#!/usr/bin/env node
// Token usage for the night shift.
//
//   count --specs 602,603 [--session <id>] [--projects <dir>]
//     Run by a builder in its cloud session. Reads this session's transcript and
//     its subagents' transcripts, and prints tokens by spec and by model as JSON:
//     {"session", "specs": {"602": {<model>: {...}} | null}, "shared": {<model>: {...}},
//      "unmatched": ["<n>", ...]}.
//     A message counts toward a spec when its git branch is spec/<n>-… or its
//     working directory names spec-<n>. A subagent's other messages count toward
//     the spec its parent was on when it started it. Where a builder's subagents
//     work, and how they link to their parent: night-shift's SKILL.md, "Where the
//     work happens". Anything else is the session's shared bucket.
//     A spec no message counted toward is null (not reported, never $0) and is
//     listed in "unmatched": [<n>, ...], with one stderr line each; count still
//     exits 0 so the matched specs keep their numbers.
//     --session and --projects default to this session; tests pass them.
//     Marks: once the main transcript holds a `token-usage.mjs mark <n>` Bash
//     call, its messages go by mark alone, in line order: from a mark up to the
//     next, to that spec (to shared under a mark for a spec not in --specs, and
//     before the first mark); branch and working directory no longer count there.
//     A subagent goes to the spec of the mark its Agent call was made under,
//     following nested subagents up; only when that gives none do its own branch
//     and working directory decide. A session with no marks counts as above.
//
//   mark <n>
//     Run by a builder as it starts (or comes back to) spec <n>. Prints
//     {"mark":"<n>"} and nothing else: count reads the call from the transcript.
//
//   rows --specs 650,657 [--repo <owner/repo>] [--from <dir>]
//     Run by the morning step: prints the array price reads, one row per spec,
//     from the spec issue's comments (gh api --paginate; --repo defaults to
//     origin's; --from reads <dir>/<n>.json, a comments array, instead). The
//     session is the newest `dispatched` night-shift comment's; tokens (and
//     session_shared) come from the newest night-shift comment after it whose
//     JSON has "tokens", passed through as written; none gives null. A spec whose
//     newest night-shift comment since dispatched isn't ready or stuck also gets
//     "status": "building".
//
//   price [--prices <file>] < specs.json
//     Run by the morning step. stdin is an array of
//     {"spec": <n>, "session": "<id>", "tokens": {...} | null, "session_shared": {...}?,
//      "status": "building"?} (status is ignored)
//     and the output is, per spec, per session and for the night: usd, out,
//     fresh_in, cache_read and the models it couldn't price. Sessions and the
//     night also list their specs that never reported: tokens null, or {} (an
//     object with no models).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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

// A builder's `token-usage.mjs mark <n>`, as a Bash call anywhere in its command line.
const MARK = /token-usage\.mjs["']?\s+mark\s+["']?#?(\d+)\b/g;
function markIn(block) {
  if (block?.type !== "tool_use" || block.name !== "Bash" || typeof block.input?.command !== "string") return null;
  return [...block.input.command.matchAll(MARK)].at(-1)?.[1] ?? null;
}

// One pass over every transcript. Keeps, per assistant message, only what the
// count needs, and where each Agent call (by tool_use id) was made from.
// In the main transcript it also follows the marks, in line order: each message
// and Agent call carries the latest mark at or before it (`mark`, or undefined).
function readTranscripts(main, files) {
  const messages = new Map();
  const spawnedFrom = new Map();
  let marked = false;
  for (const file of files) {
    let mark;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const m = e.message;
      if (e.type !== "assistant" || !m) continue;
      const blocks = Array.isArray(m.content) ? m.content : [];
      if (file === main) {
        for (const block of blocks) {
          const n = markIn(block);
          if (n) { mark = n; marked = true; }
        }
      }
      const where = { gitBranch: e.gitBranch, cwd: e.cwd, file, mark };
      for (const block of blocks) {
        if (block?.type === "tool_use" && block.id) spawnedFrom.set(block.id, where);
      }
      if (!m.usage || !m.model || m.model === "<synthetic>") continue;
      // A message is written once per streamed content block, each line carrying
      // the same usage: keep one entry per message id.
      messages.set(m.id ?? e.uuid, { ...where, model: m.model, usage: m.usage });
    }
  }
  return { messages, spawnedFrom, marked };
}

// With marks, a main-transcript message or Agent call belongs to its mark's
// spec; before the first mark, or under a mark for a spec not counted, to none.
const markSpec = (where, specs) => (where.mark && specs.has(where.mark) ? where.mark : null);

