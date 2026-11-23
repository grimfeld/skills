---
name: setup-ship
description: Set up a repository so reviewed PRs ship with one command. A `ship` label approves a PR, and `/ship:land` lands every approved PR, stacked ones after their parents. A required status and a ruleset keep unlabelled PRs off the default branch. Run once per project, or again to update or upgrade it.
disable-model-invocation: true
argument-hint: "[owner/repo] (default: the current repository)"
---

# Setup ship

After this runs, a person reviews a PR and approves it with the **`ship`** label, then runs `/ship:land`. The label
alone lands nothing, so a batch can be approved PR by PR. `/ship:land` is an agent: it merges the default branch
into each approved PR, waits for its CI and merges it, parents before the PRs stacked on them.

The repository does the rest:

- a required `ship` commit status keeps every unlabelled PR off the default branch
- Dependabot patch and GitHub Actions updates get `ship` on their own, and land with the next `/ship:land`
- labels track specs through the `ship` plugin's pipeline
- `docs/agents/shipping.md` writes the rules down for people and for the other `ship` skills

Nothing in the repository merges on its own: no auto-merge, no scheduled landing run.

Deploying after a merge stays with the project's CD. This skill checks that one exists and says so if it doesn't, but never builds one.

Files, in `${CLAUDE_SKILL_DIR}`:
- `templates/ship.yml` (the workflow) and `templates/shipping.md` (the doc). The workflow's first line, `# ship.yml version: <n>`, is the template's version; `shipping.md` follows it.
- `templates/history/ship.v<n>.yml` and `shipping.v<n>.md`: every earlier version, as released. An upgrade renders the installed version from them to tell the project's own edits from the template's.

Changes to GitHub settings reach outside the repository, so show them all first and apply them only after a yes.
File changes go through a PR like any other change.

## 1. Inspect

Read only. Collect:

0. **Installed version.** Read the first line of `.github/workflows/ship.yml`. No file: a fresh install. A file without a `# ship.yml version:` line: version 1. Version 1 changed several times before it was numbered, so an install from an early commit merges against a base that's slightly off: expect more conflicts, and show them rather than guessing. Compare it with the template's version.
   - **Older:** this run is an **upgrade**. Tell the user which version is installed and which is current, and what the newer one changes and removes (the "Versions" list below). Go on only if they want it.
   - **Current:** say so. Go on only if the user wants to change a setting (merge method, checks, bookkeeping files); otherwise stop, changing nothing.
1. **Repository.**
   - `gh repo view --json nameWithOwner,visibility,isPrivate,defaultBranchRef,isInOrganization,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`
   - `gh api repos/{owner}/{repo} -q .allow_auto_merge`: on an upgrade, whether there is auto-merge to turn off.
   - A private repository owned by a personal account on the free plan can create rulesets but doesn't enforce them: warn that the gate becomes advisory, and continue only if the user agrees.
2. **Rulesets and protection.** `gh api repos/{owner}/{repo}/rulesets` and each one's rules. Also check the legacy branch protection on the default branch.
3. **CI checks.** Take the check names from the last 10 merged PRs: `gh pr checks <n> --json name,workflow`. Required checks are the ones that ran on every PR whatever the change, typically lint, typecheck and unit tests. A job that runs only on some PRs must not be required, or PRs without it never merge. List the candidates.
4. **CD.** Look for workflows triggered by `push` to the default branch, and for deployments on recent default-branch commits: `gh api repos/{owner}/{repo}/deployments?per_page=5`, plus Vercel, Netlify or Fly configs. Summarise what deploys and how. If nothing does, say so.
5. **Project docs.** Read `CLAUDE.md`, `AGENTS.md`, `docs/agents/*` and the ADRs about merging. Look for:
   - a merge rule, for example "always squash"
   - the local check commands
   - a screenshot or visual test command
   - an existing `docs/agents/shipping.md`, which means this is a re-run: update it, don't overwrite it
