import os
import json
import re
import openai
import requests
from bs4 import BeautifulSoup
from graphviz import Digraph
from neo4j import GraphDatabase
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
import instructor
from models import KnowledgeGraph
import time
from uuid import uuid4
import traceback
from datetime import datetime

instructor.patch()

load_dotenv()

app = Flask(__name__)

# Set your OpenAI API key
openai.api_key = os.getenv("OPENAI_API_KEY")
response_data = ""

# If Neo4j credentials are set, then Neo4j is used to store information
neo4j_username = os.environ.get("NEO4J_USERNAME")
neo4j_password = os.environ.get("NEO4J_PASSWORD")
neo4j_url = os.environ.get("NEO4J_URL")
neo4j_driver = None

if neo4j_username and neo4j_password and neo4j_url:
    neo4j_driver = GraphDatabase.driver(
        neo4j_url, auth=(neo4j_username, neo4j_password))
    with neo4j_driver.session() as session:
        try:
            session.run("RETURN 1")
            print("Neo4j database connected successfully!")
        except ValueError as ve:
            print(
                "Neo4j database [value error] connection error: {}".format(ve))
        except Exception as e:
            print("Neo4j database connection error: {}".format(e))

# Function to scrape text from a website


def scrape_text_from_url(url):
    response = requests.get(url)
    if response.status_code != 200:
        return "Error: Could not retrieve content from URL."
    soup = BeautifulSoup(response.text, "html.parser")
    paragraphs = soup.find_all("p")
    text = " ".join([p.get_text() for p in paragraphs])
    print("web scrape done")
    return text

# Check sub/user plan before making a request


def correct_json(json_str):
    """
    Corrects the JSON response from OpenAI to be valid JSON by removing trailing commas
    """
    while ',\s*}' in json_str or ',\s*]' in json_str:
        json_str = re.sub(r',\s*}', '}', json_str)
        json_str = re.sub(r',\s*]', ']', json_str)

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        print("SanitizationError:", e, "for JSON:", json_str)
        return None


