// node --test skills/dashboard/scripts/board.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCards, counts, ago, BUCKETS, normaliseRepo, mergeProjects, sortBucket, LANDED_WINDOW, isMissingFile, needsCheckRead, needsCommentRead, parseReview, safeUrl, openQuestions, designLink, morningPage, morningSpecs, shipYml, actionsEnabled, approveLabels, unapproveLabels, fileText, landingRun, prAction, labelWrite, writeError, WRITE_DEFINITE, skillFor, preselectEnvironment, sessionLink, singleFlight } from "./board.mjs";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const issue = (number, labels, { state = "OPEN", updated = hoursAgo(2) } = {}) =>
  ({ number, title: `Issue ${number}`, state, labels, created_at: hoursAgo(100), updated_at: updated });

test("a spec:draft spec needs you, with its project, link, reason and age", () => {
  const [card] = toCards("acme/app", [issue(7, ["spec:draft"])], [], {}, NOW);
  assert.deepEqual(card, {
    project: "acme/app", number: 7, title: "Issue 7", url: "https://github.com/acme/app/issues/7",
    kind: "spec", bucket: "needs-you", reason: "draft", since: hoursAgo(2), age: "2 h",
    openQuestions: null, pr: null, labels: ["spec:draft"],
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

// list_pull_requests' head and base carry the repo; a PR from a fork has the fork as its head repo.
const HEAD_SHA = "4cdf6f5e0123456789abcdef0123456789abcdef";
const ref = (name, repo = "acme/app", sha = HEAD_SHA) => ({ ref: name, sha, repo: { full_name: repo } });
const pr = (number, labels, { draft = false, state = "open", merged = false, updated = hoursAgo(3), merged_at = null } = {}) => ({
  number, title: `PR ${number}`, state, draft, merged, merged_at, labels, html_url: `https://evil.example/acme/app/pull/${number}`,
  created_at: hoursAgo(200), updated_at: updated, head: ref(`branch-${number}`), base: ref("main"),
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

const SPEC = { number: 7, updated_at: hoursAgo(3) };

test("needsCommentRead: a spec never read is read", () => {
  assert.equal(needsCommentRead(undefined, SPEC), true);
});

test("needsCommentRead: a read in flight is never doubled", () => {
  assert.equal(needsCommentRead({ updatedAt: hoursAgo(9), pending: true, failed: false }, SPEC), false);
});

test("needsCommentRead: an unchanged spec read fine isn't read again; one updated since is", () => {
  assert.equal(needsCommentRead({ updatedAt: SPEC.updated_at, pending: false, failed: false }, SPEC), false);
  assert.equal(needsCommentRead({ updatedAt: hoursAgo(9), pending: false, failed: false }, SPEC), true);
});

test("needsCommentRead: a spec whose last read failed is read again", () => {
  assert.equal(needsCommentRead({ updatedAt: SPEC.updated_at, pending: false, failed: true }, SPEC), true);
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
    verdict: "Approve with suggestions", tone: "warn", head: "4cdf6f5",
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
    "<sub>pr-review · head `abc1234` · 2026-11-23 · reviewers: quality</sub>", "",
    "<!-- pr-review:end -->",
  ].join("\n");
  assert.deepEqual(parseReview(body), {
    verdict: "Approve", tone: "good", head: "abc1234", line: "Approve. nothing blocking · CI green", risks: 0,
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

test("parseReview: each verdict render-report.py writes carries its tone; an unknown one has none", () => {
  const tone = (verdict) => parseReview(`<!-- pr-review:start -->\n**${verdict}.** x\n<!-- pr-review:end -->`).tone;
  assert.equal(tone("Approve"), "good");
  assert.equal(tone("Approve with suggestions"), "warn");
  assert.equal(tone("Changes requested"), "bad");
  assert.equal(tone("Ship it"), null);
});

test("parseReview: no head line, or one that isn't a commit, gives no head", () => {
  assert.equal(parseReview("<!-- pr-review:start -->\n**Approve.** x\n<!-- pr-review:end -->").head, null);
  assert.equal(parseReview("<!-- pr-review:start -->\n**Approve.** x\n<sub>pr-review · head `?` · d</sub>\n<!-- pr-review:end -->").head, null);
});

test("safeUrl keeps https links only", () => {
  assert.equal(safeUrl("https://claude.ai/artifact/x"), "https://claude.ai/artifact/x");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://claude.ai", "//claude.ai/x", "", null]) assert.equal(safeUrl(bad), null, bad);
});

test("safeUrl with hosts keeps only links on those hosts", () => {
  assert.equal(safeUrl("https://claude.ai/artifact/x", ["claude.ai"]), "https://claude.ai/artifact/x");
  assert.equal(safeUrl("https://evil.example/artifact/x", ["claude.ai"]), null);
  assert.equal(safeUrl("https://claude.ai.evil.example/x", ["claude.ai"]), null);
  assert.equal(safeUrl("https://user@evil.example/x", ["claude.ai"]), null);
  assert.equal(safeUrl("http://claude.ai/x", ["claude.ai"]), null);
});

test("parseReview: a Full report link off claude.ai is dropped; Preview may be any https host", () => {
  const body = "<!-- pr-review:start -->\n**Approve.** fine\n\n[Preview](https://evil.example/p) · [Full report](https://evil.example/r)\n<!-- pr-review:end -->";
  const review = parseReview(body);
  assert.equal(review.reportUrl, null);
  assert.equal(review.previewUrl, "https://evil.example/p");
});

const branchPr = (number, head, base, extra = {}, headRepo = "acme/app") => ({ ...pr(number, ["pr-reviewed"], extra), head: ref(head, headRepo), base: ref(base) });

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

test("a PR doesn't land after a fork's PR whose branch has the same name as its base", () => {
  const prs = [branchPr(20, "feature", "main", {}, "mallory/app"), branchPr(21, "next", "feature")];
  assert.equal(toCards("acme/app", [], prs, {}, NOW).find((c) => c.number === 21).landsAfter, null);
  const own = [branchPr(20, "feature", "main"), branchPr(21, "next", "feature")];
  assert.equal(toCards("acme/app", [], own, {}, NOW).find((c) => c.number === 21).landsAfter, 20);
});

test("a PR card carries its review, or null when the description has none", () => {
  const [reviewed, unreviewed] = toCards("acme/app", [], [{ ...pr(1, ["pr-reviewed"]), body: REVIEW }, pr(2, ["pr-reviewed"])], {}, NOW);
  assert.equal(reviewed.review.risks, 2);
  assert.equal(reviewed.review.reportUrl, "https://claude.ai/artifact/49w8qQ97Gh5XNtkCBgHKev");
  assert.equal(unreviewed.review, null);
});

test("a review of an older head is out of date: no verdict, tone, line or risks, links kept", () => {
  const [card] = toCards("acme/app", [], [{ ...pr(1, ["pr-reviewed"]), body: REVIEW, head: ref("x", "acme/app", "9999999aaaa") }], {}, NOW);
  assert.deepEqual(card.review, {
    verdict: null, tone: null, line: null, risks: null, head: "4cdf6f5", outOfDate: true,
    reportUrl: "https://claude.ai/artifact/49w8qQ97Gh5XNtkCBgHKev", previewUrl: null,
  });
});

test("a review of the PR's current head is believed", () => {
  const [card] = toCards("acme/app", [], [{ ...pr(1, ["pr-reviewed"]), body: REVIEW }], {}, NOW);
  assert.equal(card.review.verdict, "Approve with suggestions");
  assert.equal(card.review.tone, "warn");
  assert.equal(card.review.outOfDate, false);
});

test("a review section on a PR from a fork is ignored, verdict and links alike", () => {
  const [card] = toCards("acme/app", [], [{ ...pr(1, ["pr-reviewed"]), body: REVIEW, head: ref("x", "mallory/app") }], {}, NOW);
  assert.equal(card.review, null);
  const [gone] = toCards("acme/app", [], [{ ...pr(2, ["pr-reviewed"]), body: REVIEW, head: { ref: "x", sha: HEAD_SHA, repo: null } }], {}, NOW);
  assert.equal(gone.review, null, "a deleted fork has no head repo");
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

test("openQuestions: prose that isn't 'None' counts as one question", () => {
  assert.equal(openQuestions(spec("Whether the cache should outlive a reload is still open.")), 1);
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
const morning = (url, hours, author_association = "OWNER") => ({ body: `<!-- ship:morning-page -->\nReviewed on this morning's page: ${url}`, created_at: hoursAgo(hours), user: { login: "someone" }, author_association });
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

test("designLink: a link off claude.ai gives none", () => {
  assert.equal(designLink(design("https://evil.example/artifact/abc123")), null);
});

test("morningPage: a marker comment linking off claude.ai is skipped", () => {
  assert.equal(morningPage([morning("https://claude.ai/artifact/ok", 30), morning("https://evil.example/artifact/x", 2)]).url, "https://claude.ai/artifact/ok");
});

test("morningPage: a newer marker from someone without write access is ignored", () => {
  for (const who of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", null]) {
    const comments = [morning("https://claude.ai/artifact/real", 30, "OWNER"), morning("https://claude.ai/artifact/fake", 1, who)];
    assert.equal(morningPage(comments).url, "https://claude.ai/artifact/real", String(who));
  }
  assert.equal(morningPage([morning("https://claude.ai/artifact/m", 1, "MEMBER")]).url, "https://claude.ai/artifact/m");
  assert.equal(morningPage([morning("https://claude.ai/artifact/c", 1, "COLLABORATOR")]).url, "https://claude.ai/artifact/c");
});

test("morningSpecs: specs updated in the last 7 days, newest first, at most 3; other issues and older specs left out", () => {
  const issues = [
    issue(1, ["spec:in-review"], { updated: hoursAgo(20) }),
    issue(2, ["spec:in-review"], { state: "CLOSED", updated: hoursAgo(2) }),
    issue(3, ["bug"], { updated: hoursAgo(1) }),
    issue(4, ["spec:ready"], { updated: hoursAgo(24 * 8) }),
    issue(5, ["design:ready"], { updated: hoursAgo(1) }),
  ];
  assert.deepEqual(morningSpecs(issues, NOW).map((i) => i.number), [2, 1]);
  const many = Array.from({ length: 14 }, (_, n) => issue(n + 1, ["spec:building"], { updated: hoursAgo(n + 1) }));
  assert.deepEqual(morningSpecs(many, NOW).map((i) => i.number), [1, 2, 3]);
});

const linked = (number, body, head, extra = {}, headRepo = "acme/app") => ({ ...pr(number, [], extra), body, head: ref(head, headRepo), base: ref("main") });

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

const specPrOf = (prs) => toCards("acme/app", [{ ...issue(7, ["spec:building"]), body: spec("None") }], prs, {}, NOW).find((c) => c.kind === "spec").pr?.number ?? null;

test("a spec's PR: 'Closes #70' doesn't close spec 7, nor does a spec/70- branch", () => {
  assert.equal(specPrOf([linked(40, "Closes #70", "feature/y", { draft: true }), linked(41, "x", "spec/70-other", { draft: true })]), null);
});

test("a spec's PR: of two merged PRs, the newer one", () => {
  const merged = (n, hours) => linked(n, "Closes #7", `b${n}`, { state: "closed", merged: true, merged_at: hoursAgo(hours) });
  assert.equal(specPrOf([merged(50, 60), merged(51, 10), merged(52, 30)]), 51);
});

test("a spec's PR: a PR from a fork never counts, even one that closes it or uses its branch name", () => {
  assert.equal(specPrOf([linked(60, "Closes #7", "spec/7-thing", { draft: true }, "mallory/app")]), null);
});

test("a spec's PR: when several open PRs match, the spec/<n>- branch wins over a closing keyword", () => {
  assert.equal(specPrOf([linked(70, "Closes #7", "feature/z", { draft: true }), linked(71, "x", "spec/7-thing", { draft: true })]), 71);
  assert.equal(specPrOf([linked(71, "x", "spec/7-thing", { draft: true }), linked(70, "Closes #7", "feature/z", { draft: true })]), 71);
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
    { ...pr(1, ["pr-reviewed"]), body: REVIEW },
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

// ---- Who may be approved: prAction, on a card's PR and again on the fresh read before a write.

const reviewed = (labels, opts) => ({ ...pr(1, labels, opts), body: REVIEW });
const actionOf = (p) => toCards("acme/app", [], [p], {}, NOW)[0]?.action ?? null;

test("prAction: an open, ready, reviewed PR with a current review gets Approve; one carrying ship gets Un-approve", () => {
  assert.equal(actionOf(reviewed(["pr-reviewed"])), "approve");
  assert.equal(actionOf(reviewed(["pr-reviewed", "ship"])), "unapprove");
  assert.equal(actionOf(pr(2, ["ship"])), "unapprove", "taking ship off never needs a review");
});

test("prAction: a reviewed PR whose review is missing or out of date gets Approve withheld until it's reviewed again", () => {
  assert.equal(actionOf(pr(1, ["pr-reviewed"])), "review-first", "no review section");
  assert.equal(actionOf({ ...reviewed(["pr-reviewed"]), head: ref("x", "mallory/app") }), "review-first", "a fork's review isn't believed");
  assert.equal(actionOf({ ...reviewed(["pr-reviewed"]), head: ref("x", "acme/app", "9999999aaaa") }), "review-first", "a review of an older head");
});

test("prAction: an open, non-draft PR without pr-reviewed gets no action, failing checks or not", () => {
  const p = pr(1, []);
  const [card] = toCards("acme/app", [], [p], { 1: { check_runs: [{ conclusion: "failure" }] } }, NOW);
  assert.equal(card.reason, "checks failing");
  assert.equal(card.action, null);
});

test("prAction takes the PR and its review, as the page calls it on a fresh read", () => {
  const review = { outOfDate: false };
  assert.equal(prAction({ state: "open", draft: false, labels: [{ name: "pr-reviewed" }] }, review), "approve");
  assert.equal(prAction({ state: "open", draft: false, labels: [{ name: "pr-reviewed" }] }, { outOfDate: true }), "review-first");
  assert.equal(prAction({ state: "closed", labels: ["ship"] }, review), null);
  assert.equal(prAction({ state: "open", draft: true, labels: ["pr-reviewed"] }, review), null);
});

// ---- labelWrite: the label list to write, from the fresh pull_request_read get, or why nothing is written.

const card = (action, labels = ["pr-reviewed"]) => ({ project: "acme/app", number: 1, action, labels });
const fresh = (labels, extra = {}) => ({ ...reviewed(labels), ...extra });

test("labelWrite: Approve writes the fresh labels plus ship, keeping a label added since the page loaded", () => {
  assert.deepEqual(labelWrite(card("approve"), fresh([{ name: "pr-reviewed" }, { name: "needs-docs" }])),
    { labels: ["pr-reviewed", "needs-docs", "ship"] });
});

test("labelWrite: Un-approve writes the fresh labels without ship", () => {
  assert.deepEqual(labelWrite(card("unapprove", ["pr-reviewed", "ship"]), fresh([{ name: "pr-reviewed" }, { name: "ship" }, { name: "x" }])),
    { labels: ["pr-reviewed", "x"] });
});

test("labelWrite: no fresh read, or one without a labels list, writes nothing and asks to try again", () => {
  for (const f of [undefined, null, {}, { ...reviewed([]), labels: undefined }, { ...reviewed([]), labels: "ship" }]) {
    assert.deepEqual(labelWrite(card("approve"), f), { error: "Couldn't read #1's labels: try again" });
    assert.deepEqual(labelWrite(card("unapprove", ["ship"]), f), { error: "Couldn't read #1's labels: try again" });
  }
});

test("labelWrite: a PR that changed since the page loaded is refused, and the project read again", () => {
  const changed = { error: "#1 changed since the page loaded: refreshing", refetch: true };
  const cases = {
    "gained changes-requested": fresh(["pr-reviewed", "changes-requested"]),
    "gained conflicts": fresh(["pr-reviewed", "conflicts"]),
    "went draft": fresh(["pr-reviewed"], { draft: true }),
    "lost pr-reviewed": fresh([]),
    "closed": fresh(["pr-reviewed"], { state: "closed" }),
    "pushed since its review": fresh(["pr-reviewed"], { head: ref("x", "acme/app", "9999999aaaa") }),
  };
  for (const [what, f] of Object.entries(cases)) assert.deepEqual(labelWrite(card("approve"), f), changed, what);
  assert.deepEqual(labelWrite(card("unapprove", ["ship"]), fresh(["pr-reviewed"], { state: "closed" })), changed, "closed");
});

test("labelWrite: a PR already in the end state writes nothing and says so, not as an error", () => {
  assert.deepEqual(labelWrite(card("approve"), fresh(["pr-reviewed", "ship"])), { already: true });
  assert.deepEqual(labelWrite(card("approve"), fresh(["ship"], { draft: true })), { already: true }, "ship on, whatever else changed");
  assert.deepEqual(labelWrite(card("unapprove", ["ship"]), fresh(["pr-reviewed"])), { already: true });
  assert.deepEqual(labelWrite(card("unapprove", ["ship"]), fresh(["pr-reviewed", "changes-requested"])), { already: true }, "ship off, whatever else changed");
});

// ---- writeError: a write that surely failed says what to do; any other says it may have gone through.

test("writeError: each definite failure says so; every other code says the write may have gone through", () => {
  const MAYBE = /may have gone through/;
  for (const code of ["server_not_connected", "selection_required", "server_not_found", "bad_request", "not_granted",
    "capability_disabled", "rate_limited", "not_in_manifest", "blocked_by_policy"]) {
    assert.ok(WRITE_DEFINITE.has(code), code);
    const text = writeError({ code, message: "m" }, { verb: "approve" });
    assert.doesNotMatch(text, MAYBE, code);
    assert.ok(text.length > 10, code);
  }
  for (const e of [{ code: "server_unavailable" }, { code: "upstream_error" }, { code: "cancelled" }, { code: "timeout" }, { code: "something_new" }, {}, undefined]) {
    assert.match(writeError(e, { verb: "approve" }), MAYBE, JSON.stringify(e));
  }
});

test("writeError names the connector that refused, and where to look, for a session start", () => {
  const remote = (code) => writeError({ code }, { verb: "start a session", who: "Claude Code Remote", check: "Check your sessions at claude.ai/code" });
  assert.match(remote("needs_reauth"), /^Reconnect Claude Code Remote/);
  assert.match(remote("timeout"), /^No clear answer from Claude Code Remote \(timeout\): it may have gone through\. Check your sessions at claude\.ai\/code before/);
  assert.match(writeError({ code: "needs_reauth" }, { verb: "approve" }), /^Reconnect GitHub/);
  assert.match(writeError({ code: "timeout" }, { verb: "approve" }), /^No clear answer from GitHub \(timeout\).*Check the page after it refreshes before/);
});

// ---- ship.yml's push block.

test("ship.yml: the default branch is read only inside the push block; a list elsewhere doesn't count", () => {
  const other = "# ship.yml version: 2\non:\n  push:\n    paths: [src]\n  pull_request:\n    branches: [develop]\n";
  assert.equal(shipYml(other).defaultBranch, null, "pull_request's branches aren't push's");
  const multi = "# ship.yml version: 2\non:\n  push:\n    branches:\n      - main\n";
  assert.equal(shipYml(multi).defaultBranch, null, "no inline list: no branch, Land stays off");
  const after = "# ship.yml version: 2\non:\n  push:\n\n    # trunk only\n    branches: [trunk]\njobs:\n  x:\n    branches: [nope]\n";
  assert.equal(shipYml(after).defaultBranch, "trunk", "blank and comment lines stay inside the block");
});

// ---- Run a skill: the command a card's button starts a cloud session with.

const skillOf = (issues, prs) => Object.fromEntries(toCards("acme/app", issues, prs, {}, NOW).map((c) => [`${c.kind}${c.number}`, skillFor(c)]));

test("each card that needs a ship skill maps to its button and command; every other card to none", () => {
  const issues = [
    issue(1, ["spec:draft"]),
    issue(2, ["design:ready"]),
    issue(3, ["spec:stuck"]),
    issue(4, ["spec:ready"]),
    issue(5, ["spec:draft"], { state: "CLOSED" }),
  ];
  const prs = [
    pr(10, ["conflicts"]),
    pr(11, ["pr-reviewed"]),
    pr(12, ["pr-reviewed", "ship"]),
    pr(13, ["pr-reviewed", "changes-requested"]),
    pr(14, ["pr-reviewed"], { draft: true }),
    pr(15, ["ship"], { updated: hoursAgo(30) }),
    pr(16, ["conflicts"], { state: "closed", merged: true, merged_at: hoursAgo(5) }),
  ];
  assert.deepEqual(skillOf(issues, prs), {
    spec1: { label: "Resume spec", command: "/ship:spec-me #1" },
    design2: { label: "Spec design", command: "/ship:design-me #2" },
    spec3: null,
    spec4: null,
    spec5: null,
    pr10: { label: "Resolve", command: "/ship:resolve-conflicts #10" },
    pr11: null, // reviewed: Approve is its action, and no command sends one PR back
    pr12: null,
    pr13: null,
    pr14: null,
    pr15: null,
    pr16: null,
  });
});

test("a conflicting PR that was also reviewed is offered Resolve", () => {
  assert.deepEqual(skillOf([], [pr(20, ["pr-reviewed", "conflicts"])]).pr20, { label: "Resolve", command: "/ship:resolve-conflicts #20" });
});

const env = (id, name, kind = "anthropic_cloud") => ({ environment_id: id, name, kind, state: "active" });

test("preselection: the environment named like the repo, ignoring case, wherever it is listed", () => {
  const envs = [env("env_1", "Default"), env("env_2", "website"), env("env_3", "App")];
  assert.equal(preselectEnvironment(envs, "acme/app").environment_id, "env_3");
});

test("preselection without a match: the first listed, though a cloud environment before a machine bridged to it", () => {
  assert.equal(preselectEnvironment([env("env_1", "Default"), env("env_2", "website")], "acme/app").environment_id, "env_1");
  assert.equal(preselectEnvironment([env("env_b", "laptop", "bridge"), env("env_c", "Default")], "acme/app").environment_id, "env_c");
  assert.equal(preselectEnvironment([env("env_b", "laptop", "bridge")], "acme/app").environment_id, "env_b");
});

test("preselection: a repo-named machine still wins, and no environments gives none", () => {
  assert.equal(preselectEnvironment([env("env_c", "Default"), env("env_b", "APP", "bridge")], "acme/app").environment_id, "env_b");
  assert.equal(preselectEnvironment([], "acme/app"), null);
  assert.equal(preselectEnvironment(undefined, "acme/app"), null);
});

test("the new session's link is built from the id create_session returns, wherever the result carries it", () => {
  const link = { id: "session_01AbC", url: "https://claude.ai/code/session_01AbC" };
  assert.deepEqual(sessionLink({ payload: { session_id: "session_01AbC", status: "running" } }), link);
  assert.deepEqual(sessionLink({ payload: { id: "session_01AbC" } }), link);
  assert.deepEqual(sessionLink({ payload: { session: { id: "session_01AbC" } } }), link);
  assert.deepEqual(sessionLink({ content: [{ type: "text", text: '{"session_id":"session_01AbC"}' }] }), link);
});

test("no recognisable session id, or one that isn't a plain id, gives no link", () => {
  assert.equal(sessionLink({ payload: { status: "running" } }), null);
  // Free text is never searched: only a structured id makes a link.
  assert.equal(sessionLink({ payload: "Created session session_01AbC (status: running)" }), null);
  assert.equal(sessionLink({ content: [{ type: "text", text: "see session_01AbC" }] }), null);
  assert.equal(sessionLink({ payload: { id: "../../evil?x=1" } }), null);
  assert.equal(sessionLink(undefined), null);
});

test("singleFlight: one holder at a time; a second enter is refused until the holder leaves", () => {
  const gate = singleFlight();
  assert.equal(gate.holder(), null);
  assert.equal(gate.tryEnter("skill:a/b#1"), true);
  assert.equal(gate.holder(), "skill:a/b#1");
  assert.equal(gate.tryEnter("skill:c/d#2"), false);
  assert.equal(gate.tryEnter("skill:a/b#1"), false, "the holder can't enter twice either");
  assert.equal(gate.holder(), "skill:a/b#1");
  gate.leave("skill:a/b#1");
  assert.equal(gate.holder(), null);
  assert.equal(gate.tryEnter("skill:c/d#2"), true);
});

test("singleFlight: leave by a non-holder does nothing", () => {
  const gate = singleFlight();
  gate.tryEnter("skill:a/b#1");
  gate.leave("skill:c/d#2");
  assert.equal(gate.holder(), "skill:a/b#1");
  assert.equal(gate.tryEnter("skill:c/d#2"), false);
});

test("singleFlight: a holder whose work throws or picks nothing releases the gate when left in a finally", async () => {
  const gate = singleFlight();
  const run = async (key, work) => { if (!gate.tryEnter(key)) return "refused"; try { return await work(); } finally { gate.leave(key); } };
  await assert.rejects(run("skill:a/b#1", async () => { throw new Error("no environments"); }));
  assert.equal(gate.holder(), null);
  assert.equal(await run("skill:a/b#1", async () => null), null);
  assert.equal(gate.holder(), null);
  assert.equal(await run("skill:c/d#2", async () => "started"), "started");
});
