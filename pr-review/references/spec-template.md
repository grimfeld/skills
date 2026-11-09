# Fix spec template

Write to `.scratch/pr-review-<id>/spec.md`. Unlike a feature spec, this one names files and lines: the findings are about specific code at a specific commit.

```markdown
# Fix spec: review findings for <PR title or branch>

Status: ready-for-agent
Report: .scratch/pr-review/<id>.md
Base `<base>` · head `<short sha>` at review time

## Context

<Two to four sentences: what the PR does, and the spec it implements if one was found.>

## Approved findings

| Id | Severity | Finding | Where | Ticket |
|---|---|---|---|---|
| B1 | blocker | <title> | `<file>:<line>` | 01 |

For each finding, in id order:

### B1 · <title>

- **Evidence:** <evidence from the report>
- **Fix approach:** <the agreed move; refine the reviewer's suggested_fix if verification or approval added detail>

## Testing

<For each ticket: the failing test to write first, at the highest seam that exercises the behaviour, or the concrete manual / CI check when an honest test is impractical. Name prior-art tests in the repo to model on.>

## Out of scope

- <Rejected findings, with the user's reason>
- <Deferred findings, with the note>
- <Anything the fixes must not touch>
```
