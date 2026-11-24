// node --test skills/day-shift/scripts/day-shift.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseThresholds, classify, exclusion, readDeclined, addDeclined, DEFAULTS } from "./day-shift.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "day-shift.mjs");
const run = (argv, input = "") => JSON.parse(execFileSync("node", [script, ...argv], { input, encoding: "utf8" }));

const dispatch = (shift, created_at) => ({
  body: `<!-- night-shift {"status":"dispatched",${shift ? `"shift":"${shift}",` : ""}"routine":"r","session":"s"} -->\nnight-shift: building.`,
  created_at,
  author_association: "OWNER",
});
const status = (created_at) => ({ body: '<!-- night-shift {"status":"ready","pr":9} -->\nnight-shift: ready', created_at, author_association: "OWNER" });
const sliced = (estimate) => `## Problem\n\nx\n\n## Slicing\n\n- **Estimate:** ${estimate} (basis: #40)\n- **Decision:** one PR\n`;
const spec = (number, labels, body = "", comments = []) => ({ number, title: `Spec ${number}`, labels, body, comments });

// --- thresholds

test("thresholds: both lines present, as the template writes them", () => {
  const md = "## Day builds\n\n- **Day shift:** ≤300 lines, 2 behaviours\n- **Day shift builders:** 3\n";
  assert.deepEqual(parseThresholds(md), { lines: 300, behaviours: 2, builders: 3, warnings: [] });
});

test("thresholds: plain lines, singular behaviour and <= are read too", () => {
  assert.deepEqual(parseThresholds("Day shift: <=120 lines, 1 behaviour\nDay shift builders: 1"),
    { lines: 120, behaviours: 1, builders: 1, warnings: [] });
});

test("thresholds: absent lines take the defaults, without a warning", () => {
  assert.deepEqual(parseThresholds("# Shipping\n\nNothing about days.\n"), { ...DEFAULTS, warnings: [] });
  assert.deepEqual(run(["thresholds"], ""), { ...DEFAULTS, warnings: [] });
});

test("thresholds: malformed lines take the defaults, with a warning each", () => {
  const out = parseThresholds("- **Day shift:** small ones only\n- **Day shift builders:** lots\n");
  assert.equal(out.lines, 200);
  assert.equal(out.behaviours, 1);
  assert.equal(out.builders, 2);
  assert.equal(out.warnings.length, 2);
  assert.match(out.warnings[0], /Day shift/);
  assert.equal(parseThresholds("Day shift builders: 0").builders, 2);
});

// --- classification

const now = "2026-11-24T12:00:00Z";

test("classify: a sliced estimate within the budget is small, over it is left for tonight", () => {
  const out = classify([
    spec(1, ["spec:ready"], sliced("~90–140 reviewable lines, 1 behaviour")),
    spec(2, ["spec:ready"], sliced("~150–230 reviewable lines, 1 behaviour")), // high end over 200
    spec(3, ["spec:ready"], sliced("~60–100 reviewable lines, 2 behaviours")), // too many behaviours
    spec(4, ["spec:ready"], sliced("~200 reviewable lines, 1 behaviour")), // exactly on the line
  ], DEFAULTS, { now });
  assert.deepEqual(out.small.map((s) => s.number), [1, 4]);
  assert.deepEqual(out.tonight.map((s) => s.number), [2, 3]);
  assert.equal(out.small[0].estimate, "~90–140 lines, 1 behaviour");
});

test("classify: the thresholds from shipping.md move the line", () => {
  const out = classify([spec(3, ["spec:ready"], sliced("~60–100 reviewable lines, 2 behaviours"))],
    parseThresholds("Day shift: ≤150 lines, 2 behaviours"), { now });
  assert.deepEqual(out.small.map((s) => s.number), [3]);
});

test("classify: an unsliced spec is judged from its Size section", () => {
  const out = classify([
    spec(5, ["spec:ready"], "## Size\n\nSmall: one PR.\n\n## Open questions\n\nNone"),
    spec(6, ["spec:ready"], "## Size\n\nA new skill with a script and tests. One PR.\n"),
    spec(7, ["spec:ready"], "## Size\n\nSmall, but two PRs.\n"),
    spec(8, ["spec:ready"], "## Problem\n\nNo size at all.\n"),
  ], DEFAULTS, { now });
  assert.deepEqual(out.small.map((s) => [s.number, s.sliced, s.estimate]), [[5, false, "not sliced yet"]]);
  assert.deepEqual(out.tonight.map((s) => s.number), [6, 7, 8]);
});

