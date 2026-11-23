// Ship dashboard: sorts one project's specs, designs and PRs into buckets by what they need.
// Pure: no dependencies, no DOM. build.mjs inlines it into the page (dropping `export`).
// The labels are the ones docs/agents/shipping.md defines: change them there, change them here.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
// How far back Landed looks. The page reads closed issues from a little before this.
export const LANDED_WINDOW = 7 * DAY;
const WEEK = LANDED_WINDOW;

export const BUCKETS = [
  { id: "needs-you", tone: "needs", title: "Needs you", empty: "Nothing needs you" },
  { id: "ready", tone: "ready", title: "Ready for tonight", empty: "Nothing ready for tonight" },
  { id: "in-flight", tone: "flight", title: "In flight", empty: "Nothing in flight" },
  { id: "landed", tone: "landed", title: "Landed", empty: "Nothing landed this week" },
];

export function ago(ms) {
  const h = Math.max(0, ms) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.floor(h)} h`;
  return `${Math.floor(h / 24)} d`;
}

// An open PR, and one whose branch lives in the project itself (not a fork: GitHub names ignore case).
export const isOpenPr = (pr) => String(pr?.state).toLowerCase() === "open";
const isOwnPr = (project, pr) => String(pr?.head?.repo?.full_name ?? "").toLowerCase() === project.toLowerCase();

const names = (labels) => (labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
const isSpec = (labels) => names(labels).some((n) => n.startsWith("spec:"));

// Rules run in bucket order, and the first that matches places the item, so an item
// matching several appears once, in the earliest bucket.
const ISSUE_RULES = [
  { when: (i) => i.open && i.l.has("spec:draft"), kind: "spec", bucket: "needs-you", reason: "draft" },
  { when: (i) => i.open && i.l.has("spec:stuck"), kind: "spec", bucket: "needs-you", reason: "stuck" },
  { when: (i) => i.open && i.l.has("design:ready"), kind: "design", bucket: "needs-you", reason: "design ready to turn into specs" },
  { when: (i) => i.open && i.l.has("spec:ready"), kind: "spec", bucket: "ready", reason: "ready to build" },
  { when: (i) => i.open && i.l.has("spec:building"), kind: "spec", bucket: "in-flight", reason: "building" },
  // list_issues gives no close reason or close time: a spec closed in the last week is one whose
  // last update is in the last week (closing updates it).
  { when: (i, now) => !i.open && i.spec && now - Date.parse(i.updatedAt) < WEEK, kind: "spec", bucket: "landed", reason: "closed" },
];

function issueCard(project, issue, now, prs) {
  const i = { l: new Set(names(issue.labels)), spec: isSpec(issue.labels), open: String(issue.state).toUpperCase() === "OPEN", updatedAt: issue.updated_at };
  const rule = ISSUE_RULES.find((r) => r.when(i, now));
  if (!rule) return null;
  return {
    project, number: issue.number, title: issue.title, url: `https://github.com/${project}/issues/${issue.number}`,
    kind: rule.kind, bucket: rule.bucket, reason: rule.reason, since: issue.updated_at, age: ago(now - Date.parse(issue.updated_at)),
    ...(rule.kind === "spec" ? { openQuestions: openQuestions(issue.body), pr: specPr(project, issue.number, prs) } : {}),
    ...(rule.kind === "design" ? { designUrl: designLink(issue.body) } : {}),
  };
}

// A spec's PR: one from the project itself (a fork's PR can claim any spec) whose description
// closes it ("Closes #n", as GitHub reads closing keywords) or whose branch is the night shift's
// spec/<n>-…. An open PR first, else the latest merged one; a PR closed unmerged never. Among
// several, the spec/<n>- branch first. → { number, url } or null.
function specPr(project, n, prs) {
  const closes = new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}(?!\\d)`, "i");
  const branch = new RegExp(`^spec/${n}-`);
  const own = (prs ?? []).filter((p) => isOwnPr(project, p));
  const byBranch = own.filter((p) => branch.test(p.head?.ref ?? ""));
  const byBody = own.filter((p) => closes.test(String(p.body ?? "")));
  const newestMerged = (list) => list.filter((p) => p.merged_at).sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))[0];
  const hit = byBranch.find(isOpenPr) ?? byBody.find(isOpenPr) ?? newestMerged(byBranch) ?? newestMerged(byBody);
  return hit ? { number: hit.number, url: `https://github.com/${project}/pull/${hit.number}` } : null;
}

