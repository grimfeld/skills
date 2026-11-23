# GitHub access for ship skills

Use the `gh api` REST form in the `gh` column first. It works locally and in a claude.ai/code cloud session, where GitHub's GraphQL API is refused ("HTTP 403: GitHub GraphQL is not available from Claude Code sessions") and with it every `gh issue …` and `gh pr …` command. Porcelain appears below only where GitHub has no REST form.

If `gh` isn't installed or isn't authenticated, use the GitHub MCP tools instead. Find them with ToolSearch (`github issue`, `github pull request`). The project's `docs/agents/issue-tracker.md` overrides this page when it says otherwise.

**Naming the repository.** `gh api` fills `{owner}/{repo}` only while the shell's working directory is inside the clone. A skill that may have moved its shell (to the scratchpad, a worktree outside the repository, `/tmp`) takes `<owner>/<repo>` once, while still in the clone, and writes it out in every later call:

```sh
REPO=$(git remote get-url origin | sed -E 's#(\.git)?/?$##; s#.*[/:]([^/:]+/[^/:]+)$#\1#')   # e.g. grimfeld/skills, also through a proxy remote
gh api "repos/$REPO/issues/<n>"
```

Search queries (`q=repo:…`) never fill `{owner}/{repo}`: always write the repository out there. With MCP, pass `owner` and `repo` from the same remote.

`-F body=@<file>` sends a file's contents as a field; `-f` sends a literal string.

