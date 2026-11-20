---
name: setup-ship
description: Set up a repository so reviewed PRs ship on their own. A `ship` label approves a PR, `/ship:land` lands the approved batch, and a required status, auto-merge or the project's own landing command, and a ruleset do the rest, stacked PRs included. Run once per project, or again to update it.
disable-model-invocation: true
argument-hint: "[owner/repo] (default: the current repository)"
---

# Setup ship

After this runs, a person reviews a PR and approves it with the **`ship`** label, then runs `/ship:land` (or waits
for the landing schedule in `command` mode). The label alone lands nothing, so a batch can be approved PR by PR.
The repository does the rest:

- a required `ship` commit status keeps every unlabelled PR off the default branch
- a landing run merges the labelled PRs that target the default branch when CI is green, through GitHub
  auto-merge or the project's own landing command
- a PR stacked on another one waits; when its parent merges, it is retargeted to the default branch, updated and
  landed in turn
- labels track specs through the `ship` plugin's pipeline
- `docs/agents/shipping.md` writes the rules down for people and for the other `ship` skills

Deploying after a merge stays with the project's CD. This skill checks that one exists and says so if it doesn't, but never builds one.

Files, in `${CLAUDE_SKILL_DIR}`:
- `templates/ship.yml` (the workflow) and `templates/shipping.md` (the doc). The workflow's first line, `# ship.yml version: <n>`, is the template's version; `shipping.md` follows it.
- `templates/history/ship.v<n>.yml` and `shipping.v<n>.md`: every earlier version, as released. An upgrade renders the installed version from them to tell the project's own edits from the template's.

Changes to GitHub settings reach outside the repository, so show them all first and apply them only after a yes.
File changes go through a PR like any other change.

## 1. Inspect

Read only. Collect:

0. **Installed version.** Read the first line of `.github/workflows/ship.yml`. No file: a fresh install. A file without a `# ship.yml version:` line: version 1. Compare it with the template's version.
   - **Older:** this run is an **upgrade**. Tell the user which version is installed and which is current, and what the newer one changes (the "Versions" list below). Go on only if they want it.
   - **Current:** say so. Go on only if the user wants to change a setting (mode, checks, bookkeeping files); otherwise stop, changing nothing.
1. **Repository.**
   - `gh repo view --json nameWithOwner,visibility,isPrivate,defaultBranchRef,isInOrganization,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`
   - `gh api repos/{owner}/{repo} -q .allow_auto_merge`
   - A private repository owned by a personal account on the free plan can create rulesets but doesn't enforce them: warn that the gate becomes advisory, and continue only if the user agrees.
2. **Rulesets and protection.** `gh api repos/{owner}/{repo}/rulesets` and each one's rules. Also check the legacy branch protection on the default branch.
3. **CI checks.** Take the check names from the last 10 merged PRs: `gh pr checks <n> --json name,workflow`. Required checks are the ones that ran on every PR whatever the change, typically lint, typecheck and unit tests. A job that runs only on some PRs must not be required, or PRs without it never merge. List the candidates.
4. **CD.** Look for workflows triggered by `push` to the default branch, and for deployments on recent default-branch commits: `gh api repos/{owner}/{repo}/deployments?per_page=5`, plus Vercel, Netlify or Fly configs. Summarise what deploys and how. If nothing does, say so.
5. **Project docs.** Read `CLAUDE.md`, `AGENTS.md`, `docs/agents/*` and the ADRs about merging. Look for:
   - an existing landing process: a batching or integration script, a merge queue, an "always merge with X" rule
   - the local check commands
   - a screenshot or visual test command
   - an existing `docs/agents/shipping.md`, which means this is a re-run: update it, don't overwrite it
6. **Labels.** `gh label list`.
7. **Bookkeeping files.** These are files most PRs touch, so they conflict often and need no review once merged together: glossaries, changelogs, docs indexes. Count how many of the last 30 merged PRs touch each file (`gh pr view <n> --json files`). Files touched by about 30% or more that are docs or indexes, not code or tests, are the candidates.

Done when you hold every item above.

## 2. Decide

**Upgrade:** read every value back from the installed files instead of asking for it again: the mode (a `land` job that runs a command), the merge method, the default branch, and in `command` mode the cron, prefix, commit email, landing command and setup steps from `ship.yml`; and every placeholder value in `shipping.md`: landing mode, summary and details, required and local checks, CD summary, screens command and bookkeeping files. Ask only for values the newer template adds that can't be derived from those (the "Versions" list says which). With none, skip the question round.

Otherwise, ask the user the open choices in one `AskUserQuestion` round, giving your recommendation for each:

