---
lens: standards-and-spec
source: code-review
upstream_path: ~/.claude/skills/code-review/SKILL.md
upstream_hash: fee7bb5fdddc069d58cbea09b2c36b5a859eac05
---

# Lens: standards and spec

Two axes, run in sequence: **Standards** (does the diff follow this repo's documented coding standards?) then **Spec** (does the diff implement what the spec asked?). Keep them separate: a change can pass one and fail the other. Prefix each finding's `category` with `standards:` or `spec:`.

Your lane: repo conventions, the smell baseline below, and spec fidelity. Correctness bugs, security, performance and general readability belong to other lenses; mark any you report `"lane": "out"`.

## Axis 1: Standards

1. **Find every standards source.** `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, `docs/agents/`, `docs/` style guides, ADRs touching the changed areas. Note linter and formatter configs only to skip what tooling already enforces.
2. **Match each hunk** against those standards. A documented-standard breach cites the file and the rule in `evidence`.
3. **Apply the smell baseline** below to the diff. Each smell is a judgement call: title it "Possible <smell>", confidence at most `medium`. A documented repo standard that endorses the pattern suppresses the smell.

Done when every changed file has been checked against every standards source and the baseline.

### Smell baseline (Fowler, _Refactoring_ ch.3)

- **Mysterious Name**: a name that doesn't reveal what it does or holds. → rename; if no honest name comes, the design is murky.
- **Duplicated Code**: the same logic shape in more than one hunk or file. → extract the shared shape.
- **Feature Envy**: a method reaching into another object's data more than its own. → move it onto the data it envies.
- **Data Clumps**: the same few fields or params travelling together. → bundle them into one type.
- **Primitive Obsession**: a primitive or string standing in for a domain concept. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurring. → polymorphism, or one shared map.
- **Shotgun Surgery**: one logical change forcing scattered edits across many files. → gather what changes together.
- **Divergent Change**: one module edited for several unrelated reasons. → split so each changes for one reason.
- **Speculative Generality**: abstraction, params or hooks for needs the spec doesn't have. → delete; inline back.
- **Message Chains**: long `a.b().c().d()` navigation. → hide the walk behind one method.
- **Middle Man**: a class or function that mostly delegates onward. → call the real target directly.
- **Refused Bequest**: a subclass ignoring most of what it inherits. → composition instead of inheritance.

## Axis 2: Spec

Skip this axis when the spec is "no spec available" and say so in the coverage line.

Report, quoting the spec line in `evidence` for each:

- **Missing or partial**: a requirement the spec asks for that the diff does not deliver. Severity `blocker` when it is core to the spec, else `major`.
- **Scope creep**: behaviour in the diff the spec did not ask for. Usually `minor`; `major` when it changes user-visible behaviour.
- **Wrong implementation**: a requirement that looks implemented but behaves differently from the spec.

Done when every requirement in the spec is marked delivered, partial or missing, and every behaviour change in the diff is traced to a requirement or flagged as creep.
