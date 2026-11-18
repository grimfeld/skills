---
name: retro-issues
description: Run a retro on a coding session, drop the findings open issues and PRs already cover, and file the rest as specs labelled `retro` + `spec:ready` once the user picks them, grilling where a finding needs their decision.
disable-model-invocation: true
argument-hint: "[session]  (default: the current one)"
---

# Retro issues

A retro turns one session into **findings**: improvements to the agent's environment. You file the ones nobody has filed yet, as specs the night shift can build, after the user picks them. The user is present throughout. You stop at filing: no branch, no fix.

Read first: `docs/agents/issue-tracker.md` and `docs/agents/shipping.md` if the repo has them, and `${CLAUDE_PLUGIN_ROOT}/references/github.md`, for when `gh` isn't available.

## 1. Retro

`retro` (from mattpocock/skills) is user-invoked only, so the Skill tool can't call it. Read its `SKILL.md` (`find -L ~/.claude ~/.agents -path '*/retro/SKILL.md'`) and run its steps 1 to 3 on the session passed as the argument, or the current one. Its step 4 is replaced by step 4 below.

Done when every finding has:
- a title
- a severity
- the session evidence behind it: what happened, which file, which tool call
- the file or setting it would change

## 2. Route

Give each finding a **target**:
- **The current repo**, by default.
- **Another repo**, when the file it changes lives elsewhere: an installed skill or plugin, read from its install source (`~/.agents/.skill-lock.json`, the plugin's `repository`). Check access with `gh repo view <owner>/<repo> --json viewerPermission`; without write or triage access, it's local only.
- **Local only**, when the file is in no repo, like the global `~/.claude/CLAUDE.md`. Local-only findings are listed and never filed.

Per target repo, note whether it runs the **ship pipeline**: it has `docs/agents/shipping.md` or a `spec:*` label.

## 3. Dedupe

Per target repo, read every open issue and open PR in one call each:

```
gh issue list --state open --limit 500 --json number,title,body,labels
gh pr list --state open --limit 200 --json number,title,body
```

Judge each finding against them by meaning, not keywords, and put it in one bucket:
- **new**: nothing covers it.
- **duplicate**: an open issue or PR already covers it, fix included. Name it.
- **related**: an open issue is about the same thing, but this session adds evidence or a different angle. Name it. The finding becomes a comment there.

Done when every finding has a bucket, and every duplicate or related verdict cites the number it matched.

## 4. Pick

Show one numbered list, most severe first:

```
1. [new → owner/repo] <title> — <one-line why>
2. [related → #12] <title> — <what the comment adds>
3. [duplicate of #8] <title>
4. [local only] <title> — <the file to change by hand>
```

Ask which to file. The user answers with numbers ("1, 2"), title edits, and merges ("merge 1+5": one spec covering both). Every unpicked item is skipped.

## 5. Grill

For each picked **new** item that goes to a ship-pipeline repo, check it against spec-me's buildable bar (`${CLAUDE_PLUGIN_ROOT}/skills/spec-me/SKILL.md`, section 2). Get facts from the code through subagents. Settle what the bar asks yourself, and record each choice and its reason under Implementation decisions. A choice that changes what a user sees or does, or that keeps or removes a rule, is a **decision** for the user.

If any item has a decision left, call the Skill tool with `grilling`, once, with every item's decisions in one design tree. Prefix each question with its item number ("**#1 Q2**"). If the repo keeps a glossary or ADRs, also call it with `domain-modeling`.

Done when every picked item meets the bar, or the user has stopped. Items still open when the user stops are filed as drafts (step 7).

## 6. Gate

Show, for every picked new item, its acceptance criteria and Touches; for every related item, the comment. Ask for one yes. On changes, apply them and show the changed items again.

## 7. File

**Labels:** in each target repo, create any of `retro`, `spec:ready` and `spec:draft` it will need and doesn't have with plain `gh label create <name>`, never `--force`, so an existing label's colour and description stay. If creating fails, file without the label and say so in the report.

- **New, ship-pipeline repo:** the body is `${CLAUDE_PLUGIN_ROOT}/skills/spec-me/templates/spec.md`, every section filled. Problem carries the session evidence.
  - Labels: `retro` + `spec:ready`.
  - Items the user stopped grilling before settling: `retro` + `spec:draft`, their remaining decisions under Open questions, so `/ship:spec-me #<n>` resumes them.
  - Title: what the spec delivers, in the project's words.
- **New, other repo:** a plain issue labelled `retro`, with this body:

  ```
  ## Problem
  <What went wrong in the session, with the evidence.>

  ## Change
  <What to change, and where.>

  ## Done when
  - [ ] <Checkable outcome.>
  ```

- **Related:** a comment on the named issue: the new evidence and what it adds. Its labels stay as they are.

If `docs/agents/issue-tracker.md` describes a different issue format or labels, it wins.

## End

Your last message lists:
- the issues created, with links and labels: ready, draft, or plain
- the comments added, with links
- labels that couldn't be created
- the local-only findings, with the file to change

Ready specs wait for the evening's `/ship:night-shift`.
