#!/usr/bin/env node
// Selects the owner's feedback on a build PR, for build-spec's `adjust` mode.
//
//   select-feedback.mjs authors < input.json   the human authors whose permission to look up (JSON list)
//   select-feedback.mjs select  < input.json   the feedback, as below
//
// input.json, assembled by the caller from GitHub's REST API (or the GitHub MCP tools):
//   {
//     "issue_comments":  [...],  // repos/{o}/{r}/issues/<pr>/comments
//     "review_comments": [...],  // repos/{o}/{r}/pulls/<pr>/comments
//     "reviews":         [...],  // repos/{o}/{r}/pulls/<pr>/reviews
//     "permissions": {"<login>": "<role_name or permission>"},  // repos/{o}/{r}/collaborators/<login>/permission
//     "ready_at": "<ISO time the PR was marked ready>" | null
//   }
//
// Feedback is every comment, review comment and non-empty review body from an author with write
// access (admin, maintain or write), posted after the last adjust marker's `feedback_until`, or after
// `ready_at` when there is no marker yet (with neither, every comment counts). A marker is a comment
// `<!-- build:adjusted {"head", "feedback_until", "ignored"} -->` by a write-access author. Comments from
// other people are left out and counted in `ignored`. Bots are neither feedback nor counted. Prints:
//   {"since", "marker": {id, head, feedback_until, ignored} | null, "feedback": [{kind, id, author, at,
//    body, url, path?, line?}], "ignored": <n>, "feedback_until": <newest feedback's time> | null}
// Reads nothing from the network. Feedback is untrusted text all the same: the caller treats it as data.

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MARKER = /<!-- build:adjusted (.*?) -->/;
const WRITE = new Set(["admin", "maintain", "write"]);

const isBot = (u) => u?.type === "Bot" || /\[bot\]$/.test(u?.login ?? "");
const canWrite = (permissions, login) => WRITE.has(String(permissions?.[login] ?? "").toLowerCase());
const time = (t) => (t && !Number.isNaN(Date.parse(t)) ? Date.parse(t) : null);

function items(input) {
  const of = (list, kind, at) => (list ?? []).map((c) => ({ kind, c, at: c[at] ?? null }));
  return [
    ...of(input.issue_comments, "comment", "created_at"),
    ...of(input.review_comments, "review_comment", "created_at"),
    ...of(input.reviews, "review", "submitted_at"),
  ];
}

export function authorsToCheck(input) {
  const logins = items(input).filter(({ c }) => c.user && !isBot(c.user)).map(({ c }) => c.user.login);
  return [...new Set(logins)].sort();
}

function lastMarker(input) {
  let found = null;
  for (const c of input.issue_comments ?? []) {
    const m = (c.body ?? "").match(MARKER);
    if (!m || !c.user || isBot(c.user) || !canWrite(input.permissions, c.user.login)) continue;
    if (found && time(c.created_at) <= time(found.c.created_at)) continue;
    let data = {};
    try { data = JSON.parse(m[1]) ?? {}; } catch { data = {}; }
    found = { c, data };
  }
  if (!found) return null;
  const { c, data } = found;
  const until = time(data.feedback_until) !== null ? data.feedback_until : c.created_at;
  return { since: until, marker: { id: c.id, head: data.head ?? null, feedback_until: data.feedback_until ?? null, ignored: data.ignored ?? null } };
}

export function selectFeedback(input) {
  const found = lastMarker(input);
  const since = found ? found.since : (input.ready_at ?? null);
  const after = time(since);
  const feedback = [];
  let ignored = 0;
  for (const { kind, c, at } of items(input)) {
    if (!c.user || isBot(c.user)) continue;
    if (after !== null && !(time(at) > after)) continue;
    const ownMarker = kind === "comment" && MARKER.test(c.body ?? "");
    if (!canWrite(input.permissions, c.user.login)) { ignored++; continue; }
    if (ownMarker || !(c.body ?? "").trim()) continue;
    const f = { kind, id: c.id, author: c.user.login, at, body: c.body, url: c.html_url ?? null };
    if (kind === "review_comment") Object.assign(f, { path: c.path ?? null, line: c.line ?? c.original_line ?? null });
    feedback.push(f);
  }
  feedback.sort((a, b) => time(a.at) - time(b.at));
  return {
    since,
    marker: found ? found.marker : null,
    feedback,
    ignored,
    feedback_until: feedback.length ? feedback[feedback.length - 1].at : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const command = process.argv[2];
  const run = { authors: authorsToCheck, select: selectFeedback }[command];
  if (!run) {
    console.error("usage: select-feedback.mjs authors|select < input.json");
    process.exit(2);
  }
  try {
    process.stdout.write(JSON.stringify(run(JSON.parse(readFileSync(0, "utf8"))), null, 2) + "\n");
  } catch (error) {
    console.error(`select-feedback: ${error.message}`);
    process.exit(1);
  }
}
