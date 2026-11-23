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
- touch another spec's branch, except the one in your own chain you build on

Read first:
1. The project's `CLAUDE.md` (and `AGENTS.md`), `docs/agents/shipping.md`, `docs/agents/issue-tracker.md`. The project's rules apply to you: worktrees, commit email, migrations, docs to update.
2. `${CLAUDE_PLUGIN_ROOT}/references/github.md`, for when `gh` isn't available.

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
- **Decision records first:** if the spec has a "Decision records" section other than "None", commit its ADRs and glossary entries before the first ticket, as the spec's first commit. Give each ADR the next free number on the base branch, and fix references to it in the text. They ship in this PR, never in one of their own.
- **The branch:** what `implement-spec` calls the integration branch is the spec's branch, `spec/<n>-<slug>`, made from the base above.
- **The PR:** it's a **draft**, targeting the base branch. Its body opens with `Closes #<n>` and one paragraph on what it delivers. Below that is the decisions section:

```
<!-- build:decisions:start -->
## Decisions made during the build
- <Choice the spec left open>: <what you chose> — <why, in one line>.
<!-- build:decisions:end -->
```

Append to that section every time you choose something the spec didn't say, and keep it up to date. It's what the reviewer reads to check your judgement.

**A question the spec doesn't answer:** if the answer changes what a user sees or does, or changes data in a way that can't be undone, only a person can settle it. Otherwise, decide and record it.

- **Unattended:** the spec is stuck.
- **Without `unattended`:** ask the user one question (`AskUserQuestion`) naming the choices and which you recommend, and why. Record the answer under Decisions as "<question>: decided by the owner: <choice>", and go on.

**Without the Agent tool:** build `implement-spec`'s tickets one after another in your own context, on the spec branch, instead of in implementer subagents. Record "no Agent tool: tickets built inline" under Decisions. Overrides that describe implementer worktrees, merger subagents or handoff notes don't apply on this path.

Done when every ticket is closed, or one can't be built, which makes the spec stuck.

### 3. Check

Run the local checks `docs/agents/shipping.md` lists, then the project's own pre-push checks.
- Fix failures that are your change's fault.
- If a failure is also present on the base branch, it isn't your change's fault. Record it under Decisions ("pre-existing failure: …") and go on.

Push, then wait for CI on the PR. Wait with the shell's own blocking wait (`gh pr checks <n> --watch`, or a single `until` loop with a timeout). Don't use repeated `sleep` calls. The `ship` status stays pending until a person reviews the PR. That's expected, so never try to make it pass.

**Without the Agent tool**, stop the spec here, once CI has finished: leave the spec `spec:building` and the PR a draft, post no `night-shift` comment, and end with the PR number and "review pending: run build-spec steps 4–6 from a session with the Agent tool". Specs in the chain after it are built the same way, each ending with its own hand-back.

### 4. Review

Run `pr-review` with `<pr> unattended`, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. The Skill tool can't call it. It writes the review section into the PR description and returns the approved findings: the blockers and majors.

### 5. Fix rounds, at most two

Round = fix every approved finding and every red CI check on the branch, push, wait for CI, and run `pr-review <pr> unattended` again.

- A finding you think is wrong: record it in Decisions with your reason, and leave it.
- **A `needs-person` finding** (pr-review's hand-off lists them under "Needs a person"): fix nothing for it and make no commit for it. Add a Decisions line, "finding <id> needs a person: <option names>", or "finding <id> contradicts the spec's '<quoted line>': not fixed". Run the rounds for the remaining approved findings as usual; with none left, no round is needed.
- **Before fixing any approved finding,** check its fix against the lines the spec settles: its acceptance criteria, Out of scope, Implementation decisions, Decision records, and any "stays unchanged" or ruled-out statement. A fix that would change one is treated as `needs-person`, as above, with that line quoted.
- A `needs-person` finding still open after the rounds is blocking, like an open major.
- After round 2, anything still blocking makes the spec stuck. Name each blocking item and what you tried.
- Without `unattended`, ask instead of going stuck: for each item still blocking after round 2, one question as in step 2, naming the choices (for example a fix you describe, accepting it as is with a note, or leaving the spec stuck) and your recommendation. Record the answer under Decisions as in step 2 ("<item>: decided by the owner: <choice>") and apply it, with no third review round: the two-round cap still holds. An item settled this way counts as closed for step 6; one the owner leaves stuck keeps the spec stuck.

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

A stuck spec ends the chain for the specs built on top of it. Mark each of those stuck too, "depends on #N, which is stuck", and stop.

## 7. End

Clean up the worktrees you made. Your last message lists, per spec: ready, stuck or review pending, the PR link, and the decision count. For each spec handed back at step 3 (no Agent tool), give the PR number and the line "review pending: run build-spec steps 4–6 from a session with the Agent tool".
