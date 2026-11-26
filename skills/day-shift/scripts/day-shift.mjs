#!/usr/bin/env node
// The deterministic checks behind /ship:day-shift. The skill's prose keeps the
// judgement and the dialogue; this script keeps the rules.
//
//   thresholds < shipping.md
//     The day shift's limits from shipping.md's optional lines
//     `Day shift: ≤<lines> lines, <k> behaviour(s)` and `Day shift builders: <n>`.
//     Prints {lines, behaviours, builders, warnings}. A missing line takes its
//     default (200 lines, 1 behaviour, 2 builders); a malformed one too, with a warning.
//
//   classify [--shipping <file>] [--declined <file>] [--today YYYY-MM-DD] [--now <iso>] < specs.json
//     Sorts spec:ready specs into small (to propose), tonight (left for tonight),
//     dispatched (a dispatch comment under an hour old: its builder hasn't
//     relabelled it yet) and declined (said no to today).
//
//   exclusion --side day|night [--since <iso>] < specs.json
//     Whether the other shift is building. Prints {blocked, reason, specs}.
//     side day: blocked by a spec:building spec whose latest dispatch is a night
//     one, or by a night dispatch comment since <since> (06:00 local time today by
//     default: today's evening run has dispatched; a run that slipped past midnight
//     belongs to last night). side night: blocked by a spec:building
//     spec whose latest dispatch is a day one. A dispatch comment with no `shift`
//     counts as night. A spec:stuck spec never blocks.
//
//   declined list|add [<n>...] [--file <file>] [--today YYYY-MM-DD]
//     The specs the user said no to today (default file .scratch/day-shift/declined.json,
//     {"date": "YYYY-MM-DD", "specs": [<n>...]}). A file from another day reads as empty
//     and is replaced on the next add.
//
// specs.json is an array of issues: {number, title, labels: [<name>...], body,
// comments: [{body, created_at, author_association}]}. Only `night-shift` comments
// by someone with write access (OWNER, MEMBER, COLLABORATOR) count: anyone can
// comment on a public repository, so anyone else's dispatch comment is ignored.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = Object.freeze({ lines: 200, behaviours: 1, builders: 2 });
const PENDING_DISPATCH_MS = 60 * 60 * 1000;
const MORNING_HOUR = 6;
const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const clean = (line) => line.replace(/\*\*/g, "").replace(/^\s*[-*]\s*/, "").trim();

export function parseThresholds(shippingMd = "") {
  const out = { ...DEFAULTS, warnings: [] };
  for (const raw of shippingMd.split("\n")) {
    const line = clean(raw);
    const builders = line.match(/^Day shift builders:\s*(.*)$/i);
    if (builders) {
      const n = builders[1].match(/^(\d+)\s*$/);
      if (n && Number(n[1]) > 0) out.builders = Number(n[1]);
      else out.warnings.push(`unreadable "Day shift builders" line (${line}); using ${DEFAULTS.builders}`);
      continue;
    }
    const limits = line.match(/^Day shift:\s*(.*)$/i);
    if (limits) {
      const m = limits[1].match(/^(?:≤|<=)\s*(\d+)\s*(?:reviewable\s+)?lines?\s*,\s*(\d+)\s*behaviou?rs?\.?\s*$/i);
      if (m) {
        out.lines = Number(m[1]);
        out.behaviours = Number(m[2]);
      } else {
        out.warnings.push(`unreadable "Day shift" line (${line}); using ≤${DEFAULTS.lines} lines, ${DEFAULTS.behaviours} behaviour`);
      }
    }
  }
  return out;
}

export function section(body = "", heading) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

// slice's line: **Estimate:** ~<low>–<high> reviewable lines, <k> behaviours (basis: …)
export function sliceEstimate(body) {
  const slicing = section(body, "Slicing");
  if (slicing === null) return null;
  const m = slicing.match(/Estimate:\**\s*~?\s*(\d+)(?:\s*[–-]\s*~?(\d+))?\s*(?:reviewable\s+)?lines?\s*,\s*(\d+)\s*behaviou?rs?/i);
  if (!m) return { unreadable: true };
  return { low: Number(m[1]), high: Number(m[2] ?? m[1]), behaviours: Number(m[3]) };
}

// spec-me's Size section, for a spec not sliced yet: small when it says one small PR.
export function sizeSaysSmall(body) {
  const size = section(body, "Size");
  if (!size) return false;
  if (/\b(\d+|two|three|four|several|multiple|many)\s+PRs\b/i.test(size)) return false;
  return /\bsmall\b/i.test(size) && /\b(one|1|single|a)\s+(small\s+)?PR\b/i.test(size);
}

