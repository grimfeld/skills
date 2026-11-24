// node --test skills/prototype-me/scripts/build.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "build.mjs");
const template = readFileSync(join(here, "..", "page", "prototype.html"), "utf8");

// A variants folder holding `files` ({ name: contents }).
function variants(files) {
  const dir = mkdtempSync(join(tmpdir(), "prototype-me-"));
  mkdirSync(join(dir, "variants"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "variants", name), text);
  return dir;
}
const build = (dir, ...args) =>
  execFileSync("node", [script, join(dir, "variants"), join(dir, "out", "prototype.html"), ...args], { encoding: "utf8", stdio: "pipe" });

test("build inlines the switcher, the styles and the variants, with no placeholder left", () => {
  const dir = variants({
    "B.html": "<!-- name: Inbox & list -->\n<header>Bee</header>\n",
    "A.html": '<!-- name: Sidebar "rail" -->\n<nav>Ay</nav>\n',
    "styles.css": ".app { color: rebeccapurple; }\n",
  });
  const printed = build(dir, "--title", "Billing settings");
  const out = join(dir, "out", "prototype.html");
  const page = readFileSync(out, "utf8");
  assert.equal(printed.trim(), out);
  assert.match(page, /<title>Billing settings<\/title>/);
  assert.ok(page.includes("function step(keys, current, delta)"));
  assert.doesNotMatch(page, /^export /m);
  assert.ok(page.includes(".app { color: rebeccapurple; }"));
  const sections = [...page.matchAll(/<section data-variant="(\w)" data-name="([^"]*)">([^]*?)<\/section>/g)].map((m) => m.slice(1));
  assert.deepEqual(sections, [
    ["A", "Sidebar &quot;rail&quot;", "\n<nav>Ay</nav>\n"],
    ["B", "Inbox &amp; list", "\n<header>Bee</header>\n"],
  ]);
  assert.doesNotMatch(page, /@@/);
});

test("build fails, naming the placeholder, when the page lacks one", () => {
  for (const placeholder of ["@@TITLE@@", "/*@@STYLES@@*/", "<!--@@VARIANTS@@-->", "/*@@SWITCHER@@*/"]) {
    const dir = variants({ "A.html": "<!-- name: One -->\n<p>a</p>" });
    writeFileSync(join(dir, "page.html"), template.replace(placeholder, ""));
    assert.throws(() => build(dir, "--page", join(dir, "page.html")), (err) => {
      assert.equal(err.status, 1);
      assert.ok(err.stderr.includes(`no ${placeholder} placeholder`), err.stderr);
      return true;
    });
  }
});

test("build fails with no variants, or more than 5", () => {
  const six = Object.fromEntries("ABCDEF".split("").map((k) => [`${k}.html`, `<!-- name: ${k} -->\n<p>${k}</p>`]));
  for (const files of [{ "styles.css": "p {}" }, six]) {
    assert.throws(() => build(variants(files)), (err) => err.status === 1 && /1 to 5 are allowed/.test(err.stderr));
  }
});
