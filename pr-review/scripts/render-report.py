#!/usr/bin/env python3
"""Render a pr-review state file into the human report (<id>.md) and the page (<id>.html).

usage: render-report.py .scratch/pr-review/<id>.json

Writes both files next to the JSON. Stdlib only. Schema: references/state-format.md.
"""
import html
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

SEV_ORDER = {"blocker": 0, "major": 1, "minor": 2, "nit": 3}
SEV_LABEL = {"blocker": "Blocker", "major": "Major", "minor": "Minor", "nit": "Nit"}


# ---------- shared view model ----------

def build_view(state: dict) -> dict:
    runs = state.get("runs") or []
    if not runs:
        sys.exit("state has no runs")
    run = runs[-1]
    findings = state.get("findings") or []

    def decision(f):
        return (f.get("decision") or {}).get("state", "pending")

    live = [f for f in findings if f.get("status") == "open" and decision(f) != "rejected"]
    num = lambda f: int(re.sub(r"\D", "", f["id"]) or 0)
    key = lambda f: (SEV_ORDER.get(f["severity"], 9), -len(f.get("sources") or []), num(f))
    must = sorted([f for f in live if f["severity"] in ("blocker", "major")], key=key)
    minors = sorted([f for f in live if f["severity"] == "minor"], key=key)
    nits = sorted([f for f in live if f["severity"] == "nit"], key=key)

    themes: "OrderedDict[str, list]" = OrderedDict()
    for f in minors:
        themes.setdefault(f.get("theme") or "Other", []).append(f)
    themes = OrderedDict(sorted(themes.items(), key=lambda kv: (-len(kv[1]), kv[0])))
    if nits:
        themes["Polish"] = nits

    fixed_now = [f for f in findings if f.get("status") == "fixed" and f.get("fixed_in") == run["date"]]
    rejected = [f for f in findings if decision(f) == "rejected"]
    deferred = [f for f in live if decision(f) == "deferred"]

    ci = run.get("ci") or {"status": "none"}
    blocking = [f for f in must if decision(f) != "deferred"]
    if ci.get("status") == "failing" or blocking:
        verdict, tone = "Changes requested", "bad"
    elif minors or nits:
        verdict, tone = "Approve with suggestions", "warn"
    else:
        verdict, tone = "Approve", "good"

    parts = []
    if ci.get("status") == "failing":
        parts.append(f"{len(ci.get('failing') or [])} failing CI check(s)")
    parts.append(f"{len(must)} to fix before merge" if must else "nothing blocking")
    if minors or nits:
        parts.append(f"{len(minors) + len(nits)} smaller improvements")
    parts.append({"passing": "CI green", "pending": "CI running", "none": "no CI (not a PR)"}.get(ci.get("status"), ""))

    return {
        "state": state, "run": run, "first_run": len(runs) == 1,
        "must": must, "themes": themes, "fixed_now": fixed_now,
        "rejected": rejected, "deferred": deferred,
        "verdict": verdict, "tone": tone, "headline": " · ".join(p for p in parts if p),
        "all_shown": must + minors + nits, "decision": decision,
    }


def tag_for(view, f) -> str:
    if view["first_run"]:
        return ""
    return "new" if f.get("first_seen") == view["run"]["date"] else "still open"


def decision_text(f) -> str:
    d = f.get("decision") or {}
    s = d.get("state", "pending")
    if s == "pending":
        return ""
    return s + (f": {d['reason']}" if d.get("reason") else "")


# ---------- markdown ----------

