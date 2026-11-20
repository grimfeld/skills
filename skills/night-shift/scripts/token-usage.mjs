#!/usr/bin/env node
// Token usage for the night shift.
//
//   count --specs 602,603 [--session <id>] [--projects <dir>]
//     Run by a builder in its cloud session. Reads this session's transcript and
//     its subagents' transcripts, and prints tokens by spec and by model as JSON:
//     {"session", "specs": {"602": {<model>: {...}}}, "shared": {<model>: {...}}}.
//     A message counts toward a spec when its git branch is spec/<n>-… or its
//     working directory names spec-<n>; anything else is the session's shared bucket.
//
//   price [--prices <file>] < specs.json
//     Run by the morning step. stdin is an array of
//     {"spec": <n>, "session": "<id>", "tokens": {...} | null, "session_shared": {...}?}
//     and the output is the cost and token columns per spec, per session and for the night.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const FIELDS = ["in", "out", "cache_read", "cache_write_5m", "cache_write_1h"];

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function jsonlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsonlFiles(p);
    return name.endsWith(".jsonl") ? [p] : [];
  });
}

function findTranscripts(projects, session) {
  const projectDirs = readdirSync(projects).map((d) => join(projects, d)).filter((d) => statSync(d).isDirectory());
  let main = null;
  if (session) {
    main = projectDirs.map((d) => join(d, `${session}.jsonl`)).find(existsSync) ?? null;
  } else {
    // No session id: take the most recently written top-level transcript.
    const all = projectDirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => join(d, f)));
    main = all.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  }
  if (!main) throw new Error(`no transcript found for session ${session ?? "(latest)"} under ${projects}`);
  const sessionDir = main.slice(0, -".jsonl".length);
  return { main, files: [main, ...jsonlFiles(join(sessionDir, "subagents"))] };
}

function specOf(entry, specs) {
  const fromBranch = /^spec\/(\d+)(?:-|$)/.exec(entry.gitBranch ?? "");
  if (fromBranch && specs.has(fromBranch[1])) return fromBranch[1];
  const fromCwd = /spec[-/](\d+)(?:[-/]|$)/.exec(entry.cwd ?? "");
  if (fromCwd && specs.has(fromCwd[1])) return fromCwd[1];
  return null;
}

function addUsage(bucket, model, u) {
  const t = (bucket[model] ??= Object.fromEntries(FIELDS.map((f) => [f, 0])));
  const write = u.cache_creation_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write;
  t.in += u.input_tokens ?? 0;
  t.out += u.output_tokens ?? 0;
  t.cache_read += u.cache_read_input_tokens ?? 0;
  t.cache_write_5m += w5m;
  t.cache_write_1h += w1h;
}

function count(opts) {
  const specs = new Set(String(opts.specs ?? "").split(/[,\s#]+/).filter(Boolean));
  if (!specs.size) throw new Error("count needs --specs <n,n,...>");
  const session = opts.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const projects = opts.projects ?? join(homedir(), ".claude", "projects");
  const { main, files } = findTranscripts(projects, session);

  // A message is written once per streamed content block, each line carrying the
  // same usage: keep one line per message id.
  const messages = new Map();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const m = e.message;
      if (e.type !== "assistant" || !m?.usage || !m.model || m.model === "<synthetic>") continue;
      messages.set(m.id ?? e.uuid, e);
    }
  }

  const out = { session: session ?? main.split("/").pop().replace(/\.jsonl$/, ""), specs: {}, shared: {} };
  for (const n of specs) out.specs[n] = {};
  for (const e of messages.values()) {
    const n = specOf(e, specs);
    addUsage(n ? out.specs[n] : out.shared, e.message.model, e.message.usage);
  }
  return out;
}

function columns(byModel, prices, unpriced) {
  const c = { usd: 0, out: 0, fresh_in: 0, cache_read: 0 };
  for (const [model, t] of Object.entries(byModel ?? {})) {
    c.out += t.out ?? 0;
    c.fresh_in += (t.in ?? 0) + (t.cache_write_5m ?? 0) + (t.cache_write_1h ?? 0);
    c.cache_read += t.cache_read ?? 0;
    const p = prices[model];
    if (!p) { unpriced.add(model); continue; }
    c.usd += FIELDS.reduce((sum, f) => sum + ((t[f] ?? 0) * p[f]) / 1e6, 0);
  }
  return c;
}

function plus(a, b) {
  return Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));
}

function price(opts) {
  const here = dirname(fileURLToPath(import.meta.url));
  const prices = JSON.parse(readFileSync(opts.prices ?? join(here, "prices.json"), "utf8")).models;
  const rows = JSON.parse(readFileSync(0, "utf8"));
  const unpriced = new Set();
  const zero = { usd: 0, out: 0, fresh_in: 0, cache_read: 0 };
  const out = { specs: {}, sessions: {}, night: { ...zero }, not_reported: [], unpriced_models: [] };

  for (const r of rows) {
    const s = (out.sessions[r.session ?? "unknown"] ??= { specs: [], shared: { ...zero }, total: { ...zero } });
    s.specs.push(r.spec);
    if (r.session_shared) {
      s.shared = plus(s.shared, columns(r.session_shared, prices, unpriced));
    }
    if (!r.tokens) {
      out.specs[r.spec] = null;
      out.not_reported.push(r.spec);
      continue;
    }
    out.specs[r.spec] = columns(r.tokens, prices, unpriced);
    s.total = plus(s.total, out.specs[r.spec]);
  }
  for (const s of Object.values(out.sessions)) {
    s.total = plus(s.total, s.shared);
    out.night = plus(out.night, s.total);
  }
  out.unpriced_models = [...unpriced];
  const round = (c) => c && (c.usd = Math.round(c.usd * 1e4) / 1e4);
  [...Object.values(out.specs), ...Object.values(out.sessions).flatMap((s) => [s.shared, s.total]), out.night].forEach(round);
  return out;
}

const opts = args(process.argv.slice(2));
const mode = opts._[0];
try {
  const result = mode === "count" ? count(opts) : mode === "price" ? price(opts) : null;
  if (!result) throw new Error("usage: token-usage.mjs count --specs <n,...> | price < specs.json");
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`token-usage: ${err.message}`);
  process.exit(1);
}
