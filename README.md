# skills

Custom [Claude Code](https://claude.com/claude-code) skills that orchestrate other installed skills to automate parts of a development workflow.

## Skills

### `pr-review`

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
3. **Route**: skips lenses with nothing to review (no front-end files: no web audit; docs-only: standards and spec only).
4. **Find a preview URL** for the web audit: GitHub deployments, the Vercel bot comment, the Vercel MCP, then a local dev server already running. Never starts or deploys anything.
5. **Review** in parallel. Every reviewer is report-only and returns findings in one shared format.
6. **Dedupe** across lenses. A finding several lenses agree on ranks higher.
7. **Verify** every blocker and major against the code; false positives are dropped.
8. **Report** to `.scratch/pr-review/<id>.md`. Re-runs mark findings fixed, still open or new, and never resurface rejected ones.
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
- `/implement-spec` (from mattpocock/skills) to act on the generated tickets.

## Install

```sh
git clone https://github.com/grimfeld/skills.git
ln -s "$PWD/skills/pr-review" ~/.claude/skills/pr-review
```

## Credits

The lenses in `pr-review/lenses/` are condensed adaptations of MIT-licensed skills:

- [mattpocock/skills](https://github.com/mattpocock/skills): Copyright (c) 2026 Matt Pocock
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills): Copyright (c) 2025 Addy Osmani
- [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills): Copyright (c) 2026 Addy Osmani

Each is distributed under the MIT License; see the linked repositories for the full text.

## License

[MIT](LICENSE)
