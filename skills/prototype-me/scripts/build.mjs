#!/usr/bin/env node
// Builds the prototype page: page/prototype.html with its four placeholders filled.
//
//   build.mjs <variants-dir> <out> [--title <text>] [--page <file>]
//
// <variants-dir> holds one file per variant, `<KEY>.html` (KEY a capital letter, A to Z; 1 to 5 of
// them), whose first line is `<!-- name: <short name> -->` and the rest the variant's markup, plus
// an optional `styles.css`: the project's styles, shared by every variant. Placeholders:
//   @@TITLE@@          <title>, from --title (default "Prototype")
//   /*@@STYLES@@*/     styles.css, verbatim
//   <!--@@VARIANTS@@-->  one <section data-variant="KEY" data-name="NAME"> per variant, in key order
//   /*@@SWITCHER@@*/   switcher.mjs, `export` keywords dropped (the page runs it as a plain script)
// Prints the path written. Exits 1, naming the problem, when the page lacks a placeholder, a
// variant has no name line, or there are no variants or more than 5.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MAX = 5;

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const option = (argv, flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv.splice(at, 2)[1] : undefined;
};

const argv = process.argv.slice(2);
const pagePath = option(argv, "--page") ?? join(here, "..", "page", "prototype.html");
const title = option(argv, "--title") ?? "Prototype";
const [dir, outArg] = argv;
if (!dir || !outArg) fail("usage: build.mjs <variants-dir> <out> [--title <text>] [--page <file>]");
const out = resolve(outArg);

const files = readdirSync(dir).filter((f) => /^[A-Z]\.html$/.test(f)).sort();
if (files.length === 0 || files.length > MAX) fail(`${dir} has ${files.length} variants (<KEY>.html); 1 to ${MAX} are allowed`);

const sections = files.map((file) => {
  const text = readFileSync(join(dir, file), "utf8");
  const name = text.match(/^<!--\s*name:\s*(.*?)\s*-->/);
  if (!name) fail(`${file} has no first-line <!-- name: ... --> comment`);
  return `<section data-variant="${file[0]}" data-name="${escape(name[1])}">${text.slice(name[0].length)}</section>`;
});
const stylesPath = join(dir, "styles.css");
const fills = {
  "@@TITLE@@": escape(title),
  "/*@@STYLES@@*/": existsSync(stylesPath) ? readFileSync(stylesPath, "utf8") : "",
  "<!--@@VARIANTS@@-->": sections.join("\n"),
  "/*@@SWITCHER@@*/": readFileSync(join(here, "switcher.mjs"), "utf8").replace(/^export /gm, ""),
};

let page = readFileSync(pagePath, "utf8");
for (const [placeholder, fill] of Object.entries(fills)) {
  if (!page.includes(placeholder)) fail(`${pagePath} has no ${placeholder} placeholder`);
  page = page.replace(placeholder, () => fill);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(out);
