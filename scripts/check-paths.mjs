#!/usr/bin/env node
// Checks that every path a skill or agent cites resolves where the skill runs.
//
//   node scripts/check-paths.mjs [repo root]
//     Scans every *.md under skills/ and agents/ (fenced code blocks left out). In each
//     backticked span it checks the span's first word, and every word with a root prefix,
//     when that word (after its prefix) starts with references/, skills/, lenses/, scripts/
//     or templates/. A path ends at the first space. Prints `file:line: <path>: <problem>`
//     for each one that won't resolve, and exits 1 when there is any.
//
// Where a path resolves:
//   ${CLAUDE_PLUGIN_ROOT}/…, /tmp/ship/… and <root>/… (the builder prompt's plugin root):
//     from the repo root.
//   ${CLAUDE_SKILL_DIR}/… and a bare path: in the citing file's own skill folder. A bare
//     path that exists only at the repo root fails: the skill runs inside another project.
// A bare word that is only a folder name (`skills/`) names a kind of file, not one to open, and is skipped.
// A segment holding <…> or {{…}} is a placeholder: only the directory before it is checked.
// A segment holding * is a glob: it passes when it matches at least one entry.
// Paths starting with ~, / (other than /tmp/ship/), docs/, .github/ or http point into the
// user's project or machine and are ignored.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_PREFIXES = ["${CLAUDE_PLUGIN_ROOT}/", "/tmp/ship/", "<root>/"];
const SKILL_PREFIX = "${CLAUDE_SKILL_DIR}/";
const CITED_DIRS = ["references/", "skills/", "lenses/", "scripts/", "templates/"];
const PLACEHOLDER = /<[^>]*>|\{\{[^}]*\}\}/;

// Every *.md file under dir, as paths relative to root.
function markdownFiles(root, dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(root, rel);
    return entry.isFile() && entry.name.endsWith(".md") ? [rel] : [];
  });
}

// The cited paths in one Markdown text: [{ line, raw }], raw being the word as written.
export function citations(text) {
  const found = [];
  let fenced = false;
  text.split("\n").forEach((lineText, i) => {
    if (/^\s*(```|~~~)/.test(lineText)) { fenced = !fenced; return; }
    if (fenced) return;
    for (const [, span] of lineText.matchAll(/`([^`]+)`/g)) {
      span.trim().split(/\s+/).forEach((word, w) => {
        const prefixed = [...ROOT_PREFIXES, SKILL_PREFIX].some((p) => word.startsWith(p));
        if (w > 0 && !prefixed) return;
        const bare = stripPrefix(word).rest;
        // A bare folder name alone (`skills/`) names a kind of file in the project, not a file to open.
        if (!prefixed && CITED_DIRS.includes(bare)) return;
        if (CITED_DIRS.some((d) => bare.startsWith(d))) found.push({ line: i + 1, raw: word });
      });
    }
  });
  return found;
}

function stripPrefix(word) {
  for (const p of ROOT_PREFIXES) if (word.startsWith(p)) return { kind: "root", rest: word.slice(p.length) };
  if (word.startsWith(SKILL_PREFIX)) return { kind: "skill", rest: word.slice(SKILL_PREFIX.length) };
  return { kind: "bare", rest: word };
}

// Does rel (with placeholders and globs) resolve under base?
export function resolves(base, rel) {
  const segments = rel.replace(/[.,;:)]+$/, "").split("/").filter(Boolean);
  let dirs = [base];
  for (const segment of segments) {
    if (PLACEHOLDER.test(segment)) break;
    if (segment.includes("*")) {
      const pattern = new RegExp(`^${segment.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      dirs = dirs.flatMap((d) => isDir(d) ? readdirSync(d).filter((n) => pattern.test(n)).map((n) => join(d, n)) : []);
    } else {
      dirs = dirs.map((d) => join(d, segment)).filter((p) => existsSync(p));
    }
    if (!dirs.length) return false;
  }
  return true;
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

// The skill folder a file belongs to (skills/<name>), or null.
function skillDir(file) {
  const parts = file.split(sep);
  return parts[0] === "skills" && parts.length > 2 ? join(parts[0], parts[1]) : null;
}

// Every unresolved citation in the repo at root: ["file:line: path: problem"].
export function check(root) {
  const problems = [];
  for (const file of [...markdownFiles(root, "skills"), ...markdownFiles(root, "agents")]) {
    const own = skillDir(file);
    for (const { line, raw } of citations(readFileSync(join(root, file), "utf8"))) {
      const { kind, rest } = stripPrefix(raw);
      const where = `${file.split(sep).join("/")}:${line}: ${raw}`;
      if (kind === "root") {
        if (!resolves(root, rest)) problems.push(`${where}: not found from the plugin root`);
      } else if (!own) {
        problems.push(`${where}: not in a skill folder, so it needs a root prefix: prefix with \`\${CLAUDE_PLUGIN_ROOT}/\``);
      } else if (!resolves(join(root, own), rest)) {
        if (kind === "bare" && resolves(root, rest)) problems.push(`${where}: exists only at the plugin root: prefix with \`\${CLAUDE_PLUGIN_ROOT}/\``);
        else problems.push(`${where}: not found in ${own.split(sep).join("/")}/`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = check(root);
  for (const p of problems) console.log(p);
  if (problems.length) {
    console.error(`check-paths: ${problems.length} path(s) won't resolve where the skill runs.`);
    process.exit(1);
  }
  console.log(`check-paths: every cited path under ${relative(process.cwd(), root) || "."}/skills and agents resolves.`);
}
