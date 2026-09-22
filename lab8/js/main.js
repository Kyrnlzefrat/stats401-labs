const state = {
  data: [],
  matrix: [],
  tfidf: [],

  summary: {},
  profiles: [],
  diversity: [],
  unusual: [],
  keywordHits: [],
  report: "",

  selected: null,
  selectedCell: null,

  search: "",
  section: "__all__",
  topic: "__all__"
};

const palette = d3.scaleOrdinal(d3.schemeTableau10);
const MAP_WIDTH = 920;
const MAP_HEIGHT = 620;
const MATRIX_WIDTH = 3000;

Promise.all([
  d3.csv("data/lab8_embedding_map.csv", d => ({
    ...d,
    page: +d.page,
    word_count: +d.word_count,
    cluster: +d.cluster,
    x: +d.x,
    y: +d.y,
    section_novelty: +d.section_novelty,
    neighbors: (d.neighbors || "")
      .split(";")
      .map(x => x.trim())
      .filter(Boolean)
  })),

  d3.csv("data/lab8_topic_section_matrix.csv", d => ({
    ...d,
    count: +d.count,
    proportion: +d.proportion,
    section_total: +d.section_total
  })),

  d3.csv("data/tfidf_terms.csv", d => ({
    ...d,
    mean_tfidf: +d.mean_tfidf
  })),

  d3.json("data/corpus_summary.json"),

  d3.csv("data/cluster_profiles.csv"),

  d3.csv("data/section_diversity.csv", d => ({
    ...d,
    passage_count: +d.passage_count,
    topic_count: +d.topic_count,
    entropy: +d.entropy,
    normalized_entropy: +d.normalized_entropy
  })),

  d3.csv("data/unusual_passages.csv", d => ({
    ...d,
    page: +d.page,
    section_novelty: +d.section_novelty
  })),

  d3.csv("data/keyword_hits.csv"),

  d3.text("docs/lab8_report.md")
])
  .then(([
    data,
    matrix,
    tfidf,
    summary,
    profiles,
    diversity,
    unusual,
    keywordHits,
    report
    ]) => {

    state.data = data;
    state.matrix = matrix;
    state.tfidf = tfidf;

    state.summary = summary;
    state.profiles = profiles;
    state.diversity = diversity;
    state.unusual = unusual;
    state.keywordHits = keywordHits;
    state.report = report;

    setupControls();
    renderOverview();
    renderLegend();
    renderMap();
    renderMatrix();

    renderFindings();
    renderPartH();
    })
  .catch(error => {
    console.error("Lab 8 data loading error:", error);

    document.querySelector("main").insertAdjacentHTML(
      "afterbegin",
      `
        <div class="finding">
          <h3>Data loading error</h3>
          <p>The visualization data could not be loaded. Please make sure that the following files exist:</p>
          <p>
            <code>lab8/data/lab8_embedding_map.csv</code><br>
            <code>lab8/data/lab8_topic_section_matrix.csv</code><br>
            <code>lab8/data/tfidf_terms.csv</code>
          </p>
          <p>Run <code>python lab8/build_analysis.py --pdf data/lab8_V2021-22_DKU_UG_Bulletin.pdf</code> first.</p>
        </div>
      `
    );
  });

function setupControls() {
  d3.select("#stat-passages").text(state.data.length.toLocaleString());

  d3.select("#stat-sections").text(
    new Set(state.data.map(d => d.section)).size
  );

  const meanLength = d3.mean(state.data, d => d.word_count);

  d3.select("#stat-length").text(
    Number.isFinite(meanLength) ? meanLength.toFixed(1) : "—"
  );

  d3.select("#stat-topics").text(
    new Set(state.data.map(d => d.cluster_name)).size
  );

  const sections = [
    ...new Set(state.data.map(d => d.section).filter(Boolean))
  ].sort();

  d3.select("#section-filter")
    .selectAll("option.more")
    .data(sections)
    .join("option")
    .attr("class", "more")
    .attr("value", d => d)
    .text(d => d);

  const topics = [
    ...new Set(state.data.map(d => d.cluster_name).filter(Boolean))
  ].sort();

  d3.select("#topic-filter")
    .selectAll("option.more")
    .data(topics)
    .join("option")
    .attr("class", "more")
    .attr("value", d => d)
    .text(d => d);

  d3.select("#search").on("input", function () {
    state.search = this.value.toLowerCase().trim();
    updatePointOpacity();
  });

  d3.select("#section-filter").on("change", function () {
    state.section = this.value;
    updatePointOpacity();
  });

  d3.select("#topic-filter").on("change", function () {
    state.topic = this.value;
    updatePointOpacity();
  });

  d3.select("#clear-selection").on("click", () => {
    state.selected = null;
    state.selectedCell = null;
    state.search = "";
    state.section = "__all__";
    state.topic = "__all__";

    d3.select("#search").property("value", "");
    d3.select("#section-filter").property("value", "__all__");
    d3.select("#topic-filter").property("value", "__all__");

    renderDetails(null);
    updatePointOpacity();
    renderMatrix();
  });
}

