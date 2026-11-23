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
- `scripts/render.mjs`: renders the current templates from a values file (step 4). Its test, `scripts/render.test.mjs`, also checks that this plugin's own repository matches the render with `scripts/this-repo.values.json`: a change to a template, or to grimfeld/skills' `ship.yml` or `shipping.md`, updates the others in the same PR.

Changes to GitHub settings reach outside the repository, so show them all first and apply them only after a yes.
File changes go through a PR like any other change.

## 1. Inspect

Read only, except the required-checks sync on a current install (step 0), which writes only on a yes. Collect:

0. **Installed version.** Read the first line of `.github/workflows/ship.yml`. No file: a fresh install. A file without a `# ship.yml version:` line: version 1. Version 1 changed several times before it was numbered, so an install from an early commit merges against a base that's slightly off: expect more conflicts, and show them rather than guessing. Compare it with the template's version.
   - **Older:** this run is an **upgrade**. Tell the user which version is installed and which is current, and what the newer one changes and removes (the "Versions" list below). Go on only if they want it.
   - **Current:** say so, then run "Sync required checks" (below) first. After it, go on only if the user wants to change another setting (merge method, checks, bookkeeping files); otherwise stop, changing nothing more.
1. **Repository.** First find which of these the folder is, in this order; each case implies the ones after it:
   - **Not a git repo** (`git rev-parse --is-inside-work-tree` fails): no local repo, no GitHub repo, no commits.
   - **No `origin` remote** (`git remote get-url origin` fails): no GitHub repo. A local repo with commits pushes its default branch as it is; one without commits needs a first commit.
   - **A remote with no commits** (`gh repo view --json defaultBranchRef` gives an empty `name`, or `git ls-remote --heads origin` prints nothing): no first commit.

   In any of the three, this is a fresh install with a **Repository** group to plan (step 3). Don't abort. Take the default branch name from the local repo's current branch (`git symbolic-ref --short HEAD`, which works before the first commit too) when there is one; only when step 1.1 found no git repo, from `git config init.defaultBranch`, else `main`. Skip what has nothing to read yet (rulesets, CI checks, CD, merged PRs, labels, bookkeeping files) and take the defaults: no required checks besides `ship`, nothing deploys, no bookkeeping files. A normal repo with a remote and commits runs as below, exactly as before.
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
8. **Cloud environments.** List the user's cloud environments with their IDs and names (`list_environments` from the Claude Code remote tools, where this session has them). Note the one named like the repository, if any. Where nothing can list them, ask for an `env_…` ID in step 2 instead, or "none chosen".
9. **Upgrade only: what goes away.** List the open PRs with auto-merge on (`gh pr list --state open --limit 1000 --json number,autoMergeRequest`) and the open PRs labelled `conflicts` (`gh pr list --state open --limit 1000 --label conflicts`), and in `command` mode the open landing-batch PRs (head branch starting with the installed `LAND_BRANCH_PREFIX`). Version 2 took `ship` off a `conflicts` PR, so putting it back re-approves the PR, including anything pushed since: in the plan, list each one, and put `ship` back only on those the user confirms.

Done when you hold every item above.

## 2. Decide

**Upgrade:** read every value back from the installed files instead of asking for it again:
- from `ship.yml`: the default branch;
- from `shipping.md`: the merge method (its "Merge method" line), required and local checks, CD summary, screens command, bookkeeping files and, from version 4, the cloud environment (its "Cloud environment" line);
- for the installed version's *base* (step 4.0), the values its template fills, as its "Versions" rendering rules say: for versions 1 and 2, the mode and, in `command` mode, the cron, prefix, commit email, landing command and setup steps from `ship.yml`, and the landing mode, summary and details from `shipping.md`.

Ask only for values the newer template adds that can't be derived from those (the "Versions" list says which). With none, skip the question round.

Otherwise, ask the user the open choices in one `AskUserQuestion` round, giving your recommendation for each:

