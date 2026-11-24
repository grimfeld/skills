---
name: slice
description: Size a spec:ready spec and cut it so each PR it produces takes about ten minutes to review. Keep it as one spec, or split it into specs that ship on their own (with the user's OK), then break each into tickets that are built as local commits on one branch. Run on one spec, or on every spec:ready spec.
disable-model-invocation: true
argument-hint: "#<issue> | all"
---

# Slice

The rule: **one spec, one PR, about ten minutes to review.** The reviewer reads the PR's review section (what changes, risks, findings), not the diff. So the limit is how much behaviour one person can judge in ten minutes, not how many lines change.

Tickets are how the builder breaks the work up. They become commits on the spec's branch, never PRs of their own.

Read the project's `docs/agents/issue-tracker.md` (how issues are created, edited and linked here) and `docs/agents/shipping.md` (a **review budget**, if the project sets one) as `${CLAUDE_PLUGIN_ROOT}/references/project-docs.md` says: from the default branch, with its defaults for a missing file. Reach GitHub through the rows of `${CLAUDE_PLUGIN_ROOT}/references/github.md`.

## 1. Pick the specs

- `#<n>`: that issue. It must be labelled `spec:ready`. If it isn't, stop and say why. A `spec:draft` goes back to `/ship:spec-me #<n>`. If it is labelled `bug`, stop: a bug is one PR with no tickets, built by `/ship:fix-me #<n>`. A `bug` issue that also carries `bug:specced` is a spec (fix-me found it too big): slice it.
- `all`: every open `spec:ready` issue without a "Slicing" section, leaving out bugs (as above).

## 2. Estimate

For each spec, from its Touches, Data, UI states and acceptance criteria:

1. **Explore** the areas it touches with a subagent, enough to know what exists and what must be built.
2. **Find prior art.** Look for two or three merged PRs that did something similar in the same areas: the "Search merged PRs" row of `${CLAUDE_PLUGIN_ROOT}/references/github.md` with the area words, then each PR's additions, deletions and files one at a time (a list query with additions can hit GitHub's size limit).
3. **Estimate** in **reviewable lines**: the hand-written lines changed, excluding tests, lockfiles, generated files, snapshots and docs. Give a range, and say which PR it is based on.
4. **Count the distinct behaviours** a reviewer has to judge: one per acceptance-criteria group that a user would notice separately.

The budget is the project's review budget, or else **about 500 reviewable lines and at most three behaviours, all in one area of the product**.

Done when each spec has a range, its prior art and a behaviour count.

## 3. Decide

- **Within budget:** keep it as one spec.
- **Over budget, or spanning unrelated areas:** propose a split into specs that each ship on their own and are each useful (or at least harmless) on their own.
  - Split by user-visible behaviour, never by layer. Don't split into "the schema PR, then the UI PR".
  - When one part is needed by the others (a new field, a shared component), it becomes the first spec, and the others list it under **Depends on**.
  - A part that must not reach users yet ships behind the project's flag, or a hidden route, named in the spec.

Show every decision in one message: per spec, the estimate, its basis, and keep or split. For each proposed split, show the new specs' titles, their acceptance criteria and their Depends on.
Ask for one yes, or for changes. A split happens only on a yes. Keeping a spec as it is needs no approval.

## 4. Write it down

**Kept spec:** append a "Slicing" section to the issue body, below the marker line:

```
## Slicing

- **Estimate:** ~<range> reviewable lines, <k> behaviours (basis: #<prior PR>, #<prior PR>)
- **Decision:** one PR
- **Depends on:** #<spec> | none
```

**Split spec:** create the new specs.

1. Create one issue per part.
   - Copy the parent's template sections, narrowed to the part.
   - Each part gets its own acceptance criteria, Touches and Data.
   - Each Decision record goes to the first part that relies on it, so it ships once.
   - Add a Depends on line where it applies.
   - Label each one `spec:ready`.
   - Link each one as a sub-issue of the parent, using the tracker doc's operation.
2. Give the parent a "Slicing" section listing its parts.
3. Remove the parent's `spec:ready` label, so the night shift builds the parts instead. Leave the parent open: it closes when its last part ships.

## 5. Tickets

For each spec that will be built, kept or new, run `to-tickets` on its issue, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. The Skill tool can't call it.

- Tickets are tracer-bullet vertical slices with blocking edges, published as sub-issues. That's what `implement-spec` reads.
- `to-tickets` asks the user to approve the breakdown, which is fine here: slicing happens while the user is present.
- Tell `to-tickets` to apply no triage label (no `ready-for-agent`): ship tracks work by the spec's `spec:*` label, and the repo may not have that label.
- When it's done, add a "Tickets" line to the spec's Slicing section listing them in order.

## 6. Report

Print one table, with one row per spec built tonight:

| Column | What goes in it |
|---|---|
| Issue | the spec |
| Estimate | reviewable lines |
| Behaviours | how many |
| Tickets | how many |
| Depends on | the spec it waits for, or none |

Then list the parents that were split, and anything the user asked to change.
