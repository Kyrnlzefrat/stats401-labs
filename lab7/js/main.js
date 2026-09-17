const COMPANY_FILE = "../data/lab7_assignment_companies.csv";
const TRANSACTION_FILE = "../data/lab7_assignment_transactions_60days.csv";

const WIDTH = 1250;
const HEIGHT = 550;
const NODE_MIN_R = 7;
const NODE_MAX_R = 27;
const FADE_MS = 350;

const parseDate = d3.timeParse("%Y-%m-%d");
const formatDate = d3.timeFormat("%b %d, %Y");
const formatUSD = d3.format(",.0f");
const formatCompact = d3.format("~s");

const svg = d3.select("#network").attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
const root = svg.append("g");
const linkGroup = root.append("g").attr("class", "links");
const nodeGroup = root.append("g").attr("class", "nodes");
const labelGroup = root.append("g").attr("class", "labels");

const tooltip = d3.select("#tooltip");
const status = d3.select("#status");
const spinner = d3.select("#loading-spinner");
const slider = d3.select("#time-slider");

const color = d3.scaleOrdinal();
const regionDash = new Map();
const typeColor = d3.scaleOrdinal();

let companies = [];
let transactions = [];
let transactionsByDay = new Map();
let daySummaries = [];
let currentDay = 1;
let timer = null;
let timerDelay = 700;
let currentLinks = [];
let linkSelection = null;
let nodeSelection = null;
let labelSelection = null;
let previousActivePairs = new Set();
let maxDailyVolume = 1;
let maxDailyLinkValue = 1;
let maxTransactionCount = 1;

const simulation = d3.forceSimulation(companies)
  .force("link", d3.forceLink().id(d => d.id).distance(45).strength(0.55))
  .force("charge", d3.forceManyBody().strength(-95))
  .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
  .force("x", d3.forceX(WIDTH / 2).strength(0.01))
  .force("y", d3.forceY(HEIGHT / 2).strength(0.01))
  .force("collision", d3.forceCollide().radius(d => (d.radius || NODE_MIN_R) + 12).strength(0.8))
  .alphaDecay(0.06)
  .on("tick", ticked);