- **Merge method:** what the project's history uses (merge, squash or rebase), or what its docs require. `/ship:land` merges with it.
- **Required checks:** from step 1.3.
- **Local checks:** the commands from step 1.5.
- **Bookkeeping files:** the candidates from step 1.7, as globs. A conflict only in these files is mechanical to resolve.
- **Cloud environment:** the one `/ship:night-shift` creates builder routines in, from step 1.8, or "none chosen". Recommend the one named like the repository.

When step 1.1 planned a Repository group, there is no history to read: don't ask the required checks or bookkeeping files (take step 1.1's defaults), and recommend `merge` as the merge method.
- **The GitHub repo**, only when step 1.1 found none: its owner (preselect the signed-in user, `gh api user --jq .login`; offer their organisations), name (preselect the folder's name) and visibility (preselect private). Private on a personal account on the free plan: show step 1.1's warning that the gate becomes advisory.

## 3. Show the plan

Print every change, grouped, and ask for one yes. On an **upgrade**, run step 4.0's renders and `git merge-file -p` now, printing only, and settle any conflict with the user here. The files part is the diff of `ship.yml` and `shipping.md` against what's installed, with the project's own edits listed separately, each with whether it's kept; the user can drop any of them. The repository settings part is:
- the upgrade steps the "Versions" list gives for each version passed, with the PRs from step 1.8 they touch;
- what's missing: new labels and ruleset changes the "Versions" list gives for each version passed, plus ruleset changes if the checks changed.

The user's part is the to-dos the "Versions" list gives for each version passed.

- **Repository**, only when step 1.1 found something missing, first in the plan and applied right after the yes (step 4), since the setup PR needs a base branch. List only the missing pieces:
  - create the local repo: `git init -b <default branch>`;
  - create the GitHub repo: `gh repo create <owner>/<name> --<visibility> --source . --remote origin`;
  - make a first commit and push it to the default branch: `git commit --allow-empty -m "Initial commit"`, then `git push -u origin <default branch>`. The commit is empty: files already in the folder stay uncommitted, for the user to commit in a PR once the gate is on. A local repo that already has commits pushes its default branch as it is instead, with no new commit.

  Nothing is created or pushed before the yes.
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
    - `required_status_checks`: the chosen checks plus `ship`. Pin `ship` to GitHub Actions (`"integration_id": 15368`), so only the `gate` job can set it, not anyone with push access calling the statuses API. On a re-run, compute the change as "Sync required checks" does, with the "Required on" line you are writing.
    - `non_fast_forward` and `deletion`, if missing

    Use `gh api -X PUT repos/{owner}/{repo}/rulesets/<id> --input <file>`, with the full rule list (read, change, write).
- **What only the user can do.** Never ask for a token's value or handle one. In every to-do you show, this list's and the "Versions" list's, the setup PR body included, replace `<owner>/<repo>` with the real repository.
  - Create a fine-grained token for this repository with Pull requests read/write.
  - Add it as the Dependabot secret `SHIP_TOKEN`: run `gh secret set SHIP_TOKEN --app dependabot --repo <owner>/<repo>` in a separate terminal, not with `!` in the Claude session (it can't prompt there and saves an empty value), or paste the token at `https://github.com/<owner>/<repo>/settings/secrets/dependabot`.
  - Why it's needed: a label added with GitHub's default token doesn't start other workflows, so without it the `ship` label `dependabot` adds never turns the `ship` status green.
  - Cloud sessions don't install plugins from `.claude/settings.json`. Point the user to the `grimfeld/skills` README's cloud setup script for their cloud environment.

## 4. Write the files

**Repository group first.** If step 3 planned one, apply it now, after the yes and before anything else: create the local repo, the GitHub repo, and the first commit or push, as listed. Check the default branch exists on the remote (`git ls-remote --heads origin <default branch>`) before going on.

Work in a branch, through a worktree if the project's docs say so.

0. **Upgrade only: keep the project's edits.** For each of `ship.yml` and `shipping.md`, take three copies:
   - *base*: the installed version's template from `templates/history/`, rendered with the values from step 2, that version's rendering rules (the "Versions" list) and the same `uses:` pinning as the installed file
   - *ours*: the installed file as it is
   - *theirs*: the current template, rendered by steps 1 and 2 below (`scripts/render.mjs`)

   `git merge-file -p <theirs> <base> <ours>` gives the upgraded file with the project's edits carried over. The project's edits are the hunks of `diff <base> <ours>`; list them in step 3. A conflict in the merge is one of them clashing with the template: show both sides and let the user pick. A dropped edit is left out of the result. The files written below are these merged results, not plain renders.

   An edit to a part the newer template removes (a job, a section) clashes with nothing in it and has nothing left to apply to: list it in step 3 as dropped, with why.

1. **Values.** Write the values from steps 1 and 2 to a JSON file outside the repository (the scratchpad), one key per placeholder, named without its underscores:
   - `DEFAULT_BRANCH`: the default branch.
   - `MERGE_METHOD`: merge, squash or rebase.
   - `REQUIRED_CHECKS`: the required checks, as a list (`[]` for none).
   - `LOCAL_CHECKS`: the local check commands, as a list.
   - `CD_SUMMARY`: what deploys after a merge, or "Nothing deploys on merge."
   - `SCREENS`: the command, or "none".
   - `BOOKKEEPING_FILES`: the globs, as a list (`[]` for none).
   - `CLOUD_ENVIRONMENT`: `` `env_…` (<environment name>) ``, or "none chosen".

   A list is formatted for you (each item in backticks; "no CI checks", "none", "- none" when empty). A string goes in as it is, for wording a list can't give.
2. **Render.** For each of `ship.yml` and `shipping.md`, run `node ${CLAUDE_SKILL_DIR}/scripts/render.mjs ${CLAUDE_SKILL_DIR}/templates/<file> <values.json>`. It prints the file, keeping `ship.yml`'s first line, `# ship.yml version: <n>`, as it is: `/ship:land` and later runs of this skill read it. It exits non-zero, printing nothing, when a placeholder has no value or one is left over; fix the values and run it again.
   - On a fresh install, write the output to `.github/workflows/ship.yml` and `docs/agents/shipping.md`. On an upgrade, it is *theirs* in step 0's merge.
   - On a re-run, keep any section the project has added to `shipping.md`. On an upgrade, step 0's merge does this.
   - Pin any `uses:` in `ship.yml` the way the repo's other workflows do. If they pin to commit SHAs, pin these too (`actions/checkout@<sha> # vX.Y.Z`): a repo that requires SHAs fails the whole workflow at startup over one tag.
   - Done when `ship.yml` parses as YAML (`ruby -ryaml -e 'YAML.load_file(ARGV[0])'` or `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'`, whichever exists). If `actionlint` is installed, run it too.
3. **Settings and `CLAUDE.md`:** edit them in place.
4. **Commit and open the PR.**
   - Body: what each file does, the settings that follow the merge, and the user's to-do list from step 3.
   - Open it as ready, not draft. It's the one PR that can't carry its own gate yet, so the user merges it themselves.

## 5. Apply the settings

After the user says the PR has merged, apply step 3's repository settings in the order listed: the upgrade steps, then labels, then the ruleset. The upgrade steps come after the merge, so the old `ship.yml` can't turn auto-merge back on. Applying the ruleset last means a missing `ship` status can't block the setup PR. On an upgrade, apply only what step 3 listed, with one exception: list the open PRs with auto-merge on again now and turn it off on every one, since the old `ship.yml` kept turning it on until the merge.

Re-read each setting to confirm it took:
- on an upgrade, each upgrade step: for version 3, no open PR with `autoMergeRequest`, `allow_auto_merge` false, `ship` on the `conflicts` PRs the user confirmed, and no `conflicts` label; in `command` mode, the landing-batch PRs the user agreed to close are closed
- the labels
- the ruleset's rules, with its required checks equal to the "Required on" line plus `ship` (re-read them as "Sync required checks" does)

## 6. Verify and hand off

1. Open any PR, or use the next one, and check its `ship` status reads "Waiting for review".
   - Adding `ship` turns it green and starts nothing else: nothing merges until someone runs `/ship:land`.
2. Report:
   - what changed
   - what was verified
   - what's still on the user's list (the `SHIP_TOKEN` Dependabot secret, the cloud setup script, and the to-dos of each version passed)
   - the CD finding from step 1.4
   - that `/ship:land` lands the approved PRs
   - after a Repository group: that the files already in the folder are uncommitted, for the user to commit in a PR now that the gate is on
3. **`SHIP_TOKEN`.** When the user says the secret is set, check it exists: `gh secret list --app dependabot --repo <owner>/<repo>` lists `SHIP_TOKEN`. Say whether it does. The list shows names only: never read, print or ask for its value.

## Sync required checks

`docs/agents/shipping.md` is the source of the required checks; the ruleset follows it. Read only until the yes.

1. **Wanted.** Read the "Required on `<default>`" line from the default branch's copy, not the working tree: `git fetch origin <default>`, then `git show origin/<default>:docs/agents/shipping.md`. A check is required only once the doc saying so has merged. The line has the template's form, ``Required on `<default>`: <checks>, and `ship`.``: the wanted checks are the backticked names after the colon, other than `ship`; "no CI checks" means none.
2. **Current.** Find the ruleset that targets the default branch (`gh api repos/{owner}/{repo}/rulesets`, then `gh api repos/{owner}/{repo}/rulesets/<id>`) and its `required_status_checks` rule's `required_status_checks[].context`, leaving out `ship`.
3. **Flag what hasn't run.** For each check to add, look at the most recently merged PR's checks (`gh pr list --state merged --limit 1 --json number`, then `gh pr checks <n> --json name,workflow`). A check that isn't there is flagged "hasn't run on a merged PR yet: requiring it would block every PR" and left out of the change unless the user insists.
4. **Show the difference**, one line per check: `+ <check>` for a wanted check the ruleset lacks, `- <check>` for one the ruleset requires that the line doesn't name. With none, say "required checks in sync", write nothing, and go back to where you came from.
5. **On a yes, write it.** Read, change, write: take the ruleset's whole JSON, replace only the `required_status_checks` rule's list with the wanted checks plus `ship`, keep every other rule and parameter as it was, and `gh api -X PUT repos/{owner}/{repo}/rulesets/<id> --input <file>`.
   - `ship` is always kept, pinned to GitHub Actions (`"integration_id": 15368`), whatever `shipping.md` says.
   - A check that reports from GitHub Actions (the merged PR's `gh pr checks` gives it a `workflow`) is pinned to the same `integration_id`; others are left unpinned. A check already in the ruleset keeps its pinning.
   - With no `required_status_checks` rule yet, add one with `strict_required_status_checks_policy: false`.
6. **Re-read** the ruleset and show its required checks. They now equal the wanted list (less any check left out at 3) plus `ship`.

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
  - User to-do: `SHIP_TOKEN` now needs only Pull requests read/write, as the Dependabot secret. Delete the Actions secret (`gh secret delete SHIP_TOKEN --repo <owner>/<repo>`), save a new token with only Pull requests read/write as the Dependabot secret (`gh secret set SHIP_TOKEN --app dependabot --repo <owner>/<repo>`), and revoke the old one, which could also write contents and workflows. Run both in a separate terminal, not with `!` in the Claude session (`gh secret set` can't prompt there and saves an empty value), or use `https://github.com/<owner>/<repo>/settings/secrets/dependabot`. Remove any hourly `/ship:resolve-conflicts` routine.
- **4:** `shipping.md` names the cloud environment `/ship:night-shift` creates its builder routines in (its "Night builds" section, `__CLOUD_ENVIRONMENT__`). `ship.yml` changes only its version line.
  - Rendering: version 3's base renders with the current rules (`scripts/render.mjs`); it has no `__CLOUD_ENVIRONMENT__`.
  - Ask only for the cloud environment (step 1.8), recommending the one named like the repository. Nothing else changes: no labels, ruleset changes, upgrade steps or user to-dos.
