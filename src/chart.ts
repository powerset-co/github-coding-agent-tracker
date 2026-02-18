// chart.ts — Generates an area chart (chart.png) showing the combined percentage
// of public GitHub commits made by any AI coding agent over time.
//
// Reads all CSV files from data/*.csv, sums every agent's commits per day, and
// renders a Vega-Lite area chart via sharp (SVG -> PNG).

import { globSync } from "fs";
import { readFileSync, writeFileSync } from "fs";
import * as vega from "vega";
import * as vegaLite from "vega-lite";
import sharp from "sharp";

interface DataPoint {
  date: string;
  percentage: number;
  totalCommits: number;
}

// Maps display names to CSV keys. Cursor combines editor + background agents.
const CHART_AGENTS: { name: string; keys: string[] }[] = [
  { name: "Claude Code", keys: ["claude"] },
  { name: "GitHub Copilot", keys: ["copilot"] },
  { name: "Cursor", keys: ["cursor_editor", "cursor_bg"] },
  { name: "Devin AI", keys: ["devin"] },
  { name: "Google Jules", keys: ["jules"] },
  { name: "Aider", keys: ["aider"] },
  { name: "OpenAI Codex", keys: ["codex"] },
  { name: "OpenCode", keys: ["opencode"] },
  { name: "Amazon Q", keys: ["amazonq"] },
];

// Load all daily CSV files and compute the combined agent percentage per day.
// CSV format: date,query,count — the date is read from the row, not the filename.
function loadData(): DataPoint[] {
  const files = globSync("data/*.csv");
  const points: DataPoint[] = [];
  const agentKeys = CHART_AGENTS.flatMap((a) => a.keys);

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const rows = new Map<string, number>();
    let date = "";

    for (const line of content.trim().split("\n").slice(1)) {
      const [d, query, countStr] = line.split(",");
      date = d;
      rows.set(query, parseInt(countStr, 10));
    }

    const total = rows.get("total");
    if (!total || total === 0) continue;

    const agentSum = agentKeys.reduce((sum, k) => sum + (rows.get(k) ?? 0), 0);
    points.push({ date, percentage: (agentSum / total) * 100, totalCommits: total });
  }

  // Sort chronologically so the chart x-axis is in order
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

// Build a Vega-Lite spec for a single area chart: x=date, y=combined agent %.
function buildSpec(data: DataPoint[]): vegaLite.TopLevelSpec {
  // Pick x-axis format based on date range span
  const dates = data.map((d) => d.date);
  const spanMs = new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime();
  const spanDays = spanMs / (1000 * 60 * 60 * 24);

  // For longer spans, limit the number of ticks to avoid repetitive labels
  // Using tickCount ensures labels are spaced out appropriately
  const axisConfig =
    spanDays < 60
      ? { title: null, format: "%b %d", labelAngle: -45 }
      : { title: null, format: "%b %Y", labelAngle: -45, tickCount: 8 };

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: "AI Coding Agent Commits on GitHub (% of public commits)",
    width: 1100,
    height: 450,
    padding: 20,
    background: "white",
    layer: [
      {
        data: { values: data },
        mark: { type: "area", line: true, opacity: 0.3, color: "#4c78a8" },
        encoding: {
          x: {
            field: "date",
            type: "temporal",
            axis: axisConfig,
          },
          y: {
            field: "percentage",
            type: "quantitative",
            axis: { title: "% of public commits", format: ".2f" },
          },
        },
      },
      {
        data: { values: [{}] },
        mark: {
          type: "text",
          text: "research.powerset.co",
          fontSize: 28,
          opacity: 0.08,
          angle: -25,
          font: "Helvetica Neue, Arial, sans-serif",
        },
        encoding: {
          x: { datum: { expr: "width / 2" }, type: "quantitative", scale: null },
          y: { datum: { expr: "height / 2" }, type: "quantitative", scale: null },
        },
      },
    ],
    config: {
      font: "Helvetica Neue, Arial, sans-serif",
      title: { fontSize: 16, anchor: "start" as const },
      axis: { labelFontSize: 11, titleFontSize: 12 },
    },
  } as vegaLite.TopLevelSpec;
}

// Build a markdown table showing each agent's % of all public commits over the
// last 10 days, inject into README.md.
function generateTable() {
  const files = globSync("data/*.csv");
  const perAgent = new Map<string, Map<string, number>>(); // agent -> date -> pct
  const allDates = new Set<string>();

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const rows = new Map<string, number>();
    let date = "";
    for (const line of content.trim().split("\n").slice(1)) {
      const [d, query, countStr] = line.split(",");
      date = d;
      rows.set(query, parseInt(countStr, 10));
    }
    const total = rows.get("total");
    if (!total || total === 0) continue;
    allDates.add(date);

    for (const agent of CHART_AGENTS) {
      const count = agent.keys.reduce((sum, k) => sum + (rows.get(k) ?? 0), 0);
      let byDate = perAgent.get(agent.name);
      if (!byDate) {
        byDate = new Map();
        perAgent.set(agent.name, byDate);
      }
      byDate.set(date, (count / total) * 100);
    }
  }

  const last10 = [...allDates].sort().slice(-10);

  // Average each agent's daily percentage over the last 10 days
  const sortedAgents = [...perAgent.entries()]
    .map(([agent, byDate]) => {
      const pcts = last10.map((d) => byDate.get(d) ?? 0);
      return [agent, pcts.reduce((a, b) => a + b, 0) / pcts.length] as const;
    })
    .sort((a, b) => b[1] - a[1]);

  const header = `| Agent | % of public commits |`;
  const separator = `|-------|---------------------|`;
  const rows = sortedAgents.map(([agent, avgPct]) => {
    return `| ${agent} | ${avgPct.toFixed(2)}% |`;
  });

  const table = [header, separator, ...rows].join("\n");

  const readme = readFileSync("README.md", "utf-8");
  const updated = readme.replace(
    /<!-- recent-table-start -->[\s\S]*?<!-- recent-table-end -->/,
    `<!-- recent-table-start -->\n${table}\n<!-- recent-table-end -->`,
  );
  writeFileSync("README.md", updated);
  console.log(`Updated README.md with ${last10.length}-day table (${sortedAgents.length} agents)`);
}

async function main() {
  const data = loadData();
  if (data.length === 0) {
    console.error("No data found in data/*.csv");
    process.exit(1);
  }

  console.log(`Loaded ${data.length} days of data`);

  // Compile Vega-Lite -> Vega, render to SVG, then convert to PNG via sharp
  const vlSpec = buildSpec(data);
  const vegaSpec = vegaLite.compile(vlSpec).spec;
  const view = new vega.View(vega.parse(vegaSpec), { renderer: "none" });
  const svg = await view.toSVG();

  const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
  writeFileSync("chart.png", png);
  console.log(`Wrote chart.png (${(png.length / 1024).toFixed(0)} KB)`);

  generateTable();
}

main();
