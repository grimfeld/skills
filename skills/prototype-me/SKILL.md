---
name: prototype-me
description: Show what a spec's UI could look like. Builds a few structurally different variants with the prototype skill, styled like the project, publishes them as one private claude.ai Artifact with a variant switcher, and sends a screenshot of each in chat. Pass a spec issue number, or an idea, which first becomes a spec:draft issue.
disable-model-invocation: true
argument-hint: "#<spec> | <idea in a sentence> [<count, at most 5>]"
---

# Prototype me

A prototype answers one question about one spec's UI: what should this look like? You answer it with a few
**variants**, each a structurally different take on the screen, on one private Artifact page whose switcher bar flips
between them. The user looks, from anywhere, phone included.

Files in `${CLAUDE_SKILL_DIR}`:

- `page/prototype.html`: the page template: the switcher bar, `?variant=`, the compare view, the width toggle.
- `scripts/build.mjs`: fills the template with the variants. Its header comment is the variants folder's contract.

You must never:
- commit or push anything: no branch, no files in the repository. The variants, the built page and the screenshots go
  to the scratch folder (step 4).
- publish a second Artifact for the same question: republish to its URL.
- change the spec's label.

## 1. Check the Artifact tool

If the Artifact tool isn't among your tools, stop and say so: the prototype lives on an Artifact, and there is no
local-file fallback.

## 2. Find the spec

Read `docs/agents/issue-tracker.md` as `${CLAUDE_PLUGIN_ROOT}/references/project-docs.md` says, and reach GitHub
through the rows of `${CLAUDE_PLUGIN_ROOT}/references/github.md`.

- **`#<n>`:** read the issue and its comments. Refuse, with the reason, when it is closed, or labelled
  `spec:building`, `spec:in-review` or `spec:stuck`: its UI is being built, or was. Go on with `spec:draft` or
  `spec:ready`.
- **Free text:** create a `spec:draft` issue from `${CLAUDE_PLUGIN_ROOT}/skills/spec-me/templates/spec.md`, titled as
  spec-me titles one. Fill Problem and Solution only. Every other section holds `_Open_`, and Open questions lists the
  unanswered items of spec-me's buildable bar (`${CLAUDE_PLUGIN_ROOT}/skills/spec-me/SKILL.md`, step 2). Go on with it.

**Count:** the number the user passed, else 3. At most 5.

**The question:** one line, from the spec: which screen, and what about it is undecided.

## 3. Run `prototype`

Call the Skill tool with `prototype`. If it isn't installed, read it from a clone as
`${CLAUDE_PLUGIN_ROOT}/references/running-skills.md` says. No drift-hash check. Take its UI branch (`UI.md`), never
LOGIC, whatever the question looks like.

Its rules hold: the count above, variants **structurally different** (layout, hierarchy, primary affordance, not
colour), realistic data density, state in memory only, a floating switcher with ←/→. Three of its steps are replaced:

- **Where the variants render:** on the Artifact (steps 5 and 6), never on a dev route in the app. No `NODE_ENV` gate.
- **Capture:** the spec issue and the Artifact link. No throwaway branch: the Artifact is the primary source.
- **Folding in:** nothing goes into the real code. The build does that from the spec.

## 4. Match the project

The scratch folder is `prototype-me/<n>/` in your scratchpad directory, if the session has one, else
`.scratch/prototype-me/<n>/` (`<n>`: the spec's issue number).

Start one subagent to read the project's styling: its tokens, CSS and component library, and the page the feature
lives on (or would). It writes `look.md` in the scratch folder: colours, type, spacing, radii, the components to imitate,
the surrounding chrome (header, nav), and the light and dark themes if the project has both. A project with no UI yet
gets neutral styling; `look.md` says so.

## 5. Draft the variants

Write them into `<scratch>/variants/`, as `scripts/build.mjs`'s header describes:

- `A.html`, `B.html`, … one per variant. The first line is `<!-- name: <a few words> -->`; the rest is plain HTML
  with no `<html>`, `<head>` or `<script>`: the template owns those.
- `styles.css`: the project's look from `look.md`, shared by every variant. Write narrow-screen rules as
  `@container (max-width: …)` queries rather than `@media`: each variant is a size container, so the bar's phone
  toggle shows them.

Each variant reproduces the project's surrounding chrome with realistic sample data, so it is judged in place, not in
a vacuum.

## 6. Build and publish

```
node ${CLAUDE_SKILL_DIR}/scripts/build.mjs <scratch>/variants <scratch>/prototype.html --title "<screen> prototype"
```

It prints the path it wrote. If it fails, fix what it names and build again.

Load the `artifact-design` skill, as the Artifact tool requires. Then publish the built file as one private Artifact,
with `icon: "layout"` and a one-sentence `description` naming the spec and the question. Keep its URL: every later
publish for this question goes to it. On a re-run, when the spec's `## Prototype` section already has an entry for
this question, read the Artifact linked there with the Artifact tool and publish to that URL instead, with no icon.

## 7. Screenshots

With Playwright, against the built file, at 1280×800, full page: `?variant=<key>` for each variant, then
`?variant=all`. Save them under `<scratch>/shots/` and send them in chat with SendUserFile, one caption per variant:
its key and name. Give the Artifact link with them.

## 8. Pick

The user picks in chat. A **remix** ("B's header with C's list") becomes a new variant: the next unused key in
`<scratch>/variants/`. Build again, republish to the same URL, screenshot the new variant and `all`, and go another
round. There is no round limit: it ends when the user names one variant as the winner.

## 9. Write the spec

The Artifact's **version** is what the publish result reports; if it reports none, the publish date.

Add a `## Prototype` section after Solution (after `## Design` when the spec has one), with one entry per question:

```
### <the question>

- **Question:** <the question, in a sentence>
- **Artifact:** <link>, version <version of the winning round>
- **Variants:** one line each: `<key> (<name>)`: <its structure, in a few words>
- **Winner:** <key>. <the user's reasons, verbatim, including what it borrows from other variants>
- **Not this:** <each rejected idea, and why>
```

The winner also fills the spec's UI states and adds a line to Implementation decisions. Leave the label as it is.

A re-run on a question the section already has replaces its entry. Save the body through the "Edit an issue's body"
row.

## 10. Hand back

Never set `spec:ready`. End by pointing to `/ship:spec-me #<n>`, which resumes the grilling at UI states.
