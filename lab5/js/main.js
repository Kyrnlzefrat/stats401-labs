const width = 900;
const height = 650;
const svg = d3.select("#network-svg").attr("width", width).attr("height", height);
const networkGroup = svg.append("g").attr("class", "network-group");

Promise.all([
  d3.csv("../data/lab5_assignment_stations.csv", d3.autoType),
  d3.csv("../data/lab5_assignment_routes.csv", d3.autoType)
]).then(([stations, routes]) => {
  console.log("Stations:", stations);
  console.log("Routes:", routes);
  createNetwork(stations, routes);
  createMatrix(stations, routes);
}).catch(error => {
    console.error("Error loading data:", error);
});

function createNetwork(stations, routes) {
  const stationById = new Map(stations.map(d => [d.id, d]));
  routes.forEach(d => {
    d.source = stationById.get(d.source);
    d.target = stationById.get(d.target);
  });
  const districtValues = [...new Set(stations.map(d => d.district))];
  const districtColor = d3.scaleOrdinal().domain(districtValues).range(d3.schemeTableau10);
  const passengerExtent = d3.extent(stations, d => d.daily_passengers);
  const nodeRadius = d3.scaleSqrt().domain(passengerExtent).range([5, 20]);
  const travelTimeExtent = d3.extent(routes, d => d.travel_time_min);
  const linkWidth = d3.scaleLinear().domain(travelTimeExtent).range([1.5, 7]);
  const routeTypeValues = [...new Set(routes.map(d => d.route_type))];
  const routeColor = d3.scaleOrdinal().domain(routeTypeValues).range(d3.schemeSet2);
  const simulation = d3.forceSimulation(stations)
    .force("link", d3.forceLink(routes).id(d => d.id).distance(70).strength(0.7))
    .force("charge", d3.forceManyBody().strength(-150))
    .force("center", d3.forceCenter(width / 2, height / 2).strength(1))
    .force("x", d3.forceX(width / 2).strength(0.08))
    .force("y", d3.forceY(height / 2).strength(0.08))
    .force("collision", d3.forceCollide().radius(d => nodeRadius(d) + 3));
  const linkGroup = networkGroup.append("g").attr("class", "links");
  const link = linkGroup.selectAll(".link").data(routes).join("line").attr("class", "link")
    .attr("stroke-width", d => linkWidth(d.travel_time_min))
    .attr("stroke", d => routeColor(d.route_type))
    .attr("stroke-opacity", 0.65);
  const nodeGroup = networkGroup.append("g").attr("class", "nodes");
  const node = nodeGroup.selectAll(".node").data(stations).join("g").attr("class", "node")
    .call(d3.drag().on("start", dragStarted).on("drag", dragged).on("end", dragEnded))
    .on("mouseenter", handleMouseEnter)
    .on("mouseleave", handleMouseLeave);
  node.each(function(d) {
    const group = d3.select(this);
    const r = nodeRadius(d.daily_passengers);
    if (d.station_type === "Local") {
      group.append("circle").attr("class", "node-shape").attr("r", r).attr("fill", districtColor(d.district));
    } else if (d.station_type === "Transfer") {
      group.append("rect").attr("class", "node-shape").attr("x", -r).attr("y", -r).attr("width", 2 * r).attr("height", 2 * r).attr("rx", 2).attr("fill", districtColor(d.district));
    } else if (d.station_type === "Terminal") {
      group.append("path").attr("class", "node-shape").attr("d", trianglePath(r)).attr("fill", districtColor(d.district));
    }
  });
  const tooltip = d3.select("#tooltip");
  function handleMouseEnter(event, d) {
    const connectedNodeIds = new Set();
    routes.forEach(linkData => {
      if (linkData.source.id === d.id) connectedNodeIds.add(linkData.target.id);
      if (linkData.target.id === d.id) connectedNodeIds.add(linkData.source.id);
    });
    connectedNodeIds.add(d.id);
    node.classed("dimmed", n => !connectedNodeIds.has(n.id));
    node.classed("highlighted", n => connectedNodeIds.has(n.id));
    link.classed("dimmed", l => l.source.id !== d.id && l.target.id !== d.id)
        .classed("highlighted", l => l.source.id === d.id || l.target.id === d.id);
    tooltip.style("opacity", 1).html(`
        <strong>${d.station_name}</strong>
        <br>
        District: ${d.district}
        <br>
        Daily passengers: ${d3.format(",")(d.daily_passengers)}
        <br>
        Station type: ${d.station_type}
        `).style("left", `${d.x + 12}px`).style("top", `${d.y + 12}px`);
  }
  function handleMouseLeave() {
    node.classed("dimmed", false).classed("highlighted", false);
    link.classed("dimmed", false).classed("highlighted", false);
    tooltip.style("opacity", 0);
  }
  simulation.on("tick", () => {
    stations.forEach(d => {
        const r = nodeRadius(d.daily_passengers);
        const padding = 35;
        d.x = Math.max(r + padding, Math.min(width - r - padding, d.x));
        d.y = Math.max(r + padding, Math.min(height - r - padding, d.y));});
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });
  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
  createLegend(districtValues, districtColor, routeTypeValues, routeColor);
}

