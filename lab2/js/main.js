const width = 1000;
const height = 620;
const margin = {top: 70, right: 250, bottom: 100, left: 80};
const tooltip = d3.select("#tooltip");
d3.csv("../data/cities_multivariate.csv", d => ({
    city: d.city,
    population: +d.population,
    temp_c: +d.temp_c,
    development_level: d.development_level,
    region: d.region
})).then(data => {
    console.log(data);
    const svg = d3.select("#chart").append("svg").attr("width", width).attr("height", height);
    svg.append("text").attr("class", "title").attr("x", 300).attr("y", 30).text("Population, Temperature, Development, and Region by City");
    const xScale = d3.scaleBand().domain(data.map(d => d.city)).range([margin.left, width - margin.right - 50]).padding(0.2);
    const populationScale = d3.scaleLinear().domain([0, d3.max(data, d => d.population)]).nice().range([height - margin.bottom, margin.top]);
    const temperatureScale = d3.scaleLinear().domain([d3.min(data, d => d.temp_c), d3.max(data, d => d.temp_c)]).range([height - margin.bottom, margin.top]);
    const developmentScale = d3.scaleOrdinal().domain(["Low", "Medium", "High"]).range([8, 14, 21]);
    const regions = Array.from(new Set(data.map(d => d.region)));
    const colorScale = d3.scaleOrdinal().domain(regions).range(d3.schemeCategory10);
    svg.append("g").attr("transform", `translate(0, ${height - margin.bottom})`).call(d3.axisBottom(xScale)).selectAll("text").attr("transform", "rotate(-45)").style("text-anchor", "end");
    svg.append("g").attr("transform", `translate(${margin.left}, 0)`).call(d3.axisLeft(populationScale));
    svg.append("g").attr("transform", `translate(${width - margin.right}, 0)`).call(d3.axisLeft(temperatureScale));
    svg.append("text").attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 25).attr("text-anchor", "middle").attr("class", "axis-label").text("City");
    svg.append("text").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", 15).attr("text-anchor", "middle").attr("class", "axis-label").text("Population(Million)");
    svg.append("text").attr("transform","rotate(90)").attr("x", height / 2).attr("y", -(width - margin.right) + 45).attr("text-anchor", "middle").attr("class", "axis-label").text("Temperature (°C)");
    svg.selectAll(".bar").data(data).join("rect").attr("class", "bar")
    .attr("x", d => xScale(d.city)).attr("y", d => populationScale(d.population))
    .attr("width", xScale.bandwidth()).attr("height", d => height - margin.bottom - populationScale(d.population))
    .attr("fill", "#9ecae1")
    .on("mouseover", (event, d) => {
        tooltip.style("opacity", 1).html(
            `<strong>${d.city}</strong><br>
            Population: ${d.population} million <br>
            Temperature: ${d.temp_c}°C<br>
            Development Level: ${d.development_level}<br>
            Region: ${d.region}`);}).on("mousemove", function(event){
                tooltip.style("left", (event.pageX + 10) + "px").style("top", (event.pageY + 10) + "px");
            }).on("mouseout", function(){tooltip.style("opacity", 0);});
    svg.selectAll(".temperature-point").data(data).join("circle").attr("class", ".temperature-point")
    .attr("cx", d => xScale(d.city) + xScale.bandwidth() / 2).attr("cy", d => temperatureScale(d.temp_c))
    .attr("r", d => developmentScale(d.development_level)).attr("fill", d => colorScale(d.region)).attr("opacity", 0.9)
    .attr("opacity", 0.9).on("mouseover", (event, d) => {
        d3.select(this).attr("stroke", "black").attr("stroke-width", 3);
        tooltip.style("opacity", 1).html(
            `<strong>${d.city}</strong><br>
            Population: ${d.population} million <br>
            Temperature: ${d.temp_c}°C<br>
            Development Level: ${d.development_level}<br>`);}).on("mousemove", function(event){
                tooltip.style("left", (event.pageX + 10) + "px").style("top", (event.pageY + 10) + "px");
            }).on("mouseout", function(){d3.select(this).attr("stroke", "white").attr("stroke-width", 2); tooltip.style("opacity", 0);});
    const regionLegend = svg.append("g").attr("class", "legend").attr("transform", `translate(${width - margin.right +35}, 80)`);
    regionLegend.append("text").attr("class", "legend-label").attr("y", -20).text("Region").style("font-weight", "bold");
    const regionItems = regionLegend.selectAll(".legend-item").data(regions).join("g").attr("class", "legend-item").attr("transform", (d, i) => `translate(0, ${i * 20})`);
    regionItems.append("circle").attr("r", 7).attr("fill", d => colorScale(d));
    regionItems.append("text").attr("x", 14).attr("y", 4).attr("class", "legend-text").text(d => d);
    const developmentLegend = svg.append("g").attr("class", "legend").attr("transform", `translate(${width - margin.right + 35}, ${80 + regions.length * 20 + 30})`);
    developmentLegend.append("text").attr("class", "legend-label").attr("y", -25).text("Development Level").style("font-weight", "bold");
    const developmentLevels = ["Low", "Medium", "High"];
    const developmentItems = developmentLegend.selectAll(".legend-item").data(developmentLevels).join("g").attr("class", "development-item").attr("transform", (d, i) => `translate(0, ${i * 45})`);
    developmentItems.append("circle").attr("r", d => developmentScale(d)).attr("fill", "gray").attr("opacity", 0.8);
    developmentItems.append("text").attr("x", 30).attr("y", 5).attr("class", "legend-text").text(d => d);
    svg.append("text").attr("x", width - margin.right + 15).attr("y", height - margin.bottom - 100).attr("font-size", "12px").text("Bar height → Population");
    svg.append("text").attr("x", width - margin.right + 15).attr("y", height - margin.bottom - 75).attr("font-size", "12px").text("Bubble position → Temperature");
    svg.append("text").attr("x",width - margin.right + 15).attr("y",height - margin.bottom - 50).attr("font-size", "12px").text("Bubble size → Development");
    svg.append("text").attr("x",width - margin.right + 15).attr("y",height - margin.bottom - 25).attr("font-size", "12px").text("Bubble color → Region");
})  