test("classify: only spec:ready specs; a fresh dispatch counts as dispatched, an old one doesn't", () => {
  const body = sliced("~50–80 reviewable lines, 1 behaviour");
  const out = classify([
    spec(10, ["spec:building"], body),
    spec(11, ["spec:ready"], body, [dispatch("day", "2026-11-24T11:30:00Z")]),
    spec(12, ["spec:ready"], body, [dispatch("night", "2026-11-20T22:00:00Z"), status("2026-11-21T03:00:00Z")]),
  ], DEFAULTS, { now });
  assert.deepEqual(out.dispatched.map((s) => s.number), [11]);
  assert.deepEqual(out.small.map((s) => s.number), [12]);
});

test("classify: a declined spec is set aside, not proposed", () => {
  const body = sliced("~50–80 reviewable lines, 1 behaviour");
  const out = classify([spec(20, ["spec:ready"], body), spec(21, ["spec:ready"], body)], DEFAULTS, { now, declined: [21] });
  assert.deepEqual(out.small.map((s) => s.number), [20]);
  assert.deepEqual(out.declined.map((s) => s.number), [21]);
});

test("classify CLI reads shipping.md and the declined file", () => {
  const dir = mkdtempSync(join(tmpdir(), "day-shift-"));
  writeFileSync(join(dir, "shipping.md"), "- **Day shift:** ≤100 lines, 1 behaviour\n");
  writeFileSync(join(dir, "declined.json"), JSON.stringify({ date: "2026-11-24", specs: [31] }));
  const specs = [
    spec(30, ["spec:ready"], sliced("~50–80 reviewable lines, 1 behaviour")),
    spec(31, ["spec:ready"], sliced("~50–80 reviewable lines, 1 behaviour")),
    spec(32, ["spec:ready"], sliced("~90–140 reviewable lines, 1 behaviour")),
  ];
  const out = run(["classify", "--shipping", join(dir, "shipping.md"), "--declined", join(dir, "declined.json"),
    "--today", "2026-11-24", "--now", now], JSON.stringify(specs));
  assert.equal(out.thresholds.lines, 100);
  assert.deepEqual(out.small.map((s) => s.number), [30]);
  assert.deepEqual(out.declined.map((s) => s.number), [31]);
  assert.deepEqual(out.tonight.map((s) => s.number), [32]);
});

// --- exclusion

const since = "2026-11-24T06:00:00Z";

test("exclusion: a day build blocks the night", () => {
  const specs = [spec(40, ["spec:building"], "", [dispatch("day", "2026-11-24T10:00:00Z")])];
  assert.deepEqual(exclusion(specs, "night"), { blocked: true, reason: "day shift is building", specs: [40] });
  assert.equal(exclusion(specs, "day", { since }).blocked, false);
});

test("exclusion: a night build blocks the day", () => {
  const specs = [spec(41, ["spec:building"], "", [dispatch("night", "2026-11-23T22:00:00Z")])];
  assert.deepEqual(exclusion(specs, "day", { since }), { blocked: true, reason: "night shift is building", specs: [41] });
  assert.equal(exclusion(specs, "night").blocked, false);
});

test("exclusion: a dispatch comment without a shift counts as night", () => {
  const specs = [spec(42, ["spec:building"], "", [dispatch(null, "2026-11-23T22:00:00Z")])];
  assert.equal(exclusion(specs, "day", { since }).blocked, true);
  assert.equal(exclusion(specs, "night").blocked, false);
});

test("exclusion: the latest dispatch decides", () => {
  const specs = [spec(43, ["spec:building"], "", [dispatch("night", "2026-11-22T22:00:00Z"), dispatch("day", "2026-11-23T09:00:00Z")])];
  assert.equal(exclusion(specs, "night").blocked, true);
  assert.equal(exclusion(specs, "day", { since }).blocked, false);
});

test("exclusion: a stale spec:stuck spec blocks neither shift", () => {
  const specs = [
    spec(44, ["spec:stuck"], "", [dispatch("night", "2026-11-20T22:00:00Z")]),
    spec(45, ["spec:stuck"], "", [dispatch("day", "2026-11-21T10:00:00Z")]),
  ];
  assert.equal(exclusion(specs, "day", { since }).blocked, false);
  assert.equal(exclusion(specs, "night").blocked, false);
});