- **Landing mode.**
  - `auto-merge`, the default: GitHub merges each labelled PR once required checks pass.
  - `command`: the project already lands work its own way, for example a batching script. Name the command.

  The `command` contract:
  - It takes the PR numbers to land as arguments.
  - It brings them onto the default branch through a PR whose head branch starts with a fixed prefix.
  - It does nothing harmful when such a PR is already open. The `land` job also skips its run while one is open, so a command that can't tell which PRs are already batched still works.

  If the project's command doesn't meet this contract yet, record the gap as a follow-up issue in the project, not here.
- **Merge method:** what the project's history uses (merge, squash or rebase). `command` mode uses the method its own docs require.
- **Required checks:** from step 1.3.
- **Bookkeeping files:** the candidates from step 1.7, as globs. A conflict in only these files sends the PR back to the queue once resolved; any other file waits for a re-review.
- **`command` mode only:**
  - the cron schedule for the landing run (default every 2 hours: `17 */2 * * *`)
  - the setup steps the command needs on a runner, for example install pnpm and run `pnpm install --frozen-lockfile`
  - the head-branch prefix
  - the email the landing commits use

## 3. Show the plan

Print every change, grouped, and ask for one yes. On an **upgrade**, the files part is the diff of `ship.yml` and `shipping.md` against what's installed (step 4.0 builds it), with the project's own edits listed separately, each with whether it's kept; the user can drop any of them. The repository settings part is only what's missing: new labels, and ruleset changes if the checks changed. The user's part is the to-dos the "Versions" list gives for each version passed.

- **Files**, in one PR from a new branch:
  - `.github/workflows/ship.yml` from the template.
  - `docs/agents/shipping.md` from the template.
  - `.claude/settings.json`:
    - add `extraKnownMarketplaces.grimfeld` (`{"source": {"source": "github", "repo": "grimfeld/skills"}}`)
    - add `enabledPlugins["ship@grimfeld"] = true`
    - keep everything already there
  - One line in `CLAUDE.md` (or `AGENTS.md`): "How work ships: `docs/agents/shipping.md`."
- **Repository settings**, applied after the PR merges:
  - Auto-merge on: `gh api -X PATCH repos/{owner}/{repo} -F allow_auto_merge=true`.
  - Labels:
    - `ship`: "Reviewed and approved: lands with the next landing run"
    - `pr-reviewed`: "Reviewed by /ship:pr-review"
    - `spec:draft`
    - `spec:ready`
    - `spec:building`
    - `spec:in-review`
    - `spec:stuck`
    - `design:ready`: "A Claude Design artifact, marked done"
    - `design:specced`: "Turned into specs by /ship:design-me"
    - `conflicts`: "Conflicts with the default branch: resolve, then re-review"
    - `changes-requested`: "Commented on in review: its spec goes back for a rebuild"
    - `retro`: "Filed by /ship:retro-issues from a session retro"

    Create them with `gh label create --force`, which keeps a label's other PRs and issues.
  - The ruleset on the default branch. Amend the existing ruleset that targets it; don't add a second one. It needs:
    - `pull_request`, with no required approvals: one person can't approve their own PRs, and the `ship` label is the review
    - `required_status_checks`: the chosen checks plus `ship`. Pin `ship` to GitHub Actions (`"integration_id": 15368`), so only the `gate` job can set it, not anyone with push access calling the statuses API.
    - `non_fast_forward` and `deletion`, if missing

    Use `gh api -X PUT repos/{owner}/{repo}/rulesets/<id> --input <file>`, with the full rule list (read, change, write).
- **What only the user can do.** Never ask for a token's value or handle one.
  - Create a fine-grained token for this repository with Contents, Pull requests and Workflows read/write. Workflows lets the stacked-PR cascade push a merge that brings in workflow changes, `ship.yml` itself included.
  - Add it as the Actions secret `SHIP_TOKEN` (`gh secret set SHIP_TOKEN`) and the Dependabot secret `SHIP_TOKEN` (`gh secret set SHIP_TOKEN --app dependabot`).
  - Why it's needed: without it, merges, pushes and landing PRs made by GitHub's default token don't start CI, deploys or the stacked-PR cascade.
  - Cloud sessions don't install plugins from `.claude/settings.json`. Point the user to the `grimfeld/skills` README's cloud setup script for their cloud environment.
  - Optional: a routine that runs `/ship:resolve-conflicts` every hour (`/schedule`), so conflicting PRs get resolved without anyone starting it.

## 4. Write the files

Work in a branch, through a worktree if the project's docs say so.

