# Shipping

How work gets from a branch to main in this repository. Written by `/ship:setup-ship`; the
`ship` plugin's skills (`pr-review`, `night-shift`) read it. Keep it true when the process changes.

## The rule

A PR reaches `main` only after a person has reviewed it and added the **`ship`** label.
Nothing else merges: the `ship` commit status is required by the ruleset on `main`, and it stays
pending until the label is on.

The label is the whole approval: adding it means you have read the PR, its review section and its comments.
`/ship:land` then merges every `ship` PR without asking anything more.

1. An agent opens the PR as a **draft** while it works.
2. It marks the PR ready only when local checks pass, `/ship:pr-review` has run (label `pr-reviewed`) and the
   review section is in the description.
3. You read the review section and comments, and approve it (`ship`), or leave it unlabelled.
4. `/ship:land` lands every PR carrying `ship`. `/ship:land <pr>...` adds `ship` to the PRs you name first.

Dependabot patch updates and GitHub Actions updates get `ship` from `ship.yml` and land with the next `/ship:land`.

The label approves the PR, not a commit: pushes after it land with it. Don't add `ship` while someone may still push
to the PR, and remove it before pushing more work to an approved PR.

## Landing

`/ship:land` is an agent, run when you start it. `ship.yml` lands nothing:
its `gate` job only sets the required `ship` status.

For each open, non-draft PR carrying `ship`, parents before the PRs stacked on them, the agent:

1. merges `main` into it (a merge commit, never a rebase or a force-push), resolves any conflict, and pushes;
2. waits for its checks;
3. merges it into `main` with the merge method below;
4. retargets the PRs stacked on it to `main` and lands them the same way, in the same run.

When it can't land a PR (a conflict whose sides contradict, a red check, a merge GitHub refuses), it leaves that
PR unmerged with a comment saying why, keeps `ship` on, and lands the rest. The PRs stacked on it wait. It ends with one line per PR.

- **Merge method:** merge

## Stacked PRs

A PR built on top of another one targets that PR's branch, not `main`. It can carry `ship`: `/ship:land`
lands it right after its parent. If the parent doesn't carry `ship`, the child waits for it.

## Conflicts

When merging `main` into an approved PR conflicts, `/ship:land` resolves it: it reads what each side meant from the
PRs and specs behind the conflicting commits, keeps both, runs the local checks (see Checks) and pushes. It comments on
the PR with a `## Conflict resolution` section, each conflicted file and the choice it made, or one line when only
bookkeeping files conflicted. `ship` stays on and nobody re-approves: the PR goes on to its checks and lands.

It stops only when the two sides contradict each other, changing the same behaviour in incompatible ways. Then it
pushes nothing, keeps `ship`, and comments naming the decision to make; the PRs stacked on it wait. Settle it on the
branch (merge `main` into it and push), and the next `/ship:land` lands it.

Bookkeeping files (a conflict only in these is mechanical):

- `README.md`

## Checks

Required on `main`: no CI checks (the repository has no CI yet), and `ship`.

Run locally before marking a PR ready: `claude plugin validate .`

## After merge

Nothing deploys on merge. Plugin users pick up `main` through the `grimfeld` marketplace on their next plugin update.

## Screens

Command that produces screenshots of the screens a change touches, for the review section: none

## Spec labels

Specs are GitHub issues moving through `spec:draft` → `spec:ready` → `spec:building` → `spec:in-review`, or
`spec:stuck`, and close when their PR ships. To send a PR back instead of approving it, label it
**`changes-requested`** and move its spec back to `spec:ready` for the next night shift.

## Design labels

A design is a GitHub issue carrying a Claude Design artifact link. Label it `design:ready` when the design is
settled; `/ship:design-me` turns it into specs and relabels it `design:specced`. Its handoffs are committed under
`docs/design/<module>/` by the PRs that build them. To revise a design, relabel its issue `design:ready`.
