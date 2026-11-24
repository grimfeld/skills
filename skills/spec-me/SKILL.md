---
name: spec-me
description: Grill the user about one idea until it is a buildable spec, published as a GitHub issue labelled spec:ready, or saved as spec:draft with its open questions when the session ends first. Pass an idea, or a spec:draft issue number to resume one.
disable-model-invocation: true
argument-hint: "An idea in a sentence, or #<issue> to resume a draft"
---

# Spec me

One idea per session, ending in a **spec**: a GitHub issue that an agent can build overnight without asking anyone anything.
The session ends one of two ways:

- **`spec:ready`:** every item of the buildable bar below is answered.
- **`spec:draft`:** the user stopped first. Everything settled so far is saved, along with the open questions, so any later session picks up from there with `/ship:spec-me #<n>`.

Nothing settled is ever lost: save to the issue as you go, not only at the end.

## 1. Load the project

Read these before the first question, and don't ask the user anything they already answer:

- `CLAUDE.md`, `AGENTS.md`
- the glossary (`CONTEXT.md`, `GLOSSARY.md`), and the ADRs in `docs/adr/` that touch the idea
- `docs/agents/issue-tracker.md`: how to create, edit and label issues here. In a cloud session without `gh`, use the GitHub MCP tools it names.
- `docs/agents/shipping.md`: the project's extra buildable items, if it lists any (for example "a Guide page", "a row in `SCREENS`")

**Resuming** (`#<n>` passed): read the issue body and comments. Its "Open questions" section is where the grilling restarts. Treat everything else in it as settled unless the user reopens it.

**New idea:** search open `spec:*` issues for one that already covers it (`gh issue list --label spec:draft`, then `spec:ready`). If one does, offer to resume it instead.

## 2. Grill

Call the Skill tool with `grilling`. If the project keeps a glossary or ADRs, also call it with `domain-modeling`, so terms and decisions are written down as they settle.

The ADRs and glossary entries `domain-modeling` writes belong to the spec, not to a PR of their own. Copy the full text of each one into the issue's "Decision records" section at the next save. Never commit them or open a PR for them: the build commits them in the spec's one PR, next to the code they describe.

Leave new numbers to the build. Write a new ADR as `docs/adr/NNNN-<slug>.md`, with `NNNN` literal, and refer to it everywhere else by its slug. Name a new numbered doc section (a PLAN §) "a new section" with its title and no number. The build numbers both after every number already taken.

The design tree must reach every item of the buildable bar. Use the bar to compute the frontier: an item nobody has answered yet is an open branch.
Facts come from the code, through subagents, not from the user. Decisions come from the user.

**The buildable bar:**

1. **Problem and solution**, from the user's side.
2. **Acceptance criteria:** each one observable and testable ("a person on a phone can… and sees…"), together covering the whole solution.
3. **Out of scope**, named explicitly.
4. **Touches:** the Modules, Apps, packages or surfaces it changes, in the project's own words, plus anything shared it modifies (a core type, a shared component, the schema). The night shift compares this section across specs to find conflicts, so be complete.
5. **Data:** new or changed fields, collections and migrations, and what happens to existing data. Write "None" if there are none.
6. **UI states**, for anything a person sees: empty, loading, error, the longest content, phone width. Write "No UI" if there is none.
7. **Implementation decisions:** interfaces, contracts, schema shapes and architecture choices. No file paths.
8. **Test seams:** where behaviour is tested, preferring existing seams and the highest one possible, plus the prior art to copy.
9. **Docs to update:** the user guide, ADRs, glossary, README, the project's own extras. ADRs and glossary entries settled in the session go in full under Decision records.
10. **Size:** a rough guess of the change ("one screen and a field", "a new Module") and of the number of PRs. `slice` decides properly later; this guess only flags a spec that is clearly too big while the user is still here to split it.
11. **Open questions:** none left.

A question the user answers with "you decide" is settled: record what you chose, and why, in Implementation decisions.

## 3. Save as you go

Create the issue as soon as the problem and solution are clear, from `templates/spec.md` in `${CLAUDE_SKILL_DIR}`, labelled `spec:draft`. After each round of answers, update its body.

- **Sections:** answered sections hold their answer. Unanswered ones hold `_Open_`.
- **Open questions:** list every branch still open.
- **Title:** what the spec delivers, in the project's words. Not "Spec: …".

If the session is ending (the user says stop, or changes subject) with branches still open, do a final save and tell the user the issue number to resume with.

## 4. Finish

When the frontier is empty, check every bar item against the issue body. Then:

1. Show the user the spec's acceptance criteria and Touches, and ask for a yes.
2. On yes, swap the label `spec:draft` → `spec:ready`, and leave "Open questions: none".
3. Report:
   - the issue link
   - the size guess
   - any ADR or glossary change made during the session: it is in the issue's Decision records and ships with the build. Name the local files `domain-modeling` wrote, and say they can be discarded, since the build PR adds them.
   - the next step: the spec waits for the evening's `/ship:night-shift`, or `/ship:slice #<n>` sooner
