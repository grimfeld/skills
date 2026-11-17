---
lens: web-quality
source: web-quality-audit
upstream_path: ~/.claude/skills/web-quality-audit/SKILL.md
upstream_hash: a04a8ccbc301e12a7a4680886981db4955ebafbb
---

# Lens: web quality

Your lane: **the rendered front end**: performance (Core Web Vitals and loading), accessibility, SEO, best practices and agentic browsing, for the pages and components the diff touches. Backend cost, general code quality and server-side security belong to other lenses; mark any you report `"lane": "out"`.

Set `"evidence_type": "measured"` for findings backed by a live run and `"source"` for hypotheses from code. Keep them apart: a source hypothesis never borrows a measured finding's confidence.

## 1. Target

From the changed files, list the routes and states they affect (a component maps to the pages that render it). With an audit URL, those are the pages to visit under it. Without one, you are source-only: say so in the coverage line.

## 2. Live evidence (when there is a URL)

Use the best tool available; don't block on setup:

| Need | Preferred | Fallback |
|---|---|---|
| Performance, Core Web Vitals | Chrome DevTools MCP `performance_start_trace` then `performance_analyze_insight` | `npx -y lighthouse <url> --only-categories=performance --output=json --quiet --chrome-flags="--headless=new"` |
| Accessibility, SEO, best practices, agentic browsing | Chrome DevTools MCP `lighthouse_audit` (snapshot mode on authenticated pages) | `npx -y lighthouse <url> --output=json --quiet --chrome-flags="--headless=new"` |
| Rendered semantics, interaction | Accessibility tree snapshot and keyboard walk through the changed UI | Claude in Chrome tools |

Lighthouse 13+ reports performance as **Insights**; use current insight names, not removed audit ids. A score is a signal, not proof: cite the specific failing audit or insight and the element. Read-only throughout: don't submit forms or trigger destructive actions on the page.

## 3. Source inspection

Run `~/.claude/skills/web-quality-audit/scripts/analyze.sh <changed front-end dir>` as a smoke test if it exists, then read the changed files. Use live failures to localize; check source for the items below that live evidence can't show.

## 4. Checklist

**Performance**: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. Images declare `width`/`height`; the LCP image gets `fetchpriority="high"`, modern formats, `srcset`/`sizes`; below-fold images `loading="lazy"`. Heavy rarely-used features lazy-loaded; route-level code splitting; no render-blocking CSS/JS above the fold; fonts with `font-display: swap`; objects or functions created in render passed to memoized children; `memo`/`useMemo` only where the work is expensive.

**Accessibility (WCAG 2.2 AA)**: meaningful `alt` (decorative `alt=""`); contrast 4.5:1 text, 3:1 large text; colour not the only signal; every function keyboard-reachable, no traps, visible focus; `lang` on `<html>`; form inputs labelled, errors associated with fields; no duplicate ids; native elements over ARIA, ARIA roles matching behaviour; every interactive element has a name and role.

**SEO**: unique descriptive `<title>` and meta description per page; canonical URL; no `noindex` on important pages; logical heading structure; descriptive link text; valid structured data where present.

**Best practices**: HTTPS, no mixed content; no console errors; no deprecated APIs (`document.write`, sync XHR); no exposed source maps in production; no intrusive interstitials; permission requests only in context.

**Agentic browsing**: controls exposed with names, roles and states in the accessibility tree; WebMCP tools valid when present. Keep this separate from SEO claims.

## Severity

`blocker`: page broken, a keyboard trap, a core flow unusable with assistive tech. `major`: a Core Web Vitals failure, a missing form label or name on a primary control, a `noindex` on a public page. `minor`: improvement opportunities. `nit`: polish.

Done when every route or component the diff touches has been checked against every checklist category, live where a URL exists and from source otherwise.
