#!/usr/bin/env node
// Renders setup-ship's current templates (ship.yml, shipping.md) with a project's values.
//
//   render.mjs <template> <values.json>
//     Prints the rendered file. Exits non-zero, printing nothing, when the template has a
//     placeholder the values don't fill, or a __PLACEHOLDER__ is left after filling.
//
// values.json maps each placeholder's name (without the underscores) to its value:
//   - a string is inserted as it is;
//   - REQUIRED_CHECKS, LOCAL_CHECKS and BOOKKEEPING_FILES may also be lists, formatted by
//     setup-ship's rules (step 4): each name in backticks; an empty list reads "no CI checks",
//     "none", and a single "- none" item.
// Keys a template doesn't use are ignored, so one file serves both templates.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PLACEHOLDER = /__([A-Z][A-Z0-9_]*?)__/g;

const LISTS = {
  REQUIRED_CHECKS: (items) => items.length ? items.map((c) => `\`${c}\``).join(", ") : "no CI checks",
  LOCAL_CHECKS: (items) => items.length ? items.map((c) => `\`${c}\``).join(", ") : "none",
  BOOKKEEPING_FILES: (items) => items.length ? items.map((g) => `- \`${g}\``).join("\n") : "- none",
};

export function render(template, values) {
  const errors = [];
  const filled = new Map();
  for (const [, name] of template.matchAll(PLACEHOLDER)) {
    if (filled.has(name)) continue;
    const value = values[name];
    if (value === undefined) errors.push(`no value for __${name}__`);
    else if (typeof value === "string") filled.set(name, value);
    else if (Array.isArray(value) && LISTS[name] && value.every((v) => typeof v === "string")) filled.set(name, LISTS[name](value));
    else errors.push(`__${name}__ takes ${LISTS[name] ? "a string or a list of strings" : "a string"}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));

  const out = template.replace(PLACEHOLDER, (all, name) => filled.get(name));
  const left = out.split("\n").flatMap((line, i) => line.match(PLACEHOLDER) ? [`${i + 1}: ${line}`] : []);
  if (left.length) throw new Error(`placeholders left after rendering:\n${left.join("\n")}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [templatePath, valuesPath] = process.argv.slice(2);
  if (!templatePath || !valuesPath) {
    console.error("usage: render.mjs <template> <values.json>");
    process.exit(2);
  }
  try {
    process.stdout.write(render(readFileSync(templatePath, "utf8"), JSON.parse(readFileSync(valuesPath, "utf8"))));
  } catch (error) {
    console.error(`render: ${templatePath}: ${error.message}`);
    process.exit(1);
  }
}
