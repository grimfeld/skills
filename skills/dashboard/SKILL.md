---
name: dashboard
description: Publish the ship dashboard, one live claude.ai page with every ship project's specs and PRs sorted into Needs you, Ready for tonight, In flight and Landed. Republishes to the same page when it already exists.
disable-model-invocation: true
---

# Dashboard

You publish the ship dashboard: one private Artifact page that reads GitHub live, through the viewer's own connectors, and sorts every project's specs, designs and PRs by what they need from the user. The page does the reading. Your job is to build it and publish it to the same URL every time.

You must never:
- commit the built page (it goes under a scratch directory, never into the repository)
- publish a second dashboard when one already exists: find it and republish to its URL

## 1. Build

Build the page, with the bucketing module inlined:

```
node ${CLAUDE_SKILL_DIR}/scripts/build.mjs <out>
```

`<out>` is `dashboard/dashboard.html` in your scratchpad directory, if the session has one, else `.scratch/dashboard/dashboard.html`. The script prints the path it wrote. If it fails, stop and show the error.

## 2. Find the existing dashboard

List the user's artifacts with the Artifact tool, `action: "list"`, `limit: 200`. The dashboard is the one titled exactly **Ship dashboard**. If several are, take the most recently updated and mention the others.

## 3. Publish

Every publish passes these capabilities. They are the connector tools the page calls, and must match `CONNECTORS` in `page/dashboard.html`. The page's writes are `issue_write` (Approve and Un-approve on PR cards) and `actions_run_trigger` (Land on a project row); `actions_list` finds the run Land started. A capability can't be narrowed to a tool's methods, so the page holds the whole of both write tools: it could close or retitle issues, or run any workflow. It only calls `issue_write`'s `update` with `labels` and `actions_run_trigger`'s `run_workflow` on `ship.yml`, all through one function (`callWrite`) that refuses anything else, and `build.test.mjs` checks every call site.

```json
{
  "mcp": {
    "servers": [
      { "server": "github", "tools": ["list_issues", "list_pull_requests", "pull_request_read", "get_file_contents", "issue_read", "issue_write", "actions_run_trigger", "actions_list"] },
      { "server": "Claude Code Remote", "tools": ["list_repos"] }
    ]
  }
}
```

- **Found:** read it first (`action: "read"` with its `url`), then publish the built file with `url` set to it and the capabilities above. Omit `icon`, so it keeps its own.
- **Not found:** publish the built file with the capabilities above, `icon: "dashboard"` and `description: "Every ship project's specs and PRs, sorted by what they need from you."`. Then offer, once, to pin it to the sidebar (`action: "pin"` on a yes), since it's a page to keep coming back to.

If a publish is refused because the page changed since you read it, read it again and publish once more. The page holds no content of its own, so the built file always replaces it whole.

## 4. Report

Print the link. Add one line on what the page needs: the GitHub connector, and Claude Code Remote to find projects on its own (without it, projects are added by name with **Add repo**). The first open asks the viewer to allow them.
