# Report template

Write the report to `.scratch/pr-review/<id>.md`. Persistent sections (Rejected, Deferred) sit at the top and survive re-runs; each run adds a dated section below them, newest first.

```markdown
# PR review: <PR title or branch>

<PR url or branch> · base `<base>` · head `<short sha>`

## Rejected

Findings the user rejected. Matching findings are dropped on every later run.

| Finding | File | Reason | Run |
|---|---|---|---|
| <title> | `<file>:<line>` | <user's reason> | <date> |

## Deferred

| Finding | File | Note | Run |
|---|---|---|---|

---

## Run <YYYY-MM-DD HH:MM> · head `<short sha>`

### Summary

| Blocker | Major | Minor | Nit | Dropped by verification |
|---|---|---|---|---|
| n | n | n | n | n |

<On a re-run: n fixed · n still open · n new>

### CI

<Each failing check as a blocker line with its name and link, or "All checks passing", or "No PR: CI not checked">

### Lenses

| Lens | Status | Note |
|---|---|---|
| standards-and-spec | ran | spec: <source, or "no spec available"> |
| web-quality | ran | live: <url> / source-only: <why> |
| performance | skipped | <reason> |

<Lens drift: any lens run stale after the user chose skip>
<Lens failures: any lens that failed twice>

### Findings

Ordered by severity, then corroboration, then confidence.

#### B1 · <title>  `blocker` · <new | still open>

- **Where:** `<file>:<line>`
- **Reported by:** <source_skill, ...> <lane: out if out-of-lane>
- **Confidence:** <confidence> · **Verification:** confirmed: <reason>
- **Evidence:** <evidence>
- **Fix:** <suggested_fix>
- **Decision:** <approved | rejected: reason | deferred>

<Ids: B1.. blockers, M1.. majors, m1.. minors, N1.. nits>

### Fixed since last run

- <title> (`<file>`), was <id> in run <date>

### Dropped by verification

- <title> (`<file>:<line>`), from <source_skill>: <refutation reason>
```
