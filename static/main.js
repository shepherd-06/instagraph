const calcNodeWidth = (label) => Math.max(50, label.length * 8) + "px";
const form = document.getElementById("inputForm");

// General purpose post func
async function postData(url, data = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  console.log("---- postData ----");
  console.log(data);
  console.log("------------------");

  if (!response.ok) throw new Error(await response.text());

  return await response.json();
}

// create Graph in cy div.
async function createGraph(data) {
  const descriptionElement = document.getElementById("graphDescription");
  descriptionElement.innerText = data.meta.description;

  cytoscape({
    container: document.getElementById("cy"),
    elements: data.elements,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          label: "data(label)",
          "text-valign": "center",
          "text-halign": "center",
          shape: "rectangle",
          height: "50px",
          width: (ele) => calcNodeWidth(ele.data("label")),
          color: function (ele) {
            return getTextColor(ele.data("color"));
          },
          "font-size": "12px",
        },
      },
      {
        selector: "edge",
        style: {
          width: 3,
          "line-color": "data(color)",
          "target-arrow-color": "data(color)",
          "target-arrow-shape": "triangle",
          label: "data(label)",
          "curve-style": "unbundled-bezier",
          "line-dash-pattern": [4, 4],
          "text-background-color": "#ffffff",
          "text-background-opacity": 1,
          "text-background-shape": "rectangle",
          "font-size": "10px",
        },
      },
    ],
    layout: {
      name: "cose",
      fit: true,
      padding: 30,
      avoidOverlap: true,
    },

    ready: function () {
      this.fit(); // Fits all elements in the viewport
      // this.zoom(0.3); // Sets the zoom level to 80% of the original. Adjust this value as needed.
      this.center(); // Centers the graph in the viewport
    },
  });
}

// figure out the textColor
function getTextColor(bgColor) {
  bgColor = bgColor.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((start) =>
    parseInt(bgColor.substr(start, 2), 16)
  );
  const brightness = r * 0.299 + g * 0.587 + b * 0.114;
  return brightness < 40 ? "#ffffff" : "#000000";
}

// fetch graph history from the API.
async function fetchGraphHistory() {
  try {
    const response = await fetch("/get_graph_history", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      showError("Network response was not ok " + response.statusText);
      return;
    }

    const { graph_history } = await response.json();

    const graphHistoryDiv = document.getElementById("history");

    graph_history.forEach((item, index) => {
      const metadata = item.metadata;
      graphHistoryDiv.innerHTML += `
                <div class="bg-gray-200 hover:bg-gray-300 p-5 rounded" onclick="handleGraphItemClick(event)" data-item='${JSON.stringify(
                  item
                )}'>
                  <p>${index + 1}. ${metadata.description} <br/>
                  - Created On: ${metadata.created_on} <br/>
                  - Last Updated On: ${metadata.last_updated_on}</p>
                </div>`;
    });
  } catch (error) {
    console.error("Error fetching graph history:", error);
    const graphHistoryDiv = document.getElementById("history");
    graphHistoryDiv.innerHTML += `<p> Error fetching graph history: ${error}<p>`;
    return;
  }
}

// show errors at the top of screen
function showError(message) {
  document.getElementById("error-text").textContent = message;
  const errorDiv = document.getElementById("error-message");
  errorDiv.style.display = "flex";

  setTimeout(() => {
    errorDiv.style.display = "none";
  }, 5000);
}

// draw graph from history.
function handleGraphItemClick(event) {
  const graphData = JSON.parse(event.currentTarget.getAttribute("data-item"));

  const transformedData = transformDataToGraphFormat(graphData);
  // You can also display graphData.graph to the console to see the graph elements
  console.log("Transformed graph data:", transformedData);
  createGraph(transformedData);
}

function transformDataToGraphFormat(graphData) {
  /**
   * Transforms the graph history data to a format suitable for creating a graph using the createGraph function.
   *
   * @author shepherd-06
   **/

  const elements = {
    edges: [],
    nodes: [],
  };

  // Using a Set to ensure that nodes are unique
  const uniqueNodes = new Set();

  graphData.graph.forEach((item) => {
    // Add edge
    elements.edges.push({
      data: {
        color: item.relationship.color,
        label: item.relationship.type,
        source: item.from.id,
        target: item.to.id,
      },
    });

    // Add nodes only if they are unique
    if (!uniqueNodes.has(item.from.id)) {
      elements.nodes.push({
        data: {
          id: item.from.id,
          label: item.from.label,
          type: item.from.type,
          color: item.from.color,
        },
      });
      uniqueNodes.add(item.from.id);
    }

    if (!uniqueNodes.has(item.to.id)) {
      elements.nodes.push({
        data: {
          id: item.to.id,
          label: item.to.label,
          type: item.to.type,
          color: item.to.color,
        },
      });
      uniqueNodes.add(item.to.id);
    }
  });

  const meta = {
    unique_id: graphData.metadata.unique_id,
    description: graphData.metadata.description,
    createdOn: graphData.metadata.created_on,
    lastUpdatedOn: graphData.metadata.last_updated_on,
  };

  return {
    elements,
    meta,
  };
}


// Event listener for the form submission
function handleFormSubmit(e) {
  e.preventDefault(); // Prevent form submission
  const userInput = document.getElementById("userInput").value;
  const load = document.getElementById("load");

  // Add the loading class to start the animation
  load.style.display = "block"; // show the load div
  load.classList.add("loading");

  fetch("/get_response_data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_input: userInput }),
  })
    .then((response) => {
      if (!response.ok) {
        return response.text().then((text) => {
          throw new Error(text);
        });
      }
      return response.json();
    })
    .then((data) => {
      // Remove the loading class to stop the animation
      load.classList.remove("loading");
      load.style.display = "none";
      // Call createGraph with the data received
      createGraph(data);
    })
    .catch((error) => {
      // Remove the loading class if there's an error
      load.classList.remove("loading");
      load.style.display = "none";
      console.error("Fetch Error:", error);
    });
}

// Event listener for the form submission
document
  .getElementById("inputForm")
  .addEventListener("submit", handleFormSubmit);

document.addEventListener("DOMContentLoaded", fetchGraphHistory);
document.getElementById("error-close").addEventListener("click", () => {
  document.getElementById("error-message").style.display = "none";
});
