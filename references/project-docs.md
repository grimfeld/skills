# Reading the project's docs/agents/

Ship skills read the project's rules from `docs/agents/`: `shipping.md` (how work ships) and, where the project has one, `issue-tracker.md` (how issues are created, labelled and linked). Read them as below, never from the working tree: the working tree can be days behind the default branch, or hold someone's uncommitted draft, and the rules that apply are the merged ones.

## How to read them

1. **Fetch:** `git fetch -q origin`. If it fails (no network, no remote), say so and read from the last fetched `origin/<default>`.
2. **Name the default branch:** `git symbolic-ref --short refs/remotes/origin/HEAD` gives `origin/<default>`. A fresh or shallow clone often has no `origin/HEAD`: then `git ls-remote --symref origin HEAD` (its first line, `ref: refs/heads/<default>`), else `main`, else `master`, whichever `origin` has.
3. **Read each file from it:** `git show origin/<default>:docs/agents/<file>`. "does not exist in 'origin/<default>'" means the file is missing on the default branch: use its default below, even if a copy sits in the working tree. Never report the missing file as an error.

Do this once at the start of a run, and again in a step that says "before each step".

## Defaults for a missing file

**No `issue-tracker.md`:** issues are GitHub issues in the repository of `origin`, read and written through `${CLAUDE_PLUGIN_ROOT}/references/github.md` (its REST rows first, the GitHub MCP tools where there is no `gh`). Specs carry the `spec:*` labels that `shipping.md`'s template lists: `spec:draft` → `spec:ready` → `spec:building` → `spec:in-review`, or `spec:stuck`. Tickets are sub-issues of their spec. Don't stop or warn over a missing `issue-tracker.md`: most projects have none.

**No `shipping.md`:**
- Specs use the spec template's sections (`${CLAUDE_PLUGIN_ROOT}/skills/spec-me/templates/spec.md`) and the `spec:*` labels above.
- There are no extra buildable items and no review budget beyond the skills' own defaults.
- Local checks are only the project's own (its `CLAUDE.md`, `AGENTS.md` and package scripts); none come from `shipping.md`.
- Say once, in the run's report, that the project has no `shipping.md` and the defaults applied.
- A skill that needs the file to act stops without it, as it says: `design-me` and `land` still stop and tell the user to run `/ship:setup-ship`.

## Not covered here

- `pr-review`'s `standards-and-spec` lens reads the PR's own copy of `docs/agents/` on purpose: it reviews the PR against the rules the PR carries.
- `land` already reads `shipping.md` from `origin/<default>` and keeps its own lines.
