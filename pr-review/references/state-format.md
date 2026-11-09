# Review state and how to write findings for people

The orchestrator keeps one state file per review at `.scratch/pr-review/<id>.json`. It is the single source of truth: re-runs read it, decisions are written to it, and `scripts/render-report.py` turns it into the human report (`<id>.md`) and the shareable page (`<id>.html`). Never hand-edit the `.md` or `.html`; change the JSON and re-render.

## Writing findings for people

Reviewers return findings in agent terms. Before saving a finding to state, rewrite its human fields:

- **`title`**: what goes wrong, for a user or maintainer, in plain words. Under 12 words. No code identifiers.
  - Agent: "`promptText` re-derives each face's question/answer; already differs from WordFace for listen"
  - Person: "The practice report and the practice screen can show different questions"
- **`why`**: one or two sentences: when it happens and what it costs. Code identifiers only where the reader needs them to find the spot.
- **`fix`**: one sentence naming the move, plus the test or check that proves it.
- **`theme`**: a short area name readers recognise, shared across findings so minors group well: `Accessibility`, `Security`, `Data and privacy`, `Performance`, `Duplication and type casts`, `Error handling`, `Tests`, `Docs and decisions`, `Layout on phones`, or another plain name. Nits always use `Polish`.
- One finding, one issue. Split a reviewer finding that packs several issues into several findings.

The agent-facing detail (`evidence`, `verification`, `sources`, `confidence`) is kept verbatim; the report shows it collapsed.

## Schema

```json
{
  "schema": 1,
  "id": "pr-435",
  "title": "Knowledge: agent drafts, practice report, typed attempts",
  "url": "https://github.com/owner/repo/pull/435",
  "base": "9d6fe081",
  "artifact_url": null,
  "runs": [
    {
      "date": "2026-11-09 15:34",
      "head": "e9828ed0",
      "ci": { "status": "passing", "failing": [], "note": "check, e2e ×4, CodeQL" },
      "spec": "issues #423, #424–#434",
      "lenses": [
        { "lens": "web-quality", "status": "ran", "note": "source-only: no preview found" },
        { "lens": "performance", "status": "skipped", "note": "no server code changed" }
      ],
      "dropped": [
        { "title": "…", "where": "file:line", "source": "security-and-hardening", "reason": "…" }
      ]
    }
  ],
  "findings": [
    {
      "id": "F1",
      "severity": "major",
      "status": "open",
      "first_seen": "2026-11-09 15:34",
      "fixed_in": null,
      "title": "Two listening prompts in a row: the second one never autoplays",
      "why": "…",
      "fix": "…",
      "theme": "Practice",
      "locations": ["apps/languages/src/components/ClipPlayer.tsx:36"],
      "sources": ["web-quality-audit", "code-review-and-quality"],
      "confidence": "high",
      "lane": "in",
      "verification": "confirmed: …",
      "evidence": "…",
      "decision": { "state": "pending", "reason": "", "date": "" },
      "ticket": null
    }
  ]
}
```

| Field | Rule |
|---|---|
| `runs` | Newest last. Append one per run; never rewrite earlier runs. |
| `ci.status` | `passing`, `failing`, `pending` or `none` (no PR). `failing` lists `{name, url}`. |
| `lenses[].status` | `ran`, `skipped`, `failed` or `stale` (run with an un-synced lens). |
| `findings[].id` | `F<n>`, assigned once and never reused. A finding keeps its id across runs. |
| `severity` | From `references/finding-format.md`. |
| `status` | `open` or `fixed`. Set `fixed` with `fixed_in` = the run date when a re-run no longer finds it. |
| `decision.state` | `pending`, `approved`, `rejected` or `deferred`. Rejected findings are never resurfaced: on a re-run, a new finding matching a rejected one (same root cause, same place) is discarded. |
| `ticket` | The ticket number once tickets are written. |

## Re-runs

Match each new finding to an existing open finding by root cause and location. Matched: keep the existing id, decision and human fields, refresh `evidence` and `locations`. Unmatched new findings get new ids with `first_seen` set to this run. Existing open findings nothing matched become `fixed`.

**Legacy reports**: if `<id>.md` exists without `<id>.json`, seed state from it once: each row of its Rejected table becomes a finding with `decision.state: "rejected"` and its reason.
