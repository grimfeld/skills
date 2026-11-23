// Ship dashboard: sorts one project's specs, designs and PRs into buckets by what they need.
// Pure: no dependencies, no DOM. build.mjs inlines it into the page (dropping `export`).
// The labels are the ones docs/agents/shipping.md defines: change them there, change them here.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const BUCKETS = [
  { id: "needs-you", title: "Needs you", empty: "Nothing needs you" },
  { id: "ready", title: "Ready for tonight", empty: "Nothing ready for tonight" },
  { id: "in-flight", title: "In flight", empty: "Nothing in flight" },
  { id: "landed", title: "Landed", empty: "Nothing landed this week" },
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
const updated = (p) => p.updatedAt;
const approved = (p) => p.approvedAt;
const PR_RULES = [
  { when: (p) => p.open && p.l.has("conflicts"), bucket: "needs-you", reason: () => "conflicts", at: updated },
  { when: (p) => p.open && p.failing, bucket: "needs-you", reason: () => "checks failing", at: updated },
  { when: (p, now) => p.open && p.l.has("ship") && now - Date.parse(p.approvedAt) > DAY, bucket: "needs-you", reason: (age) => `approved ${age} ago, not merged`, at: approved },
  { when: (p) => p.open && p.l.has("pr-reviewed") && !p.l.has("ship"), bucket: "needs-you", reason: () => "reviewed, waiting for your verdict", at: updated },
  { when: (p) => p.open && p.draft, bucket: "in-flight", reason: () => "draft", at: updated },
  { when: (p) => p.open && p.l.has("ship"), bucket: "in-flight", reason: (age) => `approved ${age} ago, landing`, at: approved },
  { when: (p, now) => p.mergedAt && now - Date.parse(p.mergedAt) < WEEK, bucket: "landed", reason: () => "merged", at: (p) => p.mergedAt },
];

function prCard(project, pr, check, now) {
  const p = {
    l: new Set(names(pr.labels)),
    open: String(pr.state).toLowerCase() === "open",
    draft: Boolean(pr.draft),
    mergedAt: pr.merged_at ?? null,
    updatedAt: pr.updated_at,
    // The label's time when the caller knows it; else the PR's last update, which is no earlier.
    approvedAt: pr.ship_labeled_at ?? pr.updated_at,
    failing: checksFailing(check),
  };
  const rule = PR_RULES.find((r) => r.when(p, now));
  if (!rule) return null;
  const since = rule.at(p);
  const age = ago(now - Date.parse(since));
  return {
    project, number: pr.number, title: pr.title, url: pr.html_url ?? `https://github.com/${project}/pull/${pr.number}`,
    kind: "pr", bucket: rule.bucket, reason: rule.reason(age), since, age,
  };
}

// toCards(project, issues, prs, checks, now) → cards, issues first, then PRs.
//   project: "owner/name"
//   issues:  list_issues items { number, title, state, labels, updated_at }
//   prs:     list_pull_requests items { number, title, state, draft, merged_at, html_url, labels, updated_at },
//            plus ship_labeled_at when the caller knows when `ship` went on
//   checks:  { [prNumber]: { check_runs, statuses } }, missing for PRs whose checks weren't read
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
