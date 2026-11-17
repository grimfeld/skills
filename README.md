# skills

`ship`, a [Claude Code](https://claude.com/claude-code) plugin whose skills orchestrate other installed skills to take an idea to production: grill it into a spec, slice it, build it, review it, ship it. This repo is also its own marketplace, `grimfeld`.

Commands are namespaced by the plugin: `/ship:pr-review`, and the agent is `ship:pr-lens-reviewer`.

## Skills

### `/ship:pr-review`

Reviews a PR or branch with seven parallel reviewers, each in its own lane:

| Lens | Covers | Adapted from |
|---|---|---|
| `standards-and-spec` | Repo coding standards, a code-smell baseline, fidelity to the originating spec | `code-review` |
| `quality` | Correctness, tests, architecture, change size, dead code, dependency choice | `code-review-and-quality` |
| `security` | Threat model, injection, access control, SSRF, secrets, supply chain, privacy, LLM features | `security-and-hardening` |
| `performance` | Backend, data, query and algorithmic cost | `performance-optimization` |
| `simplification` | Readability and behaviour-preserving simplifications | `code-simplification` |
| `principles` | A personal set of engineering principles, plus `crapper` / `dryer` metrics | `ub-mode` |
| `web-quality` | Core Web Vitals, accessibility, SEO, best practices, agentic browsing, against a live preview when one is found | `web-quality-audit` |

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
- The source skills installed under `~/.claude/skills/` for the drift check: `code-review` from [mattpocock/skills](https://github.com/mattpocock/skills); `code-review-and-quality`, `security-and-hardening`, `performance-optimization` and `code-simplification` from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills); `web-quality-audit` from [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills). `ub-mode` is a local skill; drop or rewrite `lenses/principles.md` if you don't have it.
- From [mattpocock/skills](https://github.com/mattpocock/skills): `grilling` and `domain-modeling` (spec-me), `to-tickets` (slice), `implement-spec` (pr-review's fix tickets, and the night build). They're called by name; install them alongside.
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

### `/ship:slice`

Sizes each `spec:ready` spec against prior PRs in the same areas. The rule is one PR per spec, about ten minutes to review: by default about 500 reviewable lines and three behaviours in one area.

- **Too big:** it proposes splitting into specs that ship on their own, split by behaviour and never by layer. It only splits once you approve.
- **Tickets:** it then calls `to-tickets` for each spec. Tickets become commits on the spec's branch, not PRs.

### `/ship:night-shift`

**Evening, with you.**
1. It slices tonight's `spec:ready` specs.
2. It compares their Touches, Data and decisions:
   - Independent specs build in parallel.
   - Specs that overlap but don't disagree are chained without asking: built in order in one session, each PR on top of the previous one.
   - Conflicting decisions go to you, in one round.
3. Once you approve the plan, it gives each session its prompt on a reused pool of builder routines (`ship-builder-<repo>-N`, since routines can't be deleted through the API) and starts them.

**`/ship:night-shift morning`** gathers the results into one page:
- PRs ready to review, smallest first, each with its verdict, risks and the decisions to check
- stuck specs, and what each needs from you

### `/ship:build-spec`

What each cloud session runs, with nobody to ask.
1. It builds the spec (`implement-spec`, tickets as commits on `spec/<n>-…`, draft PR).
2. It runs the project's checks.
3. It runs `pr-review <pr> unattended`, which approves the blockers and majors and leaves the rest for you.
4. It fixes them in at most two rounds.

Every choice the spec left open goes in the PR's Decisions section. The PR ends ready, or as a draft marked stuck with the reason. It never merges and never adds `ship`.

`pr-review unattended` never asks: it skips lens syncs, reviews any size, and publishes the page only where the Artifact tool exists. `references/github.md` maps each `gh` call to the GitHub MCP tool to use in cloud sessions without `gh`.

### `/ship:setup-ship`

Run once per project. Afterwards, adding the **`ship`** label to a reviewed PR is the only step a person takes; the repository lands it.

- **Required `ship` status:** a commit status, required by the default branch's ruleset, that stays pending until the label is on, so nothing unreviewed merges.
- **Landing:** GitHub auto-merge once CI is green (`auto-merge` mode), or the project's own landing command run on a schedule (`command` mode, for example a batching script).
- **Dependabot:** patch updates and GitHub Actions updates are labelled `ship` automatically.
- **Labels:** `ship`, `pr-reviewed`, and the `spec:*` labels the pipeline uses.
- **`docs/agents/shipping.md`:** the rules, written down for people and for the other skills.
- **The project's `.claude/settings.json`:** enables the plugin.

GitHub settings are shown first and applied only after you approve them. You create the `SHIP_TOKEN` secret yourself: the skill never handles tokens. Deploys stay with the project's CD.

`pr-review` writes its review into the PR description: what changes by area, risks, preview, screens, and what to fix before merge. That is the page you read before adding `ship`.

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
