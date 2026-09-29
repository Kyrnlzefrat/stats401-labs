const GDP_FILE = "../data/lab9_gdp_2025_top50.csv";
const LOCAL_GEOJSON = "../data/world.geojson";
const REMOTE_GEOJSON =
  "https://raw.githubusercontent.com/datasets/geo-countries/main/data/countries.geojson";
const CARTOGRAM_TOPOJSON =
  "https://cdn.jsdelivr.net/npm/visionscarto-world-atlas@1/world/110m.json";

const tooltip = d3.select("#tooltip");
let selectedIso = null;
let choroplethPaths;
let cartogram;

const formatGDP = value =>
  value == null || Number.isNaN(value)
    ? "No data"
    : `$${d3.format(",.0f")(value)}B`;

const colorScale = d3
  .scaleSequential(d3.interpolateBlues)
  .domain([Math.log10(300), Math.log10(31000)]);

const colorForGDP = value =>
  value == null || Number.isNaN(value)
    ? "#e9edf1"
    : colorScale(Math.log10(Math.max(300, value)));

function loadGeoJSON() {
  return d3.json(LOCAL_GEOJSON).catch(() => {
    console.warn("Local world.geojson not found; using the public Natural Earth GeoJSON fallback.");
    return d3.json(REMOTE_GEOJSON);
  });
}

function isoFromFeature(feature) {
  const p = feature.properties || {};
  return (
    p.iso_a3 ||
    p.ISO_A3 ||
    p.ADM0_A3 ||
    p["ISO3166-1-Alpha-3"] ||
    p.a3 ||
    p.iso3 ||
    null
  );
}

function normalizedFeatures(geoData) {
  return geoData.features.map(f => {
    f.properties = f.properties || {};
    const iso3 = isoFromFeature(f);
    f.properties._iso3 = iso3 ? String(iso3).toUpperCase() : null;
    return f;
  });
}

function buildMapJoin(features, stats) {
  const byIso = new Map(stats.map(d => [d.iso3, d]));
  features.forEach(f => {
    const row = byIso.get(f.properties._iso3);
    f.properties.value = row ? row.gdp : null;
    f.properties.rank = row ? row.rank : null;
    f.properties.countryDataName = row ? row.country : f.properties.name || "Unknown";
  });
}

function showTooltip(event, d) {
  tooltip
    .style("opacity", 1)
    .html(
      `<strong>${d.properties.countryDataName}</strong><br>
       GDP: ${formatGDP(d.properties.value)}`
    )
    .style("left", `${event.clientX + 12}px`)
    .style("top", `${event.clientY + 12}px`);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}

function updateSelectionLabel(statsByIso) {
  const label = d3.select("#selected-label");
  if (!selectedIso) {
    label.text("No country selected");
    return;
  }
  const row = statsByIso.get(selectedIso);
  label.text(row ? `${row.country} · ${formatGDP(row.gdp)}` : selectedIso);
}

function updateChoroplethClasses() {
  if (!choroplethPaths) return;
  choroplethPaths
    .classed("selected", d => selectedIso && d.properties._iso3 === selectedIso)
    .classed("dimmed", d => selectedIso && d.properties._iso3 !== selectedIso && d.properties.value != null);
}

function selectCountry(iso3) {
  selectedIso = iso3 ? iso3.toUpperCase() : null;
  updateChoroplethClasses();

  if (cartogram) {
    const existingColor = cartogram.color();
    cartogram.color(existingColor);
  }
}

function drawLegend(svg, x, y, width, height) {
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", "gdp-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%");

  const stops = d3.range(0, 1.001, 0.1);
  stops.forEach(t => {
    const value = 300 * Math.pow(31000 / 300, t);
    gradient
      .append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", colorForGDP(value));
  });

  const legend = svg.append("g").attr("class", "legend").attr("transform", `translate(${x},${y})`);
  legend
    .append("text")
    .attr("class", "legend-title")
    .attr("y", -8)
    .text("Nominal GDP (USD billions, log color scale)");

  legend
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("rx", 4)
    .attr("fill", "url(#gdp-gradient)");

  const values = [300, 500, 1000, 2000, 5000, 10000, 30000];
  const logMin = Math.log10(300);
  const logMax = Math.log10(31000);

  values.forEach(value => {
    const tx =
      ((Math.log10(value) - logMin) / (logMax - logMin)) * width;

    legend
      .append("line")
      .attr("x1", tx)
      .attr("x2", tx)
      .attr("y1", height)
      .attr("y2", height + 5)
      .attr("stroke", "#77818a");

    legend
      .append("text")
      .attr("x", tx)
      .attr("y", height + 20)
      .attr("text-anchor", "middle")
      .text(value >= 1000 ? `$${value / 1000}T` : `$${value}B`);
  });

  legend
    .append("rect")
    .attr("x", width + 22)
    .attr("width", 12)
    .attr("height", 12)
    .attr("rx", 2)
    .attr("fill", "#e9edf1");

  legend
    .append("text")
    .attr("x", width + 40)
    .attr("y", 10)
    .text("No data");
}

