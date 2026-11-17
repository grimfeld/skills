---
name: pr-review
description: Review a PR or branch with seven parallel lens reviewers, dedupe and verify their findings, then turn the approved ones into a fix spec and tickets.
disable-model-invocation: true
argument-hint: "[PR number or URL] [base=<ref>] [paths=<glob,...>] [unattended]"
---

# PR review

Seven **lens** reviewers read the same diff in parallel, each in its own lane. You orchestrate: prepare one shared context, dispatch, dedupe, verify, report, then walk the user through approval and write a fix spec with tickets. You stop after the tickets are written and the PR is labelled `pr-reviewed`.

Every reviewer is **report-only**: it reads code, runs read-only commands, and returns findings. Code changes happen later, through `/implement-spec`, after the user approves.

Files in this skill, reached by path from `${CLAUDE_SKILL_DIR}` (the directory holding this file):

- The `pr-lens-reviewer` agent (`agents/pr-lens-reviewer.md` at the plugin root): the report-only agent every reviewer and the verifier run as. It loads only four tools, which keeps each reviewer's startup small. The `ship` plugin installs it as `ship:pr-lens-reviewer`.
- `lenses/*.md`: one brief per reviewer, with `source` and `upstream_hash` front matter.
- `references/finding-format.md`: the finding schema, severity scale and dedupe rule every reviewer and you share.
- `references/state-format.md`: the review state file, and how to rewrite findings for people.
- `references/spec-template.md`, `references/ticket-template.md`.
- `scripts/check-drift.py`, `scripts/find-preview-url.sh`, `scripts/render-report.py`, `scripts/update-pr-body.py`.

Run Python scripts with `uv run --no-project python <script>`.

## Unattended mode

The argument `unattended` means no person is present, for example during a night build (`/ship:build-spec`). Never ask anything. Where a step below would ask, do this instead:

- **Drift (step 1):** skip every drifted lens's sync, and record it under "Lens drift".
- **Large diff (step 2.3):** review the whole diff.
- **Page (step 8.4):** publish it only if the Artifact tool is available. Otherwise the PR description is the review.
- **Approval (step 9):**
  - Every blocker and major is `approved`, with the reason "unattended: fix before merge".
  - Minors and nits stay `pending`, for the person who reviews the PR.
- **Spec and tickets (step 10):** skip it. The caller fixes approved findings on the branch itself.
- **Hand off (step 11.3):** end with the approved findings as a list of ids, titles, locations and fixes. Don't suggest a next command.

GitHub: `${CLAUDE_PLUGIN_ROOT}/references/github.md` says what to use when `gh` isn't available, as in some cloud sessions.

## 1. Drift check

Run `uv run --no-project python ${CLAUDE_SKILL_DIR}/scripts/check-drift.py`. It prints one `DRIFT` line per lens whose upstream skill changed since the lens was written.

On any drift, pause and ask the user, per drifted lens: **sync** or **skip**.

- **Sync**: read the current upstream `SKILL.md` (path is in the lens front matter), rewrite the lens so it keeps its lane, report-only rule and pointer to the finding format, and carries over whatever changed upstream. Show the user a diff of the lens. On approval, save it with `upstream_hash` set to the hash the script printed as `current`.
- **Skip**: run with the stale lens and record it under "Lens drift" in the report.

Done when the script prints no `DRIFT` lines, or every drifted lens is synced or explicitly skipped.

## 2. Prepare the shared context

Parse the arguments: a PR number or URL, an optional `base=`, an optional `paths=`.

1. **Target and id.** With a PR: `gh pr view <n> --json number,title,body,baseRefName,headRefName,headRefOid,url`; id is `pr-<n>`. Without: the current branch; base is `base=` or the merge-base with `main` (fall back to `master`); id is the branch name slugified.
2. **Checkout.** Reviewers need the head's files on disk. If the working tree is already at the head commit, use it. Otherwise `git fetch origin pull/<n>/head` and `git worktree add .scratch/pr-review/wt-<id> <headRefOid>`; that worktree is `REVIEW_ROOT`. Never switch the user's current branch.
3. **Diff.** `git diff --shortstat <base>...<head>` and `git diff --name-status`. Over ~3000 changed lines, show the stats and ask: continue, or narrow to paths. Apply `paths=` if given. Write the diff once to `.scratch/pr-review/<id>.diff` (`git -C <REVIEW_ROOT> diff <base>...<head> [-- <paths>] > …`); reviewers read that file instead of running their own diffs.
4. **Spec.** Look in order: issues referenced in commit messages or the PR body (fetch with `gh issue view`), a path the user passed, a file under `docs/`, `specs/` or `.scratch/` matching the branch or feature. Record the spec text, or "no spec available".
5. **CI.** With a PR: `gh pr checks <n>`. Failing checks become blockers at the top of the report.
6. **Previous state.** Read `.scratch/pr-review/<id>.json` if it exists: its open findings, decisions and `artifact_url`. If only a legacy `<id>.md` exists, seed state from it as `references/state-format.md` describes.
7. **Scratch is untracked.** If `git check-ignore -q .scratch` fails, append `.scratch/` to `.git/info/exclude`.

