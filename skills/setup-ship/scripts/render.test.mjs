// node --test skills/setup-ship/scripts/render.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "render.mjs");
const templates = join(here, "..", "templates");
const repo = join(here, "..", "..", "..");
const thisRepo = join(here, "this-repo.values.json");

const render = (template, values) => spawnSync("node", [script, template, values], { encoding: "utf8" });

function valuesFile(values) {
  const file = join(mkdtempSync(join(tmpdir(), "render-")), "values.json");
  writeFileSync(file, JSON.stringify(values));
  return file;
}

function templateFile(text) {
  const file = join(mkdtempSync(join(tmpdir(), "render-")), "template.md");
  writeFileSync(file, text);
  return file;
}

test("this repo's ship.yml is the template rendered with this repo's values", () => {
  const out = render(join(templates, "ship.yml"), thisRepo);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, readFileSync(join(repo, ".github", "workflows", "ship.yml"), "utf8"),
    "re-render .github/workflows/ship.yml, or fix skills/setup-ship/scripts/this-repo.values.json");
});

test("this repo's shipping.md is the template rendered with this repo's values", () => {
  const out = render(join(templates, "shipping.md"), thisRepo);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, readFileSync(join(repo, "docs", "agents", "shipping.md"), "utf8"),
    "re-render docs/agents/shipping.md, or fix skills/setup-ship/scripts/this-repo.values.json");
});

test("a string value is inserted as it is, everywhere its placeholder appears", () => {
  const out = render(templateFile("to __DEFAULT_BRANCH__, on `__DEFAULT_BRANCH__`: __CD_SUMMARY__\n"),
    valuesFile({ DEFAULT_BRANCH: "trunk", CD_SUMMARY: "Deploys $& on `push`." }));
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, "to trunk, on `trunk`: Deploys $& on `push`.\n");
});

test("list values are formatted by setup-ship's rules", () => {
  const template = "Required: __REQUIRED_CHECKS__, and `ship`.\nLocal: __LOCAL_CHECKS__\n\n__BOOKKEEPING_FILES__\n";
  const full = render(templateFile(template), valuesFile({
    REQUIRED_CHECKS: ["lint", "test"],
    LOCAL_CHECKS: ["npm test", "npm run lint"],
    BOOKKEEPING_FILES: ["README.md", "docs/*.md"],
  }));
  assert.equal(full.status, 0, full.stderr);
  assert.equal(full.stdout,
    "Required: `lint`, `test`, and `ship`.\nLocal: `npm test`, `npm run lint`\n\n- `README.md`\n- `docs/*.md`\n");

  const empty = render(templateFile(template), valuesFile({ REQUIRED_CHECKS: [], LOCAL_CHECKS: [], BOOKKEEPING_FILES: [] }));
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, "Required: no CI checks, and `ship`.\nLocal: none\n\n- none\n");
});

test("a placeholder with no value fails, naming it", () => {
  const out = render(templateFile("__DEFAULT_BRANCH__ and __MERGE_METHOD__\n"), valuesFile({ DEFAULT_BRANCH: "main" }));
  assert.notEqual(out.status, 0);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /no value for __MERGE_METHOD__/);
});

test("a placeholder left after rendering fails, with its line", () => {
  const out = render(templateFile("one\n__SCREENS__\n"), valuesFile({ SCREENS: "run __OTHER__" }));
  assert.notEqual(out.status, 0);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /2: run __OTHER__/);
});

test("a value of the wrong type fails", () => {
  const out = render(templateFile("__MERGE_METHOD__\n"), valuesFile({ MERGE_METHOD: ["merge"] }));
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /MERGE_METHOD/);
});

test("the version line and the rest of the template are kept as they are", () => {
  const out = execFileSync("node", [script, join(templates, "ship.yml"), valuesFile({ DEFAULT_BRANCH: "develop" })],
    { encoding: "utf8" });
  const template = readFileSync(join(templates, "ship.yml"), "utf8");
  assert.equal(out.split("\n")[0], template.split("\n")[0]);
  assert.equal(out, template.replaceAll("__DEFAULT_BRANCH__", "develop"));
});

test("the Try it values fill shipping.md's Try it section as they are", () => {
  const values = JSON.parse(readFileSync(thisRepo, "utf8"));
  const run = "`git fetch origin <branch> && git worktree add ../try-<branch> FETCH_HEAD && cd ../try-<branch> && npm run dev`";
  const out = render(join(templates, "shipping.md"),
    valuesFile({ ...values, TRY_PREVIEWS: "Vercel preview deployments on every PR", TRY_RUN: run }));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\n## Try it\n/);
  assert.ok(out.stdout.includes("\n- **Previews:** Vercel preview deployments on every PR\n"));
  assert.ok(out.stdout.includes(`\n- **Run a branch:** ${run}\n`));

  const none = render(join(templates, "shipping.md"), valuesFile({ ...values, TRY_PREVIEWS: "none", TRY_RUN: "none" }));
  assert.equal(none.status, 0, none.stderr);
  assert.ok(none.stdout.includes("\n- **Previews:** none\n- **Run a branch:** none\n"));
});

test("a values file without the Try it values fails on shipping.md", () => {
  const { TRY_PREVIEWS, TRY_RUN, ...older } = JSON.parse(readFileSync(thisRepo, "utf8"));
  const out = render(join(templates, "shipping.md"), valuesFile(older));
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /no value for __TRY_PREVIEWS__/);
  assert.match(out.stderr, /no value for __TRY_RUN__/);
});