def render_md(view) -> str:
    s, run = view["state"], view["run"]
    out = [f"# Review: {s.get('title', s['id'])}", ""]
    meta = f"{s['url']} · " if s.get("url") else ""
    out += [f"{meta}base `{s.get('base', '?')}` · head `{run.get('head', '?')}` · {run['date']}", ""]
    out += [f"**{view['verdict']}.** {view['headline']}", ""]
    if s.get("artifact_url"):
        out += [f"Page: {s['artifact_url']}", ""]

    ci = run.get("ci") or {}
    if ci.get("status") == "failing":
        out += ["## Failing CI", ""]
        out += [f"- {c['name']}" + (f" ({c['url']})" if c.get("url") else "") for c in ci.get("failing") or []]
        out += [""]

    if view["must"]:
        out += ["## Fix before merge", ""]
        for i, f in enumerate(view["must"], 1):
            tags = " · ".join(t for t in [SEV_LABEL[f["severity"]], tag_for(view, f), decision_text(f)] if t)
            out += [f"### {i}. {f['title']}", "", f"_{tags}_ · {f['id']}", "", f["why"], "",
                    f"**Fix:** {f['fix']}", "", " · ".join(f"`{loc}`" for loc in f.get("locations") or []), ""]

    if view["themes"]:
        total = sum(len(v) for v in view["themes"].values())
        out += [f"## Worth fixing ({total})", ""]
        for theme, items in view["themes"].items():
            out += [f"**{theme} ({len(items)})**", ""]
            for f in items:
                loc = (f.get("locations") or [""])[0]
                extra = " · ".join(t for t in [tag_for(view, f), decision_text(f)] if t)
                out.append(f"- {f['title']}" + (f" (`{loc}`)" if loc else "") + (f" _{extra}_" if extra else "") + f" · {f['id']}")
            out.append("")

    if view["fixed_now"]:
        out += ["## Fixed since last run", ""]
        out += [f"- {f['title']} · {f['id']}" for f in view["fixed_now"]] + [""]

    out += ["## Review notes", ""]
    out += [f"**CI:** {ci.get('status', 'none')}" + (f" ({ci['note']})" if ci.get("note") else ""), ""]
    if run.get("spec"):
        out += [f"**Spec:** {run['spec']}", ""]
    out += ["| Reviewer | Status | Note |", "|---|---|---|"]
    out += [f"| {l['lens']} | {l['status']} | {l.get('note', '')} |" for l in run.get("lenses") or []] + [""]
    if run.get("dropped"):
        out += ["**Dropped after verification**", ""]
        out += [f"- {d['title']} (`{d.get('where', '')}`): {d.get('reason', '')}" for d in run["dropped"]] + [""]
    if view["rejected"]:
        out += ["**Rejected** (not raised again)", ""]
        out += [f"- {f['title']} · {f['id']}: {(f.get('decision') or {}).get('reason', '')}" for f in view["rejected"]] + [""]
    if view["deferred"]:
        out += ["**Deferred**", ""]
        out += [f"- {f['title']} · {f['id']}: {(f.get('decision') or {}).get('reason', '')}" for f in view["deferred"]] + [""]

    out += ["## Evidence", ""]
    for f in view["all_shown"]:
        out += [f"<details><summary>{f['id']} · {html.escape(f['title'])}</summary>", ""]
        out += [f"- **Found by:** {', '.join(f.get('sources') or [])}" + (" (outside its lane)" if f.get("lane") == "out" else ""),
                f"- **Confidence:** {f.get('confidence', '?')}"]
        if f.get("verification"):
            out.append(f"- **Verification:** {f['verification']}")
        out += [f"- **Evidence:** {f.get('evidence', '')}", "", "</details>", ""]
    return "\n".join(out).rstrip() + "\n"


# ---------- html ----------

CODE_RE = re.compile(r"`([^`]+)`")


def inline(text: str) -> str:
    return CODE_RE.sub(lambda m: f"<code>{m.group(1)}</code>", html.escape(text or ""))