Done when you hold: base, head, `REVIEW_ROOT`, the saved diff file, the changed-file list, spec text or "no spec available", CI status, and the previous state (or none).

## 3. Route the lenses

Two passes. Each lens runs as its own agent; never merge lenses into one agent.

**Pass 1: by file type.** Classify each changed file, then pick lenses:

| Lens | Runs when | Model |
|---|---|---|
| `standards-and-spec` | always | default |
| `quality` | any code file changed | default |
| `security` | any code file, dependency manifest or lockfile changed | default |
| `performance` | server, data, query, worker or algorithmic code changed | `sonnet` |
| `simplification` | any code file changed | `sonnet` |
| `principles` | any code file changed | `sonnet` |
| `web-quality` | front-end files changed (`.tsx .jsx .vue .svelte .astro .css .scss .html`, or under `pages/ app/ components/ public/ styles/`) | `sonnet` |

A diff of only docs and config (Markdown, text, CI YAML, editor config) runs `standards-and-spec` alone. When a file's class is ambiguous, run the lens.

**Pass 2: by content.** When fewer than ~40 code files changed, read the code hunks of the saved diff yourself. Skip any of `performance`, `simplification`, `principles` and `web-quality` that the hunks give clearly nothing to review: for example `performance` when no data access, query, loop over a collection or worker code changed, or `simplification` and `principles` when the code change is only renames, string or config values. Decide `web-quality` after step 4, and never skip it by content when a live URL was found. When in doubt, run the lens. `standards-and-spec`, `quality` and `security` follow pass 1 only; never skip them by judgment.

Record each skipped lens with a one-line reason, prefixed `by type:` or `by content:`.

Done when every lens is selected or skipped with a reason, with `web-quality` left open until step 4 if it was selected by type.

## 4. Find a URL for web-quality

Only when `web-quality` runs.

1. `${CLAUDE_SKILL_DIR}/scripts/find-preview-url.sh gh <pr-number-or-branch>`: the PR's deployment statuses and Vercel bot comments.
2. Vercel MCP: `list_deployments` for the project, filtered to this branch, newest `READY` preview.
3. `${CLAUDE_SKILL_DIR}/scripts/find-preview-url.sh local`: a dev server already listening on 3000, 5173, 4321 or 8080.

If the URL is a Vercel preview that answers 401 or redirects to a login, call the Vercel MCP `get_access_to_vercel_url` to get a shareable link. Never start a server or create a deployment. With no reachable URL, the lens runs source-only, and the report says so.

## 5. Dispatch

**Pick the reviewer agent.** Use `subagent_type: ship:pr-lens-reviewer` when it is among the available agent types (or `pr-lens-reviewer`, from an older symlinked install). Otherwise fall back to `Explore`, then `general-purpose`. Record the type in each lens's note in state (`agent: <type>`), and name any fallback in the terminal summary, so a missing install is visible. One exception: `web-quality` with a live audit URL runs as `general-purpose`, because it needs the browser MCP tools.

In **one message**, send one `Agent` call per selected lens, with that `subagent_type` and the model from the routing table (omit `model` for default). Each prompt carries pointers and the shared context, never the lens text itself:

```
You are the <lens> reviewer for a PR review. You are report-only: read code and run read-only commands; edit no file.
Read your brief: ${CLAUDE_SKILL_DIR}/lenses/<lens>.md
Read the finding format: ${CLAUDE_SKILL_DIR}/references/finding-format.md
Repository root to read: <REVIEW_ROOT>
Diff, already saved: <absolute path of .scratch/pr-review/<id>.diff>
Changed files: <list>
Spec: <spec text, or "no spec available">
<web-quality only> Audit URL: <url, or "none: source-only">
Stay close to the diff: read the saved diff once, then the changed files and the code they directly call or are called by, using line ranges, never whole files outside the diff. Beyond that, run targeted greps for existing helpers, components or patterns the change could have reused, and read the files the spec references.
Return the coverage line and the JSON findings array exactly as the finding format specifies.
```

Done when every dispatched reviewer has returned. A reviewer that errors or returns malformed output gets one re-dispatch; after that, record it under "Lens failures" in the report.

## 6. Dedupe

Apply the dedupe rule in `references/finding-format.md` across all returned findings. Each merged finding keeps every `source_skill`; corroboration by two or more lenses raises its priority within its severity. Drop any finding that matches a previously rejected one.

## 7. Verify

Collect every `blocker` and `major` after dedupe. For each one, re-read the cited code and its callers and decide `confirmed` or `refuted` with a one-line reason:

