// node --test skills/version/scripts/version.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "version.mjs");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const run = (args, env) => execFileSync("node", [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "ship-version-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
  return dir;
}

function registry(installPath, sha) {
  const config = mkdtempSync(join(tmpdir(), "ship-config-"));
  mkdirSync(join(config, "plugins"));
  writeFileSync(join(config, "plugins", "installed_plugins.json"), JSON.stringify({
    version: 2,
    plugins: { "ship@grimfeld": [{ scope: "user", installPath, version: sha.slice(0, 12), gitCommitSha: sha, lastUpdated: "2026-11-23T17:56:53.353Z" }] },
  }));
  return config;
}

test("installed and up to date", () => {
  const remote = repo();
  const sha = git(remote, "rev-parse", "HEAD");
  const root = mkdtempSync(join(tmpdir(), "ship-root-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: registry(root, sha), SHIP_REMOTE: remote });
  assert.match(out, new RegExp(`ship ${sha.slice(0, 12)}: ship@grimfeld, installed user`));
  assert.match(out, /Updated: 2026-11-23/);
  assert.match(out, /Up to date with main/);
});

test("installed and behind main", () => {
  const remote = repo();
  const sha = git(remote, "rev-parse", "HEAD");
  git(remote, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "two");
  const root = mkdtempSync(join(tmpdir(), "ship-root-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: registry(root, sha), SHIP_REMOTE: remote });
  assert.match(out, /claude plugin update ship@grimfeld/);
});

test("working copy loaded with --plugin-dir", () => {
  const root = repo();
  const empty = mkdtempSync(join(tmpdir(), "ship-config-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: empty, SHIP_REMOTE: root });
  assert.match(out, /ship working copy at .*: main @ [0-9a-f]{12}/);
  assert.match(out, /Up to date with main/);
});

test("no plugin root", () => {
  assert.match(run([], {}), /can't be told/);
});

test("unreachable remote", () => {
  const root = repo();
  const out = run([root], { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "c-")), SHIP_REMOTE: join(root, "nope") });
  assert.match(out, /Latest: couldn't reach/);
});

function rawRegistry(text) {
  const config = mkdtempSync(join(tmpdir(), "ship-config-"));
  mkdirSync(join(config, "plugins"));
  writeFileSync(join(config, "plugins", "installed_plugins.json"), text);
  return config;
}

test("malformed registry entry is skipped", () => {
  const root = repo();
  const config = rawRegistry(JSON.stringify({ version: 2, plugins: { "ship@grimfeld": {} } }));
  const out = run([root], { CLAUDE_CONFIG_DIR: config, SHIP_REMOTE: root });
  assert.match(out, /ship working copy at .*: main @ [0-9a-f]{12}/);
});

test("unparsable registry says it couldn't be read", () => {
  const root = repo();
  const out = run([root], { CLAUDE_CONFIG_DIR: rawRegistry("{ not json"), SHIP_REMOTE: root });
  assert.match(out, /Plugin registry .*installed_plugins\.json couldn't be read/);
  assert.match(out, /ship working copy at .*: main @ [0-9a-f]{12}/);
});
