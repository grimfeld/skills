# Finding format

Shared by every lens reviewer and the orchestrator. Single source of truth for the schema, severity scale and dedupe rule.

## Reviewer output

Return exactly two things, nothing else:

1. One **coverage** line: `Coverage: <what you checked> | Skipped: <what you could not check, and why>`.
2. One fenced `json` block holding an array of findings (empty array when you found nothing).

```json
[
  {
    "file": "src/api/users.ts",
    "line": 42,
    "severity": "major",
    "category": "authorization",
    "title": "User lookup skips ownership check",
    "evidence": "`getUser(req.params.id)` returns any user's record; no comparison with `req.session.userId`. Quoted hunk: ...",
    "suggested_fix": "Compare the record's ownerId with the session user before returning; 404 otherwise.",
    "source_skill": "security-and-hardening",
    "confidence": "high",
    "lane": "in"
  }
]
```

| Field | Rule |
|---|---|
| `file`, `line` | Path relative to the repo root; the line in the head version. Use the first line of the range. A finding about the whole change uses `"file": "(change)"`, `"line": 0`. |
| `severity` | One of the scale below. |
| `category` | Short kebab-case slug from your lens (`injection`, `n-plus-one`, `deep-nesting`, `principle:boundary-discipline`). |
| `title` | The claim in under 12 words. |
| `evidence` | The quoted code and why it is a problem. A finding with no quoted code or concrete observation is not a finding. |
| `suggested_fix` | The specific move, not "consider improving". |
| `source_skill` | Your lens's `source` from its front matter. |
| `confidence` | `high` (you traced it), `medium` (likely, one assumption unverified), `low` (a heuristic match). |
| `lane` | `in` for your lens's scope; `out` for something outside it you noticed anyway. |

Lenses may add `evidence_type` (`measured` or `source`) where their brief says so.

## Severity scale

| Severity | Means | Examples |
|---|---|---|
| `blocker` | Must not merge: broken behaviour, data loss, exploitable vulnerability, spec requirement missing | IDOR, SQL injection, crash on the main path, failing CI |
| `major` | Should fix before merge: a real defect or a structural regression | Unhandled error path, N+1 on a list endpoint, missing test for a bug fix, feature logic in a shared module |
| `minor` | Worth fixing, not urgent | Unclear name, a missed simplification, a missing index on a small table |
| `nit` | Cosmetic or preference | Comment wording, import order not caught by tooling |

Rate by consequence, not by lens: a readability lens can raise a `major`, a security lens can raise a `nit`.

## Dedupe rule (orchestrator)

Two findings are duplicates when they share a `file`, their lines are within 5 of each other, and they describe the same root cause (same fix would resolve both). Findings in different files are duplicates only when one root cause produces both and one fix resolves both.

Merge duplicates into one finding:

- `severity`: the highest of the group.
- `confidence`: the highest of the group.
- `source_skill`: every distinct value, as an array.
- `evidence` and `suggested_fix`: the most specific of the group; append any distinct detail from the others.
- `lane`: `in` if any member was `in`.

**Corroboration**: a merged finding reported by two or more lenses ranks above single-lens findings of the same severity.
