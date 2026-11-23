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