function renderOverview() {
  renderSectionChart();
  renderTFIDFTable();
}

function renderSectionChart() {
  const svg = d3.select("#section-chart");
  svg.selectAll("*").remove();

  const counts = d3.rollups(
    state.data,
    values => values.length,
    d => d.section
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 16);

  if (counts.length === 0) {
    svg.append("text")
      .attr("x", 410)
      .attr("y", 220)
      .attr("text-anchor", "middle")
      .text("No section data available.");
    return;
  }

  const margin = {
    top: 20,
    right: 30,
    bottom: 45,
    left: 220
  };

  const width = 820 - margin.left - margin.right;
  const height = 440 - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain([0, d3.max(counts, d => d[1])])
    .nice()
    .range([margin.left, margin.left + width]);

  const y = d3.scaleBand()
    .domain(counts.map(d => d[0]))
    .range([margin.top, margin.top + height])
    .padding(0.18);

  svg.append("g")
    .selectAll("rect")
    .data(counts)
    .join("rect")
    .attr("x", margin.left)
    .attr("y", d => y(d[0]))
    .attr("width", d => x(d[1]) - margin.left)
    .attr("height", y.bandwidth())
    .attr("rx", 3)
    .attr("fill", "#777");

  svg.append("g")
    .attr("transform", `translate(${margin.left - 8},0)`)
    .call(d3.axisLeft(y).tickSize(0))
    .selectAll("text")
    .style("font-size", "7px");

  svg.append("g")
    .attr("transform", `translate(0,${margin.top + height})`)
    .call(d3.axisBottom(x).ticks(5));

  svg.append("text")
    .attr("x", margin.left + width / 2)
    .attr("y", 435)
    .attr("text-anchor", "middle")
    .text("Passage count");
}

function renderTFIDFTable() {
  const container = d3.select("#term-table");
  container.html("");

  const terms = state.tfidf
    .slice()
    .sort((a, b) => d3.descending(a.mean_tfidf, b.mean_tfidf))
    .slice(0, 18);

  if (terms.length === 0) {
    container.append("p").text("No TF-IDF data available.");
    return;
  }

  const table = container.append("table");

  table.append("thead")
    .append("tr")
    .html("<th>Term</th><th>Mean TF-IDF</th>");

  table.append("tbody")
    .selectAll("tr")
    .data(terms)
    .join("tr")
    .html(
      d => `
        <td>${escapeHtml(d.term)}</td>
        <td>${d.mean_tfidf.toFixed(3)}</td>
      `
    );
}

function filteredData() {
  return state.data.filter(d => {
    const inSection =
      state.section === "__all__" || d.section === state.section;

    const inTopic =
      state.topic === "__all__" || d.cluster_name === state.topic;

    const text = String(d.text || "").toLowerCase();
    const section = String(d.section || "").toLowerCase();
    const chapter = String(d.chapter || "").toLowerCase();
    const subsection = String(d.subsection || "").toLowerCase();

    const inSearch =
      !state.search ||
      text.includes(state.search) ||
      section.includes(state.search) ||
      chapter.includes(state.search) ||
      subsection.includes(state.search);

    return inSection && inTopic && inSearch;
  });
}