export function dispatches(issue) {
  const out = [];
  for (const c of issue.comments ?? []) {
    if (!TRUSTED_AUTHORS.has(c.author_association)) continue;
    const m = (c.body ?? "").match(/<!--\s*night-shift\s+(\{[\s\S]*?\})\s*-->/);
    if (!m) continue;
    let json;
    try { json = JSON.parse(m[1]); } catch { continue; }
    if (json.status !== "dispatched") continue;
    out.push({ shift: json.shift === "day" ? "day" : "night", created_at: c.created_at });
  }
  return out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export const latestDispatch = (issue) => dispatches(issue).at(-1) ?? null;
const labelsOf = (issue) => (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));

export function classify(specs, thresholds = DEFAULTS, { declined = [], now = new Date().toISOString() } = {}) {
  const out = { small: [], tonight: [], dispatched: [], declined: [] };
  for (const spec of specs) {
    if (!labelsOf(spec).includes("spec:ready")) continue;
    const row = { number: spec.number, title: spec.title ?? "" };
    const last = latestDispatch(spec);
    if (last && Date.parse(now) - Date.parse(last.created_at) < PENDING_DISPATCH_MS) {
      out.dispatched.push(row);
      continue;
    }
    const est = sliceEstimate(spec.body ?? "");
    let small;
    if (est === null) {
      row.sliced = false;
      row.estimate = "not sliced yet";
      small = sizeSaysSmall(spec.body ?? "");
    } else if (est.unreadable) {
      row.sliced = true;
      row.estimate = "estimate unreadable";
      small = false;
    } else {
      row.sliced = true;
      row.estimate = est.low === est.high
        ? `~${est.high}` : `~${est.low}–${est.high}`;
      row.estimate += ` lines, ${est.behaviours} behaviour${est.behaviours === 1 ? "" : "s"}`;
      small = est.high <= thresholds.lines && est.behaviours <= thresholds.behaviours;
    }
    if (!small) out.tonight.push(row);
    else if (declined.includes(spec.number)) out.declined.push(row);
    else out.small.push(row);
  }
  return out;
}

export function exclusion(specs, side, { since } = {}) {
  if (side !== "day" && side !== "night") throw new Error(`--side must be day or night, not ${side}`);
  const other = side === "day" ? "night" : "day";
  const building = [];
  const dispatchedToday = [];
  for (const spec of specs) {
    const last = latestDispatch(spec);
    if (labelsOf(spec).includes("spec:building") && last?.shift === other) building.push(spec.number);
    if (side === "day" && since && dispatches(spec).some((d) => d.shift === "night" && Date.parse(d.created_at) >= Date.parse(since))) {
      dispatchedToday.push(spec.number);
    }
  }
  if (building.length) {
    return { blocked: true, reason: `${other} shift is building`, specs: building };
  }
  if (dispatchedToday.length) {
    return { blocked: true, reason: "tonight's evening run has dispatched", specs: dispatchedToday };
  }
  return { blocked: false, reason: "", specs: [] };
}

export function readDeclined(file, today) {
  if (!existsSync(file)) return [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data.date === today && Array.isArray(data.specs) ? data.specs.map(Number) : [];
  } catch {
    return [];
  }
}

export function specNumber(value) {
  const m = String(value).trim().match(/^#?(\d+)$/);
  if (!m || Number(m[1]) < 1) throw new Error(`not a spec number: ${value}`);
  return Number(m[1]);
}

export function addDeclined(file, today, numbers) {
  const specs = [...new Set([...readDeclined(file, today), ...numbers.map(specNumber)])].sort((a, b) => a - b);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ date: today, specs }) + "\n");
  return specs;
}

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localMorning(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), MORNING_HOUR).toISOString();
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[++i];
    else opts._.push(argv[i]);
  }
  return opts;
}

const stdin = () => readFileSync(0, "utf8");
const print = (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");

function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = parseArgs(rest);
  const today = opts.today ?? localDate();
  const declinedFile = opts.file ?? opts.declined ?? ".scratch/day-shift/declined.json";
  switch (cmd) {
    case "thresholds":
      return print(parseThresholds(stdin()));
    case "classify": {
      const thresholds = parseThresholds(opts.shipping ? readFileSync(opts.shipping, "utf8") : "");
      const declined = opts.declined ? readDeclined(opts.declined, today) : [];
      return print({ thresholds, ...classify(JSON.parse(stdin()), thresholds, { declined, now: opts.now }) });
    }
    case "exclusion":
      return print(exclusion(JSON.parse(stdin()), opts.side, { since: opts.since ?? localMorning() }));
    case "declined": {
      const [action, ...numbers] = opts._;
      if (action === "list") return print({ date: today, specs: readDeclined(declinedFile, today) });
      if (action === "add") return print({ date: today, specs: addDeclined(declinedFile, today, numbers) });
      throw new Error("declined takes list or add");
    }
    default:
      throw new Error("usage: day-shift.mjs thresholds|classify|exclusion|declined …");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`day-shift: ${e.message}\n`);
    process.exit(1);
  }
}