| Need | `gh` | GitHub MCP |
|---|---|---|
| Read an issue | `gh api repos/{owner}/{repo}/issues/<n>`, then `gh api --paginate repos/{owner}/{repo}/issues/<n>/comments` | `issue_read` `get`, then `get_comments` |
| Search issues | `gh api -X GET search/issues -f q='repo:<owner>/<repo> is:issue is:open label:<l> <words>'`. `is:issue` is required: without it the search answers 422. | `search_issues`, else `list_issues` with `labels` |
| List issues by label | `gh api --paginate 'repos/{owner}/{repo}/issues?state=open&labels=<l>&per_page=100' --jq '.[] \| select(.pull_request \| not)'` (the issues API returns PRs too; the `select` drops them) | `list_issues` with `labels` |
| Create an issue | `gh api repos/{owner}/{repo}/issues -f title='…' -F body=@body.md` | `issue_write` `create` |
| Edit an issue's body | `jq -Rs '{body: .}' body.md \| gh api -X PATCH repos/{owner}/{repo}/issues/<n> --input -` | `issue_write` `update` |
| Create a label | `gh api repos/{owner}/{repo}/labels -f name=<l> -f description='…' -f color=<hex without #>` | none |
| Read a label | `gh api repos/{owner}/{repo}/labels/<l>` (404 when it doesn't exist) | `get_label` |
| Add a label | `gh api repos/{owner}/{repo}/issues/<n>/labels -f 'labels[]=<l>'` | `issue_write` `update` with the full label list |
| Remove a label | `gh api -X DELETE repos/{owner}/{repo}/issues/<n>/labels/<l>` | `issue_write` `update` with the full label list |
| Comment | `gh api repos/{owner}/{repo}/issues/<n>/comments -F body=@comment.md` | `add_issue_comment` |
| Edit a comment | `jq -Rs '{body: .}' body.md \| gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> --input -` | `update_issue_comment`, else post a new comment instead |
| Sub-issue | `gh api repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id=<child's id, not number>` | `sub_issue_write` `add` |
| Open a draft PR | `gh api repos/{owner}/{repo}/pulls -f base=<base> -f head=<branch> -f title='…' -F body=@body.md -F draft=true` | `create_pull_request` with `draft: true` |
| Read a PR | `gh api repos/{owner}/{repo}/pulls/<n>` (number, title, body, `.base.ref`, `.head.ref`, `.head.sha`, `.html_url`, `.draft`) | `pull_request_read` `get` |
| A PR's checks | `gh api repos/{owner}/{repo}/commits/$(gh api repos/{owner}/{repo}/pulls/<n> --jq .head.sha)/check-runs --jq '.check_runs[] \| "\(.name) \(.status) \(.conclusion)"'` | `pull_request_read` `get_check_runs`, or `get_status` |
| Wait for a PR's checks | The loop below, at most 30 minutes. A timeout means the checks are still pending, never green. | `pull_request_read` `get_check_runs` every 30 seconds, for at most 30 minutes, until every check run is `completed` |
| A commit's checks | `gh api repos/{owner}/{repo}/commits/<sha>/check-runs`, `.../commits/<sha>/status` | `get_commit`, then `pull_request_read` `get_check_runs` on its PR |
| List open PRs | `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100'` | `list_pull_requests` with `state: open` |
| Search merged PRs | `gh api -X GET search/issues -f q='repo:<owner>/<repo> is:pr is:merged <words>'`, then `gh api repos/{owner}/{repo}/pulls/<n>` for `additions`, `deletions`, and `.../pulls/<n>/files` for the files | `list_pull_requests` with `state: closed`, then `pull_request_read` `get` and `get_files` |
| Merge a PR | `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=<m> -f sha=<sha>` | `merge_pull_request` |
| Retarget a PR | `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -f base=<branch>` | `update_pull_request` with `base` |
| Edit a PR's body | `jq -Rs '{body: .}' body.md \| gh api -X PATCH repos/{owner}/{repo}/pulls/<n> --input -` | `update_pull_request` with `body` |
| Splice a section into a PR body | `uv run --no-project python ${CLAUDE_PLUGIN_ROOT}/skills/pr-review/scripts/update-pr-body.py [--markers <name>] <n> <section.md>` (fetches and patches with `gh api`; `<name>` defaults to `pr-review`, build-spec's Decisions use `build:decisions`) | `pull_request_read` `get`, saving `body` to `current.md`; then `update-pr-body.py [--markers <name>] --body-file current.md <section.md> > new.md`, which calls no `gh`; then `update_pull_request` with `body` = `new.md`'s contents. One read and one update per change. |
| Mark a PR ready | Cloud session: `gh api -X POST repos/{owner}/{repo}/pulls/<n>/ccr/ready_for_review` (back to draft: `…/ccr/convert_to_draft`). Locally: `gh pr ready <n>` (GitHub has no public REST form). | `update_pull_request` with `draft: false` |
| Label a PR | as for an issue: PRs share the issues API | as for an issue |
| Start a workflow run | `gh api -X POST repos/{owner}/{repo}/actions/workflows/<file>/dispatches -f ref=<branch>` | `run_workflow` (actions toolset) |
| A PR's timeline | `gh api repos/{owner}/{repo}/issues/<n>/timeline` | none; take the PR's creation time instead of its `ready_for_review` event |
| A PR's reviews and comments | `gh api repos/{owner}/{repo}/pulls/<n>/reviews`, `.../pulls/<n>/comments`, `.../issues/<n>/comments` | `pull_request_read` `get_reviews`, `get_review_comments`, `get_comments` |
| A failed job's log | `gh api repos/{owner}/{repo}/actions/jobs/<job id>/logs` (a GitHub Actions check run's id is its job id) | `get_job_logs` with `failed_only` (actions toolset) |
| A workflow's latest runs | `gh api 'repos/{owner}/{repo}/actions/workflows/<file>/runs?event=<event>&per_page=1'` | `list_workflow_runs` |
| Your access to a repository | `gh api repos/<owner>/<repo> --jq .permissions` (`admin`, `maintain`, `push`, `triage`, `pull`) | none: try the write and read the error |
| The authenticated user | `gh api user --jq .login` | `get_me` |

The `ccr/` routes exist only in a claude.ai/code cloud session, where the session's proxy serves them; the GraphQL 403 message names them.

## Wait for a PR's checks

One blocking loop in one shell call, so the wait stays in your turn. Run it inside the clone, or write `<owner>/<repo>` out as above.

```sh
SHA=$(gh api repos/{owner}/{repo}/pulls/<n> --jq .head.sha)
end=$(( $(date +%s) + 1800 ))
until [ "$(gh api repos/{owner}/{repo}/commits/$SHA/check-runs --jq '[.check_runs[]|select(.status!="completed")]|length')" = 0 ]; do
  [ "$(date +%s)" -ge "$end" ] && { echo "timed out waiting for checks"; break; }
  sleep 30
done
gh api repos/{owner}/{repo}/commits/$SHA/check-runs --jq '.check_runs[]|"\(.name) \(.conclusion)"'
```

Set the shell call's own timeout above 30 minutes (or run it in the background and wait for it to finish). A commit with no check runs at all passes the loop at once: if the project's CI should have started, check the PR's checks again before treating them as green. Commit statuses (such as `ship`) aren't check runs and don't hold the loop; read them with `.../commits/$SHA/status`.
