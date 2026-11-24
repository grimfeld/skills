---
name: day-shift
description: While you work, propose the small spec:ready specs nobody has dispatched, build the ones you approve in the night shift's cloud builders, and report each PR as it becomes ready to test and land. One pass per run; `/loop /ship:day-shift` repeats it. Never runs while a night build does.
disable-model-invocation: true
argument-hint: "[#<spec> ...]  (named specs skip the proposal and build whatever their size)"
---

# Day shift

You run locally, in the user's own session, while they work. Each run is one **pass**: check the night shift isn't building, report the day builds that finished, dispatch what's queued, propose new small specs, and dispatch the ones the user approves. `/loop /ship:day-shift` (self-paced) repeats it; stopping the loop or closing the session pauses the day shift. Builds already dispatched finish in the cloud, and their reports wait for the next pass.

Builds run unattended in the night shift's builder routines, with the same builder prompt and `/ship:build-spec … unattended`. Big features stay with the night shift.

You must never:
- build or dispatch a spec without the user's yes in this session (or their naming it in the arguments)
- add the `ship` label, merge a PR, or land anything: day PRs land as every PR does, with `ship` and then `/ship:land`
- dispatch while a night build is `spec:building`, or once today's evening run has dispatched

Before each pass, read `docs/agents/shipping.md` and `docs/agents/issue-tracker.md` as `${CLAUDE_PLUGIN_ROOT}/references/project-docs.md` says (fetched, from the default branch, with its defaults for a missing file), and `${CLAUDE_PLUGIN_ROOT}/references/github.md`.

## The script

`node ${CLAUDE_SKILL_DIR}/scripts/day-shift.mjs` holds the rules, so the passes don't re-derive them. Use its output; don't classify or decide the exclusion yourself.

- `thresholds < shipping.md`: the limits from `shipping.md`'s `Day shift: ≤<lines> lines, <k> behaviour(s)` and `Day shift builders: <n>` lines (defaults: ≤200 lines, 1 behaviour; 2 builders). Name any `warnings` it prints to the user once per session.
- `classify --shipping <shipping.md> --declined .scratch/day-shift/declined.json < specs.json`: `small` (to propose), `tonight` (left for tonight), `dispatched` (a dispatch under an hour old) and `declined` (said no to today). A sliced spec is judged from slice's Estimate (its upper bound), an unsliced one from spec-me's Size section saying one small PR.
- `exclusion --side day < specs.json`: `{blocked, reason, specs}`.
- `declined add <n>…` / `declined list`: the day's declines in `.scratch/day-shift/declined.json`, reset when the date changes. The file is local and never committed: make sure `.scratch/` is ignored (`git check-ignore -q .scratch`, else append `.scratch/` to `.git/info/exclude`).

`specs.json` is an array of `{number, title, labels, body, comments}`, with only the `night-shift` comments: `gh api --paginate repos/{owner}/{repo}/issues/<n>/comments --jq '[.[] | select(.body | startswith("<!-- night-shift ")) | {body, created_at}]'`.

## A pass

Keep, for the session, the list of **its builds** (spec, PR once there is one, routine, session, chain) and its **queue** of approved specs waiting for a builder. A new session starts both empty and takes as its builds every spec whose latest dispatch comment carries `"shift":"day"` and was made today.

### 1. Night shift