function canonicalPair(a, b) {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function makeNodeInitialPositions(nodes) {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const rx = 350;
  const ry = 230;
  nodes.forEach((d, i) => {
    const theta = (2 * Math.PI * i) / nodes.length;
    d.x = cx + rx * Math.cos(theta);
    d.y = cy + ry * Math.sin(theta);
    d.px = d.x;
    d.py = d.y;
  });
}

function normalizeTransaction(raw) {
  return {
    date: parseDate(raw.date),
    day: +raw.day,
    source: raw.source,
    target: raw.target,
    amount_usd: +raw.amount_usd,
    transaction_type: raw.transaction_type,
    transaction_count: +raw.transaction_count
  };
}

function aggregateDayLinks(rows) {
  // The assignment treats relationships as undirected. Multiple records for the
  // same pair on the same day are merged into one visual edge.
  const grouped = d3.rollup(
    rows,
    values => ({
      amount_usd: d3.sum(values, d => d.amount_usd),
      transaction_count: d3.sum(values, d => d.transaction_count),
      transaction_types: Array.from(new Set(values.map(d => d.transaction_type))),
      date: values[0].date,
      day: values[0].day
    }),
    d => canonicalPair(d.source, d.target)
  );

  return Array.from(grouped, ([pair, value]) => {
    const [source, target] = pair.split("||");
    return {
      id: pair,
      source,
      target,
      ...value,
      transaction_type: value.transaction_types[0] || "Other"
    };
  });
}

function appendCircleIcon(parent, fill, stroke, dasharray = "") {
  const icon = parent.append("span")
    .attr("class", "legend-circle-icon")
    .style("background", fill)
    .style("border-color", stroke)
    .style("border-style", dasharray ? "dashed" : "solid");
  return icon;
}

function appendLineIcon(parent, stroke, width = 3, opacity = 0.9) {
  const icon = parent.append("span")
    .attr("class", "legend-line-icon")
    .style("--line-color", stroke)
    .style("--line-width", `${width}px`)
    .style("--line-opacity", opacity);
  return icon;
}

function setupScales() {
  const sectors = Array.from(new Set(companies.map(d => d.sector))).sort();
  const regions = Array.from(new Set(companies.map(d => d.region))).sort();
  const types = Array.from(new Set(transactions.map(d => d.transaction_type))).sort();

  color.domain(sectors).range(d3.schemeTableau10.slice(0, Math.max(3, sectors.length)));
  typeColor.domain(types).range(d3.schemeSet2.slice(0, Math.max(3, types.length)));

  const dashPatterns = ["", "5,3", "2,3", "9,3,2,3", "12,4", "3,7"];
  regions.forEach((r, i) => regionDash.set(r, dashPatterns[i % dashPatterns.length]));

  const sectorLegend = d3.select("#sector-legend").html("");
  sectors.forEach(sector => {
    const row = sectorLegend.append("div").attr("class", "legend-row");
    appendCircleIcon(row, color(sector), "#334155");
    row.append("span").text(sector);
  });

  const regionLegend = d3.select("#region-legend").html("");
  regions.forEach(region => {
    const row = regionLegend.append("div").attr("class", "legend-row");
    appendCircleIcon(row, "#ffffff", "#334155", regionDash.get(region));
    row.append("span").text(region);
  });

  const sizeLegend = d3.select("#node-size-legend").html("");
  [6, 11, 16].forEach((r, i) => {
    const item = sizeLegend.append("div").attr("class", "legend-row");
    item.append("span")
      .attr("class", "legend-size-icon")
      .style("width", `${r * 2}px`)
      .style("height", `${r * 2}px`);
    item.append("span").text(i === 0 ? "Low" : i === 1 ? "Medium" : "High");
  });

  const typeLegend = d3.select("#type-legend").html("");
  types.forEach(type => {
    const row = typeLegend.append("div").attr("class", "legend-row");
    appendLineIcon(row, typeColor(type), 4, 0.9);
    row.append("span").text(type);
  });

  const widthLegend = d3.select("#link-width-legend").html("");
  [1, 4, 7].forEach((w, i) => {
    const row = widthLegend.append("div").attr("class", "legend-row");
    appendLineIcon(row, "#6f7f93", w, 0.9);
    row.append("span").text(i === 0 ? "Low" : i === 1 ? "Medium" : "High");
  });

  const opacityLegend = d3.select("#link-opacity-legend").html("");
  [{label: "Established", opacity: 0.72}, {label: "New", opacity: 0.95}].forEach(d => {
    const row = opacityLegend.append("div").attr("class", "legend-row");
    appendLineIcon(row, "#6f7f93", 4, d.opacity);
    row.append("span").text(d.label);
  });

  const volumes = daySummaries.flatMap(d => d.links.map(x => x.amount_usd));
  maxDailyVolume = d3.max(daySummaries, day => d3.max(day.nodes.map(n => n.volume), v => v)) || 1;
  maxDailyLinkValue = d3.max(volumes) || 1;
  maxTransactionCount = d3.max(transactions, d => d.transaction_count) || 1;
}

const sizeScale = d3.scaleSqrt().domain([0, 1]).range([NODE_MIN_R, NODE_MAX_R]);
const widthScale = d3.scaleSqrt().domain([0, 1]).range([1.2, 7]);

function buildDailySummaries() {
  daySummaries = d3.range(1, 61).map(day => {
    const rows = transactionsByDay.get(day) || [];
    const links = aggregateDayLinks(rows);
    const volumeByCompany = new Map(companies.map(c => [c.id, 0]));
    const countByCompany = new Map(companies.map(c => [c.id, 0]));

    links.forEach(link => {
      volumeByCompany.set(link.source, (volumeByCompany.get(link.source) || 0) + link.amount_usd);
      volumeByCompany.set(link.target, (volumeByCompany.get(link.target) || 0) + link.amount_usd);
      countByCompany.set(link.source, (countByCompany.get(link.source) || 0) + link.transaction_count);
      countByCompany.set(link.target, (countByCompany.get(link.target) || 0) + link.transaction_count);
    });

    const nodes = companies.map(c => ({
      ...c,
      volume: volumeByCompany.get(c.id) || 0,
      transaction_count: countByCompany.get(c.id) || 0
    }));

    const activeIds = new Set(links.flatMap(l => [l.source, l.target]));
    const totalValue = d3.sum(links, d => d.amount_usd);
    const totalCount = d3.sum(links, d => d.transaction_count);
    const crossRegion = d3.sum(links, link => {
      const s = companies.find(c => c.id === link.source);
      const t = companies.find(c => c.id === link.target);
      return s && t && s.region !== t.region ? 1 : 0;
    });

    return {
      day,
      date: rows.length ? rows[0].date : null,
      links,
      nodes,
      activeCompanies: activeIds.size,
      activeLinks: links.length,
      totalValue,
      totalCount,
      crossRegionLinks: crossRegion
    };
  });
}

function renderNodeLayer() {
  nodeSelection = nodeGroup.selectAll("circle.node")
    .data(companies, d => d.id)
    .join("circle")
    .attr("class", "node")
    .attr("fill", d => color(d.sector))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", d => regionDash.get(d.region) || "")
    .on("mouseenter", (event, d) => showNodeTooltip(event, d))
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));

  labelSelection = labelGroup.selectAll("text.node-label")
    .data(companies, d => d.id)
    .join("text")
    .attr("class", "node-label")
    .text(d => d.company_name);
}