@app.route("/get_response_data", methods=["POST"])
def get_response_data():
    global response_data
    user_input = request.json.get("user_input", "")
    if not user_input:
        return jsonify({"error": "No input provided"}), 400
    print("starting openai call")
    try:
        completion: KnowledgeGraph = openai.ChatCompletion.create(
            model="gpt-3.5-turbo-16k",
            messages=[
                {
                    "role": "user",
                    "content": f"Help me understand following by describing as a detailed knowledge graph: {user_input}",
                }
            ],
            response_model=KnowledgeGraph,
        )

        # Its now a dict, no need to worry about json loading so many times
        response_data = completion.model_dump()
        # response_data = correct_json(response_data)
        # Fixing 'from_' to 'from' in the edges
        for edge in response_data['edges']:
            edge['from'] = edge.pop('from_')
        print(response_data)

    except openai.error.RateLimitError as e:
        # request limit exceeded or something.
        print(e)
        return jsonify({"error": "".format(e)}), 429
    except Exception as e:
        # general exception handling
        print(e)
        return jsonify({"error": "".format(e)}), 400

    # Assuming you have the correct neo4j_driver instance.

    try:
        if neo4j_driver:
            # Import nodes
            unique_id = str(uuid4())
            description = response_data["metadata"]["description"]
            created_on = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')
            updated_on = created_on

            # Create MetaData node
            neo4j_driver.execute_query(
                """
                CREATE (m:MetaData {uuid: $uuid, description: $description, createdOn: $createdOn, lastUpdatedOn: $lastUpdatedOn})
                RETURN m
                """,
                {
                    "uuid": unique_id, "description": description,
                    "createdOn": created_on,
                    "lastUpdatedOn": updated_on
                }
            )

            # Import nodes and link to MetaData
            neo4j_driver.execute_query(
                """
                UNWIND $nodes AS node
                MERGE (n:Node {id: node.id})
                ON CREATE SET n.type = node.type, 
                            n.label = node.label, 
                            n.color = node.color
                WITH n
                MATCH (m:MetaData {uuid: $uuid})
                MERGE (m)-[:CONTAINS]->(n)
                """,
                {"nodes": response_data['nodes'], "uuid": unique_id}
            )

            # Import relationships and link to MetaData
            neo4j_driver.execute_query(
                """
                UNWIND $rels AS rel
                MATCH (s:Node {id: rel.from})
                MATCH (t:Node {id: rel.to})
                MERGE (s)-[r:RELATIONSHIP {type: rel.relationship}]->(t)
                ON CREATE SET r.direction = rel.direction,
                            r.color = rel.color,
                            r.timestamp = timestamp();
                """,
                {"rels": response_data['edges'], "uuid": unique_id}
            )

            # create a payload to return.
            nodes = [
                {
                    "data": {
                        "id": node["id"],
                        "label": node["label"],
                        "color": node.get("color", "defaultColor"),
                    }
                }
                for node in response_data["nodes"]
            ]

            edges = [
                {
                    "data": {
                        "source": edge["from"],
                        "target": edge["to"],
                        "label": edge["relationship"],
                        "color": edge.get("color", "defaultColor"),
                        "direction": edge["direction"],
                    }
                }
                for edge in response_data["edges"]
            ]

            return jsonify({
                "elements": {
                    "nodes": nodes,
                    "edges": edges
                },
                "meta": {
                    "unique_id": unique_id,
                    "description": description,
                    "createdOn": created_on,
                    "lastUpdatedOn": updated_on,
                }})
        else:
            return jsonify(
                {
                    "error": "An error occurred during the Neo4j operation",
                    "elements": {"nodes": [], "edges": []},
                    "meta": {
                        "unique_id": "",
                        "description": "",
                        "createdOn": "",
                        "lastUpdatedOn": "",
                    }
                }), 500

    except Exception as e:
        print("An error occurred during the Neo4j operation:", e)
        traceback.print_exc()
        return jsonify({"error": "An error occurred during the Neo4j operation: {}".format(e)}), 500


# Function to visualize the knowledge graph using Graphviz
@app.route("/graphviz", methods=["POST"])
def visualize_knowledge_graph_with_graphviz():
    global response_data
    dot = Digraph(comment="Knowledge Graph")
    response_dict = response_data
    # Add nodes to the graph
    for node in response_dict.get("nodes", []):
        dot.node(node["id"], f"{node['label']} ({node['type']})")

    # Add edges to the graph
    for edge in response_dict.get("edges", []):
        dot.edge(edge["from"], edge["to"], label=edge["relationship"])

    # Render and visualize
    dot.render("knowledge_graph.gv", view=False)
    # Render to PNG format and save it
    dot.format = "png"
    dot.render("static/knowledge_graph", view=False)

    # Construct the URL pointing to the generated PNG
    png_url = f"{request.url_root}static/knowledge_graph.png"

    return jsonify({"png_url": png_url}), 200


@app.route("/get_graph_data", methods=["POST"])
def get_graph_data():
    """
    This function is now redundant and will be removed soon. 
    The front-end should not call this function.
    """
    try:
        if neo4j_driver:
            nodes, _, _ = neo4j_driver.execute_query("""
            MATCH (n)
            WITH collect(
                {data: {id: n.id, label: n.label, color: n.color}}) AS node
            RETURN node
            """)
            nodes = [el['node'] for el in nodes][0]

            edges, _, _ = neo4j_driver.execute_query("""
            MATCH (s)-[r]->(t)
            WITH collect(
                {data: {source: s.id, target: t.id, label:r.type, color: r.color}}
            ) AS rel
            RETURN rel
            """)
            edges = [el['rel'] for el in edges][0]
        else:
            global response_data
            # print(response_data)
            response_dict = response_data
            # Assume response_data is global or passed appropriately
            nodes = [
                {
                    "data": {
                        "id": node["id"],
                        "label": node["label"],
                        "color": node.get("color", "defaultColor"),
                    }
                }
                for node in response_dict["nodes"]
            ]
            edges = [
                {
                    "data": {
                        "source": edge["from_"],
                        "target": edge["to"],
                        "label": edge["relationship"],
                        "color": edge.get("color", "defaultColor"),
                    }
                }
                for edge in response_dict["edges"]
            ]
        return jsonify({"elements": {"nodes": nodes, "edges": edges},
                        "message": "This function is now redundant and will be removed soon."}), 200
    except:
        # 410 Gone
        return jsonify({"elements": {"nodes": [], "edges": []},
                        "message": "This function is now redundant and will be removed soon."}), 410


