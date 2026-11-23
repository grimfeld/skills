# skills

`ship`, a [Claude Code](https://claude.com/claude-code) plugin whose skills orchestrate other installed skills to take an idea to production: grill it (or a Claude Design design) into a spec, slice it, build it, review it, ship it. This repo is also its own marketplace, `grimfeld`.

Commands are namespaced by the plugin: `/ship:pr-review`, and the agent is `ship:pr-lens-reviewer`.

## Skills

### `/ship:pr-review`

Reviews a PR or branch with up to eight parallel reviewers, each in its own lane:

| Lens | Covers | Adapted from |
|---|---|---|
| `standards-and-spec` | Repo coding standards, a code-smell baseline, fidelity to the originating spec | `code-review` |
| `quality` | Correctness, tests, architecture, change size, dead code, dependency choice | `code-review-and-quality` |
| `security` | Threat model, injection, access control, SSRF, secrets, supply chain, privacy, LLM features | `security-and-hardening` |
| `performance` | Backend, data, query and algorithmic cost | `performance-optimization` |
| `simplification` | Readability and behaviour-preserving simplifications | `code-simplification` |
| `principles` | A personal set of engineering principles, plus `crapper` / `dryer` metrics | `ub-mode` |
| `web-quality` | Core Web Vitals, accessibility, SEO, best practices, agentic browsing, against a live preview when one is found | `web-quality-audit` |
| `design-fidelity` | For specs built from a design: the app against the design's reference in every look, theme and viewport, with contrast and token values checked mechanically | written here |

The flow:

1. **Drift check**: each lens records the hash of the skill it was adapted from. If that skill has changed since, the run pauses and offers to re-sync the lens.
2. **Prepare**: resolves the diff (in a temporary worktree for PRs that aren't checked out), the spec, CI status and any previous report.
3. **Route**: skips lenses with nothing to review, first by file type (no front-end files: no web audit; docs-only: standards and spec only), then by reading the hunks of smaller diffs (no data or loop changes: no performance review).
4. **Find a preview URL** for the web audit: GitHub deployments, the Vercel bot comment, the Vercel MCP, then a local dev server already running. Never starts or deploys anything.
5. **Review** in parallel, one lightweight `pr-lens-reviewer` agent per lens. Every reviewer is report-only and returns findings in one shared format.
6. **Dedupe** across lenses. A finding several lenses agree on ranks higher.
7. **Verify** every blocker and major against the code; false positives are dropped.
8. **Report**: findings are rewritten in plain language and kept in `.scratch/pr-review/<id>.json`; a script renders them into a readable report (`<id>.md`) that opens with the verdict and groups smaller findings by theme, plus a private Artifact page with the same content. Re-runs mark findings fixed, still open or new, and never resurface rejected ones.
9. **Approve** blockers and majors one by one, minors and nits as a batch.
10. **Spec and tickets** for the approved findings, in `.scratch/pr-review-<id>/`, ready for `/implement-spec`.

```
/pr-review 123                 # a GitHub PR
/pr-review                     # current branch vs. its merge-base with main
/pr-review base=develop        # current branch vs. another base
/pr-review 123 paths=src/api   # narrow the review
```

#### Requirements

- [`gh`](https://cli.github.com/), authenticated, for PRs, CI status and deployment lookup.
- [`uv`](https://docs.astral.sh/uv/) to run the drift check.
- Optional: the Vercel MCP server (preview discovery and protected-preview access), Chrome DevTools MCP or `npx lighthouse` (live web audit), `crapper` and `dryer` (principles metrics).
- The source skills installed under `~/.claude/skills/` for the drift check: `code-review` from [mattpocock/skills](https://github.com/mattpocock/skills); `code-review-and-quality`, `security-and-hardening`, `performance-optimization` and `code-simplification` from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills); `web-quality-audit` from [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills). `design-fidelity` has no upstream; it needs Playwright in the project (`scripts/design-capture.mjs` resolves it from there). `ub-mode` is a local skill; drop or rewrite `lenses/principles.md` if you don't have it.
- From [mattpocock/skills](https://github.com/mattpocock/skills): `grilling` and `domain-modeling` (spec-me), `to-tickets` (slice), `implement-spec` (pr-review's fix tickets, and the night build), `retro` (retro-issues, which reads it). They're user-invoked only, so the ship skills run them by reading their `SKILL.md` (see `references/running-skills.md`); install them alongside.
- For the live web audit and the lens sources' extra references, the upstream skills under `~/.claude/skills/`; without them the lenses still run on their own briefs.

### `/ship:spec-me`

Grills you about one idea, using `grilling` and, where the project keeps a glossary or ADRs, `domain-modeling`. It stops once the idea is **buildable**:

- testable acceptance criteria
- what's out of scope
- what it touches
- data and migrations
- UI states
- implementation decisions
- test seams
- docs to update
- a size guess
- no open questions

The spec is a GitHub issue that's saved after every round:

- `spec:ready` once every item is answered
- `spec:draft` if you stop first, with its open questions listed, so `/ship:spec-me #<n>` resumes it later

ADRs and glossary entries settled during the session go into the issue's Decision records, not a PR of their own. The build commits them in the spec's PR, so each spec ends in one PR.

### `/ship:design-me`

Turns a design made in Claude Design into specs, so the night shift builds it.

1. **Mark it done:** when you like a version, open an issue labelled `design:ready` with the artifact link, or run `/ship:design-me <link>`, which opens it for you. To revise a design, relabel its issue `design:ready`.
2. **Intake:** it reads the artifact's files: the page (the reference), `HANDOFF.md`, the stylesheet and the prototype's source, plus the page's feedback notes. If the handoff files are missing, it tells you what to ask Claude Design for. `skills/design-me/templates/handoff-brief.md` is the brief to paste into Claude Design so every handoff has the same shape.
3. **Compare** with the handoff last built (`docs/design/<module>/`): only new or changed places get specs. Unbuilt specs for a changed place are replaced; a place with an open PR waits for it.
4. **Fidelity:** it writes `fidelity.json`, which says how to open each view of the reference and of the app, and screenshots the reference to check that every view opens from its URL. The brief asks Claude Design for that.
5. **Grill** you only on the handoff's open decisions, its gaps against the brief, and unaddressed feedback. A design with nothing open asks for one yes.
6. **Specs:** a foundation spec (looks, themes, Settings) when no ADR records the mechanism yet, a shell spec, then one per place, each `spec:ready` with a Design section pinning the handoff commit. The handoff is pushed on a `design/<module>-<version>` branch, and the first PR built from it commits it.

### `/ship:slice`

Sizes each `spec:ready` spec against prior PRs in the same areas. The rule is one PR per spec, about ten minutes to review: by default about 500 reviewable lines and three behaviours in one area.

- **Too big:** it proposes splitting into specs that ship on their own, split by behaviour and never by layer. It only splits once you approve.
- **Tickets:** it then calls `to-tickets` for each spec. Tickets become commits on the spec's branch, not PRs.

### `/ship:night-shift`

**Evening, with you.**
1. It runs `/ship:design-me` on every `design:ready` design, then slices tonight's `spec:ready` specs.
2. It compares their Touches, Data and decisions:
   - Independent specs build in parallel.
   - Specs that overlap but don't disagree are chained without asking: built in order in one session, each PR on top of the previous one.
   - Conflicting decisions go to you, in one round.
   - A design's place specs wait until its foundation and shell have merged.
3. Once you approve the plan, it gives each session its prompt on a reused pool of builder routines (`ship-builder-<repo>-N`, since routines can't be deleted through the API) and starts them.

**`/ship:night-shift morning`** gathers the results into one page:
- PRs ready to review, smallest first, each with its verdict, risks and the decisions to check
- for a PR built from a design, its fidelity grid: reference beside app in every look, theme and viewport, with the views the review flagged shown full size
- designs whose specs have all merged are closed
- stuck specs, and what each needs from you
- what each spec, each session and the whole night would have cost at API prices, counted by each builder from its own transcript (`scripts/token-usage.mjs`, prices in `scripts/prices.json`)
- the `/ship:land` command to run once you've reviewed: it ships the PRs you approve and sends the commented ones back for tonight

Each collected spec gets a comment linking that morning's page, marked `<!-- ship:morning-page -->`, so the page can be found from the spec.

### `/ship:land`

Run after the morning review, to ship what you approved in one step.

1. Checks `ship.yml` is version 2 or later; otherwise it stops and points at `/ship:setup-ship`.
2. Sorts last night's PRs: the ones you named are **approved**; the others you commented on are **sent back**; the rest are **not reviewed yet** and left alone.
3. Runs `resolve-conflicts` on the `conflicts` PRs in the batch first.
4. Labels the approved PRs `ship`. A stacked PR is labelled too and lands once its parent is in; approving a child never approves its parent.
5. Labels the sent-back PRs `changes-requested` and puts their specs back to `spec:ready`, so tonight's night shift rebuilds them.
6. Starts one landing run of `ship.yml`, and lists what lands now, what lands after its parent, what waits, and what went back.

```
/ship:land 512 515 520   # these PRs
/ship:land all           # every ready, reviewed PR from last night
/ship:land               # just land the PRs already labelled `ship`
```

### `/ship:build-spec`

What each cloud session runs, with nobody to ask.
1. It builds the spec (`implement-spec`, tickets as commits on `spec/<n>-…`, draft PR).
2. It runs the project's checks.
3. It runs `pr-review <pr> unattended`, which approves the blockers and majors and leaves the rest for you.
4. It fixes them in at most two rounds.

Every choice the spec left open goes in the PR's Decisions section. The PR ends ready, or as a draft marked stuck with the reason. It never merges and never adds `ship`.

`pr-review unattended` never asks: it skips lens syncs, reviews any size, and publishes the page only where the Artifact tool exists. `references/github.md` maps each `gh` call to the GitHub MCP tool to use in cloud sessions without `gh`.

### `/ship:setup-ship`

Run once per project. Afterwards, a person approves a reviewed PR with the **`ship`** label and starts landing; the repository does the rest. The label alone lands nothing, so a morning's batch can be approved PR by PR and land as one.

- **Required `ship` status:** a commit status, required by the default branch's ruleset, that stays pending until the label is on, so nothing unreviewed merges.
- **Landing:** a run of `ship.yml`, started by a dispatch (`/ship:land`), by the landing schedule in `command` mode, or by a merge. It lands the labelled PRs that target the default branch: GitHub auto-merge once CI is green (`auto-merge` mode), or the project's own landing command (`command` mode, for example a batching script).
- **Stacked PRs:** a labelled PR built on another PR's branch waits. When its parent merges, it is retargeted to the default branch, has the default branch merged in, and lands: in the same run in `auto-merge` mode, with the next scheduled run in `command` mode.
- **Dependabot:** patch updates and GitHub Actions updates are labelled `ship` and land without review.
- **Approval:** the label approves the PR, not a commit. Pushes after it land with it, so remove `ship` before pushing more work to an approved PR.
- **Conflicts:** before each landing run and whenever the default branch moves, a labelled PR that conflicts with it loses `ship`, gets `conflicts`, and a comment listing the files. Without this, landing would skip it on every run.
- **Labels:** `ship`, `pr-reviewed`, `conflicts`, `changes-requested`, and the `spec:*` and `design:*` labels the pipeline uses.
- **`docs/agents/shipping.md`:** the rules, written down for people and for the other skills.
- **The project's `.claude/settings.json`:** enables the plugin.

Run it again in a project set up by an older version and it offers an upgrade: it re-renders `ship.yml` and `shipping.md` with the values already installed, keeps your own edits to them, and shows the diff first.

GitHub settings are shown first and applied only after you approve them. You create the `SHIP_TOKEN` secret yourself: the skill never handles tokens. Deploys stay with the project's CD.

`pr-review` writes its review into the PR description: what changes by area, risks, preview, screens, and what to fix before merge. That is the page you read before adding `ship`.

### `/ship:resolve-conflicts`

Resolves the PRs labelled `conflicts`, by hand or from a scheduled routine. For each one it:
1. merges the default branch in (never a rebase or force-push)
2. reads what both sides meant, from the PRs behind the conflicting commits
3. resolves each hunk to keep both intents
4. runs the local checks and pushes

Then:
- **Only bookkeeping files conflicted** (the glossary, docs indexes: the list is in `shipping.md`): the PR gets `ship` back and lands with the next landing run.
- **Code conflicted:** `pr-review` runs, a comment explains each resolution, and you re-review before adding `ship`.
- **The two sides contradict each other:** nothing is pushed, and a comment names the decision to make.

```
/ship:resolve-conflicts            # every open PR labelled `conflicts`
/ship:resolve-conflicts 540 528    # these PRs
```

### `/ship:retro-issues`

Runs a retro on a session (mattpocock's `retro`: navigation, automated checks, coding standards, steering files, tool economy, information access) and files what isn't filed yet:

1. **Route** each finding to the repo that owns the file it changes: this one, another (an installed skill's source), or local only (your global `CLAUDE.md`), which is listed but never filed.
2. **Dedupe** against each target repo's open issues and PRs: **new**, **duplicate** (dropped, with a link) or **related** (a comment on that issue instead).
3. **Pick** from one numbered list; merge items with "merge 1+5".
4. **Grill** you, in one `grilling` round, on the decisions the picked findings need. The rest it settles itself.
5. **File** after one yes on their acceptance criteria: specs labelled `retro` + `spec:ready` for tonight's night shift, `spec:draft` for any you stopped grilling before settling. Repos without the ship pipeline get a plain issue labelled `retro`.

```
/ship:retro-issues             # the current session
/ship:retro-issues <session>   # another session on this machine
```

`retro` is user-invoked only, so the skill reads its `SKILL.md` rather than calling it; install it from [mattpocock/skills](https://github.com/mattpocock/skills).

## Install

```sh
claude plugin marketplace add grimfeld/skills
claude plugin install ship@grimfeld
```

or, inside Claude Code, `/plugin install ship --marketplace grimfeld/skills`.

A project can suggest it to everyone who opens it, in its `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "grimfeld": { "source": { "source": "github", "repo": "grimfeld/skills" } }
  },
  "enabledPlugins": { "ship@grimfeld": true }
}
```

`plugin.json` sets no `version`, so every commit on `main` is a new version and `claude plugin update ship@grimfeld` picks it up.

If you installed the old way, remove the symlinks `~/.claude/skills/pr-review` and `~/.claude/agents/pr-lens-reviewer.md`, or you get the skill twice.

### Developing

```sh
claude --plugin-dir /path/to/this/repo   # load the working copy; /reload-plugins after edits
claude plugin validate .                 # manifest and marketplace checks
```

The two remaining warnings are deliberate: no `version` (see above) and no icon.

### Cloud sessions

Cloud sessions don't install the plugins a repository enables in `.claude/settings.json` (adding a marketplace needs the trust prompt, which they never show). Install from the cloud environment's setup script instead, which runs inside the session's VM:

```sh
if claude plugin marketplace add grimfeld/skills && claude plugin install ship@grimfeld; then :; else
  # Fallback: copy the skills and agents in directly.
  CLONE="$(mktemp -d)/skills" && git clone --depth 1 https://github.com/grimfeld/skills "$CLONE"
  mkdir -p "$HOME/.claude/skills" "$HOME/.claude/agents"
  cp -R "$CLONE"/skills/* "$HOME/.claude/skills/"
  cp "$CLONE"/agents/*.md "$HOME/.claude/agents/"
fi
```

The plugin path is not documented for setup scripts yet; the fallback is the copy that worked before. Copied this way, the skill is `/pr-review` and the agent `pr-lens-reviewer`, which pr-review also accepts.

## Credits

The lenses in `skills/pr-review/lenses/` are condensed adaptations of MIT-licensed skills:

- [mattpocock/skills](https://github.com/mattpocock/skills): Copyright (c) 2026 Matt Pocock
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills): Copyright (c) 2025 Addy Osmani
- [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills): Copyright (c) 2026 Addy Osmani

Each is distributed under the MIT License; see the linked repositories for the full text.

## License

[MIT](LICENSE)
