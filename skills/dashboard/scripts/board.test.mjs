// node --test skills/dashboard/scripts/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCards, counts, ago, BUCKETS, normaliseRepo, mergeProjects, sortBucket, LANDED_WINDOW, isMissingFile, needsCheckRead, parseReview, safeUrl, openQuestions, designLink, morningPage, morningSpecs, shipYml, actionsEnabled, approveLabels, unapproveLabels, fileText, landingRun } from "./board.mjs";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const issue = (number, labels, { state = "OPEN", updated = hoursAgo(2) } = {}) =>
  ({ number, title: `Issue ${number}`, state, labels, created_at: hoursAgo(100), updated_at: updated });

test("a spec:draft spec needs you, with its project, link, reason and age", () => {
  const [card] = toCards("acme/app", [issue(7, ["spec:draft"])], [], {}, NOW);
  assert.deepEqual(card, {
    project: "acme/app", number: 7, title: "Issue 7", url: "https://github.com/acme/app/issues/7",
    kind: "spec", bucket: "needs-you", reason: "draft", since: hoursAgo(2), age: "2 h",
    openQuestions: null, pr: null,
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

// ---- Spec, design and morning-page details.

// The spec template's tail (skills/spec-me/templates/spec.md).
const spec = (questions) => `## Size\n\nOne PR.\n\n## Open questions\n\n${questions}\n\n<!-- Below this line, \`/ship:slice\` writes "Slicing" and "Tickets", and the night shift writes "Build". -->\n\n## Slicing\n\n- **Estimate:** ~200 lines\n- **Decision:** one PR\n`;

test("openQuestions: 'None' or an empty section counts 0; three questions count 3, their sub-points not", () => {
  assert.equal(openQuestions(spec("None")), 0);
  assert.equal(openQuestions(spec("- None.")), 0);
  assert.equal(openQuestions(spec("")), 0);
  assert.equal(openQuestions(spec("- Which tab first?\n- Who owns retries?\n  - one option\n  - another\n- Cache or not?")), 3);
});

test("openQuestions: a body without the section has no count", () => {
  assert.equal(openQuestions("## Problem\n\nx"), null);
  assert.equal(openQuestions(undefined), null);
});

// A design issue (skills/design-me/templates/design-issue.md).
const design = (artifact) => `## Design\n\n- **Module:** Board\n- **Artifact:** ${artifact}\n\nThe board's first look.\n\n<!-- Below this line, \`/ship:design-me\` writes "Intakes": one entry per run. -->\n\n## Intakes\n\n- [Earlier look](https://claude.ai/artifact/old)\n`;

test("designLink: the Artifact line's link, bare, in angle brackets or as a Markdown link", () => {
  assert.equal(designLink(design("https://claude.ai/artifact/abc123")), "https://claude.ai/artifact/abc123");
  assert.equal(designLink(design("<https://claude.ai/artifact/abc123>")), "https://claude.ai/artifact/abc123");
  assert.equal(designLink(design("[Board design](https://claude.ai/artifact/abc123)")), "https://claude.ai/artifact/abc123");
});

test("designLink: no link, a placeholder or a link that isn't https gives none", () => {
  assert.equal(designLink("## Design\n\n- **Module:** Board\n"), null);
  assert.equal(designLink(design("<claude.ai artifact link>")), null);
  assert.equal(designLink(design("javascript:alert(1)")), null);
  assert.equal(designLink(design("[x](javascript:alert(1)) https://claude.ai/artifact/later")), null, "only the first link on the line counts");
});

// night-shift's morning step 5 comment.
const morning = (url, hours) => ({ body: `<!-- ship:morning-page -->\nReviewed on this morning's page: ${url}`, created_at: hoursAgo(hours) });
const remark = (hours) => ({ body: "night-shift: building tonight in https://claude.ai/code/session_1.", created_at: hoursAgo(hours) });

test("morningPage: no marker comment, no page", () => {
  assert.equal(morningPage([]), null);
  assert.equal(morningPage([remark(3)]), null);
  assert.equal(morningPage(undefined), null);
});

test("morningPage: one marker comment gives its page and when it was posted", () => {
  assert.deepEqual(morningPage([remark(30), morning("https://claude.ai/artifact/m1", 20)]), { url: "https://claude.ai/artifact/m1", at: hoursAgo(20) });
});

test("morningPage: of two markers, the newest wins, in whatever order the comments come", () => {
  const comments = [morning("https://claude.ai/artifact/new", 2), remark(10), morning("https://claude.ai/artifact/old", 26)];
  assert.equal(morningPage(comments).url, "https://claude.ai/artifact/new");
  assert.equal(morningPage([...comments].reverse()).url, "https://claude.ai/artifact/new");
});

test("morningPage: a marker comment whose link isn't https is skipped", () => {
  assert.equal(morningPage([morning("https://claude.ai/artifact/ok", 30), morning("javascript:alert(1)", 2)]).url, "https://claude.ai/artifact/ok");
  assert.equal(morningPage([{ body: "Reviewed on this morning's page: https://claude.ai/artifact/x", created_at: hoursAgo(1) }]), null, "no marker");
});

test("morningSpecs: specs updated in the last 7 days, newest first, at most 10; other issues and older specs left out", () => {
  const issues = [
    issue(1, ["spec:in-review"], { updated: hoursAgo(20) }),
    issue(2, ["spec:in-review"], { state: "CLOSED", updated: hoursAgo(2) }),
    issue(3, ["bug"], { updated: hoursAgo(1) }),
    issue(4, ["spec:ready"], { updated: hoursAgo(24 * 8) }),
    issue(5, ["design:ready"], { updated: hoursAgo(1) }),
  ];
  assert.deepEqual(morningSpecs(issues, NOW).map((i) => i.number), [2, 1]);
  const many = Array.from({ length: 14 }, (_, n) => issue(n + 1, ["spec:building"], { updated: hoursAgo(n + 1) }));
  assert.deepEqual(morningSpecs(many, NOW).map((i) => i.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

const linked = (number, body, head, extra = {}) => ({ ...pr(number, [], extra), body, head: { ref: head }, base: { ref: "main" } });

test("a spec card counts its open questions and links its PR, found by a closing keyword or its spec/<n>- branch", () => {
  const issues = [
    { ...issue(7, ["spec:building"]), body: spec("- One?\n- Two?\n- Three?") },
    { ...issue(8, ["spec:stuck"]), body: spec("None") },
    { ...issue(9, ["spec:draft"]), body: "no template" },
  ];
  const prs = [
    linked(20, "Closes #7\n\nMore.", "feature/x", { draft: true }),
    linked(21, "Refs #87 and #80", "spec/8-stuck-thing", { draft: true }),
  ];
  const cards = Object.fromEntries(toCards("acme/app", issues, prs, {}, NOW).filter((c) => c.kind === "spec").map((c) => [c.number, [c.openQuestions, c.pr]]));
  assert.deepEqual(cards, {
    7: [3, { number: 20, url: "https://github.com/acme/app/pull/20" }],
    8: [0, { number: 21, url: "https://github.com/acme/app/pull/21" }],
    9: [null, null],
  });
});

test("a spec's open PR is linked before a merged one, and a PR closed unmerged never", () => {
  const issues = [{ ...issue(7, ["spec:building"]), body: spec("None") }];
  const prs = [
    linked(30, "Fixes #7", "a", { state: "closed", merged: true, merged_at: hoursAgo(50) }),
    linked(31, "Resolves #7", "b", { state: "closed" }),
    linked(32, "closes #7", "c", { draft: true }),
  ];
  assert.equal(toCards("acme/app", issues, prs, {}, NOW).find((c) => c.kind === "spec").pr.number, 32);
  assert.equal(toCards("acme/app", issues, prs.slice(0, 2), {}, NOW).find((c) => c.kind === "spec").pr.number, 30);
});

test("a design card links its design artifact", () => {
  const [card] = toCards("acme/app", [{ ...issue(3, ["design:ready"]), body: design("https://claude.ai/artifact/abc123") }], [], {}, NOW);
  assert.equal(card.designUrl, "https://claude.ai/artifact/abc123");
});

// ---- Approve, Un-approve and Land: the ship.yml version gate and the label lists.

const shipFile = (first, branch = "main") =>
  `${first}\n# Installed by /ship:setup-ship.\nname: Ship\n\non:\n  pull_request:\n    types: [opened]\n  push:\n    branches: [${branch}]\n  workflow_dispatch:\n`;

test("ship.yml's version comes from its first line: 1, 2 and 3 read as such", () => {
  assert.equal(shipYml(shipFile("# ship.yml version: 1")).version, 1);
  assert.equal(shipYml(shipFile("# ship.yml version: 2")).version, 2);
  assert.equal(shipYml(shipFile("# ship.yml version: 3")).version, 3);
});

test("a missing ship.yml, or one whose first line isn't the version line, has no version", () => {
  assert.equal(shipYml(null).version, null);
  for (const first of ["name: Ship", "# ship.yml version: two", "# ship.yml version:", "# Installed by /ship:setup-ship.", ""]) {
    assert.equal(shipYml(shipFile(first)).version, null, first);
  }
  assert.equal(shipYml("name: Ship\n# ship.yml version: 2\n").version, null, "only the first line counts");
});

test("actions are enabled from ship.yml version 2 on, never for 1, missing or malformed", () => {
  assert.deepEqual([1, 2, 3, null].map(actionsEnabled), [false, true, true, false]);
});

test("Approve writes the PR's labels plus ship, once; Un-approve writes them without it", () => {
  assert.deepEqual(approveLabels(["pr-reviewed", "spec:in-review"]), ["pr-reviewed", "spec:in-review", "ship"]);
  assert.deepEqual(approveLabels([{ name: "pr-reviewed" }, { name: "ship" }]), ["pr-reviewed", "ship"]);
  assert.deepEqual(approveLabels(undefined), ["ship"]);
  assert.deepEqual(unapproveLabels(["pr-reviewed", "ship", "needs-docs"]), ["pr-reviewed", "needs-docs"]);
  assert.deepEqual(unapproveLabels([{ name: "ship" }]), []);
  assert.deepEqual(unapproveLabels(["pr-reviewed"]), ["pr-reviewed"]);
});

test("a file's text is read from get_file_contents' resource block, past its status line", () => {
  const text = shipFile("# ship.yml version: 2");
  const result = {
    content: [
      { type: "text", text: "successfully downloaded text file (SHA: 39dc28f)" },
      { type: "resource", resource: { uri: "repo://acme/app/sha/049e1ed/contents/.github/workflows/ship.yml", mimeType: "text/plain", text } },
    ],
    payload: "successfully downloaded text file (SHA: 39dc28f)",
  };
  assert.equal(fileText(result), text);
  assert.equal(fileText({ payload: { content: Buffer.from(text).toString("base64"), encoding: "base64" } }), text, "the REST shape too");
  assert.equal(fileText({ content: [{ type: "text", text: "successfully downloaded text file" }] }), null);
  assert.equal(fileText(undefined), null);
});

test("a reviewed PR's card offers Approve, a ship PR's card Un-approve, others neither", () => {
  const prs = [
    pr(1, ["pr-reviewed"]),
    pr(2, ["pr-reviewed", "ship"]),
    pr(3, ["ship"], { updated: hoursAgo(30) }),
    pr(4, ["pr-reviewed", "conflicts"]),
    pr(5, ["pr-reviewed", "changes-requested"]),
    pr(6, ["pr-reviewed"], { draft: true }),
    pr(7, ["ship"], { state: "closed", merged: true, merged_at: hoursAgo(5) }),
  ];
  const got = Object.fromEntries(toCards("acme/app", [], prs, {}, NOW).map((c) => [c.number, [c.bucket, c.action]]));
  assert.deepEqual(got, {
    1: ["needs-you", "approve"],
    2: ["in-flight", "unapprove"],
    3: ["needs-you", "unapprove"],
    4: ["needs-you", null],
    5: ["in-flight", null],
    6: ["needs-you", null], // a draft is never approved, wherever it sits
    7: ["landed", null],
  });
  assert.deepEqual(toCards("acme/app", [], [pr(1, ["pr-reviewed", "spec:in-review"])], {}, NOW)[0].labels, ["pr-reviewed", "spec:in-review"]);
});

test("ship.yml names the default branch in its push trigger, as setup-ship writes it", () => {
  assert.equal(shipYml(shipFile("# ship.yml version: 2", "trunk")).defaultBranch, "trunk");
  assert.equal(shipYml(shipFile("# ship.yml version: 2", "'release/1.x'")).defaultBranch, "release/1.x");
  assert.equal(shipYml("# ship.yml version: 2\non:\n  workflow_dispatch:\n").defaultBranch, null);
  assert.equal(shipYml(null).defaultBranch, null);
});

test("the landing run is the newest workflow_dispatch run created since the click", () => {
  const click = Date.parse("2026-11-23T12:00:00Z");
  const run = (id, at, event = "workflow_dispatch") => ({ id, event, created_at: at, html_url: `https://github.com/acme/app/actions/runs/${id}` });
  assert.deepEqual(landingRun({ workflow_runs: [run(2, "2026-11-23T12:00:03Z"), run(1, "2026-11-23T11:00:00Z")] }, click),
    { id: 2, url: "https://github.com/acme/app/actions/runs/2" });
  assert.equal(landingRun({ workflow_runs: [run(1, "2026-11-23T11:59:00Z")] }, click), null, "an earlier run isn't this one");
  assert.equal(landingRun({ workflow_runs: [run(3, "2026-11-23T11:59:58Z")] }, click)?.id, 3, "a few seconds of clock skew are allowed");
  assert.equal(landingRun({ workflow_runs: [run(4, "2026-11-23T12:00:03Z", "push")] }, click), null);
  assert.equal(landingRun({ workflow_runs: [{ ...run(5, "2026-11-23T12:00:03Z"), html_url: "javascript:alert(1)" }] }, click), null);
  assert.equal(landingRun(undefined, click), null);
});
