---
name: night-shift
description: Evening, with the user — turn designs marked done into specs, slice tonight's spec:ready specs, find conflicts between them, grill the user only on real ones, then start one cloud builder per spec (or per dependent chain). Morning, with `morning` — gather what the night built into one page to review from, then take the user's answers to its decisions.
disable-model-invocation: true
argument-hint: "[morning]"
---

# Night shift

**Evening** (no argument): turn every `spec:ready` spec into a cloud build, so that by morning each spec is a PR that has been reviewed by `pr-review` and is waiting for the user.
You run locally, with the user present. The builds themselves run in Claude Code cloud sessions, one per spec or per chain of dependent specs, each running `/ship:build-spec`.

**Morning** (`morning`): gather the results into one page, then take the user's answers to its decisions.

Before each step, read `docs/agents/shipping.md` and `docs/agents/issue-tracker.md` as `${CLAUDE_PLUGIN_ROOT}/references/project-docs.md` says (fetched, from the default branch, with its defaults for a missing file), and `${CLAUDE_PLUGIN_ROOT}/references/github.md`.

## Evening

### 1. Tonight's specs

0. **The checkout:** after the fetch, report to the user, before planning, if the working tree is behind `origin/<default>` (`git rev-list --count HEAD..origin/<default>`: "local `<branch>` is N commits behind `origin/<default>`") or has uncommitted changes (`git status --porcelain`: list them). The night reads the rules from `origin/<default>` either way, so this is for the user to know, not a reason to stop. Never pull, stash, reset or check out anything: the working tree is theirs.
1. **Designs first:** for each open issue labelled `design:ready`, run `design-me` with `#<n>`, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says (the Skill tool can't call it). It grills the user on the design's open decisions and writes its specs as `spec:ready`. A design the user leaves with questions open keeps `design:ready` and builds nothing tonight.
2. **List them:** open issues labelled `spec:ready`.
3. **Check for leftovers:** list the `spec:building` and `spec:stuck` issues from earlier nights and show them. A `spec:building` issue whose builder's session has ended is a crashed build: say so. Never rebuild these without the user's say-so.
4. **Slice:** if any spec lacks a "Slicing" section, run `slice` with `all`, the same way. Slicing asks the user about splits and tickets, so it belongs here, while they're present.

Done when every spec to build has a "Slicing" section and tickets.

### 2. Conflicts

Compare every pair of specs on their Touches, Data, Docs to update, Implementation decisions and Depends on, always in one subagent, so no whole spec body enters the main context. Its brief: the spec numbers, this step's three kinds below (with the numbering rule and the repo docs it names), and the rows to return:

- one row per pair: the two specs, the kind, and the shared area or the disagreement; for an Ordered pair, which builds first and why (Depends on or size)
- each design place spec to hold, with the Depends on that isn't merged
- for a Conflicting pair, the two conflicting passages verbatim

Work from the rows: grill a Conflicting pair from its two passages. The three kinds:

- **Independent:** no shared area. They build in parallel.
- **Ordered:** they share files or areas but don't disagree, for example two specs adding fields to the same form.
  - Chain them: B is built after A, in the same cloud session, on top of A's branch. B's PR targets A's branch.
  - Respect an existing Depends on.
  - When nothing forces an order, put the smaller spec first.
  - Also chain specs that each add a migration, or each add an ADR, so their numbers don't clash, unless the repo's `docs/agents/shipping.md`, `CLAUDE.md` or `AGENTS.md` names a command that reserves the next number of that kind (lifeline: `adr:new` for ADRs, `migrations:next` or `integrate` for migrations). With one, such specs are Independent unless something else orders them.
  - **Design specs** (those with a "Design" section) chain at most a design's foundation and shell. A place spec whose Depends on isn't merged yet is held: it stays `spec:ready` and builds on a later night, once the user has merged what it depends on. Six places stacked on an unreviewed shell would all need rebasing after its review.
  - Ordering needs no question.
- **Conflicting:** two specs settle the same thing differently. Examples: the same term defined two ways, one field given two meanings, the same screen redesigned twice. These go to the user.
  - Ask them all in one `grilling` round, each with your recommendation.
  - Write the answers into the specs' bodies through a subagent, giving it each spec number, the passage and the answer.
  - If the answer changes a spec's scope, re-run `ship:slice #<n>` for it.

Done when every pair is classified and no conflict is open.

### 3. The night plan

Show the plan and ask for one yes:

- one row per **session**: the spec or chain, in build order, with each spec's estimate
- the builder routine each session goes to
- the model (`claude-opus-5-5` unless `shipping.md` names another)
- for each pair of ADR or migration specs left unchained, the numbering command it relied on
- the cloud environment the builders run in: the "Cloud environment" line of `shipping.md`'s "Night builds" section (`` `env_…` (<name>) ``). With no such line, or "none chosen", list the user's cloud environments (`list_environments` from the Claude Code remote tools) and ask which one tonight's builds run in, recommending the one named like the repository. Say that a `/ship:setup-ship` re-run records it in `shipping.md`. Never fall back to the default environment, and don't write the line yourself: `shipping.md` changes go through setup-ship's PR.

Specs the user wants to hold back stay `spec:ready`.

### 4. Builder routines

Builds run on a fixed **pool** of routines, reused every night: `ship-builder-<repo>-1`, `-2`, and so on. A routine can't be deleted through the API, so never create one per spec.

1. **Find the pool** in a general-purpose subagent, since the full listing carries every routine's prompt. It runs `RemoteTrigger` `list` and returns only this repository's `ship-builder-<repo>-*` routines, one row each with `id`, `name`, `enabled` and the environment ID (its `job_config.ccr.environment_id`), under 2 KB.
   - A pool routine in another environment than the night plan's: `RemoteTrigger` `update` it to that environment before giving it a session, and say so.
2. **Create missing routines,** if the pool is smaller than tonight's session count. Show the user each new routine's configuration first:
   - this repository as `sources`
   - the night plan's cloud environment (step 3)
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

## Where the work happens

In one builder session, the work for a spec happens in these places:
- **The builder:** the cloud session's repo clone, on the `spec/<n>-<slug>` branch (in a worktree if the project's rules say so).
- **Implementers:** `implement-spec` subagents, each in a `.claude/worktrees/agent-…` worktree on its own ticket branch. The branch stays local: the builder merges it into the spec branch inline and pushes only the spec branch.
- **Lens reviewers:** `pr-review`'s subagents, read-only, in the spec branch's tree or in `pr-review`'s `.scratch/pr-review/wt-<id>` worktree.
- **Fix rounds:** the builder itself, on the spec branch.

