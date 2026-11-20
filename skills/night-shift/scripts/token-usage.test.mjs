// node --test skills/night-shift/scripts/token-usage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "token-usage.mjs");
const run = (argv, input) => JSON.parse(execFileSync("node", [script, ...argv], { input, encoding: "utf8" }));

const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 } };
const one = { in: 10, out: 100, cache_read: 1000, cache_write_5m: 20, cache_write_1h: 30 };
const times = (k) => Object.fromEntries(Object.entries(one).map(([f, v]) => [f, v * k]));
const msg = (id, gitBranch, cwd, { model = "claude-opus-5-5", u = usage, content = [] } = {}) =>
  JSON.stringify({ type: "assistant", gitBranch, cwd, message: { id, model, usage: u, content } });
const spawn = (toolUseId) => [{ type: "tool_use", id: toolUseId, name: "Agent", input: {} }];

function fixture() {
  const projects = mkdtempSync(join(tmpdir(), "token-usage-"));
  const dir = join(projects, "-home-user-repo");
  const subs = join(dir, "s1", "subagents");
  mkdirSync(subs, { recursive: true });
  const wt = "/home/user/repo/.claude/worktrees";
  writeFileSync(join(dir, "s1.jsonl"), [
    msg("m1", "spec/602-tie", `${wt}/spec-602-tie`),
    msg("m1", "spec/602-tie", `${wt}/spec-602-tie`), // the same message, another streamed block
    msg("m2", "spec/602-tie", `${wt}/spec-602-tie`, { content: spawn("tu-impl") }), // starts the implementer
    msg("m3", "main", "/home/user/repo"),
    msg("m4", "spec/999-other", "/x"), // a spec not in this session: shared
    msg("m5", "main", "/home/user/repo", { content: spawn("tu-review") }), // starts a subagent from no spec
    msg("m6", "main", "/home/user/repo", { u: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } }),
    '{"type":"user"}',
    "not json",
  ].join("\n"));
  // Implementer on its own ticket branch and agent worktree: counts toward #602, its parent's spec.
  writeFileSync(join(subs, "agent-impl.jsonl"), [
    msg("s1", "ticket/1", `${wt}/agent-abc`, { content: spawn("tu-nested") }),
    msg("s2", "ticket/1", `${wt}/agent-abc`, { model: "claude-haiku-5-5" }),
  ].join("\n"));
  writeFileSync(join(subs, "agent-impl.meta.json"), JSON.stringify({ toolUseId: "tu-impl" }));
  // Nested: started by the implementer, so #602 too.
  writeFileSync(join(subs, "agent-nested.jsonl"), msg("n1", "HEAD", "/tmp/x"));
  writeFileSync(join(subs, "agent-nested.meta.json"), JSON.stringify({ toolUseId: "tu-nested" }));
  // Started from no spec, but this message runs in #603's worktree: #603.
  writeFileSync(join(subs, "agent-review.jsonl"), [msg("r1", "HEAD", `${wt}/spec-603-sugg`), msg("r2", "main", "/home/user/repo")].join("\n"));
  writeFileSync(join(subs, "agent-review.meta.json"), JSON.stringify({ toolUseId: "tu-review" }));
  return projects;
}

test("count attributes messages by branch, worktree and parent spec, once each", () => {
  const out = run(["count", "--specs", "#602 #603", "--session", "s1", "--projects", fixture()]);
  assert.equal(out.session, "s1");
  assert.deepEqual(out.specs["602"], { "claude-opus-5-5": times(4), "claude-haiku-5-5": one });
  assert.deepEqual(out.specs["603"], { "claude-opus-5-5": one });
  // m3, m4, m5, r2, and m6 whose cache writes have no 5m/1h split (all counted 5m).
  assert.deepEqual(out.shared, { "claude-opus-5-5": { in: 50, out: 500, cache_read: 5000, cache_write_5m: 130, cache_write_1h: 120 } });
});

test("count fails clearly without specs", () => {
  assert.throws(() => execFileSync("node", [script, "count"], { stdio: "pipe" }), /count needs --specs/);
});

test("price marks unpriced models and specs that never reported", () => {
  const rows = [
    { spec: 602, session: "a", tokens: { "claude-opus-5-5": one, "claude-mystery-9": one }, session_shared: { "claude-opus-5-5": one } },
    { spec: 603, session: "a", tokens: null },
    { spec: 604, session: "__proto__", tokens: { constructor: one } },
  ];
  const out = run(["price"], JSON.stringify(rows));
  // Opus: 10×4 + 100×20 + 1000×0.2 + 20×5 + 30×8 = 2580 per million.
  assert.deepEqual(out.specs["602"], { usd: 0.0026, out: 200, fresh_in: 120, cache_read: 2000, unpriced: ["claude-mystery-9"] });
  assert.equal(out.specs["603"], null);
  assert.deepEqual(out.specs["604"].unpriced, ["constructor"]);
  assert.deepEqual(out.sessions.a.not_reported, [603]);
  assert.equal(out.sessions.a.total.usd, 0.0052);
  assert.deepEqual(out.sessions.__proto__.specs, [604]);
  assert.deepEqual(out.night.not_reported, [603]);
  assert.deepEqual(out.night.unpriced.sort(), ["claude-mystery-9", "constructor"]);
});
