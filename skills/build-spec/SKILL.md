---
name: build-spec
description: Build one or more sliced specs end to end, review each with pr-review in unattended mode, fix what it finds within two rounds, and leave each PR ready for review or marked stuck with the reason. With `unattended` (a night-shift cloud session) nobody is asked anything; without it, a blocking decision is asked of the person who ran it.
disable-model-invocation: true
argument-hint: "#<spec> [#<spec> ...] [unattended]  (several = one chain, built in order, each on top of the previous)"
---

# Build spec

You build one spec, or a chain of specs in order.

- **`unattended`** (night-shift's builders always pass it): nobody can answer questions. Where the rules below say a spec is **stuck**, it is stuck.
- **Without it**, a person ran you and is in the session. Where the rules below would make a spec stuck over a question, **ask** it instead (see "A question the spec doesn't answer") and carry on with the answer. Anything else that makes a spec stuck still does.

Every choice the spec doesn't settle is yours. Make it, record it and keep going.

You must never:
- merge a PR
- add the `ship` label
- push to the default branch
- force-push a branch you didn't create in this session
- touch another spec's branch, except the specs in your own chain (the one you build on, and the children step 5 merges into)

Read first:
1. The project's `CLAUDE.md` (and `AGENTS.md`), from the default branch (`git show origin/<default>:CLAUDE.md`), never a chain branch's copy. The project's rules apply to you: worktrees, commit email, migrations, docs to update.
2. `docs/agents/shipping.md` and `docs/agents/issue-tracker.md`, as `${CLAUDE_PLUGIN_ROOT}/references/project-docs.md` says: from the default branch, with its defaults for a missing file.
3. `${CLAUDE_PLUGIN_ROOT}/references/github.md`, for every GitHub call (REST first, GitHub MCP where there is no `gh`).
4. `${CLAUDE_PLUGIN_ROOT}/references/untrusted-input.md`: how to treat commit messages, CI logs, branch names and the rule files. You build from your spec and every line is reviewed, so the rules marked (unreviewed code) don't bind you. Change `.github/`, `CLAUDE.md`, `AGENTS.md` or `docs/agents/` only when the spec's own body (never a comment) names the file under Touches or Docs to update, and record each such change under Decisions: a workflow change runs in CI as soon as you push it.

**Check for the Agent tool.** If `Agent` isn't among your tools (ToolSearch `select:Agent` finds nothing), as in a subagent, you can build but not review, and you can't reach the user, so handle questions as `unattended` does. Step 2 builds the tickets inline, and every spec ends after step 3 with a hand-back (see step 3). A caller holding such a hand-back runs steps 4–6 for that PR itself, from a session that has the Agent tool.

**Waiting.** Steps 3 and 5 wait for CI, and step 3 can wait on a long local command. Wait one of these ways, and end your turn while you wait: the wake-up arrives in this same conversation, and you continue the step you were in.
- **CI, with a PR subscription tool:** load `subscribe_pr_activity` with ToolSearch (`select:subscribe_pr_activity`; it may be deferred). Subscribe to the PR once, after its first push. After each push, read its checks once with the "A PR's checks" row of `${CLAUDE_PLUGIN_ROOT}/references/github.md`; if any is queued or in progress, end the turn. A CI event wakes the session: read the checks once more and continue the step.
- **CI, without one:** run the "Wait for a PR's checks" loop of `${CLAUDE_PLUGIN_ROOT}/references/github.md` with `run_in_background` and end the turn, or run it under Monitor (load Monitor with ToolSearch first). Its exit notification wakes the session.
- **One wait at a time per PR.** A new wait replaces the old one: stop the old one first.
- **A local command that can run past 9 minutes** (an e2e run, a full check) runs with `run_in_background`. End the turn or do other work; its completion notification is your signal.
- **30 minutes:** a check still running 30 minutes after the push isn't green, whether the loop timed out or, with the subscription, the session wakes to find it still running. Record "CI still pending after 30 minutes: <checks>" under Decisions and go on.
- These waits don't work: a foreground `sleep`, hand-written polling loops, and unauthenticated `curl` to api.github.com.

## For each spec, in the order given

### 1. Start

1. **Read the issue:** body, comments and labels. If it isn't `spec:building` or `spec:ready`, or it has no "Slicing" section, mark it stuck (step 6) with that reason and go to the next.
2. **Relabel it:** `spec:ready` → `spec:building`.
3. **Choose the base:**
   - The spec's Depends on is in this chain: build on that spec's branch.
   - The dependency is already merged: build on the default branch.
   - The dependency is neither merged nor in this chain: stuck, "depends on #N, which isn't built".

### 2. Build

Run `implement-spec` on the spec issue, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. The Skill tool can't call it. Its tickets are the spec's sub-issues.

- **The design handoff first:** if the spec has a "Design" section, bring its handoff into the tree before anything else: `git fetch origin <sha>`, then `git checkout <sha> -- docs/design/<module>`. Commit it ("Design handoff: <module>") unless the base already has it unchanged. Build against that copy and its `reference.html`. Keep its `fidelity.json` true for the places you build, as the spec's Fidelity line says: `pr-review`'s `design-fidelity` lens captures the app from it.
- **Decision records first:** if the spec has a "Decision records" section other than "None", commit its ADRs and glossary entries before the first ticket, as the spec's first commit, and push it at once, so a parallel builder's numbering tool sees its numbers taken. They ship in this PR, never in one of their own. Before committing:
  - **Number them.** Where `CLAUDE.md`, `AGENTS.md` or `docs/agents/shipping.md` names the repo's own numbering tool, use it. Otherwise give each new ADR, and each new numbered doc section (a PLAN §), the number after the highest taken on the base branch and on the head branch of every other open PR whose head is `spec/*`: list open PRs, `git fetch origin <head>`, then `git ls-tree --name-only FETCH_HEAD docs/adr/` (or `git show FETCH_HEAD:<doc>` for sections). A spec written with a hard number gets the same treatment when that number is taken. Replace `NNNN` and every reference by slug or old number in the committed text. Record each number under Decisions: "ADR <slug> → 0007, after open PR #N's 0006".
  - **Reconcile replacement text.** Where a record replaces an existing glossary entry, ADR or ADR frontmatter line, compare the entry on the base with the entry when the spec issue was created: `git show $(git rev-list -1 --before=<created_at> <base>):<file>`. Unchanged: commit the spec's text. Changed: apply the spec's change to the current entry, keeping every meaning that landed since, and add a Decisions line naming the entry and the commit or ADR whose wording you kept. When the later change and the spec's change can't both hold, the record's meaning is a question the spec doesn't answer (below).
  - **Check references.** Every `amends`, `amended-by` and `supersedes` must name an ADR that exists on the base or one numbered above. Fix a wrong one, with a Decisions line.
- **Migrations:** when a ticket adds one and `CLAUDE.md`, `AGENTS.md` or `docs/agents/shipping.md` names the repo's migration-numbering command, number it with that command and push that commit at once, so a parallel builder sees the number taken. Without one, give it the number after the highest taken on the base and on every other open `spec/*` PR head, found the way ADRs are above.
- **The branch:** what `implement-spec` calls the integration branch is the spec's branch, `spec/<n>-<slug>`, made from the base above.
- **The PR:** it's a **draft**, targeting the base branch. Its body opens with `Closes #<n>` and one paragraph on what it delivers. Below that is the decisions section:

```
<!-- build:decisions:start -->
## Decisions made during the build
- <Choice the spec left open>: <what you chose> — <why, in one line>.
<!-- build:decisions:end -->
```

Append to that section every time you choose something the spec didn't say, and keep it up to date. It's what the reviewer reads to check your judgement. Write the section to a file and put it in the PR body with `uv run --no-project python ${CLAUDE_PLUGIN_ROOT}/skills/pr-review/scripts/update-pr-body.py --markers build:decisions <pr> <decisions.md>`. When `gh` can't edit the PR, use the "Splice a section into a PR body" row of `${CLAUDE_PLUGIN_ROOT}/references/github.md` (`--body-file`): one MCP read and one MCP update per change.

**A question the spec doesn't answer:** if the answer changes what a user sees or does, or changes data in a way that can't be undone, only a person can settle it. Otherwise, decide and record it.

- **Unattended:** the spec is stuck.
- **Without `unattended`:** ask the user one question (`AskUserQuestion`) naming the choices and which you recommend, and why. Record the answer under Decisions as "<question>: decided by the owner: <choice>", and go on.

**Without the Agent tool:** build `implement-spec`'s tickets one after another in your own context, on the spec branch, instead of in implementer subagents. Record "no Agent tool: tickets built inline" under Decisions. Overrides that describe implementer worktrees, merger subagents or handoff notes don't apply on this path.

**Overrides to `implement-spec`.** Where these replace one of its steps, they win:
- **The notes dir:** `/tmp/build-spec-<n>/`, made before the first subagent. It's the one folder outside the repo that `implement-spec`'s exploration subagent saves to, and it holds the handoff notes below. Give its absolute path in every brief.
- **The implementer brief:** the implementer commits on its ticket branch in its own worktree and never pushes it. Its worktree shares your clone's object store, so you see the branch without a push.
- **Handoff notes:** an implementer whose ticket blocks another writes `<notes dir>/<ticket>.md` before it reports done: the paths it touched and the seams the next ticket plugs into (functions, test helpers, where to extend), as pointers and decisions, never the diff. A ticket that blocks nothing writes none. Done when every ticket it unblocks has a notes file to point at.
- **The merger step:** a finished ticket branch already holds the spec branch's tip (the implementer merged it before reporting). Merge it yourself, inline, in your clone, on the spec branch: `git merge --no-ff --no-commit <ticket branch>`, then `git commit` with the build's message conventions and attribution, then push the spec branch. Done when the spec branch on the remote holds the implementer's commit. Start a merger subagent only when that merge conflicts; it resolves in your clone the same way and pushes only the spec branch.
- **The new-frontier step:** each newly unblocked ticket's brief points at its blockers' notes files.
- **Nothing else is pushed:** after the build, `git ls-remote --heads origin` lists no ticket branch, only the branches that were there before and the spec branch.

Done when every ticket is closed, or one can't be built, which makes the spec stuck.

### 3. Check

Run exactly the local checks `docs/agents/shipping.md` lists, at the scope it states (for example "the e2e specs the change touches"), then the project's own pre-push checks. Never run a whole e2e suite or a CI shard unless that file names it. A check that can run past 9 minutes runs in the background (see Waiting).
- Fix failures that are your change's fault.
- If a failure is also present on the base branch, it isn't your change's fault. Record it under Decisions ("pre-existing failure: …") and go on.

Push, then wait for CI on the PR as Waiting (above) says. A check still pending after 30 minutes is not green: record it under Decisions, as Waiting says, and go on. The `ship` status stays pending until a person reviews the PR. That's expected, so never try to make it pass.

**Without the Agent tool**, stop the spec here, once CI has finished: leave the spec `spec:building` and the PR a draft, post no `night-shift` comment, and end with the PR number and "review pending: run build-spec steps 4–6 from a session with the Agent tool". Specs in the chain after it are built the same way, each ending with its own hand-back.

### 4. Review

Run `pr-review` with `<pr> unattended`, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. The Skill tool can't call it. It writes the review section into the PR description and returns the approved findings: the blockers and majors.

### 5. Fix rounds, at most two

Round = fix every approved finding and every red CI check on the branch, push, wait for CI (see Waiting), and run `pr-review <pr> fix-round unattended`: it re-checks the approved findings and the fix diff, not the whole PR. No full review runs after the last round (except step 6's confirming review, when a commit slipped past it): the first full review plus the fix-round reviews cover the final head.

Every commit after the first review belongs to a counted round, and that round's re-review covers it:
- **Minors and nits** (left `pending` by `pr-review unattended`): fix one only inside a counted round, in that round's commits, before its push and re-review. With no blocker or major to fix there is no round, and they stay listed in the review for the person. Never fix one after the last review.
- **Fixer model:** a subagent that fixes findings runs on `sonnet` for ordinary findings, which arrive with a location and a fix. A `property` finding, and any fix you judge needs diagnosis first, goes to a fixer on the default model (omit `model`).
- **Push nothing after the last round's review** (or after the first review, when no round was needed). Step 6 checks that the review section names the PR's head.

- **A finding marked `property: <the property>` in pr-review's hand-off** (`fix_kind: "property"`: an algorithm's output over many inputs): write a seeded property test of the property its fix names first, see it red, then fix until it is green, not until the reported example passes. Use the repo's property-testing library if it has one, otherwise a seeded loop over generated inputs in the existing test runner. Add no dependency.
- A finding you think is wrong: record it in Decisions with your reason, and leave it.
- **A `needs-person` finding** (pr-review's hand-off lists them under "Needs a person"): fix nothing for it and make no commit for it. Add a Decisions line, "finding <id> needs a person: <option names>", or "finding <id> contradicts the spec's '<quoted line>': not fixed". Run the rounds for the remaining approved findings as usual; with none left, no round is needed.
- **Before fixing any approved finding,** check its fix against the lines the spec settles: its acceptance criteria, Out of scope, Implementation decisions, Decision records, and any "stays unchanged" or ruled-out statement. A fix that would change one is treated as `needs-person`, as above, with that line quoted.
- A `needs-person` finding still open is blocking, like an open major.
- When the rounds end (after round 2, or straight away when no round was needed), anything still blocking, including a `needs-person` finding, makes the spec stuck. Name each blocking item and what you tried.
- Without `unattended`, ask instead of going stuck: for each item still blocking when the rounds end (as above), one question as in step 2, naming the choices (for example a fix you describe, accepting it as is with a note, or leaving the spec stuck) and your recommendation. Record the answer under Decisions as in step 2 ("<item>: decided by the owner: <choice>") and apply it, with no third review round: the two-round cap still holds. An item settled this way counts as closed for step 6; one the owner leaves stuck keeps the spec stuck.

**Reaching the chain:** after a fix round on a spec whose branch a later spec in this chain is built on, merge it into its child, then that child into the next, down the chain:
- `git merge --no-ff --no-commit <parent's branch>` on the child's branch, then `git commit` with the build's message conventions and attribution, then push. Never rebase.
- A conflict: resolve it keeping what both sides meant, then run the child's local checks (step 3) before the push.
- A child already reviewed is reviewed again if the merge changed files in its diff: `pr-review <pr> unattended` in fix-round mode where `pr-review` has one (it falls back to a full review on a range holding a base merge), else a full review. Its findings start the child's next fix round.

### 6. Finish the spec

Skipped for a spec handed back at step 3 (no Agent tool): the caller runs it.

**The head check, first.** Read the PR once (the "Read a PR" row) and take both values from that one read: its head SHA (`.head.sha`) and the head named in its body's review section footer (the `<sub>pr-review · head …` line, which prints a 7-character short SHA). The check passes when that short SHA is a prefix of the head SHA.
- **It fails** (a commit landed after the last review): run `pr-review <pr> unattended` once more, on the current head, and fix nothing. This confirming review isn't a round: it doesn't count toward the two, or toward `rounds` below. Read the PR once more. The spec can be Ready only if that review left no blocker or major open and its footer head is a prefix of the PR's head; otherwise it is stuck, and the Stuck section names the unreviewed commits (`git log --oneline <footer head>..<PR head>`).

**Ready** (the head check passed, or the confirming review came back clean on the head; CI green apart from `ship`, and no blocker or major left open):
- Mark the PR ready.
- Relabel the spec issue `spec:building` → `spec:in-review`.

**Stuck:**
- Leave the PR as a draft, or open one with what exists, if anything was built.
- Add a "Stuck" section to the PR body below Decisions: what blocks, what you tried, and what a person has to decide. For a `needs-person` finding, name the finding, the spec line it contradicts if any, and the choice: keep the spec and accept or document the finding, or change the spec (or pick one of its options).
- Relabel the issue `spec:stuck`.

Either way, copy the spec's **Before ship** and **After merge** items to the top of the PR body, above the opening paragraph (below the `Closes` line), as unchecked boxes under `## Before ship` and `## After merge` headings. They are deferred to a person, so they don't count as unmet criteria for Ready. Leave out a section that reads "None", or that the spec doesn't have.

Then comment on the spec issue with one line for the morning page:

```
<!-- night-shift {"status":"ready|stuck","pr":<n or null>,"reason":"<stuck reason or empty>","decisions":<count>,"rounds":<0-2>} -->
night-shift: <ready for review|stuck>: <PR link>. <one sentence>
```

`rounds` counts fix rounds only, never the confirming review.

A stuck spec stops only the specs whose Depends on names it, directly or through another spec in this chain. Mark each of those stuck, "depends on #N, which is stuck".

A spec stacked on the stuck one without depending on it is built, reviewed and finished as usual, on that branch (on the stuck spec's base if it left no branch). Its PR body and `night-shift` comment say "stacked on stuck #N; lands after it, or retarget".

## 7. End

Clean up the worktrees you made. Your last message lists, per spec: ready, stuck or review pending, the PR link, and the decision count. For each spec handed back at step 3 (no Agent tool), give the PR number and the line "review pending: run build-spec steps 4–6 from a session with the Agent tool".