- **Three or fewer:** do it yourself, no agent.
- **More than three:** dispatch **one** agent of the reviewer type picked in step 5 (default model) with the list, `REVIEW_ROOT` and the saved diff path, asking for that verdict per finding.

Refuted findings move to "Dropped by verification". `minor` and `nit` skip this step.

Done when every blocker and major is `confirmed` or `refuted` with a reason.

## 8. Report

1. **Write the brief.** In state's `brief` (see `references/state-format.md`), for the person who reviews the PR without reading the diff:
   - `changes`: what a user or maintainer will notice, one plain sentence each, grouped by `area` (the Module, App, package or surface the project's docs use). Behaviour first, internals only when they matter.
   - `risks`: anything that is hard to undo or reaches beyond the code: database migrations, data removed or rewritten, auth or permission changes, new or major-bumped dependencies, CI, deploy or infra config, feature flags. Name the file. Empty when there are none.
   - `preview_url`: from step 4, when found.
   - `screens`: image URLs only when they already exist (a PR comment, CI artifact or the project's screenshot command named in `docs/agents/shipping.md`); never start the app for them.
   Done when every changed area appears in `changes`.
2. **Write state.** Update `.scratch/pr-review/<id>.json` per `references/state-format.md`: append this run, match findings against the previous state (new / still open / fixed), and write each finding's human fields (`title`, `why`, `fix`, `theme`) by the writing rules there. Done when every finding has plain-language human fields, one issue each.
3. **Render.** `uv run --no-project python ${CLAUDE_SKILL_DIR}/scripts/render-report.py .scratch/pr-review/<id>.json` writes `<id>.md`, `<id>.html` and `<id>.pr.md`.
4. **Publish the page** with the Artifact tool, `file_path` = the `.html`:
   - No `artifact_url` in state: publish with `icon: "checklist"` and a one-sentence `description` (verdict and counts), then save the returned URL as `artifact_url` and re-render.
   - `artifact_url` set, page not yet published in this conversation: `action: "read"` that URL first, then publish with `url` = `artifact_url`.
   - Already published in this conversation: publish the same `file_path` again.
5. **Update the PR description.** Only when the target is a PR: `uv run --no-project python ${CLAUDE_SKILL_DIR}/scripts/update-pr-body.py <n> .scratch/pr-review/<id>.pr.md`. It replaces the section between the `pr-review` markers and leaves the rest of the description alone. The description is where the reviewer decides whether to add the `ship` label, so it must match the page. If `gh` can't edit the PR (in a cloud session without `gh`, use the GitHub MCP's pull request update tool with the same spliced body), say so in the summary and carry on.
6. **Summarise** in the terminal: the verdict line, the "fix before merge" titles, counts of smaller improvements, skipped reviewers with their reasons, any fallback reviewer agent, whether web-quality had live evidence, the report path and the page link.

## 9. Approval

Use the human `title` and `why` in every question.

- **Fix-before-merge findings, one by one.** `AskUserQuestion`, up to 4 findings per call, options Approve / Reject / Defer. A rejection carries a reason (the user types it via Other, or you ask).
- **Smaller improvements, as a batch.** List them by theme with their ids, then one question: approve all, reject all, or pick by id.

Record every decision in the state file, re-render, republish the page and update the PR description again. Done when every finding has a decision.

## 10. Spec and tickets

With at least one approved finding, write into `.scratch/pr-review-<id>/`, the local-markdown tracker layout `/implement-spec` reads:

- `spec.md` from `references/spec-template.md`.
- `issues/NN-<slug>.md` from `references/ticket-template.md`, numbered from `01`; record each finding's ticket number in state. Group approved findings by root cause or area, one ticket per group. Order the tickets so a fix others depend on (a boundary type, a shared helper) comes first, and record that with `Blocked by:`. All nits go into one final `polish` ticket that blocks nothing. Every ticket names its check: a failing test to write first where an honest one exists, otherwise a concrete manual or CI check.

If `docs/agents/issue-tracker.md` names GitHub or GitLab, offer to publish the spec and tickets there; publish only on a yes.

## 11. Finish

1. **Label the PR.** Only when the target is a PR, not a bare branch. Run `gh api repos/{owner}/{repo}/issues/<n>/labels -f 'labels[]=pr-reviewed'` (REST: `gh pr edit` fails on some repositories). If it fails because the label does not exist, create it with `gh label create pr-reviewed --description "Reviewed with /pr-review" --color 0E8A16` and retry once. If it still fails (no permission, no `gh` auth), say so in the summary and carry on. Label the PR whatever the outcome of the review, including when no finding was approved.
2. **Clean up.** Remove the worktree if you created one (`git worktree remove .scratch/pr-review/wt-<id>`).
3. **Hand off.** End with whether the label was applied, the report path, the page link, the spec path, and the next command:

```
/implement-spec .scratch/pr-review-<id>/spec.md
```