6. **Labels.** `gh label list`.
7. **Bookkeeping files.** These are files most PRs touch, so they conflict often and need no review once merged together: glossaries, changelogs, docs indexes. Count how many of the last 30 merged PRs touch each file (`gh pr view <n> --json files`). Files touched by about 30% or more that are docs or indexes, not code or tests, are the candidates.
8. **Upgrade only: what goes away.** List the open PRs with auto-merge on (`gh pr list --state open --limit 1000 --json number,autoMergeRequest`) and the open PRs labelled `conflicts` (`gh pr list --state open --limit 1000 --label conflicts`). Version 2 took `ship` off a `conflicts` PR, so putting it back re-approves the PR, including anything pushed since: in the plan, list each one, and put `ship` back only on those the user confirms.

Done when you hold every item above.

## 2. Decide

**Upgrade:** read every value back from the installed files instead of asking for it again:
- from `ship.yml`: the default branch;
- from `shipping.md`: the merge method (its "Merge method" line), required and local checks, CD summary, screens command and bookkeeping files;
- for the installed version's *base* (step 4.0), the values its template fills, as its "Versions" rendering rules say: for versions 1 and 2, the mode and, in `command` mode, the cron, prefix, commit email, landing command and setup steps from `ship.yml`, and the landing mode, summary and details from `shipping.md`.

Ask only for values the newer template adds that can't be derived from those (the "Versions" list says which). With none, skip the question round.

Otherwise, ask the user the open choices in one `AskUserQuestion` round, giving your recommendation for each:

- **Merge method:** what the project's history uses (merge, squash or rebase), or what its docs require. `/ship:land` merges with it.
- **Required checks:** from step 1.3.
- **Local checks:** the commands from step 1.5.
- **Bookkeeping files:** the candidates from step 1.7, as globs. A conflict only in these files is mechanical to resolve.

## 3. Show the plan

Print every change, grouped, and ask for one yes. On an **upgrade**, run step 4.0's renders and `git merge-file -p` now, printing only, and settle any conflict with the user here. The files part is the diff of `ship.yml` and `shipping.md` against what's installed, with the project's own edits listed separately, each with whether it's kept; the user can drop any of them. The repository settings part is:
- the upgrade steps the "Versions" list gives for each version passed, with the PRs from step 1.8 they touch;
- what's missing: new labels and ruleset changes the "Versions" list gives for each version passed, plus ruleset changes if the checks changed.

The user's part is the to-dos the "Versions" list gives for each version passed.

- **Files**, in one PR from a new branch:
  - `.github/workflows/ship.yml` from the template.
  - `docs/agents/shipping.md` from the template.
  - `.claude/settings.json`:
    - add `extraKnownMarketplaces.grimfeld` (`{"source": {"source": "github", "repo": "grimfeld/skills"}}`)
    - add `enabledPlugins["ship@grimfeld"] = true`
    - keep everything already there
  - One line in `CLAUDE.md` (or `AGENTS.md`): "How work ships: `docs/agents/shipping.md`."
- **Repository settings**, applied after the PR merges:
  - Upgrade only: the upgrade steps.
  - Labels:
    - `ship`: "Reviewed and approved: lands with the next /ship:land"
    - `pr-reviewed`: "Reviewed by /ship:pr-review"
    - `spec:draft`
    - `spec:ready`
    - `spec:building`
    - `spec:in-review`
    - `spec:stuck`
    - `design:ready`: "A Claude Design artifact, marked done"
    - `design:specced`: "Turned into specs by /ship:design-me"
    - `changes-requested`: "Sent back for a rebuild: move its spec to spec:ready"
    - `retro`: "Filed by /ship:retro-issues from a session retro"

    Create them with `gh label create --force`, which keeps a label's other PRs and issues.
  - The ruleset on the default branch. Amend the existing ruleset that targets it; don't add a second one. It needs:
    - `pull_request`, with no required approvals: one person can't approve their own PRs, and the `ship` label is the review
    - `required_status_checks`: the chosen checks plus `ship`. Pin `ship` to GitHub Actions (`"integration_id": 15368`), so only the `gate` job can set it, not anyone with push access calling the statuses API.
    - `non_fast_forward` and `deletion`, if missing

    Use `gh api -X PUT repos/{owner}/{repo}/rulesets/<id> --input <file>`, with the full rule list (read, change, write).
- **What only the user can do.** Never ask for a token's value or handle one.
  - Create a fine-grained token for this repository with Pull requests read/write.
  - Add it as the Dependabot secret `SHIP_TOKEN` (`gh secret set SHIP_TOKEN --app dependabot`).
  - Why it's needed: a label added with GitHub's default token doesn't start other workflows, so without it the `ship` label `dependabot` adds never turns the `ship` status green.
  - Cloud sessions don't install plugins from `.claude/settings.json`. Point the user to the `grimfeld/skills` README's cloud setup script for their cloud environment.