0. **Upgrade only: keep the project's edits.** For each of `ship.yml` and `shipping.md`, take three copies:
   - *base*: the installed version's template from `templates/history/`, rendered with the values from step 2, that version's rendering rules (the "Versions" list) and the same `uses:` pinning as the installed file
   - *ours*: the installed file as it is
   - *theirs*: the current template, rendered by steps 1 and 2 below

   `git merge-file -p <theirs> <base> <ours>` gives the upgraded file with the project's edits carried over. The project's edits are the hunks of `diff <base> <ours>`; list them in step 3. A conflict in the merge is one of them clashing with the template: show both sides and let the user pick. A dropped edit is left out of the result. The files written below are these merged results, not plain renders.

1. **`ship.yml`:** copy the template.
   - **`auto-merge` mode:** delete every `# >>> command mode` … `# <<< command mode` block, markers included, and drop only the marker lines of the `# >>> auto-merge mode` blocks.
   - **`command` mode:** delete every `# >>> auto-merge mode` … `# <<< auto-merge mode` block, markers included, and drop only the marker lines of the `command mode` blocks. Fill `__SETUP_STEPS__` as YAML steps indented six spaces, and `__LAND_COMMAND__`, `__LAND_CRON__`, `__LAND_BRANCH_PREFIX__` and `__COMMIT_EMAIL__`.
   - Keep the first line, `# ship.yml version: <n>`, as it is: `/ship:land` and later runs of this skill read it.
   - **Both modes:** fill `__DEFAULT_BRANCH__` and `__MERGE_METHOD__`.
   - Pin every `uses:` the way the repo's other workflows do. If they pin to commit SHAs, pin these too (`actions/checkout@<sha> # vX.Y.Z`): a repo that requires SHAs fails the whole workflow at startup over one tag.
   - Done when `grep -n '__[A-Z_]*__\|# >>>\|# <<<' ship.yml` prints nothing, and the file parses as YAML (`ruby -ryaml -e 'YAML.load_file(ARGV[0])'` or `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'`, whichever exists). If `actionlint` is installed, run it too.
2. **`shipping.md`:** fill every placeholder from steps 1 and 2.
   - `__LANDING_SUMMARY__`: one sentence.
   - `__LAND_SCHEDULE__`: in `command` mode, ` and on the landing schedule (<cron, in words>)`; in `auto-merge` mode, empty.
   - `__LAND_DETAILS__`: in `command` mode, the command, schedule, prefix and contract; in `auto-merge` mode, a single "Merged by GitHub auto-merge when the required checks pass."
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

After the user says the PR has merged, apply step 3's repository settings in the order listed: auto-merge, then labels, then the ruleset. Applying the ruleset last means a missing `ship` status can't block the setup PR. On an upgrade, apply only what step 3 listed as missing.

Re-read each setting to confirm it took:
- `allow_auto_merge`
- the labels
- the ruleset's rules

## 6. Verify and hand off

1. Open any PR, or use the next one, and check its `ship` status reads "Waiting for review".
   - Adding `ship` turns it green and starts nothing else: no `land` or `queue` run.
   - `gh workflow run ship.yml` then runs `queue` and `land`. Check that `queue` labelled any PR that already conflicts, and, if `SHIP_TOKEN` is set, that `land` turned on auto-merge (`gh pr view <n> --json autoMergeRequest`) or, in `command` mode, ran the landing command.
2. Report:
   - what changed
   - what was verified
   - what's still on the user's list (`SHIP_TOKEN` in both places, the cloud setup script, the optional `resolve-conflicts` routine, any follow-up issue for the landing command)
   - the CD finding from step 1.4

## Versions

When the template changes in a way an installed repo should pick up, raise the number on `ship.yml`'s first line, copy the released files to `templates/history/` under the old number first, and add a line here: what changed, and the values an upgrade has to ask for.

Each entry also gives what rendering that version needs beyond the current rules, for an upgrade's *base*, and what the user has to do by hand.

- **1:** the first release (no version line). Adding `ship` lands a PR at once.
  - Rendering: it has no `# >>> auto-merge mode` blocks, and fills `__AUTOMERGE_CONDITION__`: `contains(github.event.pull_request.labels.*.name, 'ship')` in `auto-merge` mode, `startsWith(github.head_ref, '<prefix>')` in `command` mode.
- **2:** `ship` approves; a landing run (`/ship:land`'s dispatch, the `command`-mode cron, or a merge) lands. Stacked PRs move onto the default branch when their parent merges. A push after approval withdraws it, unless it's a clean merge of the default branch.
  - New label `changes-requested`. Ruleset change: pin the `ship` status to GitHub Actions (`integration_id` 15368). Nothing new to ask: `__LAND_SCHEDULE__` comes from the cron.
  - User to-do: add Workflows read/write to `SHIP_TOKEN`, in both the Actions and the Dependabot secret, so the cascade can push merges that bring in workflow changes.
