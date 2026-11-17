---
lens: principles
source: ub-mode
upstream_path: ~/.claude/skills/ub-mode/SKILL.md
upstream_hash: 81f4dafefe2dbc866d9a6b7d4e1d21634b59b4b8414ee362aac94c4dc4d81c6f
---

# Lens: principles

Check the diff against the user's reduced principles. Your lane: **these principles only**. Set `category` to `principle:<slug>` using the heading below (e.g. `principle:boundary-discipline`). Generic readability, bugs, security and performance belong to other lenses; mark any you report `"lane": "out"`.

Principles are judgement calls: severity `minor` by default, `major` when the violation will clearly cause a defect or block a later change, `nit` for small lapses.

## Tools

Run these on the changed source files only (pass them as path arguments). They write to `.metrics/` and touch nothing else. Skip a tool whose language is unsupported, and say so in the coverage line.

- `crapper --use-existing-coverage <files>` (or `--no-coverage` when no coverage is on disk): every changed function at CRAP ≥ 10 is a `principle:crapper` finding; suggest splitting, testing, or both. Consider whether a long `case` is worth reducing before flagging it.
- `dryer <files>`: every pair at similarity ≥ 0.8 involving a changed function is a `principle:dryer` finding.

`mutator` rewrites source and runs the tests; it is outside a report-only review.

## First Make it Work

- **laziness-protocol**: One decision lives in one place. The smallest edit that solves the problem.
- **foundational-thinking**: The data shape is right before the logic. If a concurrent writer would matter, state is not shared.
- **tdd**: A failing test came first for the change (check commit order and that the test exercises the change). Where an honest test is impractical, no bad test was written instead.
- **redesign-from-first-principles**: A new requirement is not bolted onto the old design; the design is what you would have built had the requirement been there from the start.
- **subtract-before-add**: Complexity was taken out before anything was added.
- **model-the-domain**: The domain sits in a structure that makes illegal states impossible. Domain terms match the glossary. Code already clear and local is left alone.
- **boundary-discipline**: Data is checked where it enters; inside, it is trusted. Business logic sits in pure functions.
- **type-system-discipline**: Illegal values are impossible to write. Outside data is parsed once, where it comes in. The compiler is not silenced (`@ts-ignore`, `as any`, `# type: ignore`, `eslint-disable`, `!` non-null assertions).
- **idempotent-operations**: Running it twice, or after a crash halfway, ends in the same state.
- **separate-shared-state**: Actors that don't need the same mutable thing each get their own; when they do, one writer, enforced in the structure.

## Then Make it Right

- **fix-root-causes**: A guard that only hides a crash is not a fix. Look for null checks, try/catch or fallbacks added around a symptom.
- **verifiable-units**: The change is sequenced into small units, each checked before the next.
- **test-behavior**: Tests call the code the way its user does and check what that user would see. A test that would still pass if every function returned nothing is a finding.
- **refactoring**: A structural change pins behaviour first and proves it unchanged.
- **crapper**, **dryer**: from the tools above.

## Practice

- **commits**: Commits are small and ordered; each message says why, what changed, and how it was proved. Check `git log <base>..<head>`.

Done when every changed function has been checked against every principle above that applies to it, and both tools have run or been reported as skipped.