function drawChoropleth(geoData, stats, statsByIso) {
  const container = d3.select("#choropleth");
  const rect = container.node().getBoundingClientRect();
  const width = Math.max(760, rect.width);
  const height = Math.min(660, Math.max(470, width * 0.58));

  container.selectAll("*").remove();

  const svg = container
    .append("svg")
    .attr("class", "choropleth-svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "World choropleth map of 2025 nominal GDP");

  const mapGroup = svg.append("g");

  const projection = d3.geoNaturalEarth1();
  projection.fitExtent(
    [[16, 18], [width - 16, height - 100]],
    geoData
  );

  const path = d3.geoPath().projection(projection);

  choroplethPaths = mapGroup
    .selectAll(".country")
    .data(geoData.features)
    .join("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", d => colorForGDP(d.properties.value))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.65)
    .classed("missing", d => d.properties.value == null)
    .on("mouseenter", function(event, d) {
      showTooltip(event, d);
      d3.select(this).attr("stroke", "#111").attr("stroke-width", 1.8);
    })
    .on("mousemove", showTooltip)
    .on("mouseleave", function() {
      hideTooltip();
      d3.select(this)
        .attr("stroke", d => selectedIso && d.properties._iso3 === selectedIso ? "#111" : "#ffffff")
        .attr("stroke-width", d => selectedIso && d.properties._iso3 === selectedIso ? 2.4 : 0.65);
    })
    .on("click", function(event, d) {
      selectCountry(d.properties._iso3);
      updateSelectionLabel(statsByIso);
    });

  drawLegend(svg, 34, height - 66, Math.min(390, width - 160), 15);

  const zoom = d3
    .zoom()
    .scaleExtent([1, 8])
    .on("zoom", event => {
      mapGroup.attr("transform", event.transform);
    });

  svg.call(zoom);

  updateChoroplethClasses();
}

function drawCartogram(topology, statsByIso) {
  const host = document.getElementById("cartogram");
  host.innerHTML = "";

  const width = Math.max(760, host.getBoundingClientRect().width - 10);
  const height = Math.max(560, Math.min(720, width * 0.58));

  // cartogram-chart consumes TopoJSON and distorts area according to a numeric value.
  cartogram = new Cartogram(host)
    .width(width)
    .height(height)
    .topoJson(topology)
    .topoObjectName("countries")
    .projection(d3.geoEqualEarth())
    .iterations(20)
    .value(feature => {
      const iso = String(feature.properties?.a3 || "").toUpperCase();
      const row = statsByIso.get(iso);
      // No-data countries use only a tiny rendering baseline; they are never treated as GDP=0.
      return row ? Math.max(row.gdp, 1) : 0.01;
    })
    .color(feature => {
      const iso = String(feature.properties?.a3 || "").toUpperCase();
      const row = statsByIso.get(iso);
      if (selectedIso && iso === selectedIso) return "#111111";
      if (row) return colorForGDP(row.gdp);
      return "#e9edf1";
    })
    .label(feature => {
      const iso = String(feature.properties?.a3 || "").toUpperCase();
      const row = statsByIso.get(iso);
      return row ? `${row.country} (${iso})` : (feature.properties?.name || iso);
    })
    .valFormatter(value => formatGDP(value))
    .units("")
    .tooltipContent(feature => {
      const iso = String(feature.properties?.a3 || "").toUpperCase();
      const row = statsByIso.get(iso);
      return row
        ? `GDP rank: ${row.rank}`
        : "No GDP value in the provided top-50 dataset";
    })
    .onClick(feature => {
      const iso = String(feature.properties?.a3 || "").toUpperCase();
      if (statsByIso.has(iso)) {
        selectCountry(iso);
        updateSelectionLabel(statsByIso);
      }
    });

  // Re-apply the current selection after the first render.
  selectCountry(selectedIso);
}

Promise.all([
  d3.csv(GDP_FILE, d => ({
    iso3: d.iso3.trim().toUpperCase(),
    country: d.country.trim(),
    gdp: +d.gdp_2025_billion_usd,
    rank: +d.rank
  })),
  loadGeoJSON(),
  d3.json(CARTOGRAM_TOPOJSON)
])
  .then(([stats, geoData, topology]) => {
    const statsByIso = new Map(stats.map(d => [d.iso3, d]));

    normalizedFeatures(geoData);
    buildMapJoin(geoData.features, stats);

    drawChoropleth(geoData, stats, statsByIso);
    drawCartogram(topology, statsByIso);

    d3.select("#clear-selection").on("click", () => {
      selectedIso = null;
      updateSelectionLabel(statsByIso);
      updateChoroplethClasses();
      if (cartogram) cartogram.color(cartogram.color());
    });
  })
  .catch(error => {
    console.error(error);
    document.querySelector("main").insertAdjacentHTML(
      "afterbegin",
      `<section class="card"><strong>Loading error:</strong> ${error.message}
       <br>Please make sure <code>data/lab9_gdp_2025_top50.csv</code> exists and that the page is served
       through GitHub Pages or another web server rather than opened directly as a local file.</section>`
    );
  });
