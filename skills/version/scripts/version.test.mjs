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
const commit = (dir, msg) => git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg);

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "ship-version-"));
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "one");
  return dir;
}

function clone(remote) {
  const root = mkdtempSync(join(tmpdir(), "ship-clone-"));
  execFileSync("git", ["clone", "-q", remote, root]);
  return root;
}

// A config dir with no plugin registry in it.
const noRegistry = () => mkdtempSync(join(tmpdir(), "ship-config-"));

// A config dir whose installed_plugins.json holds text as is.
function rawRegistry(text) {
  const config = noRegistry();
  mkdirSync(join(config, "plugins"));
  writeFileSync(join(config, "plugins", "installed_plugins.json"), text);
  return config;
}

// A config dir with one registry entry under key; sha null leaves out gitCommitSha.
function registry(installPath, sha, key = "ship@grimfeld", version = sha && sha.slice(0, 12)) {
  const entry = { scope: "user", installPath, version, lastUpdated: "2026-11-23T17:56:53.353Z" };
  if (sha) entry.gitCommitSha = sha;
  return rawRegistry(JSON.stringify({ version: 2, plugins: { [key]: [entry] } }));
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
  commit(remote, "two");
  const root = mkdtempSync(join(tmpdir(), "ship-root-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: registry(root, sha), SHIP_REMOTE: remote });
  assert.match(out, /claude plugin update ship@grimfeld/);
});

test("working copy loaded with --plugin-dir", () => {
  const root = repo();
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: root });
  assert.match(out, /ship working copy at .*: main @ [0-9a-f]{12}/);
  assert.match(out, /Up to date with main/);
});

test("no plugin root", () => {
  assert.match(run([], {}), /can't be told/);
});

test("unreachable remote", () => {
  const root = repo();
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: join(root, "nope") });
  assert.match(out, /Latest: couldn't reach/);
});

test("reachable remote without main says main wasn't found", () => {
  const remote = repo();
  git(remote, "branch", "-q", "-m", "main", "dev");
  const root = clone(remote);
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: remote });
  assert.doesNotMatch(out, /couldn't reach/);
  assert.match(out, /Latest: main wasn't found on /);
});

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

test("working copy ahead of main is not told to run plugin update", () => {
  const remote = repo();
  const root = clone(remote);
  commit(root, "two");
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: remote });
  assert.doesNotMatch(out, /claude plugin update/);
  assert.match(out, new RegExp(`main is at ${git(remote, "rev-parse", "HEAD").slice(0, 12)}`));
  assert.match(out, /ahead of main/);
});

test("working copy behind main says to git pull once main's commit is fetched", () => {
  const remote = repo();
  const root = clone(remote);
  commit(remote, "two");
  git(root, "fetch", "-q");
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: remote });
  const latest = git(remote, "rev-parse", "HEAD").slice(0, 12);
  assert.match(out, new RegExp(`^main is at ${latest}\\. This copy is behind main\\. Update: git pull\\.$`, "m"));
});

test("working copy diverged from main says so", () => {
  const remote = repo();
  const root = clone(remote);
  commit(remote, "two");
  commit(root, "mine");
  git(root, "fetch", "-q");
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: remote });
  assert.match(out, /This copy is diverged from main\./);
  assert.doesNotMatch(out, /git pull/);
});

test("working copy without main's commit only says where main is", () => {
  const remote = repo();
  const root = clone(remote);
  commit(remote, "two");
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: remote });
  const latest = git(remote, "rev-parse", "HEAD").slice(0, 12);
  assert.match(out, new RegExp(`^main is at ${latest}\\.$`, "m"));
  assert.doesNotMatch(out, /This copy is/);
});

test("installed from another marketplace names its own key in the update hint", () => {
  const remote = repo();
  const sha = git(remote, "rev-parse", "HEAD");
  commit(remote, "two");
  const root = mkdtempSync(join(tmpdir(), "ship-root-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: registry(root, sha, "ship@other"), SHIP_REMOTE: remote });
  assert.match(out, /claude plugin update ship@other$/m);
});

test("compares with main even when the remote's default branch is another", () => {
  const remote = repo();
  const main = git(remote, "rev-parse", "HEAD");
  git(remote, "checkout", "-q", "-b", "dev");
  commit(remote, "dev");
  const root = mkdtempSync(join(tmpdir(), "ship-root-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: registry(root, main), SHIP_REMOTE: remote });
  assert.match(out, new RegExp(`Up to date with main \\(${main.slice(0, 12)}\\)`));
});

test("plain folder inside a git repo is not a git checkout", () => {
  const outer = repo();
  const root = join(outer, "plugin");
  mkdirSync(root);
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: outer });
  assert.match(out, /not a git checkout/);
});

test("dirty working copy says it has uncommitted changes", () => {
  const root = repo();
  writeFileSync(join(root, "edit.txt"), "x");
  const out = run([root], { CLAUDE_CONFIG_DIR: noRegistry(), SHIP_REMOTE: root });
  assert.match(out, /ship working copy at .*: main @ [0-9a-f]{12}, with uncommitted changes/);
});

test("registry entry without gitCommitSha shows latest on main", () => {
  const remote = repo();
  const latest = git(remote, "rev-parse", "HEAD");
  const root = mkdtempSync(join(tmpdir(), "ship-root-"));
  const out = run([root], { CLAUDE_CONFIG_DIR: registry(root, null, "ship@grimfeld", "1.0.0"), SHIP_REMOTE: remote });
  assert.match(out, /ship 1\.0\.0: ship@grimfeld, installed user/);
  assert.doesNotMatch(out, /Commit:/);
  assert.match(out, new RegExp(`Latest on main: ${latest.slice(0, 12)}`));
});