A subagent's transcript sits under `<session>/subagents/`. Its `meta.json` holds the `toolUseId` of the Agent call that started it, so its work counts toward the spec its parent was on, whatever branch or worktree it ran in. `scripts/token-usage.mjs` relies on this, and on the builder's marks: `build-spec` runs `token-usage.mjs mark <n>` as each spec starts, and the builder marks again when a later turn goes back to a spec. Once a session holds a mark, its messages, and the subagents it starts, count toward the spec of the latest mark, whatever branch is checked out.

## Morning

1. **Collect** every spec with a `night-shift` comment from the last 24 hours.
   - Read the spec's latest `night-shift` JSON comment, its PR, the PR's checks, and the PR's review and Decisions sections.
   - A spec still `spec:building` after its session ended crashed. Read the run log (`RemoteTrigger` `list_runs`, then `get_run_log`) for the cause, then label it `spec:stuck` and comment the cause.
   - **Still building:** a spec whose newest `night-shift` comment since its latest `dispatched` one has no `ready` or `stuck` status, and whose session `list_runs` shows still running (not stopped at the usage limit), is still building, whatever its label. Don't label or comment it. Which state a spec with no `ready` or `stuck` comment is in goes by its session: ended → crashed (above); stopped at the limit → stopped at the limit; still running → still building.
   - **Designs:** close each `design:specced` issue whose sub-issue specs have all closed, with a comment listing their PRs. Name in the report the held place specs that the merges since last night have unblocked.
2. **Cost:** what each spec would have cost at API prices. The builders counted their own tokens into their `night-shift` comments, by model (see `templates/builder-prompt.md`).
   - Build the rows with the script, never by hand: `node ${CLAUDE_SKILL_DIR}/scripts/token-usage.mjs rows --specs <the collected specs, comma-separated> > .scratch/night-shift/tokens.json`. It reads each spec's comments with `gh` and writes one row per spec from its `night-shift` comments after its newest `dispatched` one: the session, the newest `tokens` (and `session_shared`), and `"status": "building"` for a spec still building. Without `gh`, save each spec's comments (`issue_read` `get_comments`) as `.scratch/night-shift/comments/<n>.json` and add `--from .scratch/night-shift/comments`.
   - Run `node ${CLAUDE_SKILL_DIR}/scripts/token-usage.mjs price < .scratch/night-shift/tokens.json`. It applies `scripts/prices.json` and returns, per spec, per session and for the night: `usd`, `out`, `fresh_in` (input + cache writes), `cache_read` and `unpriced` (models with no price, whose tokens are counted but not in `usd`). Sessions and the night also list `not_reported` specs. A spec that never reported is `null`; a `tokens` of `{}` (no models) counts as not reported too. Use its numbers; don't price anything yourself.
