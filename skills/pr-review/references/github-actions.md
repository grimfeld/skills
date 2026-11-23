# GitHub Actions checklist

For the `quality` and `security` lenses, when the diff has a **workflow file**: anything under `.github/workflows/`, an `action.yml` or `action.yaml`, or a YAML file with top-level `on:` and `jobs:` keys (a workflow template, such as `skills/setup-ship/templates/ship.yml`).

Workflow bugs hide in the event model, not in the YAML: each item below is a failure that passed earlier reviews here. For each, the failure, then the sign in a diff. Report what you find in your own lane, in the usual finding format; cite the item by its name in `category` (`actions:race`, `actions:concurrency`, …).

## 1. One event, several runs (`actions:race`)

**Failure:** one action fires more than one workflow run, and the runs race. Merging a PR closes it *and* pushes to its base; adding a label fires `labeled` on top of the `synchronize` from the push before it; one workflow's write starts another. Two runs then read the same state and both act (two `queue` runs from one merge each landing the next PR), or the second sees state the first half-changed.

**Sign:** a workflow listening to several events or activity types that one user action produces together (`pull_request: [closed]` and `push`; `labeled` and `synchronize`; `workflow_run` plus the event that started that run), or two workflows that react to the same event, with steps that write (merge, label, comment, push, status). Ask: for one merge, label or push, how many runs start, and what does each do if the other ran first?

## 2. Concurrency keeps one pending run (`actions:concurrency`)

**Failure:** a `concurrency` group holds at most one running and one *pending* run. A newer run replaces the pending one, which is cancelled without running, even with `cancel-in-progress: false`. A group keyed too wide (per workflow, per branch) cancels a run that carried its own event: a `synchronize` run that should have set a status, a cascade step for the next PR in a stack.

**Sign:** a new or changed `concurrency:` key; a group that doesn't include what makes each run distinct (the PR number, the head SHA, the event); a design that relies on every queued run eventually running. For a 3-level stack or a burst of events, count how many runs queue on one group.

## 3. A second run's writes fail under `bash -e` (`actions:idempotence`)

**Failure:** `run:` steps use `bash -e` by default (`set -eo pipefail`). A write that already happened fails the second time: deleting a label that's gone (404), creating one that exists (422), merging an already merged PR (405), and the step, then the job, goes red. Writes that don't fail duplicate instead: two identical comments, two status updates in the wrong order.

**Sign:** `gh` or `curl` writes in a `run:` step with no check before them and no `|| true` / `--silent` on a missing target: `gh api -X DELETE …/labels/…`, `gh pr merge`, `gh label create` without `--force`, `gh pr comment` with no look for an earlier comment. Ask what the step does when it runs twice for one event (see 1) or is re-run by hand.

## 4. `pull_request` vs `pull_request_target` (`actions:trigger`)

**Failure:** `pull_request_target` runs the **base branch's** workflow with a **write** `GITHUB_TOKEN` and the repository's secrets, even for a PR from a fork. Checking out or running the PR's code there (`actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}`, a build or install script, `${{ github.event.pull_request.title }}` in a `run:` line) hands that token to the PR's author. `pull_request` from a fork gets a read-only token and no secrets, so a write step that works on a same-repo PR fails on a fork.

**Sign:** a switch to or from `pull_request_target`; a checkout of the head ref in a `pull_request_target` job; `${{ github.event.* }}` text (titles, bodies, branch names, comments) interpolated straight into `run:` instead of passed through `env:`; `permissions:` widened; secrets used in a job that fork PRs can start.

## 5. What `GITHUB_TOKEN` writes don't trigger (`actions:token-trigger`)

**Failure:** events caused by the default `GITHUB_TOKEN` don't start new workflow runs (except `workflow_dispatch` and `repository_dispatch`). A label, push, merge or PR opened with it starts nothing, so a chain that expects "label it, and the gate workflow runs" silently never runs. A personal or app token does start runs, and can loop.

**Sign:** a workflow step that writes with `GITHUB_TOKEN` (or `secrets.GITHUB_TOKEN`, or `gh` with no other token) and a design where another workflow, or this one, is meant to react to that write; the reverse, a write with a PAT or app token in a workflow that listens to the event it causes (a loop).

## 6. A template with mode blocks: review every render (`actions:template`)

**Failure:** a workflow template with mode blocks or placeholders (`__PLACEHOLDER__` values, `# >>> <mode> mode` blocks that setup keeps or removes, as in `setup-ship`'s `ship.yml` and its `templates/history/` versions) is several workflows. A bug that exists only in one mode's render, or only when a placeholder takes one of its values, is invisible in the template text.

**Sign:** a changed template with mode markers or placeholders. Render it once per mode, with the placeholder values the setup skill can write (read the skill that renders it, such as `setup-ship`), and review each render against items 1–5. Name the mode in any finding.