// The specs whose comments are read for the latest morning page: spec issues, open or closed,
// updated in the last 7 days (a morning comment updates its spec), newest first, at most 3. The
// night shift comments on every spec it collected each morning, so the newest few carry the
// newest page; reading more only costs connector calls.
const MORNING_SPECS = 3;
export function morningSpecs(issues, now) {
  return (issues ?? [])
    .filter((i) => isSpec(i.labels) && now - Date.parse(i.updated_at) < WEEK)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, MORNING_SPECS);
}

// A stacked PR: its base branch is the head branch of another open PR in this repo (a fork's
// branch of the same name doesn't count). → that PR's number, or null.
function landsAfter(project, pr, openPrs) {
  const base = pr.base?.ref;
  if (!base) return null;
  const parent = openPrs.find((o) => o.number !== pr.number && o.head?.ref === base && isOwnPr(project, o));
  return parent ? parent.number : null;
}

const FAILED_RUN = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
const FAILED_STATUS = new Set(["failure", "error"]);

// `check` is { check_runs, statuses } as pull_request_read's get_check_runs and get_status return them.
// The `ship` status stays pending until the label is on: it is the approval gate, not a check.
export function checksFailing(check) {
  const runs = check?.check_runs ?? [];
  const statuses = check?.statuses ?? [];
  return runs.some((r) => FAILED_RUN.has(r?.conclusion)) ||
    statuses.some((s) => s?.context !== "ship" && FAILED_STATUS.has(s?.state));
}

// Each rule: when it matches, its bucket, its reason, and the time its age counts from.
// list_pull_requests gives no time for when `ship` went on, so a ship PR is measured by its last update.
const updated = (p) => p.updatedAt;
const PR_RULES = [
  { when: (p) => p.open && p.l.has("conflicts"), bucket: "needs-you", reason: () => "conflicts", at: updated },
  { when: (p) => p.open && p.failing, bucket: "needs-you", reason: () => "checks failing", at: updated },
  { when: (p, now) => p.open && p.l.has("ship") && now - Date.parse(p.updatedAt) > DAY, bucket: "needs-you", reason: (age) => `ship label on, no update for ${age}`, at: updated },
  { when: (p) => p.open && p.l.has("changes-requested"), bucket: "in-flight", reason: () => "changes requested, back to the night shift", at: updated },
  { when: (p) => p.open && p.l.has("pr-reviewed") && !p.l.has("ship"), bucket: "needs-you", reason: () => "reviewed, waiting for your verdict", at: updated },
  { when: (p) => p.open && p.draft, bucket: "in-flight", reason: () => "draft", at: updated },
  { when: (p) => p.open && p.l.has("ship"), bucket: "in-flight", reason: () => "ship label on, landing", at: updated },
  { when: (p, now) => p.mergedAt && now - Date.parse(p.mergedAt) < WEEK, bucket: "landed", reason: () => "merged", at: (p) => p.mergedAt },
];

function prCard(project, pr, check, now, openPrs) {
  const p = {
    l: new Set(names(pr.labels)),
    open: isOpenPr(pr),
    draft: Boolean(pr.draft),
    mergedAt: pr.merged_at ?? null,
    updatedAt: pr.updated_at,
    failing: checksFailing(check),
  };
  const rule = PR_RULES.find((r) => r.when(p, now));
  if (!rule) return null;
  const since = rule.at(p);
  const age = ago(now - Date.parse(since));
  const review = trustedReview(project, pr);
  return {
    project, number: pr.number, title: pr.title, url: `https://github.com/${project}/pull/${pr.number}`,
    kind: "pr", bucket: rule.bucket, reason: rule.reason(age), since, age,
    review, landsAfter: p.open ? landsAfter(project, pr, openPrs) : null,
    labels: [...p.l], action: prAction(pr, review),
  };
}

// The review section, as far as it can be believed. Anyone who can edit a PR's description can
// write one, so a fork's PR gets none, and a review of an older commit than the PR's head is
// out of date: its links stay, its verdict, tone, line and risk count go.
function trustedReview(project, pr) {
  const review = isOwnPr(project, pr) ? parseReview(pr.body) : null;
  if (!review) return null;
  const sha = String(pr.head?.sha ?? "").toLowerCase();
  const outOfDate = !review.head || !sha.startsWith(review.head);
  return outOfDate ? { ...review, verdict: null, tone: null, line: null, risks: null, outOfDate } : { ...review, outOfDate };
}

