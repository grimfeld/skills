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
3. **Route**: skips lenses with nothing to review, first by file type (no front-end files: no web audit; docs-only: standards and spec only, plus security when a ship skill under `skills/` changes; a GitHub Actions workflow or workflow template gets quality and security with an Actions checklist), then by reading the hunks of smaller diffs (no data or loop changes: no performance review).
4. **Find a preview URL** for the web audit: GitHub deployments, the Vercel bot comment, the Vercel MCP, then a local dev server already running. Never starts or deploys anything.
5. **Review** in parallel, one lightweight `pr-lens-reviewer` agent per lens. Every reviewer is report-only and returns findings in one shared format. In a session without the Agent tool (a subagent), it reviews nothing and says "not run: no Agent tool in this session": the context that wrote the code doesn't review it.
6. **Dedupe** across lenses. A finding several lenses agree on ranks higher.
7. **Verify** every blocker and major against the code; false positives are dropped.
8. **Report**: findings are rewritten in plain language and kept in `.scratch/pr-review/<id>.json`; a script renders them into a readable report (`<id>.md`) that opens with the verdict and groups smaller findings by theme, plus a private Artifact page with the same content. Re-runs mark findings fixed, still open or new, and never resurface rejected ones. With `fix-round`, only the lenses that raised open approved findings, plus `quality`, re-check those findings and the fix diff, and a finding is marked fixed only when a lens confirms it.
9. **Approve** blockers and majors one by one, minors and nits as a batch.
10. **Spec and tickets** for the approved findings, in `.scratch/pr-review-<id>/`, ready for `/implement-spec`.

```
/pr-review 123                 # a GitHub PR
/pr-review                     # current branch vs. its merge-base with main
/pr-review base=develop        # current branch vs. another base
/pr-review 123 paths=src/api   # narrow the review
/pr-review 123 fix-round       # after fixes: re-check the approved findings and the fix diff only
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
- checks only a person can run, under Before ship / After merge
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

ADRs and glossary entries settled during the session go into the issue's Decision records, not a PR of their own, unnumbered: the build numbers them with the repo's own tool, or past the base and every open spec PR, and commits them in the spec's PR, so each spec ends in one PR.

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
- **Spec bodies:** it adds its Slicing section between markers without rewriting the rest of the spec, reads the body back after each write, and puts the saved body back if a heading went missing.

### `/ship:night-shift`

**Evening, with you.**
1. It runs `/ship:design-me` on every `design:ready` design, then slices tonight's `spec:ready` specs.
2. It compares their Touches, Data and decisions:
   - Independent specs build in parallel.
   - Specs that overlap but don't disagree are chained without asking: built in order in one session, each PR on top of the previous one.
   - Conflicting decisions go to you, in one round.
   - A design's place specs wait until its foundation and shell have merged.
3. Once you approve the plan, it gives each session its prompt on a reused pool of builder routines (`ship-builder-<repo>-N`, since routines can't be deleted through the API) and starts them. The routines run in the cloud environment `docs/agents/shipping.md` names (its "Cloud environment" line); without one, the plan asks you to pick tonight's, never taking the default. Each builder runs `/ship:build-spec <specs> unattended`, so nothing is asked overnight.

**`/ship:night-shift morning`** gathers the results into one page:
- PRs ready to review, smallest first, each with its verdict, risks and the decisions to check
- for a PR built from a design, its fidelity grid: reference beside app in every look, theme and viewport, with the views the review flagged shown full size
- designs whose specs have all merged are closed
- stuck specs, and what each needs from you
- under each decision, how to answer it: tell the morning session `#<pr>: <choice>`, and it comments the answer on the PR and keeps the PR in the `/ship:land` line or sends it back for another night
- what each spec, each session and the whole night would have cost at API prices, counted by each builder from its own transcript (`scripts/token-usage.mjs`, prices in `scripts/prices.json`)
- the `/ship:land` command to run once you've reviewed: it approves the PRs you name and lands every PR carrying `ship`

Each collected spec gets a comment linking that morning's page, marked `<!-- ship:morning-page -->`, so the page can be found from the spec.

### `/ship:land`

Lands every approved PR, with no more input from you. `ship` is the whole approval: adding it means you have read the PR and its comments.