## 4. Write the files

Work in a branch, through a worktree if the project's docs say so.

0. **Upgrade only: keep the project's edits.** For each of `ship.yml` and `shipping.md`, take three copies:
   - *base*: the installed version's template from `templates/history/`, rendered with the values from step 2, that version's rendering rules (the "Versions" list) and the same `uses:` pinning as the installed file
   - *ours*: the installed file as it is
   - *theirs*: the current template, rendered by steps 1 and 2 below

   `git merge-file -p <theirs> <base> <ours>` gives the upgraded file with the project's edits carried over. The project's edits are the hunks of `diff <base> <ours>`; list them in step 3. A conflict in the merge is one of them clashing with the template: show both sides and let the user pick. A dropped edit is left out of the result. The files written below are these merged results, not plain renders.

   An edit to a part the newer template removes (a job, a section) clashes with nothing in it and has nothing left to apply to: list it in step 3 as dropped, with why.

1. **`ship.yml`:** copy the template and fill `__DEFAULT_BRANCH__`.
   - Keep the first line, `# ship.yml version: <n>`, as it is: `/ship:land` and later runs of this skill read it.
   - Pin any `uses:` the way the repo's other workflows do. If they pin to commit SHAs, pin these too (`actions/checkout@<sha> # vX.Y.Z`): a repo that requires SHAs fails the whole workflow at startup over one tag.
   - Done when `grep -n '__[A-Z_]*__' ship.yml` prints nothing, and the file parses as YAML (`ruby -ryaml -e 'YAML.load_file(ARGV[0])'` or `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'`, whichever exists). If `actionlint` is installed, run it too.
2. **`shipping.md`:** fill every placeholder from steps 1 and 2.
   - `__DEFAULT_BRANCH__`: the default branch.
   - `__MERGE_METHOD__`: merge, squash or rebase.
   - `__REQUIRED_CHECKS__`: the required checks, each in backticks, comma-separated, or "no CI checks".
   - `__LOCAL_CHECKS__`: the local check commands, each in backticks.
   - `__CD_SUMMARY__`: what deploys after a merge, or "Nothing deploys on merge."
   - `__SCREENS__`: the command, or "none".
   - `__BOOKKEEPING_FILES__`: a Markdown list with one glob per item, each in backticks, or a single "none" item.

   Done when `grep -n '__[A-Z_]*__' shipping.md` prints nothing.

   On a re-run, keep any section the project has added. On an upgrade, step 0's merge does this.
3. **Settings and `CLAUDE.md`:** edit them in place.
4. **Commit and open the PR.**
   - Body: what each file does, the settings that follow the merge, and the user's to-do list from step 3.
   - Open it as ready, not draft. It's the one PR that can't carry its own gate yet, so the user merges it themselves.

## 5. Apply the settings

After the user says the PR has merged, apply step 3's repository settings in the order listed: the upgrade steps, then labels, then the ruleset. The upgrade steps come after the merge, so the old `ship.yml` can't turn auto-merge back on. Applying the ruleset last means a missing `ship` status can't block the setup PR. On an upgrade, apply only what step 3 listed.

Re-read each setting to confirm it took:
- on an upgrade, each upgrade step: for version 3, no open PR with `autoMergeRequest`, `allow_auto_merge` false, `ship` on the PRs that carried `conflicts`, and no `conflicts` label
- the labels
- the ruleset's rules

## 6. Verify and hand off

1. Open any PR, or use the next one, and check its `ship` status reads "Waiting for review".
   - Adding `ship` turns it green and starts nothing else: nothing merges until someone runs `/ship:land`.
2. Report:
   - what changed
   - what was verified
   - what's still on the user's list (the `SHIP_TOKEN` Dependabot secret, the cloud setup script, and the to-dos of each version passed)
   - the CD finding from step 1.4
   - that `/ship:land` lands the approved PRs

## Versions

When the template changes in a way an installed repo should pick up, raise the number on `ship.yml`'s first line, copy the released files to `templates/history/` under the old number first, and add a line here: what changed, and the values an upgrade has to ask for.