// The label step a PR offers, the two /ship:land takes (skills/land/SKILL.md): Approve on an open,
// ready PR with `pr-reviewed` and without `ship`, and not one already sent back (changes-requested) or
// taken out of the queue (conflicts); Un-approve on an open PR carrying `ship`. Approve also needs a
// review the page believes (review: trustedReview's answer): without one, or with one of an older
// head, it is withheld ("review-first") until the PR is reviewed again. pr: as list_pull_requests or
// pull_request_read get give it. → "approve", "review-first", "unapprove" or null.
export function prAction(pr, review) {
  if (!isOpenPr(pr)) return null;
  const l = new Set(names(pr.labels));
  if (l.has(SHIP_LABEL)) return "unapprove";
  if (pr.draft || !l.has("pr-reviewed") || l.has("changes-requested") || l.has("conflicts")) return null;
  return review && !review.outOfDate ? "approve" : "review-first";
}

// toCards(project, issues, prs, checks, now) → cards, issues first, then PRs.
//   project: "owner/name"
//   issues:  list_issues items { number, title, state, labels, updated_at }
//   prs:     list_pull_requests items { number, title, body, state, draft, merged_at, labels, updated_at,
//            head: { ref, sha, repo: { full_name } }, base: { ref } }
//   checks:  { [prNumber]: { check_runs, statuses } }, missing for PRs whose checks weren't read
//            (or couldn't be: an unread PR counts as not failing, and the page says so on its row)
//   now:     epoch ms
// Each card: { project, number, title, url, kind: "spec"|"design"|"pr", bucket, reason, since, age }, plus
//   spec cards:   openQuestions (a count, or null without the section), pr ({ number, url } or null)
//   design cards: designUrl (claude.ai, or null)
//   PR cards:     review (trustedReview: parseReview plus outOfDate, or null), landsAfter (the PR it is stacked on, or null),
//                 labels (names), action (prAction: "approve", "review-first", "unapprove" or null)
// Items that need nothing from the dashboard (spec:in-review specs, unreviewed ready PRs,
// PRs closed unmerged, anything older than a week in Landed) get no card.
export function toCards(project, issues, prs, checks, now) {
  const openPrs = (prs ?? []).filter(isOpenPr);
  return [
    ...(issues ?? []).map((i) => issueCard(project, i, now, prs)),
    ...(prs ?? []).map((p) => prCard(project, p, checks?.[p.number], now, openPrs)),
  ].filter(Boolean);
}

// Cards per bucket, for a project's summary row and the phone tabs.
export function counts(cards) {
  const out = Object.fromEntries(BUCKETS.map((b) => [b.id, 0]));
  for (const c of cards) out[c.bucket] += 1;
  return out;
}

// A repo as typed or pasted (owner/name, or its github.com URL, with or without .git) → "owner/name",
// or null when it isn't one.
const REPO = /^[\w.-]+\/[\w.-]+$/;
export function normaliseRepo(input) {
  const full = String(input ?? "").trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  return REPO.test(full) ? full : null;
}

// The dashboard's projects: each list in turn, each repo once (GitHub names ignore case).
export function mergeProjects(...lists) {
  const seen = new Map();
  for (const full of lists.flat()) if (full && !seen.has(full.toLowerCase())) seen.set(full.toLowerCase(), full);
  return [...seen.values()];
}

// A bucket's cards in reading order: what has waited longest first; Landed shows the newest first.
export function sortBucket(cards, bucket) {
  const dir = bucket === "landed" ? -1 : 1;
  return [...cards].sort((a, b) => dir * (Date.parse(a.since) - Date.parse(b.since)));
}

// get_file_contents rejects with tool_error both for a missing file and for a GitHub hiccup.
// True only for the missing-file answer, so a repo is "not set up" only when GitHub says so.
const MISSING_FILE = /\b404\b|not found|does not exist|does not point to a file/i;
export function isMissingFile(error) {
  return error?.code === "tool_error" && MISSING_FILE.test(String(error?.message ?? ""));
}

// A check run not yet completed, or a commit status other than `ship` still pending.
const stillRunning = (c) => !!c && (
  (c.check_runs ?? []).some((r) => r?.status && r.status !== "completed") ||
  (c.statuses ?? []).some((s) => s?.context !== "ship" && s?.state === "pending"));

