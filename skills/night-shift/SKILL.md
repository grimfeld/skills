---
name: night-shift
description: Evening, with the user — slice tonight's spec:ready specs, find conflicts between them, grill the user only on real ones, then start one cloud builder per spec (or per dependent chain). Morning, with `morning` — gather what the night built into one page to review from.
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

1. **List them:** open issues labelled `spec:ready`.
2. **Check for leftovers:** list the `spec:building` and `spec:stuck` issues from earlier nights and show them. A `spec:building` issue whose builder's session has ended is a crashed build: say so. Never rebuild these without the user's say-so.
3. **Slice:** if any spec lacks a "Slicing" section, call the Skill tool with `ship:slice` and `all`. Slicing asks the user about splits and tickets, so it belongs here, while they're present.

Done when every spec to build has a "Slicing" section and tickets.

### 2. Conflicts

Compare every pair of specs on their Touches, Data, Docs to update, Implementation decisions and Depends on. Use a subagent if there are more than four specs. Sort each pair into one of three kinds.

- **Independent:** no shared area. They build in parallel.
- **Ordered:** they share files or areas but don't disagree, for example two specs adding fields to the same form.
  - Chain them: B is built after A, in the same cloud session, on top of A's branch. B's PR targets A's branch.
  - Respect an existing Depends on.
  - When nothing forces an order, put the smaller spec first.
  - Also chain specs that each add a migration or an ADR, so their numbers don't clash.
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
2. **Write the morning page** and publish it as an Artifact, following the Artifact tool's own design guidance. Keep it plain: a list to work through, not a dashboard. On later mornings, republish to the same URL; the URL is saved in `.scratch/night-shift/morning-url`.
   - **Ready:** the PRs to review, smallest first. Each card has the PR link, the verdict line, the risks, and the decisions to check.
   - **Stuck:** what each one needs from the user.
   - **Totals:** what the night produced.
3. **Report in the terminal:** the page link, plus one line per PR, in the order to review them.

The user reviews each PR from its description, and adds `ship` or comments. A comment can be answered with `/ship:build-spec #<n>` the next night, or now.