3. **Fidelity grids,** for each ready PR whose spec has a "Design" section. The builders' screenshots stayed in their cloud sessions, so take them again here:
   - Check the PR's head out in a worktree, install its dependencies the way `shipping.md` says, and run `node ${CLAUDE_PLUGIN_ROOT}/skills/pr-review/scripts/design-capture.mjs --manifest docs/design/<module>/fidelity.json --out .scratch/night-shift/<pr>-fidelity --places <the spec's places> --root <the package with Playwright>`.
   - Read the PR's `design-fidelity` findings from its review section. The views they name are **flagged**.
   - If a capture fails, say so on the PR's card and go on.
   - Remove the worktree.
4. **Write the morning page** and publish it as an Artifact, following the Artifact tool's own design guidance. Keep it plain: a list to work through, not a dashboard. On later mornings, and on a second run the same morning, republish to the same URL; the URL is saved in `.scratch/night-shift/morning-url`.
   - **Header line,** when any spec is still building: "N specs still building; run `/ship:night-shift morning` again to update this page".
   - **Ready:** the PRs to review, smallest first. Each card has the PR link, the verdict line, the risks, and the decisions to check. Show the `ship` status as "awaiting your `ship` label", apart from the CI checks: it waits on the user by design. A stacked PR (its base is another PR's branch) sits under its parent's card, whatever its size, marked "lands after #<parent>", so the order is visible before approving.
   - **Design PRs** add their fidelity grid: per place, reference beside app for each look × theme × viewport. Flagged views are shown full size with their finding; the rest are thumbnails. Upload the PNGs as the page's assets (the `assets` capability) and reference each by the URL the upload returns.
   - **Stuck:** what each one needs from the user. A PR stacked on a stuck spec it doesn't depend on sits under that card, with its note "stacked on stuck #N; lands after it, or retarget".
   - **Still building,** after Ready and Stuck, left out when empty: one card per session still running, with its session link, its specs in chain order, each with its state (ready, with its PR link; building; waiting), and "cost not reported yet". A chain's finished specs keep their Ready or Stuck cards too, noting "session still running".
   - **Answer lines:** each Stuck card, and each decision to check on a Ready card, ends with one line: "Answer: tell Claude in the morning session (`#<pr>: <choice>`)", with the PR link beside it for reading. A stuck spec with no PR uses its spec number and links the spec issue. A card with several decisions has one line per decision, each naming its decision (`#<pr> <decision>: <choice>`); a card with none has no answer line.
   - **Cost line:** every Ready and Stuck card ends with one line, "≈ $4.20 at API prices · 310k out · 1.2M in · 48M cache read".
     - A spec that is `null` gets "cost not reported" instead, never a partial figure.
     - A spec with `unpriced` models adds "+ <model> (no price)" after the dollar figure.
   - **Totals:** the night's cost and a small table with one row per session (its specs, the shared bucket and the session total), with no other rows. Under them go only the notes below.
     - A session or night with `not_reported` specs reads "at least ≈ $X (N not reported: #…)", never a plain total.
     - Still-building specs (`"status": "building"` in `tokens.json`) aren't "not reported": a session or night with them reads "at least ≈ $X (N still building: #…)", alongside any not-reported note.
     - Name every model in the night's `unpriced`: its tokens are counted but not priced, and `scripts/prices.json` needs an entry for it.
     - Footnote: the figures are API-price estimates, not a bill, and builder turns after the last count are missing.
   - **Next:** the command that ships what the user approves: `/ship:land <ready PRs, in review order>`, to cut down to the ones they approve. It never names a still-building spec's PR. A PR left out isn't landed; to have it rebuilt, send it back as `docs/agents/shipping.md`'s Spec labels section says.
5. **Link the page from each spec.** Once the page is published, post one comment on each spec collected in step 1 that isn't still building, so anything reading GitHub (the ship dashboard, a person on the spec) can find it:

   ```
   <!-- ship:morning-page -->
   Reviewed on this morning's page: <page URL>
   ```

   Post a new comment every morning, even on a spec that already has one: the newest is the current link. Post with the "Comment" row of `${CLAUDE_PLUGIN_ROOT}/references/github.md` (its GitHub MCP column, `add_issue_comment`, where there is no `gh`). If a comment fails, name the spec in the report and go on.
6. **Report in the terminal:** the page link, one line per PR in the order to review them (children under their parent), the specs still building with "run `/ship:night-shift morning` again to update the page", one line with the night's cost, worded as on the page, any spec whose morning-page comment failed (step 5), and the same `/ship:land` line. End with the open decisions and stuck specs, and "Answer here as `#<pr>: <choice>`, naming the decision when a PR has several."
7. **Take answers.** Stay in the terminal for the user's answers, given as `#<pr>: <choice>` or `#<pr> <decision>: <choice>` (`#<spec>` for a stuck spec with no PR). Match each to the decision it settles; ask when that isn't clear. For each:
   - Comment it on the PR ("Morning answer to <decision>: <choice>"), so the choice is on record where the reviewer looks. For a stuck spec, comment it on the spec issue too (only there when it has no PR), where the next build reads it.
   - Keep a ready PR in the `/ship:land` line when the choice is what it built. Send it back, as `shipping.md`'s Spec labels section says, when the choice differs from what it built or the user says so. A stuck spec's PR is never in the line: its answered spec goes back to `spec:ready` for the next night.
   - Reprint the `/ship:land` line.

   Done when the user says they're finished.

The user reviews each PR from its description and comments, then runs `/ship:land` with the PRs they approve. Adding `ship` by hand approves a PR; `/ship:land` lands every PR carrying it.
