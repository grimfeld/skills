---
name: resolve-conflicts
description: Resolve the merge conflicts of PRs the Ship workflow took out of the landing queue (label `conflicts`), then send each back to the queue or to a person for re-review.
disable-model-invocation: true
argument-hint: "[#pr ...]  (default: every open PR labelled `conflicts`)"
---

# Resolve conflicts

The Ship workflow's `queue` job removes `ship` from a PR that conflicts with the default branch, adds `conflicts`, and comments with the conflicting files. You merge the default branch into each such PR, keeping what **both sides** meant, and hand it back:

- **Bookkeeping only:** every conflicted file is on the project's bookkeeping list. The PR goes straight back into the queue.
- **Code:** a person re-reviews the resolution before it ships.

You may be running with a person present or in a scheduled session with nobody to ask. Either way, decide what you can, record it in the PR comment, and mark a PR **stuck** only where step 4 says to.

You work only on the PR branches you were given. Push with a plain `git push`, never forced. Change no labels other than `conflicts` and `ship`. Merge nothing yourself.

Read first:
1. `docs/agents/shipping.md`: the default branch, the local checks, and the **Bookkeeping files** list in its Conflicts section.
2. The project's `CLAUDE.md` (and `AGENTS.md`): worktree and commit-email rules apply to you.
3. `${CLAUDE_PLUGIN_ROOT}/references/github.md`, for when `gh` isn't available.

## For each PR

### 1. Pick up

- **The PRs:** the ones passed as arguments, or `gh pr list --label conflicts --state open`.
- **Skip** a PR that's a draft, from a fork, or whose head you can't push to. Report it.
- **Read** its description and the `conflicts` comment.

### 2. Merge

In a worktree on the PR's head branch (the project's worktree command if it has one), run `git fetch origin` and then `git merge origin/<default>`.

- Use a merge, never a rebase. The reviewed commits stay as they are, and the push needs no force.
- If the merge is clean, the default branch already moved past the conflict. Push it and go to step 6 as bookkeeping only.

### 3. Learn both sides

For each conflicted file (`git diff --name-only --diff-filter=U`), find out what each side wanted:

- **The default branch's side:** `git log origin/<default> ^$(git merge-base HEAD origin/<default>) -- <file>`, plus the PRs those commits came from (`gh pr list --state merged --search <sha>`). Read their descriptions.
- **The PR's side:** its description, and its own commits on the file.

Done when you can state, for every conflicted hunk, what each side changed and why.

### 4. Resolve

Rewrite each conflicted hunk so it does what **both** sides meant. Usually that means:
- keeping both additions
- applying the PR's change to the default branch's new version of the code
- renaming to match a rename that landed

**Stuck:** if the PR's intent and the default branch's intent contradict each other, so that keeping one undoes the other, that's a design decision, not a conflict resolution. For example, both rewrote the same behaviour differently, or one deleted what the other extends. Go to step 7.

Then:
- Follow the project's own rules for numbered files, such as ADRs and migrations, when both sides added one.
- Update code the PR adds that calls something the default branch changed, even outside the conflicted files.

Done when:
- `git diff --name-only --diff-filter=U` is empty
- `git diff --check` reports no conflict markers
- the merge is committed with the default message plus one line per conflicted file saying how it was resolved

### 5. Check

Run the local checks `shipping.md` lists.

- Fix failures the merge caused.
- If a check fails the same way on `origin/<default>`, the failure is pre-existing: note it for the comment and go on.
- If you can't make the checks pass, go to step 7.

### 6. Hand back

Push with `git push`, then:

- **Bookkeeping only**, when every conflicted file matches a glob in the Bookkeeping files list:
  1. Remove `conflicts`, add `ship`.
  2. Comment: `Resolved: bookkeeping only (<files>). Back in the landing queue.`
- **Code**, when any other file conflicted:
  1. Remove `conflicts`.
  2. Run `ship:pr-review <pr> unattended` (or `pr-review`). It writes the review section into the PR description.
  3. Comment with a `## Conflict resolution` section: per conflicted file, one line on what each side wanted and how you combined them, then any pre-existing check failures. End with: "Re-review these choices, then add `ship`."

  `ship` stays off: the resolution is new code nobody has reviewed.

### 7. Stuck

1. Run `git merge --abort`, push nothing, and leave `conflicts` on.
2. Comment with a `## Conflict resolution: stuck` section:
   - the files and hunks that block
   - what each side wanted
   - the decision a person has to make
   - what you tried

## End

Remove the worktrees you made. Your last message lists, per PR:
- the outcome: resolved and queued, resolved and needing re-review, stuck, or skipped
- the PR link
- for code and stuck outcomes, the files
