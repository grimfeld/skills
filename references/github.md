# GitHub access for ship skills

Use `gh` first. If `gh` isn't installed, isn't authenticated, or the cloud session's proxy refuses it, use the GitHub MCP tools instead. Find them with ToolSearch (`github issue`, `github pull request`). The project's `docs/agents/issue-tracker.md` overrides this page when it says otherwise.

Some repositories fail on `gh pr edit` with a GraphQL error about Projects (classic). Use the REST forms below for every edit.

| Need | `gh` | GitHub MCP |
|---|---|---|
| Read an issue | `gh issue view <n> --json title,body,labels,comments` | `issue_read` `get`, then `get_comments` |
| List issues by label | `gh issue list --label <l> --state open --json number,title,body,labels` | `list_issues` with `labels` |
| Create an issue | `gh issue create --title … --body-file …` | `issue_write` `create` |
| Edit an issue's body | `jq -Rs '{body: .}' body.md \| gh api -X PATCH repos/{owner}/{repo}/issues/<n> --input -` | `issue_write` `update` |
| Add a label | `gh api repos/{owner}/{repo}/issues/<n>/labels -f 'labels[]=<l>'` | `issue_write` `update` with the full label list |
| Remove a label | `gh api -X DELETE repos/{owner}/{repo}/issues/<n>/labels/<l>` | `issue_write` `update` with the full label list |
| Comment | `gh issue comment <n> --body-file …` | `add_issue_comment` |
| Edit a comment | `jq -Rs '{body: .}' body.md \| gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> --input -` | none: post a new comment instead |
| Sub-issue | `gh api repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id=<child's id, not number>` | `sub_issue_write` `add` |
| Open a draft PR | `gh pr create --draft --base … --head … --title … --body-file …` | `create_pull_request` with `draft: true` |
| Read a PR | `gh api repos/{owner}/{repo}/pulls/<n>` | `pull_request_read` `get` |
| A PR's checks | `gh pr checks <n> --json name,state,link` | `pull_request_read` `get_status`, or `get_check_runs` |
| A commit's checks | `gh api repos/{owner}/{repo}/commits/<sha>/check-runs`, `.../commits/<sha>/status` | `get_commit`, then `pull_request_read` `get_check_runs` on its PR |
| List open PRs | `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100'` | `list_pull_requests` with `state: open` |
| Merge a PR | `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=<m> -f sha=<sha>` | `merge_pull_request` |
| Retarget a PR | `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -f base=<branch>` | `update_pull_request` with `base` |
| Edit a PR's body | `jq -Rs '{body: .}' body.md \| gh api -X PATCH repos/{owner}/{repo}/pulls/<n> --input -` | `update_pull_request` with `body` |
| Mark a PR ready | `gh pr ready <n>` | `update_pull_request` with `draft: false` |
| Label a PR | as for an issue: PRs share the issues API | as for an issue |
| Start a workflow run | `gh workflow run <file> --ref <branch>` | `run_workflow` (actions toolset) |
| A PR's timeline | `gh api repos/{owner}/{repo}/issues/<n>/timeline` | none; take the PR's creation time instead of its `ready_for_review` event |
| A PR's reviews and comments | `gh api repos/{owner}/{repo}/pulls/<n>/reviews`, `.../pulls/<n>/comments`, `.../issues/<n>/comments` | `pull_request_read` `get_reviews`, `get_review_comments`, `get_comments` |
| A workflow's latest runs | `gh run list --workflow <file> --event <event> --limit 1` | `list_workflow_runs` |
| The authenticated user | `gh api user --jq .login` | `get_me` |

`{owner}/{repo}` is filled in by `gh api` inside a clone. With MCP, pass `owner` and `repo` from `git remote get-url origin`.
