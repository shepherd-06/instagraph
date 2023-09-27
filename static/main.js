const calcNodeWidth = (label) => Math.max(50, label.length * 8) + "px";
const form = document.getElementById("inputForm");
const load = document.getElementById("load");

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
      graphHistoryDiv.innerHTML += `
              <div class="bg-gray-200 hover:bg-gray-300 p-5 rounded" onclick="handleGraphItemClick(event)" data-item='${JSON.stringify(
                item
              )}'>
                <p>${index + 1}. From: ${item.from_node.label} (Type: ${
        item.from_node.type
      }) 
                - Relationship: ${item.relationship.type} (Direction: ${
        item.relationship.direction
      }) 
                - To: ${item.to_node.label} (Type: ${item.to_node.type})</p>
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
  const itemData = JSON.parse(event.currentTarget.getAttribute("data-item"));
  const transformedData = transformDataToGraphFormat(itemData);

  createGraph(transformedData);
}

function transformDataToGraphFormat(itemData) {
  /**
   * Transforms the graph history data to a format suitable for creating a graph using the createGraph function.
   *
   * @author shepherd-06
   **/
  return {
    elements: {
      edges: [
        {
          data: {
            color: itemData.relationship.color,
            label: itemData.relationship.type,
            source: itemData.from_node.id,
            target: itemData.to_node.id,
          },
        },
      ],
      nodes: [
        {
          data: {
            id: itemData.from_node.id,
            label: itemData.from_node.label,
            type: itemData.from_node.type,
            color: itemData.from_node.color,
          },
        },
        {
          data: {
            id: itemData.to_node.id,
            label: itemData.to_node.label,
            type: itemData.to_node.type,
            color: itemData.to_node.color,
          },
        },
      ],
    },
  };
}

// Event listener for the form submission
function handleFormSubmit(e) {
  e.preventDefault(); // Prevent form submission
  const userInput = document.getElementById("userInput").value;

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
      // Call createGraph with the data received
      createGraph(data);
    })
    .catch((error) => {
      // Remove the loading class if there's an error
      load.classList.remove("loading");
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
