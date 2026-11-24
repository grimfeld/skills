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

Run the local checks `docs/agents/shipping.md` lists, then the project's own pre-push checks.
- Fix failures that are your change's fault.
- If a failure is also present on the base branch, it isn't your change's fault. Record it under Decisions ("pre-existing failure: …") and go on.

Push, then wait for CI on the PR with the "Wait for a PR's checks" row of `${CLAUDE_PLUGIN_ROOT}/references/github.md`: one blocking REST loop with a 30-minute timeout, or its GitHub MCP column where there is no `gh`. Don't use repeated `sleep` calls. A timeout means the checks are still pending, not green: record it under Decisions ("CI still pending after 30 minutes: <checks>") and go on. The `ship` status stays pending until a person reviews the PR. That's expected, so never try to make it pass.

**Without the Agent tool**, stop the spec here, once CI has finished: leave the spec `spec:building` and the PR a draft, post no `night-shift` comment, and end with the PR number and "review pending: run build-spec steps 4–6 from a session with the Agent tool". Specs in the chain after it are built the same way, each ending with its own hand-back.

### 4. Review

Run `pr-review` with `<pr> unattended`, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. The Skill tool can't call it. It writes the review section into the PR description and returns the approved findings: the blockers and majors.

### 5. Fix rounds, at most two

Round = fix every approved finding and every red CI check on the branch, push, wait for CI, and run `pr-review <pr> fix-round unattended`: it re-checks the approved findings and the fix diff, not the whole PR. No full review runs after the last round: the first full review plus the fix-round reviews cover the final head.

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

**Ready** (CI green apart from `ship`, and no blocker or major left open):
- Mark the PR ready.
- Relabel the spec issue `spec:building` → `spec:in-review`.

**Stuck:**
- Leave the PR as a draft, or open one with what exists, if anything was built.
- Add a "Stuck" section to the PR body below Decisions: what blocks, what you tried, and what a person has to decide. For a `needs-person` finding, name the finding, the spec line it contradicts if any, and the choice: keep the spec and accept or document the finding, or change the spec (or pick one of its options).
- Relabel the issue `spec:stuck`.

Either way, comment on the spec issue with one line for the morning page:

```
<!-- night-shift {"status":"ready|stuck","pr":<n or null>,"reason":"<stuck reason or empty>","decisions":<count>,"rounds":<0-2>} -->
night-shift: <ready for review|stuck>: <PR link>. <one sentence>
```

A stuck spec stops only the specs whose Depends on names it, directly or through another spec in this chain. Mark each of those stuck, "depends on #N, which is stuck".

A spec stacked on the stuck one without depending on it is built, reviewed and finished as usual, on that branch (on the stuck spec's base if it left no branch). Its PR body and `night-shift` comment say "stacked on stuck #N; lands after it, or retarget".

## 7. End

Clean up the worktrees you made. Your last message lists, per spec: ready, stuck or review pending, the PR link, and the decision count. For each spec handed back at step 3 (no Agent tool), give the PR number and the line "review pending: run build-spec steps 4–6 from a session with the Agent tool".