CSS = """
/* Layout: one reading column; verdict band, then findings ranked by consequence, notes and evidence last. */
:root {
  --bg: #f6f7f9; --surface: #ffffff; --fg: #1b1f27; --muted: #5b6372; --line: #dde1e8;
  --accent: #2b4fd8; --code-bg: #eceff4;
  --blocker: #b4232f; --major: #b25e09; --minor: #3d5a99; --nit: #6b7280; --good: #217a45;
  --tint-bad: #fbe9ea; --tint-warn: #fdf1e2; --tint-good: #e6f4ec;
  --font-display: "Newsreader", Georgia, "Times New Roman", serif;
  --font-body: "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #12151b; --surface: #1a1e26; --fg: #e6e9ef; --muted: #9aa3b2; --line: #2c323d;
  --accent: #8ea6ff; --code-bg: #232833;
  --blocker: #ff7b84; --major: #f2a54a; --minor: #9bb2ef; --nit: #a3abb8; --good: #62c98d;
  --tint-bad: #3a1d21; --tint-warn: #3a2a15; --tint-good: #16301f; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #12151b; --surface: #1a1e26; --fg: #e6e9ef; --muted: #9aa3b2; --line: #2c323d;
  --accent: #8ea6ff; --code-bg: #232833;
  --blocker: #ff7b84; --major: #f2a54a; --minor: #9bb2ef; --nit: #a3abb8; --good: #62c98d;
  --tint-bad: #3a1d21; --tint-warn: #3a2a15; --tint-good: #16301f; color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 16px/1.6 var(--font-body);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { max-width: 46rem; margin: 0 auto; padding-block: 2.5rem 4rem; display: grid; gap: 2.5rem; }
a { color: var(--accent); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font: 0.86em var(--font-mono); background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; overflow-wrap: anywhere; }
h1, h2 { font-family: var(--font-display); font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: 1.9rem; line-height: 1.2; }
h2 { font-size: 1.35rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.05rem; margin: 0; line-height: 1.4; text-wrap: balance; }
.eyebrow { font: 600 0.75rem var(--font-body); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
header { display: grid; gap: 0.75rem; }
.meta { color: var(--muted); font-size: 0.9rem; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
.meta code { font-size: 0.85em; }
.verdict { display: grid; gap: 0.2rem; padding: 1rem 1.25rem; border-radius: 10px; }
.verdict strong { font: 600 1.4rem var(--font-display); }
.verdict.bad { background: var(--tint-bad); } .verdict.bad strong { color: var(--blocker); }
.verdict.warn { background: var(--tint-warn); } .verdict.warn strong { color: var(--major); }
.verdict.good { background: var(--tint-good); } .verdict.good strong { color: var(--good); }
section { display: grid; gap: 1.25rem; }
ol.must { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.5rem; counter-reset: must; }
ol.must > li { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 0 0.75rem; counter-increment: must; }
ol.must > li::before { content: counter(must); font: 600 1.4rem/1.3 var(--font-display); color: var(--muted); font-variant-numeric: tabular-nums; }
.item { display: grid; gap: 0.45rem; min-width: 0; }
.item p { margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.chip { font: 600 0.72rem var(--font-body); letter-spacing: 0.05em; text-transform: uppercase; padding: 0.15rem 0.5rem;
  border-radius: 999px; border: 1px solid currentColor; }
.chip.blocker { color: var(--blocker); } .chip.major { color: var(--major); } .chip.minor { color: var(--minor); } .chip.nit { color: var(--nit); }
.chip.plain { color: var(--muted); }
.fix { padding-left: 0.75rem; border-left: 2px solid var(--line); }
.fix b { color: var(--muted); font-weight: 600; }
.locs { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.fid { font: 0.75rem var(--font-mono); color: var(--muted); }
.theme { display: grid; gap: 0.5rem; }
.theme h3 { display: flex; gap: 0.5rem; align-items: baseline; }
.theme h3 span { color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; }
ul.list { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.35rem; }
ul.list li { padding-left: 0.2rem; }
ul.list .sub { color: var(--muted); font-size: 0.9rem; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.notes { display: grid; gap: 1rem; }
.notes h3 { font-size: 0.95rem; }
details { border-bottom: 1px solid var(--line); padding-block: 0.5rem; }
summary { cursor: pointer; display: flex; gap: 0.6rem; align-items: baseline; }
summary .fid { flex: none; }
details dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.3rem 1rem; margin: 0.75rem 0 0.25rem; font-size: 0.92rem; }
details dt { color: var(--muted); }
details dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) { h1 { font-size: 1.5rem; } details dl { grid-template-columns: minmax(0, 1fr); } }
"""

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700'
         '&family=JetBrains+Mono:wght@400&family=Newsreader:opsz,wght@6..72,600&display=swap">')


def chip(cls, text):
    return f'<span class="chip {cls}">{html.escape(text)}</span>' if text else ""