@app.route("/get_graph_history", methods=["GET"])
def get_graph_history():
    try:
        if neo4j_driver:
            # Fetching 10 most recent MetaData along with related nodes and relationships
            result, _, _ = neo4j_driver.execute_query("""
            MATCH (m:MetaData)
            WITH m ORDER BY datetime(m.lastUpdatedOn) DESC LIMIT 10
            MATCH (m)-[:CONTAINS]->(n:Node)
            MATCH (n)-[r:RELATIONSHIP]->(other:Node) WHERE (m)-[:CONTAINS]->(other)
            RETURN m,n, r, other
            """)

            current_uuid = None
            graph_data = []  # temp storage
            graph_history = []  # have sorted graph_data based on unique id

            for record in result:
                # Converting dict_items to dictionary
                node_meta = dict(record['m'].items())
                # they will be converted automatically in the loop
                node_from = record['n'].items()
                relationship = record['r'].items()
                node_to = record['other'].items()

                if current_uuid is None:
                    # initial logic
                    metadata = {
                        "description": node_meta["description"],
                        "last_updated_on": node_meta["lastUpdatedOn"],
                        "created_on": node_meta["createdOn"],
                        "unique_id": node_meta["uuid"]
                    }
                    current_uuid = node_meta["uuid"]
                    graph_data.append({
                        "from": {key: value for key, value in node_from},
                        "to": {key: value for key, value in node_to},
                        "relationship": {key: value for key, value in relationship},
                    })
                elif current_uuid == node_meta["uuid"]:
                    # continue logic
                    graph_data.append({
                        "from": {key: value for key, value in node_from},
                        "to": {key: value for key, value in node_to},
                        "relationship": {key: value for key, value in relationship},
                    })
                else:
                    # changed uuid logic
                    graph_history.append({
                        "metadata": metadata,
                        "graph": graph_data,
                    })
                    # new Entry
                    graph_data = []
                    metadata = {
                        "description": node_meta["description"],
                        "last_updated_on": node_meta["lastUpdatedOn"],
                        "created_on": node_meta["createdOn"],
                        "unique_id": node_meta["uuid"]
                    }
                    current_uuid = node_meta["uuid"]
                    graph_data = []  # flashing the graph data
                    graph_data.append({
                        "from": {key: value for key, value in node_from},
                        "to": {key: value for key, value in node_to},
                        "relationship": {key: value for key, value in relationship},
                    })
            return jsonify({"graph_history": graph_history, "total": len(graph_history)})
        else:
            return jsonify({"error": "Neo4j driver not initialized"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def process_graph_data(record):
    """
    This function is now redundant and will be removed soon. 
    
    This function processes a record from the Neo4j query result
    and formats it as a dictionary with the node details and the relationship.

    :param record: A record from the Neo4j query result
    :return: A dictionary representing the graph data
    """
    try:
        node_from = record['n'].items()
        node_to = record['m'].items()
        relationship = record['r'].items()

        graph_data = {
            "from_node": {key: value for key, value in node_from},
            "to_node": {key: value for key, value in node_to},
            "relationship": {key: value for key, value in relationship},
        }

        return graph_data
    except Exception as e:
        return {"error": str(e)}


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