Write `.scratch/day-shift/specs.json` from the `spec:building` issues and every spec issue updated since local midnight (`search/issues` with `is:issue label:spec:* updated:>=<date>`, or each `spec:*` label's listing), then run `exclusion --side day`.

Blocked: print "Night shift is building (#…); not dispatching" (or "Tonight's evening run has dispatched (#…); not dispatching") with the next wake time. Report your own builds (step 2) and skip steps 3–5.

### 2. Its builds

For each of its builds, read the spec's labels and its latest `night-shift` status comment:

- **`spec:in-review` (ready), not reported yet:** one terminal message, then one `PushNotification`, "#<pr> ready: <spec title>". The message carries:
  - the PR link
  - the verdict line, the risks and the decisions to check, from the PR body's `/ship:pr-review` and `build:decisions` sections, as the morning page's Ready card shows them
  - a cost line worded as on the morning page ("≈ $4.20 at API prices · 310k out · 1.2M in · 48M cache read"): write `[{"spec": <n>, "session": "<its session>", "tokens": <the status comment's tokens, or null>}]` to `.scratch/day-shift/tokens.json` and run `node ${CLAUDE_PLUGIN_ROOT}/skills/night-shift/scripts/token-usage.mjs price < .scratch/day-shift/tokens.json`. A spec with no tokens yet reads "cost not reported".
  - `/ship:land #<pr>`, to run once they've tried it

  Mark it reported and drop it from its builds.
- **`spec:stuck`:** print the spec, its PR and the stuck reason once, and drop it from its builds. Its PR body's Stuck section says what a person has to decide.
- **`spec:building` after its session has ended:** a crashed build. Read the cause from the run log (`RemoteTrigger` `list_runs`, then `get_run_log`), label it `spec:stuck`, comment the cause on the spec, and report it as stuck.
- **Still building:** nothing to report.

### 3. The queue

Count the builders in flight: its builds still `spec:building`, one per session (a chain counts once). While fewer than `Day shift builders`, take the next queued spec (or chain) to step 5. When the queue still holds specs, print "N approved specs waiting for a free builder".

### 4. Proposals

**Named specs** (`/ship:day-shift #a #b`): no proposal. Each named spec must be `spec:ready`; refuse any other with the reason ("#a is `spec:building`"). The rest are approved whatever their size.

**Otherwise:** list the open `spec:ready` issues into `specs.json` and run `classify`.
- **Nothing to do:** no `small` spec: print "No small spec ready; N left for tonight (#…)" with the next wake time.
- **Proposal:** one row per `small` spec (number, title, estimate), then the `tonight` specs as one compact line, "Left for tonight: #… (N)", however many. Then ask, with `AskUserQuestion` (up to four specs per call), yes or no for each `small` spec. Dispatch nothing without a yes.
  - A no: `declined add <n>`. It isn't proposed again today, and is tomorrow.
  - A yes: approved.

**Slicing an approved spec.** A spec with no "Slicing" section is sliced now, before it's queued: run `slice` with `#<n>` as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says (the Skill tool can't call it), with its questions and ticket approval, in this session. If slice splits it, run `classify` on the parts: the parts still `small` are approved; the rest are reported as left for tonight and stay `spec:ready`. A named spec's parts are all approved.

**Overlap.** Compare the approved specs with each other and with its builds still `spec:building`, as `/ship:night-shift`'s Conflicts step does (one subagent, the three kinds, the same rows). Ordered specs are chained in one builder, in the order that step gives; a spec ordered after one of its builds still building waits in the queue until that build is ready. A real conflict is put to the user in this pass, with your recommendation, and the answer written into the specs as that step says. Queue the approved specs, then run step 3 again.

### 5. Dispatch

Dispatch on the night shift's builder pool, as `/ship:night-shift`'s Builder routines step (step 4) does, reading `${CLAUDE_PLUGIN_ROOT}/skills/night-shift/SKILL.md` for it:
- **The environment** is `shipping.md`'s "Cloud environment" line. With none, ask which of the user's cloud environments the builds run in, as the night plan does, once per session.
- **The model** is the night shift's (`claude-opus-5-5` unless `shipping.md` names another).
- **Find the pool** in a subagent, as it does. Use a routine none of its builds is running on.
- **Pool smaller than needed:** show the configuration of each routine to create, as that step does, and create them only after the user's yes. Without it, the specs stay queued.
- **The prompt** is `${CLAUDE_PLUGIN_ROOT}/skills/night-shift/templates/builder-prompt.md`, with `{{SPECS}}` the spec or chain and `{{RESUME}}` empty, and a fresh event `uuid`.
- **Start it** with `RemoteTrigger` `run`, check `list_runs` shows a new run, then comment on each spec:

```
<!-- night-shift {"status":"dispatched","shift":"day","routine":"<id>","session":"<id>"} -->
night-shift: building now (day shift) in <session link>.
```

Add it to its builds. `build-spec` relabels the spec `spec:building` once its session starts.

**GitHub unreachable, or a dispatch failing:** say which spec and what failed, dispatch nothing more this pass, and keep the rest queued. The next pass tries again.

### 6. Next wake-up

End the pass with one line: what was dispatched, reported or queued, and the next wake time. Under `/loop`, schedule the next pass with `ScheduleWakeup` (prompt `/ship:day-shift`, without spec numbers): about 5 minutes ahead while one of its builds is `spec:building`, about an hour ahead otherwise. Run without `/loop`, say that `/loop /ship:day-shift` keeps it going.