def render_html(view) -> str:
    s, run = view["state"], view["run"]
    ident = s["id"].replace("pr-", "PR ") if s["id"].startswith("pr-") else s["id"]
    h = [f"<title>{html.escape(ident)} review</title>",
         '<meta name="claude:viewport-fit-sides" content="cover">', FONTS, f"<style>{CSS}</style>", "<main>"]

    link = f'<a href="{html.escape(s["url"])}">{html.escape(ident)}</a>' if s.get("url") else html.escape(ident)
    h += ["<header>", f'<div class="eyebrow">Code review · {link}</div>', f"<h1>{inline(s.get('title', s['id']))}</h1>",
          f'<div class="meta"><span>base <code>{html.escape(s.get("base", "?"))}</code></span>'
          f'<span>head <code>{html.escape(run.get("head", "?"))}</code></span><span>{html.escape(run["date"])}</span></div>',
          f'<div class="verdict {view["tone"]}"><strong>{html.escape(view["verdict"])}</strong><span>{html.escape(view["headline"])}</span></div>',
          "</header>"]

    ci = run.get("ci") or {}
    if ci.get("status") == "failing":
        h += ["<section><h2>Failing CI</h2><ul class=\"list\">"]
        for c in ci.get("failing") or []:
            name = html.escape(c["name"])
            h.append(f'<li><a href="{html.escape(c["url"])}">{name}</a></li>' if c.get("url") else f"<li>{name}</li>")
        h += ["</ul></section>"]

    if view["must"]:
        h += ["<section><h2>Fix before merge</h2>", '<ol class="must">']
        for f in view["must"]:
            locs = "".join(f"<code>{html.escape(l)}</code>" for l in f.get("locations") or [])
            tags = chip(f["severity"], SEV_LABEL[f["severity"]]) + chip("plain", tag_for(view, f)) + chip("plain", decision_text(f))
            h += [f'<li><div class="item"><h3>{inline(f["title"])}</h3><div class="tags">{tags}<span class="fid">{f["id"]}</span></div>',
                  f"<p>{inline(f['why'])}</p>", f'<p class="fix"><b>Fix</b> {inline(f["fix"])}</p>',
                  f'<div class="locs">{locs}</div></div></li>']
        h += ["</ol></section>"]

    if view["themes"]:
        total = sum(len(v) for v in view["themes"].values())
        h += [f"<section><h2>Worth fixing <span class=\"fid\">({total})</span></h2>"]
        for theme, items in view["themes"].items():
            h += ['<div class="theme">', f"<h3>{html.escape(theme)} <span>{len(items)}</span></h3>", '<ul class="list">']
            for f in items:
                loc = (f.get("locations") or [""])[0]
                extra = " · ".join(t for t in [tag_for(view, f), decision_text(f)] if t)
                h.append(f"<li>{inline(f['title'])} <span class=\"fid\">{f['id']}</span>"
                         + (f'<br><span class="sub"><code>{html.escape(loc)}</code></span>' if loc else "")
                         + (f' <span class="sub">· {html.escape(extra)}</span>' if extra else "") + "</li>")
            h += ["</ul></div>"]
        h += ["</section>"]

    if view["fixed_now"]:
        h += ["<section><h2>Fixed since last run</h2><ul class=\"list\">"]
        h += [f"<li>{inline(f['title'])} <span class=\"fid\">{f['id']}</span></li>" for f in view["fixed_now"]]
        h += ["</ul></section>"]

    h += ["<section><h2>Review notes</h2><div class=\"notes\">"]
    ci_line = html.escape(ci.get("status", "none")) + (f" · {html.escape(ci['note'])}" if ci.get("note") else "")
    h.append(f"<p><b>CI</b> {ci_line}" + (f"<br><b>Spec</b> {inline(run['spec'])}" if run.get("spec") else "") + "</p>")
    h += ['<div class="table-wrap"><table><thead><tr><th>Reviewer</th><th>Status</th><th>Note</th></tr></thead><tbody>']
    h += [f"<tr><td>{html.escape(l['lens'])}</td><td>{html.escape(l['status'])}</td><td>{inline(l.get('note', ''))}</td></tr>"
          for l in run.get("lenses") or []]
    h += ["</tbody></table></div>"]
    for heading, rows in (("Dropped after verification", [(d["title"], d.get("reason", ""), d.get("where", "")) for d in run.get("dropped") or []]),
                          ("Rejected (not raised again)", [(f["title"], (f.get("decision") or {}).get("reason", ""), f["id"]) for f in view["rejected"]]),
                          ("Deferred", [(f["title"], (f.get("decision") or {}).get("reason", ""), f["id"]) for f in view["deferred"]])):
        if rows:
            h += [f"<div><h3>{heading}</h3><ul class=\"list\">"]
            h += [f"<li>{inline(t)} <span class=\"fid\">{html.escape(ref)}</span><br><span class=\"sub\">{inline(r)}</span></li>" for t, r, ref in rows]
            h += ["</ul></div>"]
    h += ["</div></section>"]

    if view["all_shown"]:
        h += ["<section><h2>Evidence</h2><div>"]
        for f in view["all_shown"]:
            found = html.escape(", ".join(f.get("sources") or [])) + (" (outside its lane)" if f.get("lane") == "out" else "")
            rows = [("Found by", found), ("Confidence", html.escape(f.get("confidence", "?")))]
            if f.get("verification"):
                rows.append(("Verification", inline(f["verification"])))
            rows.append(("Evidence", inline(f.get("evidence", ""))))
            dl = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows)
            h.append(f'<details><summary><span class="fid">{f["id"]}</span><span>{inline(f["title"])}</span></summary><dl>{dl}</dl></details>')
        h += ["</div></section>"]

    h += ["</main>"]
    return "\n".join(h) + "\n"


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = Path(sys.argv[1])
    view = build_view(json.loads(path.read_text()))
    md, page = path.with_suffix(".md"), path.with_suffix(".html")
    md.write_text(render_md(view))
    page.write_text(render_html(view))
    print(f"{md}\n{page}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
