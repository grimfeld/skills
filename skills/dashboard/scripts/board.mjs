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

const names = (labels) => (labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);

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
  { when: (i, now) => !i.open && [...i.l].some((n) => n.startsWith("spec:")) && now - Date.parse(i.updatedAt) < WEEK, kind: "spec", bucket: "landed", reason: "closed" },
];

function issueCard(project, issue, now) {
  const i = { l: new Set(names(issue.labels)), open: String(issue.state).toUpperCase() === "OPEN", updatedAt: issue.updated_at };
  const rule = ISSUE_RULES.find((r) => r.when(i, now));
  if (!rule) return null;
  return {
    project, number: issue.number, title: issue.title, url: `https://github.com/${project}/issues/${issue.number}`,
    kind: rule.kind, bucket: rule.bucket, reason: rule.reason, since: issue.updated_at, age: ago(now - Date.parse(issue.updated_at)),
  };
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

function prCard(project, pr, check, now) {
  const p = {
    l: new Set(names(pr.labels)),
    open: String(pr.state).toLowerCase() === "open",
    draft: Boolean(pr.draft),
    mergedAt: pr.merged_at ?? null,
    updatedAt: pr.updated_at,
    failing: checksFailing(check),
  };
  const rule = PR_RULES.find((r) => r.when(p, now));
  if (!rule) return null;
  const since = rule.at(p);
  const age = ago(now - Date.parse(since));
  return {
    project, number: pr.number, title: pr.title, url: `https://github.com/${project}/pull/${pr.number}`,
    kind: "pr", bucket: rule.bucket, reason: rule.reason(age), since, age,
  };
}

// toCards(project, issues, prs, checks, now) → cards, issues first, then PRs.
//   project: "owner/name"
//   issues:  list_issues items { number, title, state, labels, updated_at }
//   prs:     list_pull_requests items { number, title, state, draft, merged_at, labels, updated_at }
//   checks:  { [prNumber]: { check_runs, statuses } }, missing for PRs whose checks weren't read
//            (or couldn't be: an unread PR counts as not failing, and the page says so on its row)
//   now:     epoch ms
// Each card: { project, number, title, url, kind: "spec"|"design"|"pr", bucket, reason, since, age }.
// Items that need nothing from the dashboard (spec:in-review specs, unreviewed ready PRs,
// PRs closed unmerged, anything older than a week in Landed) get no card.
export function toCards(project, issues, prs, checks, now) {
  return [
    ...(issues ?? []).map((i) => issueCard(project, i, now)),
    ...(prs ?? []).map((p) => prCard(project, p, checks?.[p.number], now)),
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