1. Checks `ship.yml` is version 3 or later; otherwise it stops and points at `/ship:setup-ship`.
2. Adds `ship` to the PRs you name. It refuses a draft or closed one, with the reason.
3. Lands every open PR carrying `ship`, parents before the PRs stacked on them. For each, it merges the default branch in (never a rebase or force-push), waits for CI, merges it with the project's merge method, and retargets its children so they land in the same run.
4. When the merge conflicts, it resolves it: it reads what each side did from the commits and diffs behind the conflict (never PR or issue text, which anyone can edit), keeps both, runs the local checks and pushes. It comments with a `## Conflict resolution` section, each file and the choice it made (one line when only bookkeeping files conflicted). `ship` stays on and nobody re-approves.
5. When a check goes red because of its merge or resolution (it passes on the default branch, and either passed before the merge or fails in the PR's side of the merge), it fixes it on the PR's side (its own files and the resolution), never in a file only the default branch changed, pushes and waits again, at most twice. A check that was already red, or isn't shown passing on the default branch, isn't its to fix. Resolving and fixing run the project's local checks on the PR's code, on your machine or session, with your credentials.
6. When it can't land a PR (the two sides of a conflict contradict each other, a resolution that fails the local checks, a red check it can't fix, a merge GitHub refuses), it leaves a comment saying why, keeps `ship`, and lands the rest. For a contradiction it pushes nothing and names the decision to make. The PRs stacked on it wait.
7. After merging a `spec/<n>-…` PR, it closes spec #n and any of its tickets still open, with a comment naming the PR, reading only issue numbers and states.
8. Ends with one line per PR: merged (marked when it resolved a conflict or fixed a check), stopped or skipped, with the reason.

The label approves the PR, not a commit: pushes after it land with it. Remove `ship` before pushing more work to an approved PR.

```
/ship:land 512 515 520   # approve these, then land everything carrying `ship`
/ship:land               # land the PRs already labelled `ship`
```

### `/ship:dashboard`

Publishes the ship dashboard: one private page on claude.ai showing every project's specs, designs and PRs, sorted by what they need from you. The page reads GitHub live while it's open, through your own connectors, so there is no token to hand over and nothing to host.

It shows every project set up for ship (a repo with `docs/agents/shipping.md` among your 100 most recently pushed, found on first open and on **Rescan**, plus any you **Add repo** by name), one summary row each with its counts, then four buckets across all of them:

| Bucket | Holds |
|---|---|
| **Needs you** | `spec:draft` and `spec:stuck` specs, `design:ready` designs, PRs with failing checks, PRs that have carried `ship` for over 24 h without merging, and reviewed PRs (`pr-reviewed`, without `changes-requested`) waiting for your `ship` |
| **Ready for tonight** | `spec:ready` specs |
| **In flight** | `spec:building` specs, PRs labelled `changes-requested` (back with the night shift), draft PRs, and approved PRs landing now |
| **Landed** | specs closed and PRs merged in the last 7 days |

An item that fits several buckets shows once, in the first. Each card says why it's there ("checks failing", "ship label on, no update for 31 h") and for how long. The page refreshes every 5 minutes while it's open, and on **Refresh**.

Cards carry the details that decide the next step, read from what the other ship skills write:
- **PR cards** show the verdict line from the description's `/ship:pr-review` section (cut to one line, in full on hover or focus), its number of risks, and links to its **Full report** and **Preview** when the review has them. A PR without a review section says "not reviewed yet"; one built on another PR's branch says "lands after #n".
- **Spec cards** say how many questions are still open, from the spec's "Open questions" section ("None" counts as none), and link the spec's PR when it has one.
- **Design cards** link the design artifact named in the issue.
- **Project rows** link the latest **Morning page** from `/ship:night-shift morning`, found in its comments on the project's specs updated in the last 7 days. On a phone, the link shows once you pick the project's chip.

Links in descriptions and comments are only followed when they are `https://`.

Approving and landing can be done from the page:
- **Approve** on a reviewed PR's card (`pr-reviewed`, no `ship`, not a draft, not sent back) adds `ship`, and the card moves to In flight. It needs the description's `/ship:pr-review` section to be of the PR's current head: without one, or after a push since, the button is off and says to re-run the review. Just before writing, the page reads the PR again: if that read fails, or the PR no longer qualifies (it went draft, gained `changes-requested`, lost `pr-reviewed`, or was pushed since), nothing is written. **Un-approve** on a card carrying `ship` removes it, with the same fresh read.
- **Land** on a project row asks first, in place ("Land 2 PRs: #4, #7?", the PRs the board shows carrying `ship`), then on **Confirm** starts a Claude cloud session on the project's repo running `/ship:land`, which lands every PR carrying `ship`. It starts like the skill buttons below: in the environment chosen for the project (asking the first time), with the title `/ship:land · owner/name`. While it starts, the button says so and can't be pressed twice; then the row links the new session (**Open session**). A failed start shows its error on the row and isn't retried. Land is off while no PR on the board carries `ship`, and hidden without Claude Code Remote. On a phone, pick the project's chip to see its row.