function renderLegend() {
  const container = d3.select("#legend");
  container.html("");

  const topics = [
    ...new Set(state.data.map(d => d.cluster_name).filter(Boolean))
  ].sort();

  topics.forEach(topic => {
    const item = container
      .append("div")
      .attr("class", "legend-item");

    item.append("span")
      .attr("class", "legend-color")
      .style("background", palette(topic));

    item.append("span").text(topic);
  });

  container
    .append("div")
    .attr("class", "legend-item")
    .style("margin-left", "15px")
    .html(`
      <span style="
        width: 18px;
        height: 18px;
        display: inline-block;
        border: 1px solid #777;
        border-radius: 50%;
      "></span>
      <span>Point size = passage length</span>
    `);
}

function renderMap() {
  const svg = d3.select("#semantic-map");
  svg.selectAll("*").remove();

  const margin = {
    top: 30,
    right: 30,
    bottom: 45,
    left: 55
  };

  const width = MAP_WIDTH - margin.left - margin.right;
  const height = MAP_HEIGHT - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain(d3.extent(state.data, d => d.x))
    .nice()
    .range([margin.left, margin.left + width]);

  const y = d3.scaleLinear()
    .domain(d3.extent(state.data, d => d.y))
    .nice()
    .range([margin.top + height, margin.top]);

  const radius = d3.scaleSqrt()
    .domain(d3.extent(state.data, d => d.word_count))
    .range([2.5, 8]);

  const zoomLayer = svg.append("g").attr("class", "zoom-layer");

  zoomLayer.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${margin.top + height})`)
    .call(d3.axisBottom(x).ticks(5));

  zoomLayer.append("g")
    .attr("class", "axis y-axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5));

  zoomLayer.append("text")
    .attr("x", margin.left + width / 2)
    .attr("y", MAP_HEIGHT - 8)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .text("UMAP dimension 1");

  zoomLayer.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + height / 2))
    .attr("y", 15)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .text("UMAP dimension 2");

  const pointsLayer = zoomLayer
    .append("g")
    .attr("class", "points-layer");

  pointsLayer
    .selectAll("circle")
    .data(state.data)
    .join("circle")
    .attr("class", "passage")
    .attr("cx", d => x(d.x))
    .attr("cy", d => y(d.y))
    .attr("r", d => radius(d.word_count))
    .attr("fill", d => palette(d.cluster_name))
    .attr("fill-opacity", 0.72)
    .attr("stroke", "none")
    .on("click", (event, d) => {
      event.stopPropagation();
      selectPoint(d);
    })
    .append("title")
    .text(
      d =>
        `${d.section} · ${d.cluster_name}\n` +
        `Page ${d.page}\n` +
        `${String(d.text || "").slice(0, 220)}`
    );

  const zoom = d3.zoom()
    .scaleExtent([0.6, 12])
    .on("zoom", event => {
      zoomLayer.attr("transform", event.transform);
    });

  svg.call(zoom);

  svg.on("click", () => {
    if (state.selected !== null) {
      state.selected = null;
      renderDetails(null);
      updatePointOpacity();
      renderMatrix();
    }
  });

  updatePointOpacity();
}

function updatePointOpacity() {
  const keep = new Set(filteredData().map(d => d.passage_id));

  const neighborSet = state.selected
    ? new Set(state.selected.neighbors)
    : new Set();

  d3.select("#semantic-map .points-layer")
    .selectAll("circle")
    .attr("opacity", d => {
      if (neighborSet.size > 0) {
        if (d.passage_id === state.selected.passage_id) return 1;
        if (neighborSet.has(d.passage_id)) return 1;
        return keep.has(d.passage_id) ? 0.08 : 0.025;
      }

      return keep.has(d.passage_id) ? 0.78 : 0.05;
    })
    .attr("stroke", d => {
      if (
        state.selected &&
        d.passage_id === state.selected.passage_id
      ) {
        return "#111";
      }

      if (neighborSet.has(d.passage_id)) return "#333";
      return "none";
    })
    .attr("stroke-width", d => {
      if (
        state.selected &&
        d.passage_id === state.selected.passage_id
      ) {
        return 3;
      }

      if (neighborSet.has(d.passage_id)) return 1.5;
      return 0;
    });
}

function selectPoint(d) {
  state.selected = d;
  state.selectedCell = {
    section: d.section,
    topic: d.cluster_name
  };

  renderDetails(d);
  updatePointOpacity();
  renderMatrix();
}

function renderDetails(d) {
  const panel = d3.select("#detail-panel");
  panel.html("");

  if (!d) {
    panel.append("h3").text("Passage details");
    panel.append("p")
      .attr("class", "detail-text")
      .text("Click a point to inspect a passage and its nearest semantic neighbors.");
    return;
  }

  panel.append("h3").text(d.section || "Selected passage");

  const meta = panel.append("div").attr("class", "detail-meta");

  meta.append("div").text(`Chapter: ${d.chapter || "—"}`);
  meta.append("div").text(`Section: ${d.section || "—"}`);
  meta.append("div").text(`Subsection: ${d.subsection || "—"}`);
  meta.append("div").text(`Page: ${d.page || "—"}`);
  meta.append("div").text(`Semantic topic: ${d.cluster_name || "—"}`);
  meta.append("div").text(`Passage length: ${d.word_count || 0} words`);
  meta.append("div").text(
    `Section novelty: ${
      Number.isFinite(d.section_novelty)
        ? d.section_novelty.toFixed(3)
        : "—"
    }`
  );

  panel.append("h4").text("Original passage");

  panel.append("p")
    .attr("class", "detail-text")
    .text(d.text || "");

  const lookup = new Map(
    state.data.map(item => [item.passage_id, item])
  );

  panel.append("h4").text("5 nearest semantic neighbors");

  const neighbors = d.neighbors
    .map(id => lookup.get(id))
    .filter(Boolean)
    .slice(0, 5);

  if (neighbors.length === 0) {
    panel.append("p")
      .attr("class", "detail-text")
      .text("Nearest-neighbor information is not available for this passage.");
    return;
  }

  panel.append("div")
    .attr("class", "neighbors")
    .selectAll("button")
    .data(neighbors)
    .join("button")
    .attr("class", "neighbor-item")
    .on("click", (event, neighbor) => {
      event.stopPropagation();
      selectPoint(neighbor);
    })
    .each(function (neighbor) {
      const button = d3.select(this);

      button.append("strong")
        .text(`${neighbor.section} · ${neighbor.cluster_name}`);

      button.append("span")
        .text(
          `p.${neighbor.page} — ` +
          `${String(neighbor.text || "").slice(0, 150)}` +
          `${String(neighbor.text || "").length > 150 ? "…" : ""}`
        );
    });
}

function renderMatrix() {

    const svg = d3.select("#matrix");

    svg.selectAll("*").remove();


    const sections = [
        ...new Set(
            state.matrix
                .map(d => d.section)
                .filter(Boolean)
        )
    ].sort();


    const topics = [
        ...new Set(
            state.matrix
                .map(d => d.cluster_name)
                .filter(Boolean)
        )
    ].sort();


    if (
        sections.length === 0 ||
        topics.length === 0
    ) {

        svg
            .attr("width", MATRIX_WIDTH)
            .attr("height", 300)
            .attr("viewBox", "0 0 1100 300");

        svg.append("text")
            .attr("x", MATRIX_WIDTH / 2)
            .attr("y", 150)
            .attr("text-anchor", "middle")
            .text("No matrix data available.");

        return;
    }


    // --------------------------------------------------------
    // Dynamic matrix size
    // --------------------------------------------------------

    const rowHeight = 12;

    const margin = {
        top: 35,
        right: 80,
        bottom: 35,
        left: 330
    };

    const matrixHeight =
        margin.top +
        margin.bottom +
        sections.length * rowHeight;


    svg
        .attr("width", MATRIX_WIDTH)
        .attr("height", matrixHeight)
        .attr(
            "viewBox",
            `0 0 ${MATRIX_WIDTH} ${matrixHeight}`
        );


    const width =
        MATRIX_WIDTH -
        margin.left -
        margin.right;

    const height =
        matrixHeight -
        margin.top -
        margin.bottom;


    // --------------------------------------------------------
    // Scales
    // --------------------------------------------------------

    const x = d3.scaleBand()
        .domain(topics)
        .range([
            margin.left,
            margin.left + width
        ])
        .padding(0.30);


    const y = d3.scaleBand()
        .domain(sections)
        .range([
            margin.top,
            margin.top + height
        ])
        .padding(0.40);


    const maxCount =
        d3.max(
            state.matrix,
            d => d.count
        ) || 1;


    const color =
        d3.scaleSequential(
            d3.interpolateBlues
        )
        .domain([
            0,
            maxCount
        ]);


    // --------------------------------------------------------
    // Topic labels
    // --------------------------------------------------------

    svg.append("g")
        .selectAll("text")
        .data(topics)
        .join("text")
        .attr(
            "x",
            d => x(d) + x.bandwidth() / 2
        )
        .attr(
            "y",
            margin.top - 25
        )
        .attr(
            "text-anchor",
            "middle"
        )
        .style(
            "font-size",
            "11px"
        )
        .style(
            "font-weight",
            "normal"
        )
        .text(d => d);


    // --------------------------------------------------------
    // Section labels
    // --------------------------------------------------------

    svg.append("g")
        .attr(
            "transform",
            `translate(${margin.left - 8},0)`
        )
        .call(
            d3.axisLeft(y)
                .tickSize(0)
        )
        .selectAll("text")
        .style(
            "font-size",
            "10px"
        );


    // --------------------------------------------------------
    // Matrix lookup
    // --------------------------------------------------------

    const lookup = new Map(
        state.matrix.map(
            d => [
                `${d.section}|||${d.cluster_name}`,
                d
            ]
        )
    );


    const completeCells = [];


    for (const section of sections) {

        for (const topic of topics) {

            const key =
                `${section}|||${topic}`;

            const existing =
                lookup.get(key);


            completeCells.push(
                existing || {
                    section,
                    cluster_name: topic,
                    count: 0,
                    proportion: 0,
                    section_total: 0
                }
            );
        }
    }


    // --------------------------------------------------------
    // Matrix cells
    // --------------------------------------------------------

    const cells =
        svg.append("g")
            .selectAll("rect")
            .data(completeCells)
            .join("rect")
            .attr(
                "class",
                "matrix-cell"
            )
            .attr(
                "x",
                d => x(d.cluster_name)
            )
            .attr(
                "y",
                d => y(d.section)
            )
            .attr(
                "width",
                x.bandwidth()
            )
            .attr(
                "height",
                y.bandwidth()
            )
            .attr(
                "fill",
                d =>
                    d.count > 0
                        ? color(d.count)
                        : "#fff"
            )
            .attr(
                "stroke",
                d => {

                    if (
                        state.selectedCell &&
                        state.selectedCell.section === d.section &&
                        state.selectedCell.topic === d.cluster_name
                    ) {
                        return "#111";
                    }

                    return "#e5e5e5";
                }
            )
            .attr(
                "stroke-width",
                d => {

                    if (
                        state.selectedCell &&
                        state.selectedCell.section === d.section &&
                        state.selectedCell.topic === d.cluster_name
                    ) {
                        return 3;
                    }

                    return 1;
                }
            )
            .on(
                "click",
                (event, d) => {

                    event.stopPropagation();

                    selectCell(d);
                }
            );


    // --------------------------------------------------------
    // Tooltips
    // --------------------------------------------------------

    cells.append("title")
        .text(
            d =>
                `${d.section} · ${d.cluster_name}\n` +
                `${d.count} passages` +
                (
                    Number.isFinite(d.proportion)
                        ? ` (${(
                            d.proportion * 100
                        ).toFixed(1)}%)`
                        : ""
                )
        );


    // --------------------------------------------------------
    // Matrix legend
    // --------------------------------------------------------

    const legendX = 2850;
    const legendY = 1000;

    svg.append("text")
        .attr(
            "x",
            legendX
        )
        .attr(
            "y",
            legendY
        )
        .style(
            "font-size",
            "12px"
        )
        .text("Passage count");


    const gradientWidth = 140;
    const gradientSteps = 20;


    svg.append("g")
        .selectAll("rect")
        .data(
            d3.range(gradientSteps)
        )
        .join("rect")
        .attr(
            "x",
            d =>
                legendX +
                (
                    gradientWidth /
                    gradientSteps
                ) * d
        )
        .attr(
            "y",
            legendY + 12
        )
        .attr(
            "width",
            gradientWidth /
            gradientSteps + 1
        )
        .attr(
            "height",
            12
        )
        .attr(
            "fill",
            d =>
                color(
                    maxCount *
                    d /
                    (gradientSteps - 1)
                )
        );


    svg.append("text")
        .attr(
            "x",
            legendX
        )
        .attr(
            "y",
            legendY + 42
        )
        .style(
            "font-size",
            "11px"
        )
        .text("0");


    svg.append("text")
        .attr(
            "x",
            legendX + gradientWidth
        )
        .attr(
            "y",
            legendY + 42
        )
        .attr(
            "text-anchor",
            "end"
        )
        .style(
            "font-size",
            "11px"
        )
        .text(maxCount);
}

function selectCell(d) {

    state.selectedCell = {
        section: d.section,
        topic: d.cluster_name
    };

    state.section = d.section;
    state.topic = d.cluster_name;
    state.selected = null;


    // Synchronize filters
    d3.select("#section-filter")
        .property("value", d.section);

    d3.select("#topic-filter")
        .property("value", d.cluster_name);


    // Matching passages
    const matches = state.data.filter(
        item =>
            item.section === d.section &&
            item.cluster_name === d.cluster_name
    );


    // Show visible feedback in detail panel
    const panel =
        d3.select("#detail-panel");

    panel.html("");

    panel.append("h3")
        .text("Selected Matrix Cell");

    panel.append("div")
        .attr("class", "detail-meta")
        .html(`
            <div><strong>Section:</strong> ${escapeHtml(d.section)}</div>
            <div><strong>Semantic topic:</strong> ${escapeHtml(d.cluster_name)}</div>
            <div><strong>Passages:</strong> ${matches.length}</div>
        `);

    panel.append("p")
        .attr("class", "detail-text")
        .text(
            matches.length > 0
                ? "Matching passages are highlighted in the semantic map."
                : "No passages belong to this section-topic combination."
        );


    // Update both views
    updatePointOpacity();
    renderMatrix();
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[character])
  );
}

function renderFindings() {

  const container = d3.select("#findings");

  container.html("");


  // ========================================================
  // 1. Major semantic topics
  // ========================================================

  const topics = d3.rollups(
    state.data,
    values => values.length,
    d => d.cluster_name
  ).sort(
    (a, b) => d3.descending(a[1], b[1])
  );


  container.append("div")
    .attr("class", "finding")
    .html(`
      <h3>1. Major semantic topics</h3>

      <p>
        The largest semantic topics are:
        ${topics.slice(0, 5).map(
          d =>
            `<strong>${escapeHtml(d[0])}</strong>
             (${d[1].toLocaleString()} passages)`
        ).join(", ")}.
      </p>
    `);


  // ========================================================
  // 2. Topics across sections
  // ========================================================

  const coverage = d3.rollups(
    state.data,
    values => new Set(
      values.map(d => d.section)
    ).size,
    d => d.cluster_name
  ).sort(
    (a, b) => d3.descending(a[1], b[1])
  );


  container.append("div")
    .attr("class", "finding")
    .html(`
      <h3>2. Topics appearing across formal sections</h3>

      <p>
        The topics with the broadest formal coverage are:
        ${coverage.slice(0, 5).map(
          d =>
            `<strong>${escapeHtml(d[0])}</strong>
             (${d[1]} sections)`
        ).join(", ")}.
      </p>
    `);


  // ========================================================
  // 3. Semantic diversity
  // ========================================================

  if (state.diversity.length > 0) {

    const diversity =
      state.diversity
        .slice()
        .sort(
          (a, b) =>
            d3.descending(
              a.normalized_entropy,
              b.normalized_entropy
            )
        );


    const d = diversity[0];


    container.append("div")
      .attr("class", "finding")
      .html(`
        <h3>3. Most semantically diverse section</h3>

        <p>
          The formal section with the highest normalized semantic
          diversity is
          <strong>${escapeHtml(d.section)}</strong>,
          with a normalized entropy of
          <strong>${d.normalized_entropy.toFixed(3)}</strong>.
        </p>
      `);
  }


  // ========================================================
  // 4. Cross-section semantic neighbors
  // ========================================================

  const lookup = new Map(
    state.data.map(
      d => [d.passage_id, d]
    )
  );


  let pair = null;


  for (const d of state.data) {

    for (const id of d.neighbors) {

      const n = lookup.get(id);

      if (
        n &&
        n.section !== d.section
      ) {
        pair = {
          source: d,
          target: n
        };

        break;
      }
    }

    if (pair) {
      break;
    }
  }


  if (pair) {

    container.append("div")
      .attr("class", "finding")
      .html(`
        <h3>4. Cross-section semantic similarity</h3>

        <p>
          Passage
          <strong>${escapeHtml(pair.source.passage_id)}</strong>
          from
          <strong>${escapeHtml(pair.source.section)}</strong>
          has a nearest semantic neighbor
          <strong>${escapeHtml(pair.target.passage_id)}</strong>
          from
          <strong>${escapeHtml(pair.target.section)}</strong>.
        </p>

        <p>
          <strong>Source:</strong>
          ${escapeHtml(
            String(pair.source.text || "").slice(0, 300)
          )}...
        </p>

        <p>
          <strong>Neighbor:</strong>
          ${escapeHtml(
            String(pair.target.text || "").slice(0, 300)
          )}...
        </p>
      `);
  }


  // ========================================================
  // 5. Unusual passages
  // ========================================================

  if (state.unusual.length > 0) {

    const unusual =
      state.unusual
        .slice()
        .sort(
          (a, b) =>
            d3.descending(
              a.section_novelty,
              b.section_novelty
            )
        );


    const d = unusual[0];


    container.append("div")
      .attr("class", "finding")
      .html(`
        <h3>5. Passages unusual for their section</h3>

        <p>
          The passage with the highest section-novelty score is
          <strong>${escapeHtml(d.passage_id)}</strong>,
          from
          <strong>${escapeHtml(d.section)}</strong>,
          page ${d.page}, with novelty
          <strong>${d.section_novelty.toFixed(3)}</strong>.
        </p>

        <p>
          ${escapeHtml(
            String(d.text || "").slice(0, 400)
          )}...
        </p>
      `);
  }


  // ========================================================
  // 6. Required keyword search
  // ========================================================

  const keywords = [
    "credit",
    "graduation",
    "registration",
    "academic integrity"
  ];


  container.append("div")
    .attr("class", "finding")
    .html(`
      <h3>6. Required keyword distributions</h3>

      <p>
        ${keywords.map(keyword => {

          const hits =
            state.keywordHits.filter(
              d => d.query === keyword
            );

          const sections =
            new Set(
              hits.map(d => d.section)
            );

          return `
            <strong>${keyword}</strong>
            appears in ${hits.length.toLocaleString()}
            passages across ${sections.size}
            formal sections
          `;

        }).join("; ")}.
      </p>
    `);
}

function renderPartH() {

  const container = d3.select("#part-h-content");

  container.html("");

  if (!state.report) {
    container.append("p")
      .text("Part H report is not available.");
    return;
  }

  const lines = state.report.split(/\r?\n/);

  let paragraph = [];

  function flushParagraph() {

    if (paragraph.length === 0) {
      return;
    }

    const text = paragraph.join(" ");

    container.append("p")
      .html(markdownInlineToHtml(text));

    paragraph = [];
  }

  lines.forEach(line => {

    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();

      container.append("h2")
        .text(trimmed.slice(2));

      return;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();

      container.append("h3")
        .text(trimmed.slice(3));

      return;
    }

    paragraph.push(trimmed);
  });

  flushParagraph();
}


function markdownInlineToHtml(text) {

  let html = escapeHtml(text);

  html = html.replace(
    /\*\*(.*?)\*\*/g,
    "<strong>$1</strong>"
  );

  html = html.replace(
    /\*(.*?)\*/g,
    "<em>$1</em>"
  );

  html = html.replace(
    /`(.*?)`/g,
    "<code>$1</code>"
  );

  return html;
}