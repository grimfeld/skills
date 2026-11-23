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

function issueCard(project, issue, now, prs) {
  const i = { l: new Set(names(issue.labels)), open: String(issue.state).toUpperCase() === "OPEN", updatedAt: issue.updated_at };
  const rule = ISSUE_RULES.find((r) => r.when(i, now));
  if (!rule) return null;
  return {
    project, number: issue.number, title: issue.title, url: `https://github.com/${project}/issues/${issue.number}`,
    kind: rule.kind, bucket: rule.bucket, reason: rule.reason, since: issue.updated_at, age: ago(now - Date.parse(issue.updated_at)),
    ...(rule.kind === "spec" ? { openQuestions: openQuestions(issue.body), pr: specPr(project, issue.number, prs) } : {}),
    ...(rule.kind === "design" ? { designUrl: designLink(issue.body) } : {}),
  };
}

// A spec's PR: one whose description closes it ("Closes #n", as GitHub reads closing keywords) or
// whose branch is the night shift's spec/<n>-…. An open PR first, else the latest merged one;
// a PR closed unmerged never. → { number, url } or null.
function specPr(project, n, prs) {
  const closes = new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}(?!\\d)`, "i");
  const mine = (prs ?? []).filter((p) => closes.test(String(p.body ?? "")) || new RegExp(`^spec/${n}-`).test(p.head?.ref ?? ""));
  const open = mine.find((p) => String(p.state).toLowerCase() === "open");
  const merged = mine.filter((p) => p.merged_at).sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))[0];
  const hit = open ?? merged;
  return hit ? { number: hit.number, url: `https://github.com/${project}/pull/${hit.number}` } : null;
}

// The specs whose comments are read for the latest morning page: spec issues, open or closed,
// updated in the last 7 days (a morning comment updates its spec), newest first, at most 10.
const MORNING_SPECS = 10;
export function morningSpecs(issues, now) {
  return (issues ?? [])
    .filter((i) => names(i.labels).some((n) => n.startsWith("spec:")) && now - Date.parse(i.updated_at) < WEEK)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, MORNING_SPECS);
}

// A stacked PR: its base branch is the head branch of another open PR in this repo (a fork's
// branch of the same name doesn't count). → that PR's number, or null.
function landsAfter(pr, openPrs) {
  const base = pr.base?.ref;
  if (!base) return null;
  const parent = openPrs.find((o) => o.number !== pr.number && o.head?.ref === base &&
    (!o.head.repo?.full_name || !pr.base.repo?.full_name || o.head.repo.full_name === pr.base.repo.full_name));
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
    review: parseReview(pr.body), landsAfter: p.open ? landsAfter(pr, openPrs) : null,
    labels: [...p.l], action: prAction(p),
  };
}

// The label step a PR card offers, the two /ship:land takes (skills/land/SKILL.md): Approve on an open,
// ready, reviewed PR without `ship`, and not one already sent back (changes-requested) or taken out of
// the queue (conflicts); Un-approve on an open PR carrying `ship`. → "approve", "unapprove" or null.
function prAction(p) {
  if (!p.open) return null;
  if (p.l.has("ship")) return "unapprove";
  if (p.draft || !p.l.has("pr-reviewed") || p.l.has("changes-requested") || p.l.has("conflicts")) return null;
  return "approve";
}

// toCards(project, issues, prs, checks, now) → cards, issues first, then PRs.
//   project: "owner/name"
//   issues:  list_issues items { number, title, state, labels, updated_at }
//   prs:     list_pull_requests items { number, title, state, draft, merged_at, labels, updated_at }
//   checks:  { [prNumber]: { check_runs, statuses } }, missing for PRs whose checks weren't read
//            (or couldn't be: an unread PR counts as not failing, and the page says so on its row)
//   now:     epoch ms
// Each card: { project, number, title, url, kind: "spec"|"design"|"pr", bucket, reason, since, age }, plus
//   spec cards:   openQuestions (a count, or null without the section), pr ({ number, url } or null)
//   design cards: designUrl (https, or null)
//   PR cards:     review (parseReview, or null), landsAfter (the PR it is stacked on, or null),
//                 labels (names), action ("approve", "unapprove" or null: the label step it offers)
// Items that need nothing from the dashboard (spec:in-review specs, unreviewed ready PRs,
// PRs closed unmerged, anything older than a week in Landed) get no card.
export function toCards(project, issues, prs, checks, now) {
  const openPrs = (prs ?? []).filter((p) => String(p.state).toLowerCase() === "open");
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

// ---- Card details, parsed from text other skills write. Each parser follows a format another
// skill owns (named above it): when that format changes, change the parser.
// Bodies and comments are anyone's text: a link is kept only when it is https.

export function safeUrl(text) {
  try {
    const url = new URL(String(text ?? "").trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const linkTo = (text, label) => safeUrl(text.match(new RegExp(`\\[${label}\\]\\(([^)\\s]+)\\)`))?.[1]);

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
// between its markers, "**<Verdict>.** <headline>", "[Preview](…) · [Full report](…)", and
// "### Risks" bullets, where the single "None found: …" bullet means no risks.
// → { verdict, line, risks (null without a Risks heading), reportUrl, previewUrl }, or null without the section.
const REVIEW_START = "<!-- pr-review:start -->";
const REVIEW_END = "<!-- pr-review:end -->";
export function parseReview(body) {
  const text = String(body ?? "");
  const from = text.indexOf(REVIEW_START);
  const to = text.indexOf(REVIEW_END, from);
  if (from < 0 || to < 0) return null;
  const review = text.slice(from + REVIEW_START.length, to);
  const bold = review.match(/^\*\*(.+?)\.?\*\*\s*(.*)$/m);
  const items = section(review, /^###\s+Risks\b/i);
  const risks = items ? topItems(items).filter((r) => !/^None found\b/i.test(r)).length : null;
  return {
    verdict: bold ? bold[1] : null,
    line: bold ? `${bold[1]}.${bold[2] ? ` ${bold[2]}` : ""}` : null,
    risks,
    reportUrl: linkTo(review, "Full report"),
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
// "- **Artifact:** <link>" line, bare, in <angle brackets> or as [text](link). → https URL or null.
export function designLink(body) {
  const line = String(body ?? "").split(/\r?\n/).find((l) => /^\s*[-*]\s+\*\*Artifact:\*\*/i.test(l));
  const value = line?.replace(/^.*?\*\*Artifact:\*\*\s*/i, "") ?? "";
  const link = value.match(/^\[[^\]]*\]\(([^)\s]+)\)/) ?? value.match(/^<([^>\s]+)>/) ?? value.match(/^(\S+)/);
  return link ? safeUrl(link[1]) : null;
}

// night-shift's morning comment on each spec it collected (skills/night-shift/SKILL.md, morning step 5):
// "<!-- ship:morning-page -->" then "Reviewed on this morning's page: <url>". A new one is posted
// every morning, so the newest is current. comments: issue_read get_comments items { body, created_at },
// any order, from any number of specs. → { url, at } of the newest with an https link, or null.
const MORNING_MARK = "<!-- ship:morning-page -->";
export function morningPage(comments) {
  let best = null;
  for (const c of comments ?? []) {
    const body = String(c?.body ?? "");
    if (!body.includes(MORNING_MARK)) continue;
    const url = safeUrl(body.slice(body.indexOf(MORNING_MARK)).match(/page:\s*<?(\S+?)>?(\s|$)/)?.[1]);
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
  return { version: version ? Number(version[1]) : null, defaultBranch: null };
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