function trianglePath(r) {
  const height = r * 1.8;
  const points = [[0, -height / 2], [-r, height / 2], [r, height / 2]];
  return d3.line()([...points, points[0]]);
}

function createLegend(districtValues, districtColor, routeTypeValues, routeColor) {
  const legend = d3.select("#legend");
  legend.html("");
  const districtSection = legend.append("div").attr("class", "legend-section");
  districtSection.append("h4").text("Node color: District");
  districtValues.forEach(district => {
    const item = districtSection.append("div").attr("class", "legend-item");
    item.append("span").attr("class", "legend-color").style("background-color", districtColor(district));
    item.append("span").text(district);
  });
  const stationSection = legend.append("div").attr("class", "legend-section");
  stationSection.append("h4").text("Node shape: Station type");
  const stationTypes = ["Local", "Transfer", "Terminal"];
  stationTypes.forEach(type => {
    const item = stationSection.append("div").attr("class", "legend-item");
    item.append("span").attr("class", `legend-shape legend-${type.toLowerCase()}`);
    item.append("span").text(type);
  });
  const passengerSection = legend.append("div").attr("class", "legend-section");
  passengerSection.append("h4").text("Node size: Daily passengers");
  passengerSection.append("div").attr("class", "legend-text").text("Larger nodes represent higher daily passenger volume.");
  const routeSection = legend.append("div").attr("class", "legend-section");
  routeSection.append("h4").text("Link color: Route type");
  routeTypeValues.forEach(type => {
    const item = routeSection.append("div").attr("class", "legend-item");
    item.append("span").attr("class", "legend-color").style("background-color", routeColor(type));
    item.append("span").text(type);
  });
  const timeSection = legend.append("div").attr("class", "legend-section");
  timeSection.append("h4").text("Link width: Travel time");
  timeSection.append("div").attr("class", "legend-text").text("Thicker links represent longer travel times.");
}