function updateNetwork(day) {
  currentDay = day;
  const summary = daySummaries[day - 1];
  if (!summary) return;

  // Node objects themselves persist; only their visual properties change.
  const nodeById = new Map(summary.nodes.map(d => [d.id, d]));
  companies.forEach(c => {
    const next = nodeById.get(c.id);
    c.volume = next.volume;
    c.transaction_count = next.transaction_count;
    c.radius = sizeScale(Math.sqrt(c.volume / maxDailyVolume));
  });

  const activePairs = new Set(summary.links.map(d => d.id));

  const newLinks = summary.links.map(d => ({
    ...d,
    source: d.source,
    target: d.target,
    isNew: !previousActivePairs.has(d.id)
  }));

  linkSelection = linkGroup.selectAll("line.link")
    .data(newLinks, d => d.id)
    .join(
      enter => enter.append("line")
        .attr("class", "link")
        .attr("stroke", d => typeColor(d.transaction_type))
        .attr("stroke-width", d => widthScale(Math.sqrt(d.amount_usd / maxDailyLinkValue)))
        .attr("opacity", 0)
        .on("mouseenter", showLinkTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)
        .call(enter => enter.transition().duration(FADE_MS).attr("opacity", d => d.isNew ? 0.95 : 0.72)),
      update => update
        .attr("stroke", d => typeColor(d.transaction_type))
        .attr("stroke-width", d => widthScale(Math.sqrt(d.amount_usd / maxDailyLinkValue)))
        .transition().duration(FADE_MS)
        .attr("opacity", d => d.isNew ? 0.95 : 0.72),
      exit => exit.transition().duration(FADE_MS).attr("opacity", 0).remove()
    );

  nodeSelection
    .transition().duration(FADE_MS)
    .attr("r", d => sizeScale(Math.sqrt((d.volume || 0) / maxDailyVolume)))
    .attr("stroke-width", d => d.volume > 0 ? 2.6 : 1.2)
    .attr("stroke", d => d.volume > 0 ? "#1d2b42" : "#b4bfce");

  // Label only the more active nodes to limit clutter, while every node remains inspectable.
  labelSelection
    .attr("x", d => d.x + sizeScale(Math.sqrt((d.volume || 0) / maxDailyVolume)) + 5)
    .attr("y", d => d.y + 3)
    .attr("opacity", d => d.volume > 0 ? 0.88 : 0.35);

  updateSummary(summary);
  updateHeadings(summary);

  currentLinks = newLinks;
  previousActivePairs = activePairs;
  // Let d3-force replace source/target ids with the persistent company objects.
  // The same link objects are kept by the SVG selection, so ticks can follow node coordinates.
  simulation.force("link").links(currentLinks);
  simulation.alpha(Math.max(simulation.alpha(), 0.18)).restart();
}

