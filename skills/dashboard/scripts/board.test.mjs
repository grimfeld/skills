// node --test skills/dashboard/scripts/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCards, counts, ago, BUCKETS, normaliseRepo, mergeProjects, sortBucket, LANDED_WINDOW, isMissingFile, needsCheckRead, parseReview, safeUrl } from "./board.mjs";

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

const pr = (number, labels, { draft = false, state = "open", merged = false, updated = hoursAgo(3), merged_at = null } = {}) => ({
  number, title: `PR ${number}`, state, draft, merged, merged_at, labels, html_url: `https://evil.example/acme/app/pull/${number}`,
  created_at: hoursAgo(200), updated_at: updated,
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
    [13, "pr", "in-flight", "ship label on, landing"],
    [14, "pr", "needs-you", "ship label on, no update for 31 h"],
  ]);
});

test("a PR card links to the PR on github.com, built from project and number, not html_url", () => {
  assert.equal(toCards("acme/app", [], [pr(10, ["pr-reviewed"])], {}, NOW)[0].url, "https://github.com/acme/app/pull/10");
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

test("a changes-requested PR is back with the night shift, not waiting on you", () => {
  const prs = [pr(60, ["pr-reviewed", "changes-requested"])];
  assert.deepEqual(pick(toCards("acme/app", [], prs, {}, NOW)), [[60, "pr", "in-flight", "changes requested, back to the night shift"]]);
});

test("a PR closed without merging gets no card, whatever its labels", () => {
  assert.deepEqual(toCards("acme/app", [], [pr(61, ["pr-reviewed"], { state: "closed" })], {}, NOW), []);
});

test("a merged PR has landed, even with conflicts, pr-reviewed and ship still on", () => {
  const prs = [pr(62, ["conflicts", "pr-reviewed", "ship"], { state: "closed", merged: true, merged_at: hoursAgo(5) })];
  assert.deepEqual(pick(toCards("acme/app", [], prs, {}, NOW)), [[62, "pr", "landed", "merged"]]);
});

test("each bucket carries the colour tone the page styles it with", () => {
  assert.deepEqual(BUCKETS.map((b) => [b.id, b.tone]), [["needs-you", "needs"], ["ready", "ready"], ["in-flight", "flight"], ["landed", "landed"]]);
});

test("normaliseRepo turns a pasted repo into owner/name, and rejects anything else", () => {
  assert.deepEqual(
    ["https://github.com/o/r.git/", "  acme/app ", "github.com/acme/app", "acme/my.repo-2", "acme", "a/b/c", "acme/ap p", "", "https://gitlab.com/o/r", null].map(normaliseRepo),
    ["o/r", "acme/app", "acme/app", "acme/my.repo-2", null, null, null, null, null, null],
  );
});

test("mergeProjects keeps each repo once, ignoring case, in first-seen order and spelling", () => {
  assert.deepEqual(mergeProjects(["Acme/App", "acme/api"], ["acme/app", "zed/x", "ACME/API"]), ["Acme/App", "acme/api", "zed/x"]);
  assert.deepEqual(mergeProjects(undefined, ["a/b"]), ["a/b"]);
});

test("within a bucket, what has waited longest comes first; Landed shows the newest first", () => {
  const cards = [{ n: 1, since: hoursAgo(5) }, { n: 2, since: hoursAgo(50) }, { n: 3, since: hoursAgo(1) }];
  assert.deepEqual(sortBucket(cards, "needs-you").map((c) => c.n), [2, 1, 3]);
  assert.deepEqual(sortBucket(cards, "landed").map((c) => c.n), [3, 1, 2]);
  assert.deepEqual(cards.map((c) => c.n), [1, 2, 3], "the input is left alone");
});

test("Landed covers the last 7 days", () => {
  assert.equal(LANDED_WINDOW, 7 * 24 * 3600e3);
  const prs = [pr(70, [], { state: "closed", merged_at: hoursAgo(24 * 7 - 1) }), pr(71, [], { state: "closed", merged_at: hoursAgo(24 * 7 + 1) })];
  assert.deepEqual(pick(toCards("acme/app", [], prs, {}, NOW)).map((c) => c[0]), [70]);
});

// The GitHub connector's answer for a path that isn't there, as observed.
const MISSING = "Failed to get file contents. The path does not point to a file or directory, or the file does not exist in the repository.";

test("isMissingFile: the GitHub connector's missing-file tool_error means the file isn't there", () => {
  assert.equal(isMissingFile({ code: "tool_error", message: MISSING }), true);
  assert.equal(isMissingFile({ code: "tool_error", message: "GET .../contents/docs/agents/shipping.md: 404 Not Found []" }), true);
});

test("isMissingFile: a GitHub hiccup or another refusal is not a missing file", () => {
  assert.equal(isMissingFile({ code: "tool_error", message: "GET .../contents/docs/agents/shipping.md: 502 Bad Gateway []" }), false);
  assert.equal(isMissingFile({ code: "tool_error", message: "API rate limit exceeded for user." }), false);
  assert.equal(isMissingFile({ code: "rate_limited", message: "not found" }), false);
  assert.equal(isMissingFile({ code: "upstream_error", message: MISSING }), false);
  assert.equal(isMissingFile(undefined), false);
});

// needsCheckRead(prevRead, check, pr, refresh): whether a ready PR's checks are read (again).
const PR = { number: 4, state: "open", updated_at: hoursAgo(3) };
const lastRead = { updatedAt: PR.updated_at, pending: false };
const passed = { check_runs: [{ name: "test", status: "completed", conclusion: "success" }], statuses: [{ context: "ship", state: "pending" }] };

test("needsCheckRead: a PR never read is read", () => {
  assert.equal(needsCheckRead(undefined, undefined, PR, false), true);
});

test("needsCheckRead: an unchanged PR whose checks finished is not read again; Refresh reads it", () => {
  assert.equal(needsCheckRead(lastRead, passed, PR, false), false);
  assert.equal(needsCheckRead(lastRead, passed, PR, true), true);
});

test("needsCheckRead: the pending ship status alone doesn't make a PR re-read", () => {
  const onlyShip = { check_runs: [], statuses: [{ context: "ship", state: "pending" }] };
  assert.equal(needsCheckRead(lastRead, onlyShip, PR, false), false);
});

test("needsCheckRead: an unchanged PR with a run queued or in progress, or another status pending, is re-read", () => {
  for (const status of ["queued", "in_progress"]) {
    assert.equal(needsCheckRead(lastRead, { check_runs: [{ name: "test", status, conclusion: null }], statuses: [] }, PR, false), true, status);
  }
  assert.equal(needsCheckRead(lastRead, { check_runs: [], statuses: [{ context: "ci/build", state: "pending" }] }, PR, false), true);
});

test("needsCheckRead: checks that couldn't be read are read again", () => {
  assert.equal(needsCheckRead(lastRead, { unknown: true, code: "upstream_error" }, PR, false), true);
});

test("needsCheckRead: a PR updated since its last read is re-read", () => {
  assert.equal(needsCheckRead(lastRead, passed, { ...PR, updated_at: hoursAgo(1) }, false), true);
});

test("needsCheckRead: a read still in flight is never doubled, even on Refresh", () => {
  const inFlight = { updatedAt: hoursAgo(5), pending: true };
  assert.equal(needsCheckRead(inFlight, undefined, { ...PR, updated_at: hoursAgo(1) }, false), false);
  assert.equal(needsCheckRead(inFlight, undefined, PR, true), false);
});

// ---- PR card details: the pr-review section render-report.py writes into PR descriptions.

// PR #88's section, as pr-review wrote it.
const REVIEW = `Closes #71

<!-- pr-review:start -->
## Review

**Approve with suggestions.** nothing blocking · 4 smaller improvements · no CI checks in this repository

[Full report](https://claude.ai/artifact/49w8qQ97Gh5XNtkCBgHKev)

### What changes

**Dashboard**

- \`/ship:dashboard\` publishes one private claude.ai page, and republishes to the same page later.

### Risks

- **Connector scope:** the page reads GitHub with your own connector credentials. A person should approve this connector scope (\`skills/dashboard/SKILL.md\`).
- **Never opened against real repos:** the connector calls were tested only against a mock.

<details><summary>Worth fixing later (4)</summary>

- **Error handling:** Refresh while file reads are refused serves cached data for up to 4 minutes

</details>

<sub>pr-review · head \`4cdf6f5\` · 2026-11-23 14:40 · reviewers: quality</sub>

<!-- pr-review:end -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

test("parseReview reads the verdict line, the risks and the Full report link from the review section", () => {
  assert.deepEqual(parseReview(REVIEW), {
    verdict: "Approve with suggestions",
    line: "Approve with suggestions. nothing blocking · 4 smaller improvements · no CI checks in this repository",
    risks: 2,
    reportUrl: "https://claude.ai/artifact/49w8qQ97Gh5XNtkCBgHKev",
    previewUrl: null,
  });
});

test("parseReview: a description without the review section has no review", () => {
  assert.equal(parseReview("Closes #71\n\nSome description."), null);
  assert.equal(parseReview(undefined), null);
  assert.equal(parseReview("<!-- pr-review:start -->\n**Approve.** cut off"), null, "no end marker");
});

test("parseReview: the 'None found' bullet means zero risks; Preview and Full report links both read", () => {
  const body = [
    "<!-- pr-review:start -->", "## Review", "",
    "**Approve.** nothing blocking · CI green", "",
    "[Preview](https://app-git-x.vercel.app/) · [Full report](https://claude.ai/artifact/abc)", "",
    "### Risks", "",
    "- None found: no migration, data removal, auth, dependency or deploy change.", "",
    "<sub>pr-review · head `abc` · 2026-11-23 · reviewers: quality</sub>", "",
    "<!-- pr-review:end -->",
  ].join("\n");
  assert.deepEqual(parseReview(body), {
    verdict: "Approve", line: "Approve. nothing blocking · CI green", risks: 0,
    reportUrl: "https://claude.ai/artifact/abc", previewUrl: "https://app-git-x.vercel.app/",
  });
});

test("parseReview: links that aren't https are dropped", () => {
  const body = "<!-- pr-review:start -->\n**Changes requested.** 1 to fix\n\n[Preview](javascript:alert(1)) · [Full report](http://claude.ai/x)\n<!-- pr-review:end -->";
  const review = parseReview(body);
  assert.equal(review.previewUrl, null);
  assert.equal(review.reportUrl, null);
  assert.equal(review.verdict, "Changes requested");
  assert.equal(review.risks, null, "no Risks heading: the count is unknown, not zero");
});

test("safeUrl keeps https links only", () => {
  assert.equal(safeUrl("https://claude.ai/artifact/x"), "https://claude.ai/artifact/x");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://claude.ai", "//claude.ai/x", "", null]) assert.equal(safeUrl(bad), null, bad);
});

const branchPr = (number, head, base, extra = {}) => ({ ...pr(number, ["pr-reviewed"], extra), head: { ref: head, sha: "abc" }, base: { ref: base } });

test("a PR whose base is another open PR's branch lands after it; a PR on the default branch lands on its own", () => {
  const prs = [
    branchPr(10, "spec/71-ship-dashboard", "main"),
    branchPr(11, "spec/72-dashboard-card-details", "spec/71-ship-dashboard"),
    branchPr(12, "spec/73-other", "spec/old-merged", { state: "closed" }),
    branchPr(13, "spec/74-on-merged", "spec/73-other"),
  ];
  const by = Object.fromEntries(toCards("acme/app", [], prs, {}, NOW).map((c) => [c.number, c.landsAfter]));
  assert.deepEqual(by, { 10: null, 11: 10, 13: null });
});

test("a PR card carries its review, or null when the description has none", () => {
  const [reviewed, unreviewed] = toCards("acme/app", [], [{ ...pr(1, ["pr-reviewed"]), body: REVIEW }, pr(2, ["pr-reviewed"])], {}, NOW);
  assert.equal(reviewed.review.risks, 2);
  assert.equal(reviewed.review.reportUrl, "https://claude.ai/artifact/49w8qQ97Gh5XNtkCBgHKev");
  assert.equal(unreviewed.review, null);
});
