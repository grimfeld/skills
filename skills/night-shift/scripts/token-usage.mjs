#!/usr/bin/env node
// Token usage for the night shift.
//
//   count --specs 602,603 [--session <id>] [--projects <dir>]
//     Run by a builder in its cloud session. Reads this session's transcript and
//     its subagents' transcripts, and prints tokens by spec and by model as JSON:
//     {"session", "specs": {"602": {<model>: {...}}}, "shared": {<model>: {...}}}.
//     A message counts toward a spec when its git branch is spec/<n>-… or its
//     working directory names spec-<n>. A subagent's other messages count toward
//     the spec its parent was on when it started it. Where a builder's subagents
//     work, and how they link to their parent: night-shift's SKILL.md, "Where the
//     work happens". Anything else is the session's shared bucket.
//     --session and --projects default to this session; tests pass them.
//
//   price [--prices <file>] < specs.json
//     Run by the morning step. stdin is an array of
//     {"spec": <n>, "session": "<id>", "tokens": {...} | null, "session_shared": {...}?}
//     and the output is, per spec, per session and for the night: usd, out,
//     fresh_in, cache_read and the models it couldn't price. Sessions and the
//     night also list their specs that never reported.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
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
  return { main, subagents: jsonlFiles(join(main.slice(0, -".jsonl".length), "subagents")) };
}

function specOf(where, specs) {
  const fromBranch = /^spec\/(\d+)(?:-|$)/.exec(where.gitBranch ?? "");
  if (fromBranch && specs.has(fromBranch[1])) return fromBranch[1];
  const fromCwd = /spec[-/](\d+)(?:[-/]|$)/.exec(where.cwd ?? "");
  if (fromCwd && specs.has(fromCwd[1])) return fromCwd[1];
  return null;
}

// One pass over every transcript. Keeps, per assistant message, only what the
// count needs, and where each Agent call (by tool_use id) was made from.
function readTranscripts(files) {
  const messages = new Map();
  const spawnedFrom = new Map();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const m = e.message;
      if (e.type !== "assistant" || !m) continue;
      const where = { gitBranch: e.gitBranch, cwd: e.cwd, file };
      for (const block of Array.isArray(m.content) ? m.content : []) {
        if (block?.type === "tool_use" && block.id) spawnedFrom.set(block.id, where);
      }
      if (!m.usage || !m.model || m.model === "<synthetic>") continue;
      // A message is written once per streamed content block, each line carrying
      // the same usage: keep one entry per message id.
      messages.set(m.id ?? e.uuid, { ...where, model: m.model, usage: m.usage });
    }
  }
  return { messages, spawnedFrom };
}

// The spec a subagent's parent was on when it started it, following parents up
// through nested subagents. Its meta.json names the Agent call's tool_use id.
function parentSpecs(subagents, spawnedFrom, specs) {
  const memo = new Map();
  const resolve = (file, seen = new Set()) => {
    if (memo.has(file)) return memo.get(file);
    if (seen.has(file)) return null;
    seen.add(file);
    let spec = null;
    const meta = file.replace(/\.jsonl$/, ".meta.json");
    if (existsSync(meta)) {
      let toolUseId = null;
      try { toolUseId = JSON.parse(readFileSync(meta, "utf8")).toolUseId; } catch {}
      const parent = toolUseId && spawnedFrom.get(toolUseId);
      if (parent) spec = specOf(parent, specs) ?? resolve(parent.file, seen);
    }
    memo.set(file, spec);
    return spec;
  };
  for (const file of subagents) resolve(file);
  return memo;
}

function addUsage(bucket, model, u) {
  const t = (bucket[model] ??= Object.fromEntries(FIELDS.map((f) => [f, 0])));
  // Transcripts without the 5m/1h split count every cache write as 5-minute.
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0);
  t.in += u.input_tokens ?? 0;
  t.out += u.output_tokens ?? 0;
  t.cache_read += u.cache_read_input_tokens ?? 0;
  t.cache_write_5m += w5m;
  t.cache_write_1h += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
}

function count(opts) {
  const specs = new Set(String(opts.specs ?? "").split(/[,\s#]+/).filter(Boolean));
  if (!specs.size) throw new Error("count needs --specs <n,n,...>");
  const session = opts.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const projects = opts.projects ?? join(homedir(), ".claude", "projects");
  const { main, subagents } = findTranscripts(projects, session);
  const { messages, spawnedFrom } = readTranscripts([main, ...subagents]);
  const fromParent = parentSpecs(subagents, spawnedFrom, specs);

  const out = { session: session ?? basename(main, ".jsonl"), specs: {}, shared: {} };
  for (const n of specs) out.specs[n] = {};
  for (const msg of messages.values()) {
    const n = specOf(msg, specs) ?? fromParent.get(msg.file) ?? null;
    addUsage(n ? out.specs[n] : out.shared, msg.model, msg.usage);
  }
  return out;
}

const emptyColumns = () => ({ usd: 0, out: 0, fresh_in: 0, cache_read: 0, unpriced: [] });

function columns(byModel, prices) {
  const c = emptyColumns();
  for (const [model, t] of Object.entries(byModel ?? {})) {
    c.out += t.out ?? 0;
    c.fresh_in += (t.in ?? 0) + (t.cache_write_5m ?? 0) + (t.cache_write_1h ?? 0);
    c.cache_read += t.cache_read ?? 0;
    if (!Object.hasOwn(prices, model)) { c.unpriced.push(model); continue; }
    c.usd += FIELDS.reduce((sum, f) => sum + ((t[f] ?? 0) * prices[model][f]) / 1e6, 0);
  }
  return c;
}

function plus(a, b) {
  return {
    usd: a.usd + b.usd,
    out: a.out + b.out,
    fresh_in: a.fresh_in + b.fresh_in,
    cache_read: a.cache_read + b.cache_read,
    unpriced: [...new Set([...a.unpriced, ...b.unpriced])],
  };
}

function roundUsd(c) {
  if (c) c.usd = Math.round(c.usd * 1e4) / 1e4;
}

function price(opts) {
  const here = dirname(fileURLToPath(import.meta.url));
  const prices = JSON.parse(readFileSync(opts.prices ?? join(here, "prices.json"), "utf8")).models;
  const rows = JSON.parse(readFileSync(0, "utf8"));
  if (!Array.isArray(rows)) throw new Error("price expects a JSON array of rows on stdin");

  // Session ids and model names come from issue comments: keep them out of
  // Object.prototype's way.
  const specs = Object.create(null);
  const sessions = Object.create(null);
  for (const r of rows) {
    const key = String(r.session ?? "unknown");
    const s = (sessions[key] ??= { specs: [], not_reported: [], shared: emptyColumns(), total: emptyColumns() });
    s.specs.push(r.spec);
    if (r.session_shared) s.shared = plus(s.shared, columns(r.session_shared, prices));
    if (!r.tokens) {
      specs[r.spec] = null;
      s.not_reported.push(r.spec);
      continue;
    }
    specs[r.spec] = columns(r.tokens, prices);
    s.total = plus(s.total, specs[r.spec]);
  }

  let night = { ...emptyColumns(), not_reported: [] };
  for (const s of Object.values(sessions)) {
    s.total = plus(s.total, s.shared);
    night = { ...plus(night, s.total), not_reported: [...night.not_reported, ...s.not_reported] };
  }
  for (const c of [...Object.values(specs), ...Object.values(sessions).flatMap((s) => [s.shared, s.total]), night]) roundUsd(c);
  return { specs: { ...specs }, sessions: { ...sessions }, night };
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
