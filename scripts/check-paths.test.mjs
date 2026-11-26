import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { check, citations } from "./check-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// A fixture plugin: files maps repo-relative paths to contents ("" for any file).
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "check-paths-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const base = {
  "references/github.md": "",
  "references/running-skills.md": "",
  "skills/demo/scripts/run.sh": "",
  "skills/demo/templates/history/ship.v1.yml": "",
  "skills/demo/lenses/a.md": "lens",
  "agents/reviewer.md": "agent",
};

test("a ${CLAUDE_PLUGIN_ROOT}/, /tmp/ship/ or <root>/ path passes when it exists from the repo root", () => {
  const root = fixture({ ...base, "skills/demo/SKILL.md": "Read `${CLAUDE_PLUGIN_ROOT}/references/github.md`, `/tmp/ship/references/running-skills.md` and `<root>/skills/demo/scripts/run.sh`." });
  assert.deepEqual(check(root), []);
});

test("a root-prefixed path that doesn't exist fails", () => {
  const root = fixture({ ...base, "skills/demo/SKILL.md": "Read `${CLAUDE_PLUGIN_ROOT}/references/missing.md`." });
  assert.deepEqual(check(root), ["skills/demo/SKILL.md:1: ${CLAUDE_PLUGIN_ROOT}/references/missing.md: not found from the plugin root"]);
});

test("${CLAUDE_SKILL_DIR}/ resolves in the citing file's skill folder, and the path ends at the first space", () => {
  const ok = fixture({ ...base, "skills/demo/SKILL.md": "Run `${CLAUDE_SKILL_DIR}/scripts/run.sh gh <pr>`." });
  assert.deepEqual(check(ok), []);
  const bad = fixture({ ...base, "skills/demo/SKILL.md": "Run `${CLAUDE_SKILL_DIR}/references/github.md`." });
  assert.equal(check(bad).length, 1);
  assert.match(check(bad)[0], /^skills\/demo\/SKILL\.md:1: .*not found in skills\/demo\//);
});

test("a prefixed path later in a command span is checked too", () => {
  const root = fixture({ ...base, "skills/demo/SKILL.md": "Run `node ${CLAUDE_SKILL_DIR}/scripts/gone.mjs count`." });
  assert.match(check(root)[0], /scripts\/gone\.mjs: not found/);
});

test("a bare path passes in its own skill folder, from a nested file too", () => {
  const root = fixture({ ...base, "skills/demo/SKILL.md": "Files: `scripts/run.sh`, `lenses/a.md`.", "skills/demo/templates/prompt.md": "See `scripts/run.sh`." });
  assert.deepEqual(check(root), []);
});

test("a bare path that exists only at the plugin root fails with the prefix fix", () => {
  const root = fixture({ ...base, "skills/demo/templates/prompt.md": "line one\nas `references/github.md` says" });
  assert.deepEqual(check(root), ["skills/demo/templates/prompt.md:2: references/github.md: exists only at the plugin root: prefix with `${CLAUDE_PLUGIN_ROOT}/`"]);
});

test("a bare path found nowhere fails", () => {
  const root = fixture({ ...base, "skills/demo/SKILL.md": "`scripts/nope.sh`" });
  assert.match(check(root)[0], /scripts\/nope\.sh: not found in skills\/demo\//);
});

test("a placeholder segment checks only the directory before it", () => {
  const ok = fixture({ ...base, "skills/demo/SKILL.md": "`templates/history/ship.v<n>.yml` and `${CLAUDE_PLUGIN_ROOT}/skills/{{NAME}}/x.md`" });
  assert.deepEqual(check(ok), []);
  const bad = fixture({ ...base, "skills/demo/SKILL.md": "`templates/old/ship.v<n>.yml`" });
  assert.equal(check(bad).length, 1);
});

test("a glob passes when it matches at least one entry", () => {
  const ok = fixture({ ...base, "skills/demo/SKILL.md": "`lenses/*.md` and `${CLAUDE_PLUGIN_ROOT}/skills/*/scripts/*.sh`" });
  assert.deepEqual(check(ok), []);
  const bad = fixture({ ...base, "skills/demo/SKILL.md": "`lenses/*.json`" });
  assert.equal(check(bad).length, 1);
});

test("paths into the user's project or machine are ignored", () => {
  const root = fixture({ ...base, "skills/demo/SKILL.md": "`~/.claude/skills/x`, `/etc/scripts/x`, `docs/agents/shipping.md`, `.github/workflows/x.yml`, `https://example.com/scripts/x`" });
  assert.deepEqual(check(root), []);
});

test("a bare folder name alone, fenced code and words after the first in a span aren't citations", () => {
  const text = "any file under `skills/`\n```sh\ncat references/github.md\n```\n`node --test skills/*/scripts/none.mjs`";
  assert.deepEqual(citations(text), []);
});

test("agent files have no skill folder: a bare path there fails", () => {
  const root = fixture({ ...base, "agents/reviewer.md": "Read `lenses/a.md`." });
  assert.match(check(root)[0], /^agents\/reviewer\.md:1: lenses\/a\.md: not in a skill folder/);
});

test("the CLI exits 1 and prints file:line on a bad path, 0 when all resolve", () => {
  const bad = fixture({ ...base, "skills/demo/SKILL.md": "`references/github.md`" });
  let failed;
  try { execFileSync("node", [join(here, "check-paths.mjs"), bad], { stdio: "pipe" }); } catch (e) { failed = e; }
  assert.equal(failed?.status, 1);
  assert.match(failed.stdout.toString(), /skills\/demo\/SKILL\.md:1: references\/github\.md/);
  const ok = fixture(base);
  execFileSync("node", [join(here, "check-paths.mjs"), ok], { stdio: "pipe" });
});

test("this repository passes", () => {
  assert.deepEqual(check(join(here, "..")), []);
});
