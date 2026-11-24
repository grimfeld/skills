# GitHub Actions checklist

For the `quality` and `security` lenses, when the dispatch prompt lists **workflow files** (pr-review's step 3 defines them; templates such as `skills/setup-ship/templates/ship.yml` count).

Workflow bugs hide in the event model, not in the YAML: each item below is a failure that passed earlier reviews here. For each, the failure, then the sign in a diff. Report what you find in your own lane, in the usual finding format; cite the item by its name in `category` (`actions:race`, `actions:concurrency`, …).

## 1. One event, several runs (`actions:race`)

**Failure:** one action fires more than one workflow run, and the runs race. Merging a PR closes it *and* pushes to its base; adding a label fires `labeled` on top of the `synchronize` from the push before it; one workflow's write starts another. Two runs then read the same state and both act (two `queue` runs from one merge each landing the next PR), or the second sees state the first half-changed.

**Sign:** a workflow listening to several events or activity types that one user action produces together (`pull_request: [closed]` and `push`; `labeled` and `synchronize`; `workflow_run` plus the event that started that run), or two workflows that react to the same event, with steps that write (merge, label, comment, push, status). Ask: for one merge, label or push, how many runs start, and what does each do if the other ran first?

## 2. Concurrency keeps one pending run (`actions:concurrency`)

**Failure:** a `concurrency` group holds at most one running and one *pending* run. A newer run replaces the pending one, which is cancelled without running, even with `cancel-in-progress: false`. A group keyed too wide (per workflow, per branch) cancels a run that carried its own event: a `synchronize` run that should have set a status, a cascade step for the next PR in a stack.

**Sign:** a new or changed `concurrency:` key; a group that doesn't include what makes each run distinct (the PR number, the head SHA, the event); a design that relies on every queued run eventually running. For a 3-level stack or a burst of events, count how many runs queue on one group.

## 3. A second run's writes fail, or failures hide (`actions:idempotence`)

**Failure:** a `run:` step with no `shell:` key, and no `defaults.run.shell` on its job or workflow, runs on Linux and macOS runners as `bash -e {0}`: errexit, but **no pipefail**. With `shell: bash` it runs `bash --noprofile --norc -eo pipefail {0}`. A write that already happened fails the second time: deleting a label that's gone (404), creating one that exists (422), merging an already merged PR (405), and the step, then the job, goes red. Writes that don't fail duplicate instead: two identical comments, two status updates in the wrong order. And a failure can hide: under the default shell, a failing `gh api` piped into `jq`, `sed` or `head` leaves the step green and an empty value flowing on; `curl` without `--fail` exits 0 on a 404, 405 or 422.

**Sign:** `gh` or `curl` writes in a `run:` step with no read-before-write check and no guard scoped to the expected error (a 404 on a DELETE, a 422 on a create): `gh api -X DELETE …/labels/…`, `gh pr merge`, `gh label create` without `--force`, `gh pr comment` with no look for an earlier comment. `--silent` is no guard: it only hides output (`gh api` still fails on any 4xx). Also a read or write in a pipeline under the default shell, and `curl` without `--fail`, whose failure nobody sees. Ask what the step does when it runs twice for one event (see 1), is re-run by hand, or its API call fails.

## 4. `pull_request` vs privileged triggers (`actions:trigger`)

**Failure:** `pull_request_target` runs the **default branch's** workflow (since December 2025, whatever the PR's base: a fix to the workflow on a stacked PR's base branch doesn't apply until it reaches the default branch), with a `GITHUB_TOKEN` that can write unless `permissions:` narrows it, and the repository's secrets, even for a PR from a fork. `workflow_run` and `issue_comment` run the same way, in the base repository with its token and secrets, on input a fork PR or any commenter controls. Checking out or running the PR's code there (`actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}`, a build or install script, `${{ github.event.pull_request.title }}` in a `run:` line) hands that token to the PR's author. `pull_request` from a fork gets a read-only token and no secrets, so a write step that works on a same-repo PR fails on a fork; `pull_request_review` and `pull_request_review_comment` behave like `pull_request` for forks.

**Sign:** a switch to or from `pull_request_target`, `workflow_run` or `issue_comment`; a checkout of the head ref, the head SHA or `refs/pull/*/head` in one of those jobs; a `workflow_run` job that downloads the triggering run's artifacts and runs or trusts them; `${{ github.event.comment.body }}` or `${{ github.event.workflow_run.head_branch }}` in a `run:` line; `${{ github.event.* }}`, `${{ github.head_ref }}` or any other attacker-written context (titles, bodies, branch names, comments, commit messages) interpolated straight into `run:` or an `actions/github-script` `script:` instead of passed through `env:`; `permissions:` widened; secrets used in a job that fork PRs can start.

## 5. What `GITHUB_TOKEN` writes don't trigger (`actions:token-trigger`)

**Failure:** events caused by the default `GITHUB_TOKEN` don't start new workflow runs (except `workflow_dispatch` and `repository_dispatch`). A label, push, merge or PR opened with it starts nothing, so a chain that expects "label it, and the gate workflow runs" silently never runs. A personal or app token does start runs, and can loop.

**Sign:** a workflow step that writes with `GITHUB_TOKEN` (or `secrets.GITHUB_TOKEN`, or `gh` with no other token) and a design where another workflow, or this one, is meant to react to that write; the reverse, a write with a PAT or app token in a workflow that listens to the event it causes (a loop).

## 6. A template with mode blocks: review every render (`actions:template`)

**Failure:** a workflow template with mode blocks or placeholders (`__PLACEHOLDER__` values, `# >>> <mode> mode` blocks that setup keeps or removes, as in `setup-ship`'s `ship.yml` and its `templates/history/` versions) is several workflows. A bug that exists only in one mode's render, or only when a placeholder takes one of its values, is invisible in the template text.

**Sign:** a changed template with mode markers or placeholders. Render it once per mode, with the placeholder values the setup skill can write (read the skill that renders it, such as `setup-ship`), and review each render against items 1–5. Name the mode in any finding.