// Whether a ready PR's checks are read now. prevRead is { updatedAt, pending } from the last read
// (undefined if none), check what it returned ({ check_runs, statuses } or { unknown: true }).
// A read in flight is never doubled. Otherwise the PR is read when never read, on Refresh, when it
// changed since (updated_at moved), when the last read failed, or when a check was still running
// (a check finishing doesn't move updated_at).
export function needsCheckRead(prevRead, check, pr, refresh) {
  if (prevRead?.pending) return false;
  return !prevRead || refresh || prevRead.updatedAt !== pr.updated_at || !check || Boolean(check.unknown) || stillRunning(check);
}

// Whether a recent spec's comments are read now, for its morning-page link. prevRead is
// { updatedAt, pending, failed } from the last read (undefined if none). A read in flight is never
// doubled. Otherwise the spec is read when never read, when it changed since (a new comment moves
// updated_at) or when the last read failed.
export function needsCommentRead(prevRead, issue) {
  if (prevRead?.pending) return false;
  return !prevRead || prevRead.failed || prevRead.updatedAt !== issue.updated_at;
}

// ---- Card details, parsed from text other skills write. Each parser follows a format another
// skill owns (named above it): when that format changes, change the parser.
// Bodies and comments are anyone's text: a link is kept only when it is https, and the links that
// are always claude.ai artifacts (full report, design, morning page) only when they are on claude.ai.
const CLAUDE = ["claude.ai"];

