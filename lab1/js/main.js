console.log("main.js loaded");
d3.csv("../data/students.csv", d=> ({name: d.name, score: +d.score})).then(data => {
    console.log(data);
    const width = 900;
    const length = 500;
    const margin = {top: 40, right: 40, bottom: 40, left: 40};
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = length - margin.top - margin.bottom;

    const svg = d3.select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", length);
    svg.append("text")
        .attr("x", width / 2).attr("y", margin.top / 2)
        .attr("text-anchor", "middle").text("Student Scores");
    const chart = svg.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);
    const x = d3.scaleBand().domain(data.map(d => d.name)).range([0, innerWidth]).padding(0.2);
    const y = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);
    chart.selectAll("rect").data(data).join("rect")
        .attr("x", d => x(d.name)).attr("y", d => y(d.score))
        .attr("width", x.bandwidth()).attr("height", d => innerHeight - y(d.score)).attr("fill", "steelblue");
    chart.selectAll("name").data(data).join("text")
        .attr("class", "name").attr("x", d => x(d.name) + x.bandwidth() / 2).attr("y", innerHeight + 30)
        .attr("text-anchor", "middle").text(d => d.name);
    chart.selectAll("score").data(data).join("text")
        .attr("class", "score").attr("x", d => x(d.name) + x.bandwidth() / 2).attr("y", d => y(d.score) - 10)
        .attr("text-anchor", "middle").text(d => d.score);    
});