function createMatrix(stations, routes) {
  const districtOrder = ["Central", "North", "South", "East", "West"];
  const stationTypeOrder = ["Transfer", "Terminal", "Local"];
  const orderedStations = [...stations].sort((a, b) => {
    const districtDifference = districtOrder.indexOf(a.district) - districtOrder.indexOf(b.district);
    if (districtDifference !== 0) return districtDifference;
    const typeDifference = stationTypeOrder.indexOf(a.station_type) - stationTypeOrder.indexOf(b.station_type);
    if (typeDifference !== 0) return typeDifference;
    return a.station_name.localeCompare(b.station_name);
  });
  const stationById = new Map(stations.map(d => [d.id, d]));
  const connectionMap = new Map();
  routes.forEach(route => {
    const sourceId = typeof route.source === "object" ? route.source.id : route.source;
    const targetId = typeof route.target === "object" ? route.target.id : route.target;
    const key1 = `${sourceId}|${targetId}`, key2 = `${targetId}|${sourceId}`;
    connectionMap.set(key1, route); connectionMap.set(key2, route);
  });
  const matrixData = [];
  orderedStations.forEach(rowStation => {
    orderedStations.forEach(colStation => {
      const connection = connectionMap.get(`${rowStation.id}|${colStation.id}`);
      matrixData.push({ row: rowStation.id, col: colStation.id, rowStation: rowStation, colStation: colStation, connection: connection || null, connected: connection !== undefined });
    });
  });
  const margin = { top: 180, right: 40, bottom: 40, left: 180 };
  const matrixSize = 700;
  const svgWidth = margin.left + matrixSize + margin.right;
  const svgHeight = margin.top + matrixSize + margin.bottom;
  const svg = d3.select("#matrix-svg").attr("width", svgWidth).attr("height", svgHeight);
  const matrixX = d3.scaleBand().domain(orderedStations.map(d => d.id)).range([0, matrixSize]).padding(0.04);
  const matrixY = d3.scaleBand().domain(orderedStations.map(d => d.id)).range([0, matrixSize]).padding(0.04);
  const routeTypes = [...new Set(routes.map(d => d.route_type))];
  const routeColor = d3.scaleOrdinal().domain(routeTypes).range(d3.schemeSet2);
  const travelTimeExtent = d3.extent(routes, d => d.travel_time_min);
  const opacityScale = d3.scaleLinear().domain(travelTimeExtent).range([0.35, 1]);
  const districtColor = d3.scaleOrdinal().domain(districtOrder).range(d3.schemeTableau10);
  const matrixGroup = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const cells = matrixGroup.selectAll(".matrix-cell").data(matrixData).join("rect").attr("class", "matrix-cell")
    .attr("x", d => matrixX(d.col)).attr("y", d => matrixY(d.row)).attr("width", matrixX.bandwidth()).attr("height", matrixY.bandwidth())
    .attr("fill", d => d.connected ? routeColor(d.connection.route_type) : "#f3f3f3")
    .attr("fill-opacity", d => d.connected ? opacityScale(d.connection.travel_time_min) : 1);
  const columnLabels = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`).selectAll(".matrix-label").data(orderedStations).join("text").attr("class", "matrix-label")
    .attr("x", d => matrixX(d.id) + matrixX.bandwidth() / 2).attr("y", -8).attr("text-anchor", "start")
    .attr("transform", d => `rotate(-65,${matrixX(d.id) + matrixX.bandwidth() / 2},-8)`)
    .attr("fill", d => districtColor(d.district)).attr("font-weight", d => d.station_type === "Transfer" ? "bold" : "normal")
    .attr("font-style", d => d.station_type === "Terminal" ? "italic" : "normal").text(d => d.station_name);
  const rowLabels = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`).selectAll(".matrix-label").data(orderedStations).join("text").attr("class", "matrix-label")
    .attr("x", -8).attr("y", d => matrixY(d.id) + matrixY.bandwidth() / 2).attr("text-anchor", "end").attr("dominant-baseline", "middle")
    .attr("fill", d => districtColor(d.district)).attr("font-weight", d => d.station_type === "Transfer" ? "bold" : "normal")
    .attr("font-style", d => d.station_type === "Terminal" ? "italic" : "normal").text(d => d.station_name);
  const matrixTooltip = d3.select("#matrix-tooltip");
  cells.on("mouseenter", function(event, d) {
    const relatedIds = new Set([d.row, d.col]);
    cells.classed("dimmed", cell => cell.row !== d.row && cell.col !== d.col).classed("highlighted", cell => cell.row === d.row || cell.col === d.col);
    rowLabels.classed("dimmed", station => !relatedIds.has(station.id));
    columnLabels.classed("dimmed", station => !relatedIds.has(station.id));
    if (d.connected) {
      const connection = d.connection;
      matrixTooltip.style("opacity", 1).html(`<strong>${d.rowStation.station_name} ↔ ${d.colStation.station_name}</strong><br>Route type: ${connection.route_type}<br>Travel time: ${connection.travel_time_min} min`);
    } else {
      matrixTooltip.style("opacity", 1).html(`<strong>${d.rowStation.station_name} ↔ ${d.colStation.station_name}</strong><br>No direct connection`);
    }
    const containerRect = document.querySelector("#matrix-container").getBoundingClientRect();
    const tooltipX = event.clientX - containerRect.left - 60;
    const tooltipY = event.clientY - containerRect.top + 15;
    matrixTooltip.style("left", `${tooltipX}px`).style("top", `${tooltipY}px`);
  }).on("mouseleave", function() {
    cells.classed("dimmed", false).classed("highlighted", false);
    rowLabels.classed("dimmed", false);
    columnLabels.classed("dimmed", false);
    matrixTooltip.style("opacity", 0);
  });
  const districtValues = [...new Set(stations.map(d => d.district))];
  createMatrixLegend(districtValues, districtColor, routeTypes, routeColor);
}

function createMatrixLegend(districtValues, districtColor,routeTypes, routeColor) {
  const legend = d3.select("#matrix-legend");
  legend.html("");
  const districtSection = legend.append("div").attr("class", "legend-section");
  districtSection.append("h4").text("Node color: District");
  districtValues.forEach(district => {
    const item = districtSection.append("div").attr("class", "legend-item");
    item.append("span").attr("class", "legend-color").style("background-color", districtColor(district));
    item.append("span").text(district);
  });
  const routeSection = legend.append("div").attr("class", "matrix-legend-section");
  routeSection.append("h4").text("Cell color: Route type");
  routeTypes.forEach(type => {
    const item = routeSection.append("div").attr("class", "matrix-legend-item");
    item.append("span").attr("class", "matrix-legend-color").style("background-color", routeColor(type));
    item.append("span").text(type);
  });
  const timeSection = legend.append("div").attr("class", "matrix-legend-section");
  timeSection.append("h4").text("Cell opacity: Travel time");
  timeSection.append("div").attr("class", "legend-text").text("Darker cells represent longer direct travel times.");
  const orderSection = legend.append("div").attr("class", "matrix-legend-section");
  orderSection.append("h4").text("Station ordering");
  orderSection.append("div").attr("class", "legend-text").text("Stations are ordered by district, then station type.");
  const labelSection = legend.append("div").attr("class", "matrix-legend-section");
  labelSection.append("h4").text("Station labels");
  labelSection.append("div").attr("class", "legend-text").html("Label color = district<br>Bold = Transfer<br>Italic = Terminal");
}