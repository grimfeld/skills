#!/usr/bin/env node
// Capture a design's reference and the built app at every place × look × theme × viewport, and check
// contrast and token values mechanically. Report-only: it never edits the project.
//
//   node design-capture.mjs --manifest docs/design/<module>/fidelity.json --out <dir>
//        [--side reference|app|both] [--app-url <url>] [--places a,b] [--root <project dir>]
//
// The manifest is described in ../references/fidelity-manifest.md. Playwright is resolved from the
// project (--root, default the current directory), so the project's own version and browsers are used.
//
// Writes <out>/<place>/<look>-<theme>-<viewport>.<side>.png and <out>/report.json.
// Exit 0 when every shot was taken, 1 when any failed, 2 on bad arguments or manifest.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { side: "both" };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    args[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return args;
}

function fail(message) {
  console.error(`design-capture: ${message}`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (!args.manifest || !args.out) fail("--manifest and --out are required");
if (!["reference", "app", "both"].includes(args.side)) fail("--side is reference, app or both");

const root = path.resolve(args.root ?? process.cwd());
const manifestPath = path.resolve(root, args.manifest);
const manifestDir = path.dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const key of ["reference", "looks", "themes", "viewports", "places"]) {
  if (!manifest[key]) fail(`manifest has no "${key}"`);
}

function loadPlaywright() {
  const require = createRequire(path.join(root, "package.json"));
  for (const name of ["playwright", "@playwright/test"]) {
    try {
      return require(name);
    } catch {}
  }
  // pnpm workspaces keep Playwright in a package's own node_modules.
  for (const dir of [".", "shell", "app", "apps/web", "web", "frontend"]) {
    try {
      return createRequire(path.join(root, dir, "package.json"))("@playwright/test");
    } catch {}
  }
  fail(`Playwright not found from ${root}; pass --root to the package that has it`);
}

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? encodeURIComponent(vars[key]) : match));
const fillRaw = (template, vars) => template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);

async function waitForUrl(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Runs in the page: contrast of every visible text, and token values, both resolved through a canvas
// so any CSS colour syntax (hex, rgb, oklch, color-mix) compares as sRGB.
function inspect({ scope, tokens }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
  };
  const lum = ([r, g, b]) =>
    [r, g, b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  const background = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null;
      const c = rgba(style.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    return layers.reduceRight((acc, layer) => over(layer, acc), [255, 255, 255, 1]);
  };

  const root = (scope && document.querySelector(scope)) || document.body;
  const contrast = [];
  let checked = 0;
  for (const el of root.querySelectorAll("*")) {
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (!text) continue;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (style.visibility !== "visible" || Number(style.opacity) === 0 || box.width === 0 || box.height === 0) continue;
    if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
    const bg = background(el);
    if (!bg) continue; // on an image or gradient: left to the reviewer
    checked++;
    const fg = over(rgba(style.color), bg);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r < need) contrast.push({ text: text.slice(0, 60), ratio: Math.round(r * 100) / 100, need, fg: hex(fg), bg: hex(bg) });
  }

  const tokenResults = [];
  const tokenStyle = getComputedStyle(root);
  for (const [name, want] of Object.entries(tokens ?? {})) {
    const raw = tokenStyle.getPropertyValue(name).trim();
    if (!raw) {
      tokenResults.push({ name, want, got: null, ok: false });
      continue;
    }
    const got = rgba(raw);
    const exp = rgba(want);
    const ok = got.every((v, i) => Math.abs(v - exp[i]) <= (i === 3 ? 0.02 : 2));
    tokenResults.push({ name, want, got: hex(got), raw, ok });
  }
  return { contrast, contrastChecked: checked, tokens: tokenResults };
}

async function main() {
  const { chromium } = loadPlaywright();
  const out = path.resolve(args.out);
  mkdirSync(out, { recursive: true });
  const sides = args.side === "both" ? ["reference", "app"] : [args.side];
  const places = args.places ? args.places.split(",") : Object.keys(manifest.places);
  const app = manifest.app ?? {};
  const appUrl = args.appUrl ?? app.url;
  if (sides.includes("app") && !appUrl) fail("no app URL: set app.url in the manifest or pass --app-url");

  let server;
  if (sides.includes("app") && !args.appUrl && app.serve) {
    server = spawn(app.serve, { cwd: path.resolve(root, app.cwd ?? "."), shell: true, stdio: "ignore", detached: true });
    if (!(await waitForUrl(appUrl, (app.timeout ?? 180) * 1000))) {
      process.kill(-server.pid);
      fail(`app did not answer at ${appUrl} after "${app.serve}"`);
    }
  }

  const reference = pathToFileURL(path.resolve(manifestDir, manifest.reference)).href;
  const browser = await chromium.launch();
  const report = { manifest: path.relative(root, manifestPath), app_url: appUrl ?? null, shots: [] };
  let failed = 0;
  try {
    for (const place of places) {
      const spec = manifest.places[place];
      if (!spec) {
        report.shots.push({ place, error: "not in manifest" });
        failed++;
        continue;
      }
      mkdirSync(path.join(out, place), { recursive: true });
      for (const look of manifest.looks) {
        for (const theme of manifest.themes) {
          const vars = { place, look, theme };
          const combo = `${look}-${theme}`;
          for (const [viewport, size] of Object.entries(manifest.viewports)) {
            for (const side of sides) {
              if (side === "app" && !spec.app) continue; // a place the app doesn't have yet
              const file = path.join(place, `${combo}-${viewport}.${side}.png`);
              const shot = { place, look, theme, viewport, side, file };
              const contextOptions = { viewport: size, deviceScaleFactor: 1, reducedMotion: "reduce" };
              if (side === "app" && app.storage_state) contextOptions.storageState = path.resolve(root, app.storage_state);
              const context = await browser.newContext(contextOptions);
              try {
                const page = await context.newPage();
                if (side === "app" && app.init) await page.addInitScript(fillRaw(app.init, vars));
                const url =
                  side === "reference"
                    ? reference + fill(spec.reference ?? manifest.reference_view ?? "", vars)
                    : new URL(fill(spec.app, vars), appUrl).href;
                shot.url = url;
                await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
                await page.evaluate(() => document.fonts.ready);
                await page.waitForTimeout(manifest.settle_ms ?? 300);
                await page.screenshot({ path: path.join(out, file), fullPage: true });
                const scope = side === "app" ? app.scope : manifest.reference_scope;
                const tokens = side === "app" ? Object.fromEntries(
                  Object.entries(manifest.tokens ?? {}).map(([name, values]) => [name, values[combo]]).filter(([, v]) => v),
                ) : {};
                Object.assign(shot, await page.evaluate(inspect, { scope, tokens }));
              } catch (error) {
                shot.error = String(error.message ?? error).split("\n")[0];
                failed++;
              } finally {
                await context.close();
              }
              report.shots.push(shot);
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
    if (server) process.kill(-server.pid);
  }

  report.summary = {
    shots: report.shots.length,
    failed,
    contrast_failures: report.shots.reduce((n, s) => n + (s.contrast?.length ?? 0), 0),
    token_mismatches: report.shots.reduce((n, s) => n + (s.tokens?.filter((t) => !t.ok).length ?? 0), 0),
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  process.exit(failed ? 1 : 0);
}

if (!existsSync(manifestPath)) fail(`no manifest at ${manifestPath}`);
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