function updateSummary(summary) {
  d3.select("#active-companies").text(summary.activeCompanies);
  d3.select("#active-links").text(summary.activeLinks);
  d3.select("#total-value").text(`$${formatUSD(summary.totalValue)}`);
  d3.select("#total-count").text(formatUSD(summary.totalCount));
}

function updateHeadings(summary) {
  d3.select("#day-label").text(`Day ${summary.day}`);
  d3.select("#date-label").text(summary.date ? formatDate(summary.date) : "No records");
  d3.select("#heading-day").text(`Day ${summary.day}`);
  slider.property("value", summary.day);
}

function ticked() {
  if (linkSelection) {
    linkSelection
      .attr("x1", d => getX(d.source))
      .attr("y1", d => getY(d.source))
      .attr("x2", d => getX(d.target))
      .attr("y2", d => getY(d.target));
  }
  if (nodeSelection) {
    nodeSelection.attr("cx", d => d.x).attr("cy", d => d.y);
  }
  if (labelSelection) {
    labelSelection
      .attr("x", d => d.x + (d.radius || NODE_MIN_R) + 5)
      .attr("y", d => d.y + 3);
  }
}

function getX(node) {
  return typeof node.x === "number" ? node.x : WIDTH / 2;
}

function getY(node) {
  return typeof node.y === "number" ? node.y : HEIGHT / 2;
}

function showNodeTooltip(event, d) {
  const company = d;
  tooltip
    .style("opacity", 1)
    .style("left", `${event.offsetX}px`)
    .style("top", `${event.offsetY}px`)
    .attr("aria-hidden", "false")
    .html(`
      <strong>${company.company_name}</strong><br>
      Sector: ${company.sector}<br>
      Region: ${company.region}<br>
      Current volume: $${formatUSD(company.volume || 0)}<br>
      Current transactions: ${formatUSD(company.transaction_count || 0)}
    `);
}

function showLinkTooltip(event, d) {
  tooltip
    .style("opacity", 1)
    .style("left", `${event.offsetX}px`)
    .style("top", `${event.offsetY}px`)
    .attr("aria-hidden", "false")
    .html(`
      <strong>Commercial relationship</strong><br>
      ${companyName(d.source)} ↔ ${companyName(d.target)}<br>
      Type: ${d.transaction_types.join(", ")}<br>
      Value: $${formatUSD(d.amount_usd)}<br>
      Transactions: ${formatUSD(d.transaction_count)}
    `);
}

function companyName(nodeOrId) {
  const id = typeof nodeOrId === "object" ? nodeOrId.id : nodeOrId;
  const c = companies.find(x => x.id === id);
  return c ? c.company_name : id;
}

function moveTooltip(event) {
  tooltip.style("left", `${event.offsetX}px`).style("top", `${event.offsetY}px`);
}

function hideTooltip() {
  tooltip.style("opacity", 0).attr("aria-hidden", "true");
}

function play() {
  if (timer) return;
  if (currentDay >= 60) {
    currentDay = 1;
    previousActivePairs = new Set();
    updateNetwork(currentDay);
  }
  timer = d3.interval(() => {
    updateNetwork(currentDay);
    if (currentDay >= 60) {
      pause();
      return;
    }
    currentDay += 1;
  }, timerDelay);
}

function pause() {
  if (timer) {
    timer.stop();
    timer = null;
  }
}

function reset() {
  pause();
  currentDay = 1;
  previousActivePairs = new Set();
  updateNetwork(currentDay);
}