// The spec a subagent's parent was on when it started it, following parents up
// through nested subagents. Its meta.json names the Agent call's tool_use id.
// In a marked session an Agent call in the main transcript gives its mark's
// spec, and one made in a subagent follows that subagent up first.
function parentSpecs(main, subagents, spawnedFrom, specs, marked) {
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
      if (parent && !marked) spec = specOf(parent, specs) ?? resolve(parent.file, seen);
      else if (parent && parent.file === main) spec = markSpec(parent, specs);
      else if (parent) spec = resolve(parent.file, seen) ?? specOf(parent, specs);
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
  const { messages, spawnedFrom, marked } = readTranscripts(main, [main, ...subagents]);
  const fromParent = parentSpecs(main, subagents, spawnedFrom, specs, marked);

  const out = { session: session ?? basename(main, ".jsonl"), specs: {}, shared: {} };
  for (const n of specs) out.specs[n] = {};
  for (const msg of messages.values()) {
    // Marks win: in a marked session the main transcript goes by mark alone, and
    // a subagent by its Agent call before its own branch or worktree.
    const n = !marked ? specOf(msg, specs) ?? fromParent.get(msg.file) ?? null
      : msg.file === main ? markSpec(msg, specs)
      : fromParent.get(msg.file) ?? specOf(msg, specs);
    addUsage(n ? out.specs[n] : out.shared, msg.model, msg.usage);
  }
  // A spec no message counted toward is not reported, never $0: null, listed and warned about.
  out.unmatched = [...specs].filter((n) => !Object.keys(out.specs[n]).length);
  for (const n of out.unmatched) {
    out.specs[n] = null;
    console.error(`token-usage: no message matched spec #${n}; its tokens are null (not reported)`);
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
    // A tokens object with no models ({}) is as unreported as null.
    if (!r.tokens || !Object.keys(r.tokens).length) {
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

// The JSON of a `<!-- night-shift {...} -->` comment, or null.
function nightShiftJson(body) {
  const m = /<!--\s*night-shift\s+(\{[\s\S]*?\})\s*-->/.exec(String(body ?? ""));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function specComments(n, opts) {
  if (opts.from) return JSON.parse(readFileSync(join(opts.from, `${n}.json`), "utf8"));
  const repo = opts.repo ?? execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })
    .trim().replace(/(\.git)?\/?$/, "").replace(/.*[/:]([^/:]+\/[^/:]+)$/, "$1");
  // One compact JSON comment per line, whatever gh does with pages.
  const out = execFileSync("gh", ["api", "--paginate", `repos/${repo}/issues/${n}/comments?per_page=100`,
    "--jq", ".[] | {id, created_at, body} | @json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// One row per spec for price, from its night-shift comments after its newest
// `dispatched` one (all of them when it has none).
function rows(opts) {
  const specs = [...new Set(String(opts.specs ?? "").split(/[,\s#]+/).filter(Boolean))];
  if (!specs.length) throw new Error("rows needs --specs <n,n,...>");
  return specs.map((n) => {
    const notes = specComments(n, opts)
      .map((c) => ({ c, json: nightShiftJson(c.body) }))
      .filter((x) => x.json && typeof x.json === "object")
      .sort((a, b) => String(a.c.created_at).localeCompare(String(b.c.created_at)) || (a.c.id ?? 0) - (b.c.id ?? 0));
    const lastDispatch = notes.findLastIndex((x) => x.json.status === "dispatched");
    const tonight = notes.slice(lastDispatch + 1);
    const row = { spec: Number(n), session: lastDispatch >= 0 ? (notes[lastDispatch].json.session ?? null) : null, tokens: null };
    const counted = tonight.findLast((x) => Object.hasOwn(x.json, "tokens"));
    // tokens pass through as the builder wrote them, null and {} included.
    if (counted) {
      row.tokens = counted.json.tokens ?? null;
      if (counted.json.session_shared) row.session_shared = counted.json.session_shared;
    }
    const status = tonight.at(-1)?.json.status;
    if (status !== "ready" && status !== "stuck") row.status = "building";
    return row;
  });
}

// Only validates and echoes: count finds the call itself in the transcript.
function mark(opts) {
  const m = /^#?(\d+)$/.exec(opts._[1] ?? "");
  if (!m || opts._.length !== 2) throw new Error("usage: token-usage.mjs mark <n>");
  return { mark: m[1] };
}

const opts = args(process.argv.slice(2));
const mode = opts._[0];
try {
  const modes = { count, price, mark, rows };
  const result = Object.hasOwn(modes, mode) ? modes[mode](opts) : null;
  if (!result) throw new Error("usage: token-usage.mjs count --specs <n,...> | mark <n> | rows --specs <n,...> | price < specs.json");
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`token-usage: ${err.message}`);
  process.exit(1);
}