// hosts, when given, is the list of hostnames the link may point at (exactly, no subdomains).
export function safeUrl(text, hosts) {
  try {
    const url = new URL(String(text ?? "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return !hosts || hosts.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

const linkTo = (text, label, hosts) => safeUrl(text.match(new RegExp(`\\[${label}\\]\\(([^)\\s]+)\\)`))?.[1], hosts);

// The lines under a "## <name>" (or "### <name>") heading, up to the next heading or HTML comment.
function section(text, heading) {
  const lines = String(text ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s|^<!--|^<details|^<sub>/.test(l.trim()));
  return end < 0 ? rest : rest.slice(0, end);
}

// Top-level list items ("- ", "* ", "1. "), sub-items left out.
const topItems = (lines) => lines.filter((l) => /^ ?([-*+]|\d+[.)])\s+\S/.test(l)).map((l) => l.replace(/^ ?([-*+]|\d+[.)])\s+/, ""));

// pr-review's section in a PR description (skills/pr-review/scripts/render-report.py, render_pr):
// between its markers, "**<Verdict>.** <headline>", "[Preview](…) · [Full report](…)",
// "### Risks" bullets, where the single "None found: …" bullet means no risks, and a closing
// "<sub>pr-review · head `<sha>` · <date> · …</sub>" naming the commit it reviewed.
// → { verdict, tone, line, risks (null without a Risks heading), head, reportUrl, previewUrl },
// or null without the section. Anyone who can edit the description can write this section:
// prCard decides whether to believe it.
const REVIEW_START = "<!-- pr-review:start -->";
const REVIEW_END = "<!-- pr-review:end -->";
// render-report.py's view(): each verdict and the tone its report colours it with.
const VERDICT_TONE = { "Approve": "good", "Approve with suggestions": "warn", "Changes requested": "bad" };
export function parseReview(body) {
  const text = String(body ?? "");
  const from = text.indexOf(REVIEW_START);
  const to = text.indexOf(REVIEW_END, from);
  if (from < 0 || to < 0) return null;
  const review = text.slice(from + REVIEW_START.length, to);
  const bold = review.match(/^\*\*(.+?)\.?\*\*\s*(.*)$/m);
  const items = section(review, /^###\s+Risks\b/i);
  const risks = items ? topItems(items).filter((r) => !/^None found\b/i.test(r)).length : null;
  const verdict = bold ? bold[1] : null;
  return {
    verdict,
    tone: VERDICT_TONE[verdict] ?? null,
    line: bold ? `${bold[1]}.${bold[2] ? ` ${bold[2]}` : ""}` : null,
    risks,
    head: review.match(/<sub>pr-review · head `([0-9a-f]{7,40})`/i)?.[1].toLowerCase() ?? null,
    reportUrl: linkTo(review, "Full report", CLAUDE),
    previewUrl: linkTo(review, "Preview"),
  };
}

// The spec template's "## Open questions" section (skills/spec-me/templates/spec.md): one top-level
// item per open question, or "None". → the count (sub-points not counted; prose that isn't
// "None" counts as one question), or null when the body has no such section.
export function openQuestions(body) {
  const lines = section(body, /^##\s+Open questions\b/i);
  if (!lines) return null;
  const text = lines.join("\n").trim();
  if (!text || /^([-*+]\s+)?none\b/i.test(text)) return 0;
  return topItems(lines).length || 1;
}

// A design issue's artifact (skills/design-me/templates/design-issue.md): the first link on its
// "- **Artifact:** <link>" line, bare, in <angle brackets> or as [text](link). → claude.ai URL or null.
export function designLink(body) {
  const line = String(body ?? "").split(/\r?\n/).find((l) => /^\s*[-*]\s+\*\*Artifact:\*\*/i.test(l));
  const value = line?.replace(/^.*?\*\*Artifact:\*\*\s*/i, "") ?? "";
  const link = value.match(/^\[[^\]]*\]\(([^)\s]+)\)/) ?? value.match(/^<([^>\s]+)>/) ?? value.match(/^(\S+)/);
  return link ? safeUrl(link[1], CLAUDE) : null;
}

// night-shift's morning comment on each spec it collected (skills/night-shift/SKILL.md, morning step 5):
// "<!-- ship:morning-page -->" then "Reviewed on this morning's page: <url>". A new one is posted
// every morning, so the newest is current. comments: issue_read get_comments items
// { body, created_at, author_association }, any order, from any number of specs. Anyone can comment
// on a public repo, so only a comment from someone with write access counts (the night shift posts
// as the user). → { url, at } of the newest with a claude.ai link, or null.
const MORNING_MARK = "<!-- ship:morning-page -->";
const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export function morningPage(comments) {
  let best = null;
  for (const c of comments ?? []) {
    const body = String(c?.body ?? "");
    if (!body.includes(MORNING_MARK) || !TRUSTED_AUTHORS.has(c?.author_association)) continue;
    const url = safeUrl(body.slice(body.indexOf(MORNING_MARK)).match(/page:\s*<?(\S+?)>?(\s|$)/)?.[1], CLAUDE);
    if (url && (!best || Date.parse(c.created_at) > Date.parse(best.at))) best = { url, at: c.created_at };
  }
  return best;
}

// ---- Actions: Approve, Un-approve and Land, as /ship:land does them (skills/land/SKILL.md, step 1).

// setup-ship's .github/workflows/ship.yml (skills/setup-ship/templates/ship.yml): its first line is
// "# ship.yml version: N", and its push trigger names the default branch ("branches: [main]"),
// the value setup-ship's upgrade reads back too. text: the file, or null when it is missing.
// → { version (a number, or null when missing or the first line isn't a version line), defaultBranch (or null) }
export function shipYml(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const version = lines[0]?.match(/^#\s*ship\.yml version:\s*(\d+)\s*$/);
  return { version: version ? Number(version[1]) : null, defaultBranch: pushBranch(lines) };
}

// The inline "branches: [x]" inside the "push:" trigger's block, which ends at the next line indented
// no deeper than "push:" (blank and comment lines don't end it). Without an inline list there, no
// branch: Land stays off rather than taking another trigger's branches. → the first branch, or null.
const indent = (l) => l.match(/^\s*/)[0].length;
function pushBranch(lines) {
  const at = lines.findIndex((l) => /^\s+push:\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || l.trim().startsWith("#")) continue;
    if (indent(l) <= indent(lines[at])) return null;
    if (/^\s+branches:/.test(l)) return l.match(/branches:\s*\[\s*["']?([^"',\]\s]+)["']?/)?.[1] ?? null;
  }
  return null;
}

// Version 2 is the first where `ship` only approves and a landing run lands: older ones land a PR as
// soon as it's labelled. So every action needs 2 or later, as /ship:land does.
export const MIN_SHIP_VERSION = 2;
export const actionsEnabled = (version) => Number.isInteger(version) && version >= MIN_SHIP_VERSION;

// issue_write's `labels` replaces a PR's whole label list, so a label change sends every label it
// keeps. labels: as the connector lists them (names or { name }). → the full list to write.
export const SHIP_LABEL = "ship";
export const approveLabels = (labels) => [...names(labels).filter((n) => n !== SHIP_LABEL), SHIP_LABEL];
export const unapproveLabels = (labels) => names(labels).filter((n) => n !== SHIP_LABEL);

// Approve or Un-approve's write, from pull_request_read get's answer just before it (fresh: its
// payload, or undefined when the read failed). The labels come from that read only, so none added
// since the page loaded is dropped, and the PR must still offer the card's action, so a PR that went
// draft, lost pr-reviewed, gained changes-requested or conflicts, or was pushed since its review, is
// never approved. An open PR already in the action's end state (ship on for approve, off for
// un-approve) needs no write. card: { project, number, action }.
// → { labels } to write, { already: true } when there is nothing to change, or { error, refetch? } when
// nothing is written (refetch: read the project again).
export function labelWrite(card, fresh) {
  if (!fresh || !Array.isArray(fresh.labels)) return { error: `Couldn't read #${card.number}'s labels: try again` };
  if (isOpenPr(fresh) && (card.action === "approve" || card.action === "unapprove")
    && names(fresh.labels).includes(SHIP_LABEL) === (card.action === "approve")) return { already: true };
  const now = prAction(fresh, trustedReview(card.project, fresh));
  if (now !== card.action || (now !== "approve" && now !== "unapprove")) return { error: `#${card.number} changed since the page loaded: refreshing`, refetch: true };
  return { labels: now === "approve" ? approveLabels(fresh.labels) : unapproveLabels(fresh.labels) };
}

// The words for a failed write (issue_write or actions_run_trigger), by the connector's error code.
// Only the codes listed here mean the write surely didn't happen; any other (a timeout, an upstream
// error, a code added later) may have run, and says so. verb: what was tried ("approve").
export const WRITE_DEFINITE = new Map([
  ["approval_required", (v) => `GitHub needs your approval to ${v}. ${v[0].toUpperCase()}${v.slice(1)} again to be asked.`],
  ["consent_required", (v) => `GitHub needs your approval to ${v}. ${v[0].toUpperCase()}${v.slice(1)} again to be asked.`],
  ["not_granted", (v) => `This page wasn't allowed to ${v}: ${v} again and allow it when asked.`],
  ["not_in_manifest", (v) => `This page isn't allowed to ${v}: turn the GitHub connector's tool on in Permissions, or rerun /ship:dashboard.`],
  ["capability_disabled", (v) => `Connector calls are turned off for this page, so it can't ${v}.`],
  ["blocked_by_policy", (v) => `Your organization's policy doesn't let this page ${v}.`],
  ["server_not_connected", () => "GitHub isn't connected: connect it in claude.ai Settings → Connectors, then try again."],
  ["server_not_found", () => "GitHub isn't connected: connect it in claude.ai Settings → Connectors, then try again."],
  ["selection_required", (v) => `Pick the GitHub connection to use when asked, then ${v} again.`],
  ["needs_reauth", () => "Reconnect GitHub in claude.ai Settings → Connectors, then try again."],
  ["bad_request", (v, m) => `GitHub rejected the request to ${v}${m ? `: ${m}` : ""}. Nothing changed.`],
  ["rate_limited", () => "Too many GitHub calls just now: wait a minute, then try again."],
  ["tool_error", (v, m) => `GitHub refused: ${m || "tool_error"}`],
]);
export function writeError(e, verb) {
  const code = e?.code ?? "upstream_error";
  const definite = WRITE_DEFINITE.get(code);
  if (definite) return definite(verb, e?.message);
  return `No clear answer from GitHub (${code}${e?.message ? `: ${e.message}` : ""}): it may have gone through. Check the page after it refreshes before trying again.`;
}

// A file's text from a get_file_contents result: the GitHub connector answers with a status line,
// then the file as an embedded resource; the REST shape ({ content, encoding: "base64" }) is read too.
// → the text, or null when the result carries none.
export function fileText(result) {
  for (const block of result?.content ?? []) {
    if (block?.type === "resource" && typeof block.resource?.text === "string") return block.resource.text;
  }
  const p = result?.payload;
  if (p && typeof p.content === "string" && p.encoding === "base64") {
    try {
      const bytes = Uint8Array.from(atob(p.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }
  return null;
}

// actions_list's list_workflow_runs for ship.yml, newest first: the run a Land click started is the
// newest workflow_dispatch run created after the click (less a few seconds for clock skew between
// this device and GitHub). → { id, url (on github.com) } or null when it hasn't appeared yet.
const RUN_SKEW = 5e3;
export function landingRun(payload, clickedAt) {
  const runs = Array.isArray(payload) ? payload : payload?.workflow_runs ?? [];
  const run = runs.find((r) => r?.event === "workflow_dispatch" && Date.parse(r.created_at) >= clickedAt - RUN_SKEW);
  const url = run && safeUrl(run.html_url, ["github.com"]);
  return url ? { id: run.id, url } : null;
}
