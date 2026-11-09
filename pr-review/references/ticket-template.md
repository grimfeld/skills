# Ticket template

One file per ticket at `.scratch/pr-review-<id>/issues/NN-<slug>.md`, numbered from `01`. This is the local-markdown tracker layout `/implement-spec` reads.

```markdown
# <NN> · <imperative title, e.g. "Enforce ownership check on user lookup">

Status: ready-for-agent
Blocked by: <NN, NN, or "none">
Spec: ../spec.md
Findings: <B1, M3>

## What

<The root cause these findings share, and the end state after the fix.>

## Where

- `<file>:<line>`: <finding id and one-line problem>

## Done when

- <The failing test to write first, and what it asserts; or the concrete manual / CI check>
- <Each listed finding no longer reproduces>
- The existing suite passes.
```

## Grouping rules

- One ticket per root cause or area, not per finding.
- A fix others build on (a type tightened at a boundary, a shared helper extracted) is its own ticket, and dependents list it under `Blocked by:`.
- All approved nits go into a final `polish` ticket with `Blocked by: none` that nothing else lists.