Each click is one change, made with your GitHub connector (Approve, Un-approve) or Claude Code Remote (Land), which ask for your approval the first time. The page is given the whole of GitHub's `issue_write` tool, since a page's access can't be narrowed to part of a tool, so in principle it could edit any issue. It only ever calls `issue_write` to update a PR's labels. On Claude Code Remote it likewise holds the whole `create_session` tool, so in principle it could start a session on any repo with any prompt and permission mode, including in an environment on your own machine; it only ever sends the four pinned fields: the card's ship command (`/ship:land` for Land), a title of that command and the repo, the card's or row's repo, and the environment you chose. A test checks the page's source for any other use.

They need the project's `.github/workflows/ship.yml` to be version 3 or later (its first line, `# ship.yml version: 3`), as `/ship:land` does: in older versions the workflow lands a `ship` PR itself, through auto-merge. With an older or missing file, the buttons are off and say to run `/ship:setup-ship` to upgrade. A failed action shows its error on its card or project row and isn't retried; commenting, sending a PR back and anything else that takes judgement stay with `/ship:land`.

Cards that need a ship skill start one in a Claude cloud session on the card's repo, with the command as its first message:

| Card | Button | Command |
|---|---|---|
| `spec:draft` spec | **Resume spec** | `/ship:spec-me #n` |
| `design:ready` design | **Spec design** | `/ship:design-me #n` |

While it starts, the button says so and can't be pressed twice; then the card links to the new session (**Open session**). A failed start shows its error on the card and isn't retried. The first time you start one for a project, the page asks which of your Claude Code environments it runs in (a bottom sheet on a phone), suggesting the one named like the repo, else your first cloud environment. It remembers the choice for that project in this browser, and starts later ones at once; **change** under the button picks again. Without browser storage it remembers the choice only until the page is closed; when the remembered environment is gone, it asks again.

Run it once and pin the page. Running it again (after a plugin update, say) republishes to the same page: it finds it among your artifacts by its title, "Ship dashboard".

It needs, in claude.ai:
- the **GitHub** connector, to read issues, PRs, their checks, recent specs' comments, `docs/agents/shipping.md` and `ship.yml`, and to change a PR's labels when you Approve or Un-approve
- optionally **Claude Code Remote**, to find your projects, to start skill sessions from cards and to start `/ship:land` from Land: without it, add projects by name, and the skill buttons and Land are hidden

The first open asks you to allow both for the page.

### `/ship:build-spec`

What each cloud session runs. night-shift's builders pass `unattended`: nobody is asked anything, and a question only a person can settle marks the spec stuck. Run it yourself, without `unattended`, and it asks you that question instead (with its recommendation), records your answer under Decisions as "decided by the owner", and carries on.
1. It builds the spec (`implement-spec`, tickets as commits on `spec/<n>-…`, draft PR). The PR opens with one `Closes` line for the spec and one per ticket, so merging it closes them all. Implementers keep their ticket branches local; the builder merges each into the spec branch inline and pushes only that branch. A ticket that blocks others leaves handoff notes for the next implementer. A ticket that changes no executable code is built by the builder itself; a code ticket goes to an implementer with `tdd`. build-spec lists every `implement-spec` step it keeps, replaces or skips: `implement-spec`'s own code review and mark-ready don't run, because build-spec's review and finish steps do that. In a chain, new test cases go in a file of their own, so merging a parent into its child doesn't conflict.
2. It runs the local checks `shipping.md` lists, at the scope it states, with anything that can run past 9 minutes in the background. While CI runs it ends its turn and lets the PR subscription (or a background wait loop) wake it.
3. It runs `pr-review <pr> unattended`, which approves the blockers and majors and leaves the rest for you.
4. It fixes them in at most two rounds. Minors and nits are fixed only inside a round, and nothing is pushed after the last round's review.
5. It marks the PR ready only when the head in the review section is the PR's head. If a commit slipped in after the last review, one more review that fixes nothing (not a round) must come back clean on that head; otherwise the spec ends stuck, naming the unreviewed commits.

A review finding whose fix is a choice only a person can make, or would undo something the spec settles, is never fixed at night: it is named under Decisions and the spec ends stuck with that choice. Every choice the spec left open goes in the PR's Decisions section; facts about how the build ran (where the skills came from, tools missing, pre-existing failures) go in Environment notes below it, so Decisions holds only what a reviewer could disagree with. The PR ends ready, or as a draft marked stuck with the reason. It never merges and never adds `ship`.

