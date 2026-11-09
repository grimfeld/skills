---
lens: quality
source: code-review-and-quality
upstream_path: ~/.claude/skills/code-review-and-quality/SKILL.md
upstream_hash: 2c0b966d411b0d64c4f44efdde30d5f6f3666f76
---

# Lens: quality

Your lane: **correctness, tests, architecture, change size, dead code, dependency choice**. Security, performance, readability and naming each have their own lens; mark any you report `"lane": "out"`.

Lead with leverage. One structural problem outranks ten nits; a short list of high-conviction findings beats a long one. Report real defects at their real severity.

## 1. Context

Read the PR description, the commit messages and the spec. State the intended behaviour change in one sentence before reading code.

## 2. Tests first

- Do tests exist for the changed behaviour? A bug fix without a regression test is `major`.
- Do they test behaviour through the public seam, or implementation details?
- Are edge cases and error paths covered?
- **Would the tests catch a regression?** For each condition the change adds, ask: if it were inverted (a negation dropped, `&&` swapped for `||`), would a test fail? Answer by reading the tests. A condition no test would catch is a finding naming the missing case.

## 3. Correctness

- Does the code do what the tests and spec say?
- Edge cases: null, empty, boundary values, off-by-one.
- Error paths handled, not just the happy path.
- Race conditions, state inconsistencies, partial failure leaving bad state.

## 4. Architecture

- New pattern where an existing one fits? Justified?
- Module boundaries and dependency direction (no cycles).
- Duplication of an existing canonical helper.
- **Complexity reduced or relocated?** Count the concepts a reader must hold. A refactor that leaves the count unchanged is not cleaner.
- **Feature logic leaking into a shared module.**
- **Type boundaries explicit?** Gratuitous `any`/`unknown`/optional/casts and silent fallbacks papering over an unclear invariant.
- **A conditional bolted onto an unrelated flow**, or repeated conditionals on the same shape: a missing model or dispatcher.

Propose a named structural remedy, not just the problem: replace a conditional chain with a typed model or dispatcher; collapse duplicate branches; separate orchestration from business logic; move feature logic to its owning package; reuse the canonical helper; make a type boundary explicit; delete a pass-through wrapper; extract a helper or split a large file. Prefer the remedy that removes moving pieces.

**Presumptive `major`s**: a refactor that relocates complexity; a file pushed past ~1000 total lines with no decomposition; feature logic in a shared module; a near-duplicate of a canonical helper; a silent fallback hiding an unclear invariant.

## 5. Change size

- ~100 changed lines is good, ~300 acceptable for one logical change, ~1000 too large: report as a `(change)` finding with a split strategy (stack, by file group, horizontal, vertical).
- A refactor mixed with new behaviour is two changes.

## 6. Dead code

Code made unreachable or unused by this change: list each item with where its replacement lives.

## 7. Dependency choice

For each added or upgraded dependency: does the existing stack already solve this? Bundle size? Maintained? License compatible? A bulk bump of several packages, or a lockfile change with no manifest change, is a finding. (Vulnerabilities and supply-chain risk belong to the security lens.)

Done when every changed file has been walked through steps 2–4, and steps 5–7 have been checked against the whole change.
