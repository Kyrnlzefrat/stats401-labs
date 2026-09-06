const margin = { top: 50, right: 40, bottom: 65, left: 70 };
const width = 900 - margin.left - margin.right;
const height = 500 - margin.top - margin.bottom;

const svg = d3.select("#sentiment-chart")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

const parseDate = d3.timeParse("%Y-%m-%d");

d3.csv("../data/sentiment_by_date.csv", d => ({
    date: parseDate(d.tweet_date),
    sentiment_score: +d.sentiment_score,
    tweet_count: +d.tweet_count
}))
.then(data => {
    data = data.filter(d =>
        d.date &&
        Number.isFinite(d.sentiment_score) &&
        Number.isFinite(d.tweet_count)
    );

    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.date))
        .range([0, width]);

    const y = d3.scaleLinear()
        .domain([-1, 1])
        .range([height, 0]);

    const r = d3.scaleSqrt()
        .domain([0, d3.max(data, d => d.tweet_count)])
        .range([3, 12]);

    g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(
            d3.axisBottom(x)
                .ticks(8)
                .tickFormat(d3.timeFormat("%b %Y"))
        );

    g.append("g")
        .call(d3.axisLeft(y).ticks(7));

    g.append("text")
        .attr("x", width / 2)
        .attr("y", height + 50)
        .attr("text-anchor", "middle")
        .text("Date");

    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -50)
        .attr("text-anchor", "middle")
        .text("Average Sentiment Score");

    g.append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", y(0))
        .attr("y2", y(0))
        .attr("stroke", "#999")
        .attr("stroke-dasharray", "4,4");

    const line = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.sentiment_score))
        .curve(d3.curveMonotoneX);

    g.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", "steelblue")
        .attr("stroke-width", 2)
        .attr("d", line);

    const tooltip = d3.select("#tooltip");

    g.selectAll(".point")
        .data(data)
        .join("circle")
        .attr("class", "point")
        .attr("cx", d => x(d.date))
        .attr("cy", d => y(d.sentiment_score))
        .attr("r", d => r(d.tweet_count))
        .attr("fill", "steelblue")
        .attr("opacity", 0.75)
        .on("mousemove", function(event, d) {
            tooltip
                .style("display", "block")
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY - 28}px`)
                .html(`
                    <strong>${d3.timeFormat("%B %d, %Y")(d.date)}</strong><br>
                    Average sentiment: ${d.sentiment_score.toFixed(3)}<br>
                    Tweets: ${d.tweet_count}
                `);
        })
        .on("mouseleave", function() {
            tooltip.style("display", "none");
        });

})
.catch(error => {
    console.error("Error loading sentiment_by_date.csv:", error);

    d3.select("#error-message")
        .text("Unable to load sentiment_by_date.csv. Check the file path and local server.");
});