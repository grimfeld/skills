// node --test skills/dashboard/scripts/build.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "build.mjs");
const board = readFileSync(join(here, "board.mjs"), "utf8");

test("build inlines the bucketing module into the page, with no placeholder left", () => {
  const out = join(mkdtempSync(join(tmpdir(), "dashboard-")), "nested", "dashboard.html");
  const printed = execFileSync("node", [script, out], { encoding: "utf8" });
  const page = readFileSync(out, "utf8");
  assert.equal(printed.trim(), out);
  assert.match(page, /<title>Ship dashboard<\/title>/);
  assert.ok(page.includes("function toCards(project, issues, prs, checks, now)"));
  assert.ok(page.includes(board.match(/const PR_RULES = \[[^]*?\n\];/)[0]), "the rules arrive verbatim");
  assert.doesNotMatch(page, /@@BOARD@@/);
  assert.doesNotMatch(page, /^export /m);
});

test("build fails when the page has no placeholder", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-"));
  writeFileSync(join(dir, "page.html"), "<title>Ship dashboard</title><script></script>");
  assert.throws(
    () => execFileSync("node", [script, join(dir, "out.html"), "--page", join(dir, "page.html")], { stdio: "pipe" }),
    /no \/\*@@BOARD@@\*\/ placeholder/,
  );
});

test("SKILL.md's capabilities name exactly the connector tools the page calls", () => {
  const skill = readFileSync(join(here, "..", "SKILL.md"), "utf8");
  const page = readFileSync(join(here, "..", "page", "dashboard.html"), "utf8");
  const declared = JSON.parse(skill.match(/```json\n([^]*?)\n```/)[1]).mcp.servers;
  const literal = page.match(/const CONNECTORS = (\{[^]*?\n\s*\});/)[1];
  const called = Object.values(new Function(`return ${literal}`)());
  const shape = (servers) => Object.fromEntries(servers.map((s) => [s.server, [...s.tools].sort()]));
  assert.deepEqual(shape(declared), shape(called));
  assert.equal(declared.length, called.length, "each server once");
});

test("the page writes only through callWrite (issue_write's update with labels, actions_run_trigger's run_workflow on ship.yml) and its one create_session", () => {
  const page = readFileSync(join(here, "..", "page", "dashboard.html"), "utf8");
  // Every connector call: reads go through readOnce, discovery through list_repos, GitHub writes
  // through callWrite, and a session start through its one create_session.
  const callTools = [...page.matchAll(/callTool\(([^,]+), ([^,]+),/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(callTools.sort(), ["REMOTE \"list_repos\"", "REMOTE \"create_session\"", "server tool", "GH tool"].sort(),
    "callTool only in readOnce, callWrite, discovery and startSession");
  const reads = [...page.matchAll(/readOnce\("(\w+)"/g)].map((m) => m[1]);
  assert.ok(!reads.some((t) => ["issue_write", "actions_run_trigger", "create_session"].includes(t)), "no write through readOnce");
  // create_session, explicitly: one call site, its inputs fixed to the card's command, title, repo and the chosen environment.
  const sessions = [...page.matchAll(/callTool\(REMOTE, "create_session", \{([^]*?)\n\s*\}, /g)].map((m) => m[1]);
  assert.equal(sessions.length, 1, "one create_session call site");
  const input = Object.fromEntries(sessions[0].split(/,\n/).map((kv) => kv.trim()).filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf(":")), kv.slice(kv.indexOf(":") + 1).trim().replace(/,$/, "")]));
  assert.deepEqual(Object.keys(input), ["prompt", "title", "source_url", "environment_id"]);
  assert.equal(input.prompt, "skill.command");
  assert.equal(input.source_url, "`https://github.com/${card.project}`");
  assert.equal(input.environment_id, "env.environment_id");
  const writes = [...page.matchAll(/callWrite\(([^)]*?)\{ method: "(\w+)"([^}]*)\}/g)].map((m) => [m[1].trim(), m[2], m[3]]);
  assert.equal(writes.length, [...page.matchAll(/await callWrite\(/g)].length, "every callWrite call names its method inline");
  assert.deepEqual(writes.map(([tool, method]) => `${tool} ${method}`).sort(), ['"actions_run_trigger", run_workflow', '"issue_write", update']);
  const issue = writes.find(([tool]) => tool.includes("issue_write"))[2];
  assert.deepEqual(issue.split(",").map((k) => k.split(":")[0].trim()).filter(Boolean), ["owner", "repo", "issue_number", "labels"]);
  assert.match(writes.find(([tool]) => tool.includes("actions_run_trigger"))[2], /workflow_id: "ship\.yml"/);
});
