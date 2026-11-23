// node --test skills/dashboard/scripts/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCards, counts, ago } from "./board.mjs";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const issue = (number, labels, { state = "OPEN", updated = hoursAgo(2) } = {}) =>
  ({ number, title: `Issue ${number}`, state, labels, created_at: hoursAgo(100), updated_at: updated });

test("a spec:draft spec needs you, with its project, link, reason and age", () => {
  const [card] = toCards("acme/app", [issue(7, ["spec:draft"])], [], {}, NOW);
  assert.deepEqual(card, {
    project: "acme/app", number: 7, title: "Issue 7", url: "https://github.com/acme/app/issues/7",
    kind: "spec", bucket: "needs-you", reason: "draft", since: hoursAgo(2), age: "2 h",
  });
});

const pick = (cards) => cards.map((c) => [c.number, c.kind, c.bucket, c.reason]);

test("each issue label state lands in its bucket; other issues get no card", () => {
  const issues = [
    issue(1, ["spec:draft"]),
    issue(2, ["spec:stuck", "retro"]),
    issue(3, ["design:ready"]),
    issue(4, ["spec:ready"]),
    issue(5, ["spec:building"]),
    issue(6, ["spec:in-review"]), // its PR stands for it
    issue(7, ["design:specced"]),
    issue(8, ["bug"]),
  ];
  assert.deepEqual(pick(toCards("acme/app", issues, [], {}, NOW)), [
    [1, "spec", "needs-you", "draft"],
    [2, "spec", "needs-you", "stuck"],
    [3, "design", "needs-you", "design ready to turn into specs"],
    [4, "spec", "ready", "ready to build"],
    [5, "spec", "in-flight", "building"],
  ]);
});

test("labels may come as objects with a name", () => {
  assert.equal(toCards("acme/app", [issue(1, [{ name: "spec:ready" }])], [], {}, NOW)[0].bucket, "ready");
});

test("specs closed in the last 7 days have landed; older ones and open issues stay out of Landed", () => {
  const issues = [
    issue(1, ["spec:in-review"], { state: "CLOSED", updated: hoursAgo(24 * 6) }),
    issue(2, ["spec:in-review"], { state: "CLOSED", updated: hoursAgo(24 * 8) }),
    issue(3, ["bug"], { state: "CLOSED", updated: hoursAgo(1) }),
  ];
  assert.deepEqual(pick(toCards("acme/app", issues, [], {}, NOW)), [[1, "spec", "landed", "closed"]]);
});

const pr = (number, labels, { draft = false, state = "open", merged = false, updated = hoursAgo(3), merged_at = null, ship_labeled_at } = {}) => ({
  number, title: `PR ${number}`, state, draft, merged, merged_at, labels, html_url: `https://github.com/acme/app/pull/${number}`,
  created_at: hoursAgo(200), updated_at: updated, ...(ship_labeled_at ? { ship_labeled_at } : {}),
});

test("each PR state lands in its bucket", () => {
  const prs = [
    pr(10, ["pr-reviewed"]),
    pr(11, ["conflicts"]),
    pr(12, [], { draft: true }),
    pr(13, ["pr-reviewed", "ship"], { updated: hoursAgo(5) }),
    pr(14, ["pr-reviewed", "ship"], { updated: hoursAgo(31) }),
    pr(15, []), // ready, not reviewed yet: the night shift is still on it
    pr(16, [], { state: "closed" }), // closed without merging
  ];
  assert.deepEqual(pick(toCards("acme/app", [], prs, {}, NOW)), [
    [10, "pr", "needs-you", "reviewed, waiting for your verdict"],
    [11, "pr", "needs-you", "conflicts"],
    [12, "pr", "in-flight", "draft"],
    [13, "pr", "in-flight", "approved 5 h ago, landing"],
    [14, "pr", "needs-you", "approved 31 h ago, not merged"],
  ]);
  assert.equal(toCards("acme/app", [], prs, {}, NOW)[0].url, "https://github.com/acme/app/pull/10");
});

test("approval time is when ship was added, when known, else the PR's last update", () => {
  const prs = [pr(20, ["ship"], { updated: hoursAgo(2), ship_labeled_at: hoursAgo(30) })];
  const [card] = toCards("acme/app", [], prs, {}, NOW);
  assert.equal(card.reason, "approved 30 h ago, not merged");
  assert.equal(card.since, hoursAgo(30));
});

test("failing checks need you; the pending ship status and skipped runs are not failures", () => {
  const prs = [pr(30, []), pr(31, []), pr(32, ["ship"]), pr(33, [])];
  const checks = {
    30: { check_runs: [{ name: "test", status: "completed", conclusion: "failure" }] },
    31: { check_runs: [{ name: "lint", status: "completed", conclusion: "skipped" }], statuses: [{ context: "ship", state: "pending" }, { context: "ship", state: "failure" }] },
    32: { statuses: [{ context: "ci/build", state: "error" }] },
    33: { check_runs: [{ name: "test", status: "in_progress", conclusion: null }] },
  };
  assert.deepEqual(pick(toCards("acme/app", [], prs, checks, NOW)), [
    [30, "pr", "needs-you", "checks failing"],
    [32, "pr", "needs-you", "checks failing"],
  ]);
});

test("PRs merged in the last 7 days have landed; older merges are dropped", () => {
  const prs = [
    pr(40, ["ship"], { state: "closed", merged: true, merged_at: hoursAgo(24 * 6) }),
    pr(41, ["ship"], { state: "closed", merged: true, merged_at: hoursAgo(24 * 8) }),
    pr(42, [], { state: "closed", merged_at: hoursAgo(1) }), // merged, though `merged` was left out
  ];
  const cards = toCards("acme/app", [], prs, {}, NOW);
  assert.deepEqual(pick(cards), [[40, "pr", "landed", "merged"], [42, "pr", "landed", "merged"]]);
  assert.equal(cards[0].since, hoursAgo(24 * 6));
  assert.equal(cards[0].age, "6 d");
});

test("an item matching several rules appears once, in the earliest bucket", () => {
  // A draft (In flight) with conflicts (Needs you); a ship PR (In flight) whose checks fail (Needs you).
  const prs = [pr(50, ["conflicts"], { draft: true }), pr(51, ["ship"])];
  const checks = { 51: { check_runs: [{ conclusion: "failure" }] } };
  // A spec labelled both ready and building.
  const issues = [issue(52, ["spec:building", "spec:ready"])];
  assert.deepEqual(pick(toCards("acme/app", issues, prs, checks, NOW)), [
    [52, "spec", "ready", "ready to build"],
    [50, "pr", "needs-you", "conflicts"],
    [51, "pr", "needs-you", "checks failing"],
  ]);
});

test("counts gives every bucket, zero included", () => {
  const cards = toCards("acme/app", [issue(1, ["spec:draft"]), issue(2, ["spec:stuck"]), issue(3, ["spec:ready"])], [], {}, NOW);
  assert.deepEqual(counts(cards), { "needs-you": 2, ready: 1, "in-flight": 0, landed: 0 });
});

test("ago reads in minutes, then hours up to two days, then days", () => {
  assert.deepEqual([ago(20 * 60e3), ago(31 * 3600e3), ago(47.5 * 3600e3), ago(50 * 3600e3), ago(-5)], ["20 min", "31 h", "47 h", "2 d", "1 min"]);
});
