---
name: land
description: After the morning review, ship what the user approved in one step. Labels the approved PRs `ship`, sends the ones they commented on back to tonight's night shift, resolves waiting conflicts, then starts one landing run. Stacked PRs land in order, each once its parent is in.
disable-model-invocation: true
argument-hint: "[#pr ... | all]  (none: land the PRs already labelled `ship`)"
---

# Land

The user has reviewed last night's PRs. You turn their verdicts into one landing run:

- each PR they approved gets `ship`
- each one they commented on instead goes back to the night shift
- conflicts already waiting are resolved first
- then `ship.yml` lands the batch, once

The `ship` label approves a PR; it doesn't land it. `ship.yml` lands every labelled PR that targets the default branch. A PR stacked on another one (its base is the parent's branch) waits, and `ship.yml` moves it onto the default branch and lands it once its parent merges. So you never merge, retarget or order anything yourself: labelling and one dispatch are the whole landing.

Approval is per PR. Never add `ship` to a PR the user didn't approve, not even the parent of one they did.

You must never:
- merge a PR, or push to the default branch
- add `ship` to a draft, or to a PR without `pr-reviewed`
- change labels other than `ship`, `changes-requested`, `conflicts` (through `resolve-conflicts`) and the spec's `spec:*` label

Read first:
1. `docs/agents/shipping.md`: the default branch, landing mode, stacked PRs and spec labels.
2. `${CLAUDE_PLUGIN_ROOT}/references/github.md`, for when `gh` isn't available.

## 1. Check the workflow

Read the first line of `.github/workflows/ship.yml` on the default branch (`git show origin/<default>:.github/workflows/ship.yml | head -1`).

It must be `# ship.yml version: 2` or later: 2 is the first version where the label approves and a landing run lands, which is all this skill relies on. A newer template doesn't make an installed version 2 unsafe, so don't block on it; mention that `/ship:setup-ship` offers the upgrade. If the file is missing, or has an older version or no version line, stop before changing anything: in that version adding `ship` lands a PR at once and stacked PRs can merge into their parent's branch. Tell the user to run `/ship:setup-ship`, which offers the upgrade.

## 2. Last night's PRs

1. **Specs:** the issues with a `night-shift` comment from the last 24 hours (the JSON comment `build-spec` leaves).
2. **PRs:** the `pr` in each spec's latest `night-shift` comment. For each, read `number, title, isDraft, baseRefName, headRefName, labels, url` and the spec it closes (`Closes #<n>` in its body).
3. **Stacks:** a PR whose base is another open PR's head branch is that PR's child. Note each PR's parent.

## 3. The user's verdicts

Parse the arguments:

- **PR numbers:** the approved PRs. They may include PRs from earlier nights.
- **`all`:** every PR from step 2 that is ready (not a draft) and labelled `pr-reviewed`.
- **Nothing:** approve nothing new, and send nothing back: skip the sort below and step 6. The batch is the PRs already labelled `ship`.

A PR that already carries `ship` is approved, whatever the arguments: the user labelled it by hand.

With arguments, sort last night's PRs that are neither named nor labelled `ship`:

- **Commented:** a review, review comment or PR comment by the user (`gh api user --jq .login`) made after the PR was marked ready (its `ready_for_review` timeline event, or its creation if it was never a draft). This is feedback, so it goes back to the night shift (step 6). The ship tooling posts under the user's login too, so skip its comments: any comment that holds an HTML marker comment (`<!-- … -->`), or that starts like the ones `ship.yml` and `resolve-conflicts` post ("This PR conflicts with", "New commits arrived after", "Resolved:", "## Conflict resolution").
- **Not reviewed yet:** no such comment. Leave it alone and list it at the end.

Refuse, with the reason, any approved PR that is a draft, lacks `pr-reviewed`, or is closed. Leave it out of the batch and go on.

## 4. Conflicts first

Collect every open PR labelled `conflicts`: `ship.yml` took `ship` off each when it added `conflicts`, so they can't be found by `ship`. If there are any, run `resolve-conflicts` with them, as `${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. It puts `ship` back on a PR whose resolution touched only bookkeeping files, and that PR joins the batch.

A PR that resolve-conflicts sent to re-review (a code resolution) or left stuck (still labelled `conflicts`) stays out of this batch, even if it was approved: the resolution is code nobody has reviewed. Step 5 skips it; report it under Waiting.

## 5. Approve

Add `ship` to each approved PR that doesn't have it, except those step 4 held back (`gh api repos/{owner}/{repo}/issues/<n>/labels -f 'labels[]=ship'`).

A child whose parent isn't approved still gets `ship`: it can't land until the parent merges, so the label is safe and records the user's approval. Report it as "waiting on #<parent>, not approved".

## 6. Send back the commented PRs

For each commented PR:

1. Add `changes-requested` to the PR. Remove `ship` if it has it.
2. Relabel its spec `spec:in-review` → `spec:ready`.
3. Comment on the spec:

```
<!-- land {"status":"changes-requested","pr":<n>} -->
land: changes requested on #<pr> (<link to the user's latest review or comment>). Back to `spec:ready` for the next night shift.
```

Its stacked children stay where they are. Report them as "waiting on #<parent>, changes requested".

## 7. Land

Start one landing run, after every label is on, so the whole batch is checked and landed together:

```
gh workflow run ship.yml --ref <default>
```

Then check it started: `gh run list --workflow ship.yml --event workflow_dispatch --limit 1`. If the dispatch fails (no permission, workflow disabled), say so: the PRs keep `ship` and land with the next landing run.

Don't wait for the merges. CI and the stacked cascade can take an hour; `night-shift morning` reports what merged.

## 8. Report

One line per PR, in these groups, each with its link:

- **Landing now:** approved, labelled and targeting the default branch.
- **Landing after its parent:** approved children, with the parent each waits on.
- **Waiting:** a child whose parent isn't approved or got changes requested, and code-conflict resolutions waiting for re-review.
- **Back to tonight's night shift:** the commented PRs, with their specs.
- **Refused:** drafts, PRs without `pr-reviewed`, closed PRs, with the reason.
- **Not reviewed yet:** last night's PRs with neither approval nor comment.

End with the landing run's link.
