const width = 1450;
const height = 850;
const svg = d3.select("svg").attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
const tooltip = d3.select("#tooltip");
const statusColor = d3.scaleOrdinal().domain(["Increase", "Unchanged", "Decrease"]).range(["#4daf4a","#999999","#e41a1c"]);

d3.json("../data/lab6_assignment_gdp.json").then(data => {
  console.log("GDP hierarchy loaded:", data);
  createTreemap(data, "#treemap-squarify", d3.treemapSquarify);
  createTreemap(data, "#treemap-binary", d3.treemapBinary);
}).catch(error => {
  console.error("Error loading GDP hierarchy:", error);
});

function createTreemap(data, selector, tileMethod) {
  const root = d3.hierarchy(data).sum(d => d.gdp || 0).sort((a, b) => b.value - a.value);
  console.log("Hierarchy for", selector, root);
  const treemapLayout = d3.treemap()
    .tile(tileMethod)
    .size([width, height])
    .paddingOuter(8)
    .paddingInner(4)
    .paddingTop(d => (d.depth === 1 ? 30 : d.depth === 2 ? 24 : 3))
    .round(true);
  treemapLayout(root);
  const svg = d3.select(selector).append("svg").attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const continentNodes = root.children || [];
  svg.selectAll(".continent-boundary").data(continentNodes).join("rect").attr("class", "continent-boundary")
    .attr("x", d => d.x0).attr("y", d => d.y0).attr("width", d => d.x1 - d.x0).attr("height", d => d.y1 - d.y0)
    .attr("fill", "none").attr("stroke", "#333").attr("stroke-width", 2);
  svg.selectAll(".continent-label").data(continentNodes).join("text").attr("class", "continent-label")
    .attr("x", d => d.x0 + 7).attr("y", d => d.y0 + 18).text(d => d.data.name);
  const areaNodes = root.descendants().filter(d => d.depth === 2);
  svg.selectAll(".area-boundary").data(areaNodes).join("rect").attr("class", "area-boundary")
    .attr("x", d => d.x0).attr("y", d => d.y0).attr("width", d => d.x1 - d.x0).attr("height", d => d.y1 - d.y0)
    .attr("fill", "none").attr("stroke", "#888").attr("stroke-width", 1);
  const areaLabels = svg.selectAll(".area-label").data(areaNodes).join("text").attr("class", "area-label")
    .attr("x", d => d.x0 + 5).attr("y",d => d.y0 + 15).text(d => d.data.name);
    areaLabels.each(function(d){
        const text = d3.select(this); const cellWidth = d.x1 - d.x0; const cellHeight = d.y1 - d.y0;
        text.style("display", "block");
        let fontSize = Math.min(14, Math.max(8, cellHeight * 0.25));
        text.style("font-size", `${fontSize}px`);
        while(this.getComputedTextLength() > cellWidth - 12){
            fontSize -= 0.1;
            text.style("font-size", `${fontSize}px`);
        }
        let label = d.data.name;
        text.text(label);
        while (this.getComputedTextLength() > cellWidth - 12 && label.length > 3){
            label = label.slice(0, -1);
            text.text(label + "...");
        }
    });
  const leaves = root.leaves();
  const cells = svg.selectAll(".cell").data(leaves).join("g").attr("class", "cell").attr("transform", d => `translate(${d.x0},${d.y0})`);
  cells.append("rect").attr("width", d => Math.max(0, d.x1 - d.x0)).attr("height", d => Math.max(0, d.y1 - d.y0)).attr("fill", d => statusColor(d.data.status));
  const countryLabels = cells.append("text").attr("class", "country-label").attr("x", 5).attr("y", 18).text(d => d.data.name);
  countryLabels.each(function(d){
        const text = d3.select(this); const cellWidth = d.x1 - d.x0; const cellHeight = d.y1 - d.y0;
        if (cellWidth < 12 || cellHeight < 7) {text.style("display", "none");return;}
        text.style("display", "block");
        let fontSize = Math.min(14,Math.max(8,Math.min(cellWidth * 0.15, cellHeight * 0.3)));
        text.style("font-size", `${fontSize}px`);
        while (this.getComputedTextLength() > cellWidth - 8 ){fontSize -= 0.1;text.style("font-size",`${fontSize}px`);}
        let label = d.data.name;
        text.text(label);
        while (this.getComputedTextLength() > cellWidth - 8 && label.length > 3){
            label = label.slice(0, -1);
            text.text(label + "...");
        }
    }); 
    cells.on("mouseover", function(event, d) {
    d3.select(this).select("rect").attr("stroke", "black").attr("stroke-width", 3);
    const ancestors = d.ancestors();
    tooltip.style("opacity", 1).html(`
      <strong>${d.data.name}</strong>
      <br>Continent: ${ancestors[2].data.name}
      <br>Area: ${ancestors[1].data.name}
      <br>GDP: $${Number(d.data.gdp).toLocaleString()} billion
      <br>Status: ${d.data.status}
    `);
  }).on("mousemove", function(event) {
    tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
  }).on("mouseout", function() {
    d3.select(this).select("rect").attr("stroke", "white").attr("stroke-width", 1.5);
    tooltip.style("opacity", 0);
  });
}