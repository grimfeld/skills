---
name: night-shift
description: Evening, with the user — turn designs marked done into specs, slice tonight's spec:ready specs, find conflicts between them, grill the user only on real ones, then start one cloud builder per spec (or per dependent chain). Morning, with `morning` — gather what the night built into one page to review from.
disable-model-invocation: true
argument-hint: "[morning]"
---

# Night shift

**Evening** (no argument): turn every `spec:ready` spec into a cloud build, so that by morning each spec is a PR that has been reviewed by `pr-review` and is waiting for the user.
You run locally, with the user present. The builds themselves run in Claude Code cloud sessions, one per spec or per chain of dependent specs, each running `/ship:build-spec`.

**Morning** (`morning`): gather the results into one page.

Before each step, read `docs/agents/shipping.md`, `docs/agents/issue-tracker.md` and `${CLAUDE_PLUGIN_ROOT}/references/github.md`.

## Evening

### 1. Tonight's specs

1. **Designs first:** for each open issue labelled `design:ready`, run `design-me` with `#<n>`, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says (the Skill tool can't call it). It grills the user on the design's open decisions and writes its specs as `spec:ready`. A design the user leaves with questions open keeps `design:ready` and builds nothing tonight.
2. **List them:** open issues labelled `spec:ready`.
3. **Check for leftovers:** list the `spec:building` and `spec:stuck` issues from earlier nights and show them. A `spec:building` issue whose builder's session has ended is a crashed build: say so. Never rebuild these without the user's say-so.
4. **Slice:** if any spec lacks a "Slicing" section, run `slice` with `all`, the same way. Slicing asks the user about splits and tickets, so it belongs here, while they're present.

Done when every spec to build has a "Slicing" section and tickets.

### 2. Conflicts

Compare every pair of specs on their Touches, Data, Docs to update, Implementation decisions and Depends on. Use a subagent if there are more than four specs. Sort each pair into one of three kinds.

- **Independent:** no shared area. They build in parallel.
- **Ordered:** they share files or areas but don't disagree, for example two specs adding fields to the same form.
  - Chain them: B is built after A, in the same cloud session, on top of A's branch. B's PR targets A's branch.
  - Respect an existing Depends on.
  - When nothing forces an order, put the smaller spec first.
  - Also chain specs that each add a migration or an ADR, so their numbers don't clash.
  - **Design specs** (those with a "Design" section) chain at most a design's foundation and shell. A place spec whose Depends on isn't merged yet is held: it stays `spec:ready` and builds on a later night, once the user has merged what it depends on. Six places stacked on an unreviewed shell would all need rebasing after its review.
  - Ordering needs no question.
- **Conflicting:** two specs settle the same thing differently. Examples: the same term defined two ways, one field given two meanings, the same screen redesigned twice. These go to the user.
  - Ask them all in one `grilling` round, each with your recommendation.
  - Write the answers into the specs' bodies.
  - If the answer changes a spec's scope, re-run `ship:slice #<n>` for it.

Done when every pair is classified and no conflict is open.

### 3. The night plan

Show the plan and ask for one yes:

- one row per **session**: the spec or chain, in build order, with each spec's estimate
- the builder routine each session goes to
- the model (`claude-opus-5-5` unless `shipping.md` names another)

Specs the user wants to hold back stay `spec:ready`.

### 4. Builder routines

Builds run on a fixed **pool** of routines, reused every night: `ship-builder-<repo>-1`, `-2`, and so on. A routine can't be deleted through the API, so never create one per spec.

1. **Find the pool.** List the routines (`RemoteTrigger` `list`) and keep the ones with this repository's pool name.
2. **Create missing routines,** if the pool is smaller than tonight's session count. Show the user each new routine's configuration first:
   - this repository as `sources`
   - the default cloud environment
   - the model
   - `allowed_tools`: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill`, `Agent`, `ToolSearch`, `WebFetch`
   - `enabled: false`, so it never fires on its own
   - `enabled_plugins: ["ship@grimfeld"]` and `extra_marketplaces` pointing at `grimfeld/skills`. If the API refuses these fields, drop them: the environment's setup script installs the plugin instead.

   Then create it with `RemoteTrigger` `create`, using a `run_once_at` an hour ahead (the API requires one schedule) and `enabled: false`.
3. **Give each session its prompt and start it.**
   - Update the routine's `job_config.ccr.events` with tonight's prompt, built from `templates/builder-prompt.md` in `${CLAUDE_SKILL_DIR}`, with a fresh event `uuid`.
   - Start it with `RemoteTrigger` `run`. One routine runs one session.
4. **Check each session started:** `list_runs` should show a new run. Then comment on each spec:

```
<!-- night-shift {"status":"dispatched","routine":"<id>","session":"<id>"} -->
night-shift: building tonight in <session link>.
```

`build-spec` relabels the specs `spec:building` itself, once its session has started.

### 5. Hand off

Tell the user:
- what's building, and where
- that `/ship:night-shift morning` gathers the results

## Morning

1. **Collect** every spec with a `night-shift` comment from the last 24 hours.
   - Read the spec's latest `night-shift` JSON comment, its PR, the PR's checks, and the PR's review and Decisions sections.
   - A spec still `spec:building` after its session ended crashed. Read the run log (`RemoteTrigger` `list_runs`, then `get_run_log`) for the cause, then label it `spec:stuck` and comment the cause.
   - **Designs:** close each `design:specced` issue whose sub-issue specs have all closed, with a comment listing their PRs. Name in the report the held place specs that the merges since last night have unblocked.
2. **Fidelity grids,** for each ready PR whose spec has a "Design" section. The builders' screenshots stayed in their cloud sessions, so take them again here:
   - Check the PR's head out in a worktree, install its dependencies the way `shipping.md` says, and run `node ${CLAUDE_PLUGIN_ROOT}/skills/pr-review/scripts/design-capture.mjs --manifest docs/design/<module>/fidelity.json --out .scratch/night-shift/<pr>-fidelity --places <the spec's places> --root <the package with Playwright>`.
   - Read the PR's `design-fidelity` findings from its review section. The views they name are **flagged**.
   - If a capture fails, say so on the PR's card and go on.
   - Remove the worktree.
3. **Write the morning page** and publish it as an Artifact, following the Artifact tool's own design guidance. Keep it plain: a list to work through, not a dashboard. On later mornings, republish to the same URL; the URL is saved in `.scratch/night-shift/morning-url`.
   - **Ready:** the PRs to review, smallest first. Each card has the PR link, the verdict line, the risks, and the decisions to check. A stacked PR (its base is another PR's branch) sits under its parent's card, whatever its size, marked "lands after #<parent>", so the order is visible before approving.
   - **Design PRs** add their fidelity grid: per place, reference beside app for each look × theme × viewport. Flagged views are shown full size with their finding; the rest are thumbnails. Upload the PNGs as the page's assets (the `assets` capability) and reference each by the URL the upload returns.
   - **Stuck:** what each one needs from the user.
   - **Totals:** what the night produced.
   - **Next:** the command that ships what the user approves: `/ship:land <ready PRs, in review order>`, to cut down to the ones they approve. A PR left with a comment instead goes back to `spec:ready` for tonight's night shift.
4. **Report in the terminal:** the page link, one line per PR in the order to review them (children under their parent), and the same `/ship:land` line.

The user reviews each PR from its description, approving it or leaving a comment, then runs `/ship:land` with the PRs they approve. Adding `ship` by hand approves a PR but doesn't land it; `/ship:land` with no arguments, or the landing schedule, does.
