---
lens: simplification
source: code-simplification
upstream_path: ~/.claude/skills/code-simplification/SKILL.md
upstream_hash: 15b6e21924188ee46402a8c91963162fd9056c7d
---

# Lens: simplification

Your lane: **readability**: code in the diff that is harder to read, follow or change than it needs to be. Every suggestion preserves behaviour exactly: same outputs, errors, side effects and ordering for every input. Bugs, security and performance belong to other lenses; mark any you report `"lane": "out"`.

The test for every finding: would a new team member understand the suggested version faster than the original? Fewer lines is not the goal; comprehension speed is.

## Scope and conventions

- Stay on lines the diff added or changed, plus code they make worse.
- Match the project's own style (`CLAUDE.md`, neighbouring code): import style, function declaration style, naming, error handling, type annotation depth. A suggestion that breaks project consistency is churn.
- **Chesterton's Fence**: before flagging something as unnecessary, find why it exists: read its callers and tests, and run `git log -L` or `git blame` on it. A reason you found goes in `evidence`; a reason you couldn't rule out lowers `confidence`.

## Patterns

**Structure**

| Pattern | Signal | Move |
|---|---|---|
| Deep nesting | 3+ levels | Guard clauses, extracted conditions |
| Long function | 50+ lines, several responsibilities | Split into named functions |
| Nested ternaries | Needs a mental stack to parse | if/else, switch, or lookup object |
| Boolean flag params | `doThing(true, false, true)` | Options object or separate functions |
| Repeated conditionals | Same check in several places | One named predicate |

**Naming**

| Pattern | Signal | Move |
|---|---|---|
| Generic names | `data`, `result`, `temp`, `val` | Name the content |
| Abbreviations | `usr`, `cfg`, `evt` | Full words, except `id`, `url`, `api` |
| Misleading names | `get` that mutates | Name the actual behaviour |
| "What" comments | `// increment counter` | Delete; keep "why" comments |

**Redundancy**

| Pattern | Signal | Move |
|---|---|---|
| Duplicated logic | Same 5+ lines in several places | Extract a shared function |
| Dead code | Unreachable branches, unused variables, commented-out blocks | Remove |
| Wrapper adding nothing | Pass-through function or class | Call the underlying function |
| Over-engineering | Factory for one product, strategy with one strategy | The direct approach |
| Redundant assertions | Casting to an already-inferred type | Remove |
| Needless `async`/`await` | `return await` of a single promise with no try | Return the promise |

## Over-simplification

Leave these alone: a helper that gives a concept a name; an abstraction that exists for testability or a real second use; two simple functions that would merge into one complex one.

## Severity

Most findings are `minor` or `nit`. Raise to `major` when the complexity hides a likely bug or will clearly slow every future change to this code.

Done when every added or changed function in the diff has been checked against every pattern table.