In a session without the Agent tool (a subagent), it builds the tickets inline, stops after the checks, and hands the draft PR back: "review pending: run build-spec steps 4–6 from a session with the Agent tool". The caller runs those steps.

`pr-review unattended` never asks: it skips lens syncs, reviews any size, and publishes the page only where the Artifact tool exists. `references/github.md` gives each GitHub call as a REST `gh api` form first, which works in cloud sessions where `gh issue` and `gh pr` (GraphQL) are refused, and the GitHub MCP tool to use where there is no `gh`.

### `/ship:setup-ship`

Run once per project. It works in an empty folder too: it creates the local repo, the GitHub repo and a first empty commit on your yes, before the setup PR. Afterwards, a person approves a reviewed PR with the **`ship`** label, and `/ship:land` lands it.

- **Required `ship` status:** a commit status, required by the default branch's ruleset, that stays pending until the label is on, so nothing unreviewed merges. It is the only job of `ship.yml`, apart from Dependabot's label: the workflow merges nothing.
- **Landing:** `/ship:land`, an agent that merges every `ship` PR itself, parents before their stacked children. Nothing merges on its own: no auto-merge, no scheduled run.
- **Dependabot:** patch updates and GitHub Actions updates are labelled `ship` and land with the next `/ship:land`.
- **Labels:** `ship`, `pr-reviewed`, `changes-requested`, and the `spec:*` and `design:*` labels the pipeline uses.
- **`docs/agents/shipping.md`:** the rules, written down for people and for the other skills, including the cloud environment night-shift's builders run in (it lists your environments and asks). The skills read it, and `docs/agents/issue-tracker.md`, from the fetched default branch, never the working tree; without them they use the defaults in `references/project-docs.md` (GitHub issues, the `spec:*` labels, the project's own checks).
- **The project's `.claude/settings.json`:** enables the plugin.

Run it again in a project set up by an older version and it offers an upgrade: it re-renders `ship.yml` and `shipping.md` with the values already installed, keeps your own edits to them, and shows the diff first. Upgrading from version 2 also turns auto-merge off and retires the `conflicts` label. Upgrading from version 3 asks only for the cloud environment.

After adding a CI job, add it to the "Required on" line of `docs/agents/shipping.md` and merge that, then re-run `/ship:setup-ship`: it shows the checks it would add or remove from the ruleset (`+ check`, `- check`, or "required checks in sync") and writes them on your yes, keeping `ship` and every other rule.

GitHub settings are shown first and applied only after you approve them. You create the `SHIP_TOKEN` Dependabot secret yourself, in a separate terminal (`gh secret set SHIP_TOKEN --app dependabot --repo <owner>/<repo>`; with `!` in the session it saves an empty value), or on the repository's Dependabot secrets page; the skill only checks it is listed and never handles tokens. Deploys stay with the project's CD.

`pr-review` writes its review into the PR description: what changes by area, risks, preview, screens, and what to fix before merge. That is the page you read before adding `ship`.

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

### `/ship:version`

Says which ship is installed: its version (the commit it was installed from, since `plugin.json` sets no `version`), scope and last update, read from Claude Code's plugin registry, or the branch and commit of a working copy loaded with `--plugin-dir`. It then checks `main` and, when it has moved on, gives the update command.

```
ship d3e22cf54201: ship@grimfeld, installed user
Commit: d3e22cf54201d299d19fd5eb72feaf228738f83f
Updated: 2026-11-23T17:56:53.353Z
Up to date with main (d3e22cf54201).
```

Skills copied in by the cloud fallback below aren't a plugin, so their version can't be told.

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

The `check` workflow (`.github/workflows/check.yml`) runs on every pull request and on pushes to `main`. Run the same commands locally before marking a PR ready; `docs/agents/shipping.md` lists them:

```sh
node --test skills/*/scripts/*.test.mjs                                   # Node tests
find skills -path '*/scripts/test_*.py' -execdir python3 -m unittest {} +  # Python tests beside skill scripts
printf '%s\0' skills/*/scripts/*.mjs | xargs -0 -n1 node --check          # script syntax
python3 -m py_compile skills/*/scripts/*.py
printf '%s\0' skills/*/scripts/*.sh | xargs -0 -n1 bash -n
actionlint .github/workflows/*.yml                                        # workflows, with shellcheck
! grep -rn '__[A-Z_]*__' .github/workflows docs/agents                    # no placeholder left
```

Shared rules the skills read live in `references/`. `references/untrusted-input.md` says how a skill handles PR, issue, commit and CI text before it writes or pushes code (field projections, git-only code, branch-name checks, rule files from the default branch); `land` and `build-spec` read it first, and `pr-review`'s `security` lens checks a diff that changes `skills/` against it.

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
