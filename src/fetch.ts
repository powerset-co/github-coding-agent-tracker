// fetch.ts — Fetches daily commit counts from the GitHub Search API.
//
// For each date, we query:
//   1. Total public commits (split into 24x 1-hour windows, then summed)
//   2. Per-agent commit counts
//
// Results are written to data/YYYY-MM-DD.csv with columns: date, query, count.
//
// Usage:
//   bun run src/fetch.ts 2026-02-14           # single day
//   bun run src/fetch.ts 2025-02-17 2026-02-15  # inclusive date range

import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { AGENTS } from "./agents.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OctokitWithPlugins = Octokit.plugin(throttling, retry);

const octokit = new OctokitWithPlugins({
  auth: process.env.GITHUB_TOKEN,
  retry: { doNotRetry: [404, 422] },
  throttle: {
    onRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
      octokit.log.warn(`Rate limit hit for ${options.method} ${options.url}`);
      if (retryCount < 3) {
        octokit.log.info(`Retrying after ${retryAfter}s...`);
        return true;
      }
    },
    onSecondaryRateLimit: (retryAfter: number, options: any, octokit: any, retryCount: number) => {
      octokit.log.warn(`Secondary rate limit hit for ${options.method} ${options.url}`);
      if (retryCount < 3) {
        return true;
      }
    },
  },
});

// Execute a commit search and return the total_count.
// We set per_page=1 since we only need the count, not the actual results.
async function searchCount(query: string): Promise<number> {
  const resp = await octokit.rest.search.commits({ q: query, per_page: 1 });
  return resp.data.total_count;
}

// GitHub's search API total_count is approximate and becomes unreliable above
// ~1M results. Splitting the day into 24x 1-hour windows keeps each window's
// count well under that ceiling, making the summed daily total more accurate.
// Build 24 hourly windows: 00..01, 01..02, ..., 23..00(+1day)
function buildTimeWindows(date: string): { key: string; start: string; end: string }[] {
  const windows: { key: string; start: string; end: string }[] = [];
  const nextDay = new Date(date + "T00:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);

  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    const start = `${date}T${hh}:00:00Z`;
    // Hour 23 ends at next day's T00:00:00Z
    const endHH = String(h + 1).padStart(2, "0");
    const end = h < 23 ? `${date}T${endHH}:00:00Z` : `${nextDayStr}T00:00:00Z`;
    windows.push({ key: `total_${hh}`, start, end });
  }
  return windows;
}

async function fetchDay(date: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const timeWindows = buildTimeWindows(date);

  // Fetch total public commits in 24x 1-hour windows and sum them.
  let total = 0;
  for (const win of timeWindows) {
    const q = `is:public committer-date:${win.start}..${win.end}`;
    const count = await searchCount(q);
    counts.set(win.key, count);
    total += count;
  }
  counts.set("total", total);

  // Fetch commit count for each agent's search query.
  for (const agent of AGENTS) {
    const q = `is:public ${agent.query} committer-date:${date}`;
    const count = await searchCount(q);
    counts.set(agent.key, count);
  }

  return counts;
}

// Write results as a flat CSV: data/YYYY-MM-DD.csv
// Each row includes the date so files are self-contained and can be queried
// with DuckDB via: SELECT * FROM read_csv('data/*.csv')
function writeCSV(date: string, counts: Map<string, number>): void {
  mkdirSync("data", { recursive: true });

  const rows = ["date,query,count"];
  rows.push(`${date},total,${counts.get("total")}`);
  for (const agent of AGENTS) {
    rows.push(`${date},${agent.key},${counts.get(agent.key)}`);
  }

  writeFileSync(join("data", `${date}.csv`), rows.join("\n") + "\n");
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function printSummary(date: string, counts: Map<string, number>): void {
  const parts = [`${date}: total=${formatNumber(counts.get("total")!)}`];
  for (const agent of AGENTS) {
    parts.push(`${agent.key}=${formatNumber(counts.get(agent.key)!)}`);
  }
  console.log(parts.join("  "));
}

// Parse CLI args into an array of YYYY-MM-DD date strings.
// Supports a single date or an inclusive start..end range.
function parseDateRange(args: string[]): string[] {
  if (args.length === 0) {
    console.error("Usage: bun run src/fetch.ts YYYY-MM-DD [YYYY-MM-DD]");
    process.exit(1);
  }

  const start = args[0];
  const end = args.length > 1 ? args[1] : start;

  const dates: string[] = [];
  const current = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");

  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    console.error("Error: GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  const dates = parseDateRange(process.argv.slice(2));
  console.log(
    `Fetching data for ${dates.length} day(s): ${dates[0]} to ${dates[dates.length - 1]}`,
  );

  // Each day requires 24 (hourly windows) + N (agents) search API calls.
  // GitHub's search API rate limit is 30 requests/minute for authenticated users.
  // With 12 agents, that's 36 queries/day — so we can backfill ~1 day/minute.
  for (const date of dates) {
    const counts = await fetchDay(date);
    writeCSV(date, counts);
    printSummary(date, counts);
  }
}

main();
