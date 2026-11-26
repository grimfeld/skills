# Editing skills

Before adding or changing an instruction in `skills/`, `agents/` or `references/`, check the diff three ways. A reviewer applies the same checks.

1. **Its own never-list.** Read the skill's "You must never" list. A new instruction that tells the agent to do something on that list, with the list unchanged, is a **blocker**: an unattended agent told both things behaves unpredictably. Change the instruction, or change the list in the same PR and say why.
2. **Other skills' contracts.** Find every skill that writes or reads what the instruction touches, and check they still agree. A contract changed in one skill is changed in all its readers in the same PR, never split across PRs. Contracts live in:
   - each skill's "You must never" list;
   - `references/running-skills.md` (how one skill runs another, and subagents' scratch folders);
   - the comment markers: `<!-- night-shift … -->` (its JSON statuses), `<!-- land … -->`, `<!-- ship:morning-page -->`, `build:decisions`, and `pr-review`'s `pr-review:start`/`pr-review:end`;
   - the labels in `docs/agents/shipping.md`: `spec:*`, `design:*`, `ship`, `pr-reviewed`, `changes-requested`.
3. **The project's rules for these skills.** `references/untrusted-input.md` (rules for steps that write or push code), `references/project-docs.md` (reading `docs/agents/` from the default branch), and `references/github.md` (every GitHub call). A path the skill cites must resolve where it runs: `node scripts/check-paths.mjs`.

A finding from these checks is a `standards:` finding that cites this file.