Each entry also gives what rendering that version needs beyond the current rules, for an upgrade's *base*, and what the user has to do by hand.

- **1:** the first release (no version line). Adding `ship` lands a PR at once.
  - Rendering: it has no `# >>> auto-merge mode` blocks, and fills `__AUTOMERGE_CONDITION__`: `contains(github.event.pull_request.labels.*.name, 'ship')` in `auto-merge` mode, `startsWith(github.head_ref, '<prefix>')` in `command` mode. The rest is version 2's rendering, below.
- **2:** `ship` approves; a landing run (`/ship:land`'s dispatch, the `command`-mode cron, or a merge) lands. Stacked PRs move onto the default branch when their parent merges. The label approves the PR, not a commit: pushes after it keep `ship`.
  - Rendering (version 1's base uses it too): the mode is `command` if the installed `ship.yml` has a `LAND_BRANCH_PREFIX`, `auto-merge` otherwise. In `ship.yml`, delete every block of the other mode (`# >>> <mode> mode` … `# <<< <mode> mode`, markers included) and drop only the marker lines of the installed mode's blocks. Fill `__MERGE_METHOD__`, and in `command` mode `__SETUP_STEPS__` (YAML steps indented six spaces), `__LAND_COMMAND__`, `__LAND_CRON__`, `__LAND_BRANCH_PREFIX__` and `__COMMIT_EMAIL__`. Its `shipping.md` fills `__LAND_MODE__`, `__LANDING_SUMMARY__` (one sentence), `__LAND_SCHEDULE__` (in `command` mode ` and on the landing schedule (<cron, in words>)`, otherwise empty) and `__LAND_DETAILS__` (in `command` mode the command, schedule, prefix and contract; otherwise "Merged by GitHub auto-merge when the required checks pass."). Take each value from the installed files. Nothing new to ask: the merge method is read back from the installed `shipping.md`.
  - New label `changes-requested`. Ruleset change: pin the `ship` status to GitHub Actions (`integration_id` 15368). Nothing new to ask: `__LAND_SCHEDULE__` comes from the cron.
  - User to-do: add Workflows read/write to `SHIP_TOKEN`, in both the Actions and the Dependabot secret, so the cascade can push merges that bring in workflow changes.
  - Upgrade step: in `auto-merge` mode, version 1 turned on GitHub auto-merge for every labelled PR, stacked ones included, and version 2 doesn't. List the open PRs with auto-merge on (`gh pr list --state open --limit 1000 --json number,autoMergeRequest`) and turn it off on each (`gh pr merge <n> --disable-auto`), so none lands outside a landing run.
- **3:** `ship.yml` lands nothing. `/ship:land` is an agent that merges every `ship` PR itself: it merges the default branch in, waits for CI and merges, parents before their stacked children. `ship.yml` keeps `gate` and `dependabot`, which labels and no longer merges. Removed: the `queue`, `land` and `automerge` jobs, command mode, auto-merge, the stacked-PR cascade, the `conflicts` label and `/ship:resolve-conflicts`.
  - Upgrade steps: turn auto-merge off on every open PR that has it (`gh pr list --state open --limit 1000 --json number,autoMergeRequest`, then `gh pr merge <n> --disable-auto`); turn off the repository's auto-merge (`gh api -X PATCH repos/{owner}/{repo} -F allow_auto_merge=false`); put `ship` back on each open PR labelled `conflicts` that the user confirmed in the plan, then delete the `conflicts` label (`gh label delete conflicts --yes`). Update the `ship` and `changes-requested` labels' descriptions (`gh label create <name> --force`, with the descriptions above). In `command` mode, list the open PRs whose head branch starts with the installed `LAND_BRANCH_PREFIX` (landing batches): nothing merges them any more, and the PRs they batch land one by one, so close each one the user agrees to in the plan (`gh pr close <n> --comment ...`). Keep the ruleset's required `ship` status.
  - User to-do: `SHIP_TOKEN` now needs only Pull requests read/write, as the Dependabot secret. Delete the Actions secret (`gh secret delete SHIP_TOKEN`), save a new token with only Pull requests read/write as the Dependabot secret (`gh secret set SHIP_TOKEN --app dependabot`), and revoke the old one, which could also write contents and workflows. Remove any hourly `/ship:resolve-conflicts` routine.