test("exclusion: tonight's evening run having dispatched blocks the day, even once its builds are done", () => {
  const specs = [spec(46, ["spec:in-review"], "", [dispatch("night", "2026-11-24T19:30:00Z")])];
  assert.deepEqual(exclusion(specs, "day", { since }), { blocked: true, reason: "tonight's evening run has dispatched", specs: [46] });
  const yesterday = [spec(47, ["spec:in-review"], "", [dispatch("night", "2026-11-23T22:00:00Z")])];
  assert.equal(exclusion(yesterday, "day", { since }).blocked, false);
});

test("exclusion: last night's run that slipped past midnight doesn't block the day once its builds are done", () => {
  const specs = [spec(49, ["spec:in-review"], "", [dispatch("night", "2026-11-24T00:30:00Z")])];
  assert.equal(exclusion(specs, "day", { since }).blocked, false);
});

test("exclusion and classify ignore dispatch comments from people without write access", () => {
  const forged = (shift, at) => ({ ...dispatch(shift, at), author_association: "NONE" });
  const night = [spec(50, ["spec:building"], "", [dispatch("night", "2026-11-23T22:00:00Z"), forged("day", "2026-11-24T10:00:00Z")])];
  assert.equal(exclusion(night, "day", { since }).blocked, true); // the forged day comment doesn't hide the night build
  assert.equal(exclusion(night, "night").blocked, false);
  const today = [spec(51, ["spec:in-review"], "", [forged("night", "2026-11-24T19:00:00Z")])];
  assert.equal(exclusion(today, "day", { since }).blocked, false);
  const ready = [spec(52, ["spec:ready"], sliced("~50–80 reviewable lines, 1 behaviour"), [forged("day", "2026-11-24T11:50:00Z")])];
  assert.deepEqual(classify(ready, DEFAULTS, { now }).small.map((s) => s.number), [52]);
});

test("exclusion CLI", () => {
  const specs = [spec(48, ["spec:building"], "", [dispatch("day", "2026-11-24T10:00:00Z")])];
  assert.deepEqual(run(["exclusion", "--side", "night"], JSON.stringify(specs)).specs, [48]);
  assert.equal(run(["exclusion", "--side", "day", "--since", since], JSON.stringify(specs)).blocked, false);
});

// --- declined file

test("declined: kept for the same day, reset the next", () => {
  const file = join(mkdtempSync(join(tmpdir(), "day-shift-")), "nested", "declined.json");
  assert.deepEqual(readDeclined(file, "2026-11-24"), []);
  assert.deepEqual(addDeclined(file, "2026-11-24", [12]), [12]);
  assert.deepEqual(addDeclined(file, "2026-11-24", ["9", 12]), [9, 12]);
  assert.deepEqual(readDeclined(file, "2026-11-24"), [9, 12]);
  assert.deepEqual(readDeclined(file, "2026-11-25"), []);
  assert.deepEqual(addDeclined(file, "2026-11-25", [14]), [14]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { date: "2026-11-25", specs: [14] });
});

test("classify: an unreadable Slicing estimate is left for tonight", () => {
  const out = classify([spec(60, ["spec:ready"], "## Slicing\n\n- **Estimate:** a few hundred lines\n")], DEFAULTS, { now });
  assert.deepEqual(out.tonight.map((s) => [s.number, s.estimate]), [[60, "estimate unreadable"]]);
});

test("declined: '#12' is read as spec 12, and anything else is refused", () => {
  const file = join(mkdtempSync(join(tmpdir(), "day-shift-")), "declined.json");
  assert.deepEqual(addDeclined(file, "2026-11-24", ["#12"]), [12]);
  assert.throws(() => addDeclined(file, "2026-11-24", ["twelve"]), /not a spec number/);
});

test("declined CLI: list and add", () => {
  const file = join(mkdtempSync(join(tmpdir(), "day-shift-")), "declined.json");
  assert.deepEqual(run(["declined", "add", "5", "--file", file, "--today", "2026-11-24"]), { date: "2026-11-24", specs: [5] });
  assert.deepEqual(run(["declined", "list", "--file", file, "--today", "2026-11-24"]), { date: "2026-11-24", specs: [5] });
  assert.deepEqual(run(["declined", "list", "--file", file, "--today", "2026-11-25"]), { date: "2026-11-25", specs: [] });
});

test("declined: an unreadable file reads as empty", () => {
  const file = join(mkdtempSync(join(tmpdir(), "day-shift-")), "declined.json");
  writeFileSync(file, "not json");
  assert.deepEqual(readDeclined(file, "2026-11-24"), []);
});