function setupControls() {
  d3.select("#play").on("click", play);
  d3.select("#pause").on("click", pause);
  d3.select("#reset").on("click", reset);
  slider
    .property("disabled", false)
    .on("input", function () {
      pause();
      currentDay = Math.max(1, Math.min(60, +this.value));
      if (currentDay <= 1) {
        previousActivePairs = new Set();
      }
      updateNetwork(currentDay);
    });
  d3.select("#speed").on("change", function () {
    timerDelay = +this.value;
    if (timer) {
      pause();
      play();
    }
  });
}
function calculateConnectedComponents(links) {
  const adj = new Map(companies.map(c => [c.id, []]));
  links.forEach(l => {
    if (!adj.has(l.source)) adj.set(l.source, []);
    if (!adj.has(l.target)) adj.set(l.target, []);
    adj.get(l.source).push(l.target);
    adj.get(l.target).push(l.source);
  });

  const seen = new Set();
  let components = 0;
  let largest = 0;

  for (const c of companies) {
    if (seen.has(c.id)) continue;
    components += 1;
    let size = 0;
    const queue = [c.id];
    seen.add(c.id);
    while (queue.length) {
      const x = queue.pop();
      size += 1;
      for (const y of (adj.get(x) || [])) {
        if (!seen.has(y)) {
          seen.add(y);
          queue.push(y);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return { components, largest };
}

function makeFindings() {
  const perDay = daySummaries.map(summary => {
    const comps = calculateConnectedComponents(summary.links);
    const degree = new Map(companies.map(c => [c.id, 0]));
    summary.links.forEach(link => {
      degree.set(link.source, (degree.get(link.source) || 0) + 1);
      degree.set(link.target, (degree.get(link.target) || 0) + 1);
    });
    const centrality = new Map(
      companies.map(company => [
        company.id,
        companies.length > 1 ? (degree.get(company.id) || 0) / (companies.length - 1) : 0
      ])
    );
    return {
      ...summary,
      ...comps,
      degree,
      centrality
    };
  });

  const first = perDay[0];
  const last = perDay[perDay.length - 1];

  const minLinks = d3.least(perDay, d => d.activeLinks);
  const maxLinks = d3.greatest(perDay, d => d.activeLinks);

  const companyActivity = companies.map(company => {
    const firstHalfVolume = d3.sum(perDay.slice(0, 30), d => {
      const node = d.nodes.find(x => x.id === company.id);
      return node ? node.volume : 0;
    });

    const secondHalfVolume = d3.sum(perDay.slice(30), d => {
      const node = d.nodes.find(x => x.id === company.id);
      return node ? node.volume : 0;
    });

    const firstHalfCentrality = d3.mean(perDay.slice(0, 30), d => d.centrality.get(company.id) || 0) || 0;
    const secondHalfCentrality = d3.mean(perDay.slice(30), d => d.centrality.get(company.id) || 0) || 0;

    return {
      ...company,
      firstHalfVolume,
      secondHalfVolume,
      volumeChange: secondHalfVolume - firstHalfVolume,
      firstHalfCentrality,
      secondHalfCentrality,
      centralityChange: secondHalfCentrality - firstHalfCentrality
    };
  });

  const strongestCentralityIncrease = d3.greatest(companyActivity, d => d.centralityChange);
  const strongestActivityIncrease = d3.greatest(companyActivity, d => d.volumeChange);

  const pairPresence = new Map();
  const pairStats = new Map();

  perDay.forEach(summary => {
    summary.links.forEach(link => {
      const days = pairPresence.get(link.id) || [];
      days.push(summary.day);
      pairPresence.set(link.id, days);

      const stat = pairStats.get(link.id) || {
        firstValue: 0,
        firstDays: 0,
        secondValue: 0,
        secondDays: 0
      };

      if (summary.day <= 30) {
        stat.firstValue += link.amount_usd;
        stat.firstDays += 1;
      } else {
        stat.secondValue += link.amount_usd;
        stat.secondDays += 1;
      }

      pairStats.set(link.id, stat);
    });
  });

  let latestAppearance = null;
  let earliestDisappearance = null;

  pairPresence.forEach((days, pair) => {
    const starts = days[0];
    const ends = days[days.length - 1];

    const record = {
      pair,
      starts,
      ends,
      duration: days.length
    };

    if (!latestAppearance || starts > latestAppearance.starts) {
      latestAppearance = record;
    }

    if (!earliestDisappearance || ends < earliestDisappearance.ends) {
      earliestDisappearance = record;
    }
  });

  const strengtheningRelationships = [];

  pairStats.forEach((stat, pair) => {
    if (stat.firstDays > 0 && stat.secondDays > 0) {
      const firstAverage = stat.firstValue / stat.firstDays;
      const secondAverage = stat.secondValue / stat.secondDays;

      strengtheningRelationships.push({
        pair,
        firstAverage,
        secondAverage,
        increase: secondAverage - firstAverage
      });
    }
  });

  const strongestRelationshipIncrease = strengtheningRelationships.length > 0
    ? d3.greatest(strengtheningRelationships, d => d.increase)
    : null;

  const crossRegionShares = perDay.map(d => ({
    day: d.day,
    share: d.activeLinks > 0 ? d.crossRegionLinks / d.activeLinks : 0
  }));

  const crossFirst = d3.mean(crossRegionShares.slice(0, 30), d => d.share) || 0;
  const crossSecond = d3.mean(crossRegionShares.slice(30), d => d.share) || 0;

  const findings = [
    `Connectivity varies across the 60 days: active links range from ${minLinks.activeLinks} (Day ${minLinks.day}) to ${maxLinks.activeLinks} (Day ${maxLinks.day}). Day 1 has ${first.activeLinks} active links, while Day 60 has ${last.activeLinks}.`,
    `${strongestCentralityIncrease.company_name} has the largest increase in mean degree centrality between Days 1–30 and Days 31–60, from ${(strongestCentralityIncrease.firstHalfCentrality * 100).toFixed(1)}% to ${(strongestCentralityIncrease.secondHalfCentrality * 100).toFixed(1)}%. ${strongestActivityIncrease.company_name} has the largest increase in cumulative transaction value over the same period.`,
    `The number of connected components changes over time. The largest observed connected component contains ${d3.max(perDay, d => d.largest)} of ${companies.length} companies. Days with more than one component indicate temporary separation into relatively distinct clusters.`,
    latestAppearance && earliestDisappearance && strongestRelationshipIncrease
      ? `Relationships appear and disappear throughout the period. ${formatPair(latestAppearance.pair)} first appears on Day ${latestAppearance.starts}, while ${formatPair(earliestDisappearance.pair)} has its last observed activity on Day ${earliestDisappearance.ends}. Among relationships active in both halves, ${formatPair(strongestRelationshipIncrease.pair)} has the largest increase in average daily transaction value, from $${formatUSD(strongestRelationshipIncrease.firstAverage)} to $${formatUSD(strongestRelationshipIncrease.secondAverage)}.`
      : `Relationship appearance, disappearance, or strengthening could not be identified from the loaded data.`,
    `The mean share of active links crossing regions is ${(crossFirst * 100).toFixed(1)}% in Days 1–30 and ${(crossSecond * 100).toFixed(1)}% in Days 31–60.`
  ];

  const cards = d3.select("#findings").selectAll("div.finding");

  cards
    .data(findings)
    .select("p")
    .text(d => d);
}

function formatPair(pair) {
  if (!pair) {return "the relationship";}
  const [sourceId, targetId] = pair.split("||");
  return (
    `${companyName(sourceId)} ↔ ` +
    `${companyName(targetId)}`
  );
}

async function init() {
  setupControls();
  try {
    const [companyRows, transactionRows] = await Promise.all([
      d3.csv(COMPANY_FILE),
      d3.csv(TRANSACTION_FILE, normalizeTransaction)
    ]);

    companies = companyRows.map(d => ({
      id: d.id,
      company_name: d.company_name,
      sector: d.sector,
      region: d.region,
      x: WIDTH / 2,
      y: HEIGHT / 2
    }));

    transactions = transactionRows;
    transactionsByDay = d3.group(transactions, d => d.day);
    buildDailySummaries();
    setupScales();
    makeNodeInitialPositions(companies);
    renderNodeLayer();

    // Force simulation must use the persistent company objects, not clones.
    simulation.nodes(companies);
    simulation.force("link").links([]);
    simulation.alpha(1).restart();

    slider.property("disabled", false);
    spinner.classed("hidden", true);
    status.text(`${companies.length} companies · ${transactions.length} transaction records · 60 days`);

    sizeScale.domain([0, 1]);
    widthScale.domain([0, 1]);
    updateNetwork(1);
    makeFindings();
  } catch (error) {
    console.error(error);
    spinner.classed("hidden", true);
    status.text("Data load failed");
    d3.select("#error-message").text(
      `Could not load the assignment datasets. Check that the page is served through a local/web server and that the CSV files exist at ../data/. (${error.message})`
    );
  }
}

function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.18).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

init();
