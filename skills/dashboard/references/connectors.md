# Connector tools the dashboard calls

Every tool in `CONNECTORS` (`page/dashboard.html`): the arguments the page passes, the response it reads, and the errors it relies on. Add a tool here when you add it to `CONNECTORS` and to the capabilities in `SKILL.md`.

**Observed** means a real, read-only call through the connector tool in a Claude Code cloud session, on the date given. **Not observed** means nobody has seen the reply: the entry says what the page assumes, and the code has to survive that guess being wrong.

## How the page sees a reply

The page calls tools with `window.claude.use("mcp").callTool(server, tool, input, options)`. The reply comes back as `{ payload, content, cache }`:

- `payload`: the tool's JSON answer, parsed. The shapes below are the JSON each tool returned.
- `content`: the tool's raw content blocks. Only `get_file_contents` is read from them (`fileText` in `board.mjs`).
- A failure rejects with `{ code, message }`. A tool's own error (GitHub's answer) has `code: "tool_error"` and the tool's error text as `message`. Connector-level refusals have the codes in `DENIED` in the page.

The calls below were made from the session's own MCP client, which shows `payload` and `content` but not that wrapper. Where the page reads an array, it goes through `listOf(payload, key)`, which takes a bare array or `payload[key]`, so either form works.

## GitHub (`github`)

### `list_issues`

Observed 2026-11-23.

- **Arguments:** `{ owner, repo, state: "OPEN" | "CLOSED", perPage: 100 | 50, orderBy: "UPDATED_AT", direction: "DESC", fields: ["number", "title", "body", "state", "labels", "created_at", "updated_at"] }`, plus `since` (ISO time) for closed issues. `state` is upper case here, unlike `list_pull_requests`.
- **Response:** an object, not an array: `{ issues: [...], pageInfo: { hasNextPage, endCursor, ... }, totalCount }`. The page reads `payload.issues`.
- **Each issue:** only the fields asked for. `labels` is an array of **strings** (`["retro", "spec:ready"]`), not `{ name }` objects; `board.mjs`'s `names()` takes both. `state` is `"OPEN"` or `"CLOSED"`.
- **No `closed_at`:** it isn't a field `list_issues` offers. Landed uses `updated_at` for closed specs.

### `list_pull_requests`

Observed 2026-11-23.

- **Arguments:** `{ owner, repo, state: "open" | "closed", perPage: 100 | 50, sort: "updated", direction: "asc" | "desc", fields: ["number", "title", "body", "state", "draft", "merged", "merged_at", "labels", "head", "base", "created_at", "updated_at"] }`. `state` is lower case.
- **Response:** a bare array of PRs. The page's `listOf` takes it as is.
- **Each PR:** `labels` is an array of **strings**. `head` and `base` are `{ ref, sha, repo: { full_name, description } }`. `head.repo.full_name` is how `board.mjs` (`isOwnPr`) tells a PR from this repo from one from a fork. `state` is `"open"` or `"closed"`; `merged` is a boolean and `merged_at` is null until it merges.

### `pull_request_read`

Observed 2026-11-23. Three methods; each takes `{ method, owner, repo, pullNumber }`.

- **`get`** (fresh labels before an Approve or Un-approve): one PR object, the fields of `list_pull_requests` plus `body`, `user`, `merged_by`, `mergeable_state`, `additions`, `deletions`, `changed_files`, `commits`, `html_url` and `closed_at`. `labels` is an array of strings; `labelWrite` reads only `payload.labels`.
- **`get_check_runs`**: `{ total_count, check_runs: [{ id, name, status, conclusion, html_url, details_url, started_at, completed_at }] }`. `status` is `"completed"` once done; `conclusion` is then `"success"`, `"skipped"`, `"failure"` and so on. The page reads `payload.check_runs`.
- **`get_status`**: `{ state, sha, total_count, statuses: [{ state, context, description, created_at, updated_at }] }`. The `ship` gate is the status with `context: "ship"`. The page reads `payload.statuses`.

### `get_file_contents`

Observed 2026-11-23.

- **Arguments:** `{ owner, repo, path }`, with no `ref`, so it reads the default branch. Paths: `docs/agents/shipping.md` (is this repo set up for ship?) and `.github/workflows/ship.yml` (the gate version).
- **A file:** two content blocks. A text line, `successfully downloaded text file (SHA: <sha>)`, then an embedded resource whose URI is `repo://<owner>/<repo>/sha/<commit>/contents/<path>` and whose `text` is the file. `fileText` reads the first `resource` block's `text`. (It also reads the REST form, `{ content, encoding: "base64" }`, which this connector didn't return.)
- **A missing file:** a `tool_error` whose message is exactly:

  > Failed to get file contents. The path does not point to a file or directory, or the file does not exist in the repository.

  It contains neither "404" nor "not found". `isMissingFile` in `board.mjs` matches `does not point to a file` and `does not exist`, as well as `404` and `not found` for other connector versions. Any other `tool_error` is a GitHub hiccup: the repo is "couldn't be checked", not "not set up".

### `issue_read`

Observed 2026-11-23.

- **Arguments:** `{ method: "get_comments", owner, repo, issue_number, perPage: 100 }` (the morning-page link).
- **Response:** a bare array of comments, `[]` when there are none.
- **Each comment:** `{ id, body, html_url, user: { login, ... }, author_association, reactions, created_at, updated_at }`. `author_association` is a string such as `"OWNER"`; `morningPage` trusts a night-shift comment only when it is `OWNER`, `MEMBER` or `COLLABORATOR`.

### `issue_write`

Observed 2026-11-23 (a label update on a spec issue).

- **Arguments:** only `{ method: "update", owner, repo, issue_number, labels }`, through `callWrite`, which refuses anything else. `labels` replaces the whole list, so the page sends every label the PR keeps.
- **Response:** `{ id, url }`, with `id` a string and `url` the issue's (or PR's) `github.com` page. The page doesn't read it: success is the call resolving.

## Claude Code Remote (`Claude Code Remote`)

### `list_repos`

Observed 2026-11-23.

- **Arguments:** `{ limit: 100 }`.
- **Response:** `{ repos: [{ full_name, url, pushed_at, visibility, can_push }], has_more }`, most recently pushed first. The page reads `payload.repos[].full_name` and drops anything `normaliseRepo` changes.

### `list_environments`

Observed 2026-11-23.

- **Arguments:** `{ limit: 100 }`.
- **Response:** `{ environments: [{ environment_id, name, description, state, kind, created_at }], has_more }`. The page reads `payload.environments` and keeps entries with an `environment_id`.
- **`kind`:** `"anthropic_cloud"` for a cloud environment (the `Default` one among them), `"bridge"` for one on the viewer's own machine (its `description` is `Bridge environment (<machine name>)`). `preselectEnvironment` prefers a cloud one; the picker labels a bridge one "your machine". `state` was `"active"` on every one.

### `create_session`

**Not observed.** Starting a session is a write that the builder can't undo, so it wasn't called.

- **Arguments:** exactly `{ prompt, title, source_url: "https://github.com/<owner>/<repo>", environment_id }` (`startSession`).
- **What the page assumes:** the tool's description says it "returns the new session's ID and status". `sessionLink` in `board.mjs` looks for the id as `session_id`, `id`, `session.id` or `session.session_id`, in `payload` or in a JSON text block, and links `https://claude.ai/code/<id>` only when it is a plain id. Otherwise the page links the viewer's sessions at `https://claude.ai/code`. The tests assume `{ session_id: "session_…", status }`.
- **Errors:** any failure is shown as "it may have gone through" (`writeError`), and the page never retries, since a failed start may still have made a session.
