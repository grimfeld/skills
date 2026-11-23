#!/usr/bin/env node
// Builds the dashboard page: page/dashboard.html with board.mjs inlined at its
// /*@@BOARD@@*/ placeholder (`export` keywords dropped, since the page runs it as a plain script).
//
//   build.mjs [<out>] [--page <file>]
//     <out> defaults to .scratch/dashboard/dashboard.html under the current directory.
//     Prints the path written. Exits non-zero when the page has no placeholder.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "/*@@BOARD@@*/";
const here = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const pageAt = argv.indexOf("--page");
const pagePath = pageAt >= 0 ? argv.splice(pageAt, 2)[1] : join(here, "..", "page", "dashboard.html");
const out = resolve(argv[0] ?? join(".scratch", "dashboard", "dashboard.html"));

const page = readFileSync(pagePath, "utf8");
if (!page.includes(PLACEHOLDER)) {
  console.error(`build: ${pagePath} has no ${PLACEHOLDER} placeholder`);
  process.exit(1);
}
const board = readFileSync(join(here, "board.mjs"), "utf8").replace(/^export /gm, "");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page.replace(PLACEHOLDER, () => board));
console.log(out);
