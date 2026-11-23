// node version.mjs <plugin root>
// Says which commit of the ship plugin is loaded from <plugin root>, and whether main has moved on.
// SHIP_REMOTE overrides the repository compared against (tests use a local one).
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
// Never prompt for credentials (ls-remote against a private or moved remote): fail fast instead.
const nonInteractiveGitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000, env: nonInteractiveGitEnv }).trim();
const short = (sha) => sha.slice(0, 12);

// The plugin registry: { plugins } when read, { unreadable } when present but unreadable, neither when absent.
function readRegistry(config) {
  const path = join(config, "plugins", "installed_plugins.json");
  let text;
  try { text = readFileSync(path, "utf8"); } catch (err) {
    return err.code === "ENOENT" ? { path } : { path, unreadable: true };
  }
  try {
    const parsed = JSON.parse(text);
    const plugins = parsed && typeof parsed.plugins === "object" && parsed.plugins ? parsed.plugins : {};
    return { path, plugins };
  } catch { return { path, unreadable: true }; }
}

// ship@* registry entries installed at root; entries that aren't arrays or lack a string installPath are skipped.
function registryHits(plugins, root) {
  return Object.entries(plugins)
    .filter(([key, entries]) => key.startsWith("ship@") && Array.isArray(entries))
    .flatMap(([key, entries]) => entries.map((e) => ({ key, ...e })))
    .filter((e) => typeof e.installPath === "string" && real(e.installPath) === real(root));
}

// Describe a registry install: { lines, sha, key }.
function describeInstalled(hits) {
  const e = hits[0];
  const sha = e.gitCommitSha || null;
  const lines = [`ship ${e.version || "(no version)"}: ${e.key}, installed ${hits.map((h) => h.scope + (h.projectPath ? ` (${h.projectPath})` : "")).join(", ")}`];
  if (sha) lines.push(`Commit: ${sha}`);
  lines.push(`Updated: ${e.lastUpdated || e.installedAt || "unknown"}`);
  return { lines, sha, key: e.key };
}

// Describe a --plugin-dir working copy: { lines, sha, key: null, root }, root being the checkout compare looks in.
function describeWorkingCopy(root) {
  try {
    // git climbs to a parent repo; only a checkout whose top level is root itself counts.
    if (real(git("-C", root, "rev-parse", "--show-toplevel")) !== real(root)) throw new Error("not the top level");
    const sha = git("-C", root, "rev-parse", "HEAD");
    const branch = git("-C", root, "rev-parse", "--abbrev-ref", "HEAD");
    const dirty = git("-C", root, "status", "--porcelain") ? ", with uncommitted changes" : "";
    return { lines: [`ship working copy at ${root}: ${branch} @ ${short(sha)}${dirty}`], sha, key: null, root };
  } catch {
    return { lines: [`ship at ${root}: not in the plugin registry and not a git checkout, so the version can't be told.`], sha: null, key: null };
  }
}

// What's loaded from root: { lines, sha, key, root }, with a note first when the registry couldn't be read.
function describe(root, config) {
  const registry = readRegistry(config);
  const note = registry.unreadable ? [`Plugin registry ${registry.path} couldn't be read; checking for a working copy.`] : [];
  const hits = registry.plugins ? registryHits(registry.plugins, root) : [];
  const found = hits.length ? describeInstalled(hits) : describeWorkingCopy(root);
  return { ...found, lines: [...note, ...found.lines] };
}

// Where a working copy at root stands against main's commit, or null when that commit isn't in the copy.
function relation(root, sha, latest) {
  const isAncestor = (a, b) => { try { git("-C", root, "merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
  try { git("-C", root, "cat-file", "-e", `${latest}^{commit}`); } catch { return null; }
  if (isAncestor(sha, latest)) return "behind main. Update: git pull";
  if (isAncestor(latest, sha)) return "ahead of main";
  return "diverged from main";
}

// Lines comparing what's loaded ({ sha, key, root }) with main on the remote ({ reached, latest }).
function compare(loaded, { reached, latest }, remote) {
  const { sha, key, root } = loaded;
  if (!reached) return [`Latest: couldn't reach ${remote}.`];
  if (!latest) return [`Latest: main wasn't found on ${remote}.`];
  if (!sha) return [`Latest on main: ${short(latest)}`];
  if (latest === sha) return [`Up to date with main (${short(latest)}).`];
  if (key) return [`main is at ${short(latest)}. Update: claude plugin update ${key}`];
  const where = relation(root, sha, latest);
  return [`main is at ${short(latest)}.${where ? ` This copy is ${where}.` : ""}`];
}

// main on the remote: { reached, latest }, latest null when the remote has no main. No credential helpers run.
function mainOn(remote) {
  try { return { reached: true, latest: git("-c", "credential.helper=", "ls-remote", remote, "refs/heads/main").split(/\s/)[0] || null }; }
  catch { return { reached: false, latest: null }; }
}

function main() {
  const remote = process.env.SHIP_REMOTE || "https://github.com/grimfeld/skills";
  const root = process.argv[2];
  if (!root) {
    console.log("Plugin root unknown: not loaded as a plugin (copied skills, or run outside Claude Code). The version can't be told.");
    return;
  }
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const loaded = describe(root, config);
  for (const line of [...loaded.lines, ...compare(loaded, mainOn(remote), remote)]) console.log(line);
}

main();
