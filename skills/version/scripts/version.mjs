// node version.mjs <plugin root>
// Says which commit of the ship plugin is loaded from <plugin root>, and whether main has moved on.
// SHIP_REMOTE overrides the repository compared against (tests use a local one).
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const REMOTE = process.env.SHIP_REMOTE || "https://github.com/grimfeld/skills";
const root = process.argv[2];
if (!root) {
  console.log("Plugin root unknown: not loaded as a plugin (copied skills, or run outside Claude Code). The version can't be told.");
  process.exit(0);
}

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim();
const short = (sha) => sha.slice(0, 12);

function installed() {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let registry;
  try { registry = JSON.parse(readFileSync(join(config, "plugins", "installed_plugins.json"), "utf8")); } catch { return null; }
  const hits = Object.entries(registry.plugins || {})
    .filter(([key]) => key.startsWith("ship@"))
    .flatMap(([key, entries]) => entries.map((e) => ({ key, ...e })))
    .filter((e) => e.installPath && real(e.installPath) === real(root));
  return hits.length ? hits : null;
}

let sha;
const hits = installed();
if (hits) {
  const e = hits[0];
  sha = e.gitCommitSha || null;
  console.log(`ship ${e.version || "(no version)"}: ${e.key}, installed ${hits.map((h) => h.scope + (h.projectPath ? ` (${h.projectPath})` : "")).join(", ")}`);
  if (sha) console.log(`Commit: ${sha}`);
  console.log(`Updated: ${e.lastUpdated || e.installedAt || "unknown"}`);
} else {
  try {
    sha = git("-C", root, "rev-parse", "HEAD");
    const branch = git("-C", root, "rev-parse", "--abbrev-ref", "HEAD");
    const dirty = git("-C", root, "status", "--porcelain") ? ", with uncommitted changes" : "";
    console.log(`ship working copy at ${root}: ${branch} @ ${short(sha)}${dirty}`);
  } catch {
    console.log(`ship at ${root}: not in the plugin registry and not a git checkout, so the version can't be told.`);
  }
}

let latest;
try { latest = git("ls-remote", REMOTE, "HEAD").split(/\s/)[0]; } catch { latest = null; }
if (!latest) console.log(`Latest: couldn't reach ${REMOTE}.`);
else if (!sha) console.log(`Latest on main: ${short(latest)}`);
else if (latest === sha) console.log(`Up to date with main (${short(latest)}).`);
else console.log(`main is at ${short(latest)}. Update: claude plugin update ship@grimfeld`);
