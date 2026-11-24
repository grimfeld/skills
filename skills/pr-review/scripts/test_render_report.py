"""Tests for render-report.py.

Run from the repository root:
    uv run --no-project python -m unittest discover -s skills/pr-review/scripts -p 'test_*.py'

Each test writes a small state file, renders it, and asserts on the three outputs.
Later specs add fixtures here: build a state with `state(...)` and read outputs with `render(...)`.
"""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "render-report.py"


def finding(fid, severity, theme="Other", title=None):
    return {
        "id": fid, "severity": severity, "status": "open", "first_seen": "2026-11-23 20:00", "fixed_in": None,
        "title": title or f"Finding {fid}", "why": "Because.", "fix": "Do the thing.", "theme": theme,
        "locations": [f"src/{fid}.py:1"], "sources": ["code-review"], "confidence": "high", "lane": "in",
        "evidence": "quoted", "decision": {"state": "pending", "reason": "", "date": ""}, "ticket": None,
    }


def state(findings=(), ci=None, lenses=None):
    return {
        "schema": 1, "id": "pr-1", "title": "A change", "url": "https://github.com/o/r/pull/1", "base": "abc",
        "artifact_url": None, "brief": {"changes": [{"area": "Core", "what": "It changes."}], "risks": []},
        "runs": [{
            "date": "2026-11-23 20:00", "head": "def",
            "ci": ci if ci is not None else {"status": "passing", "failing": []},
            "spec": "issue #1",
            "lenses": lenses if lenses is not None else [{"lens": "quality", "status": "ran", "note": ""}],
            "dropped": [],
        }],
        "findings": list(findings),
    }


def render(st) -> dict:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "pr-1.json"
        path.write_text(json.dumps(st))
        subprocess.run([sys.executable, str(SCRIPT), str(path)], check=True, capture_output=True, text=True)
        return {k: path.with_suffix(ext).read_text() for k, ext in (("md", ".md"), ("html", ".html"), ("pr", ".pr.md"))}


def headline_count(text):
    m = re.search(r"(\d+) smaller improvements", text)
    return int(m.group(1)) if m else 0


def worth_fixing_items(out) -> dict:
    """The items each output lists under Worth fixing."""
    md = out["md"].split("## Worth fixing", 1)[1].split("\n## ", 1)[0]
    html = out["html"].split("<h2>Worth fixing", 1)[1].split("</section>", 1)[0]
    pr = out["pr"].split("Worth fixing later", 1)[1].split("</details>", 1)[0]
    return {
        "md": len(re.findall(r"^- ", md, re.M)),
        "html": html.count("<li>"),
        "pr": sum(len(line.split(":** ", 1)[1].split("; ")) for line in pr.splitlines() if line.startswith("- **")),
    }


class WorthFixing(unittest.TestCase):
    def test_polish_minor_and_nits_share_one_group(self):
        st = state([finding("F1", "minor", "Polish"), finding("F2", "minor", "Tests"),
                    finding("F3", "nit", "Polish"), finding("F4", "nit", "Polish")])
        out = render(st)
        self.assertEqual(headline_count(out["pr"]), 4)
        self.assertEqual(worth_fixing_items(out), {"md": 4, "html": 4, "pr": 4})
        self.assertEqual(out["md"].count("**Polish ("), 1)
        self.assertIn("**Polish (3)**", out["md"])
        self.assertEqual(out["pr"].count("**Polish:**"), 1)
        self.assertEqual(out["html"].count(">Polish <span>"), 1)

    def test_headline_count_matches_lists(self):
        st = state([finding("F1", "minor", "A"), finding("F2", "minor", "B"), finding("F3", "minor", "A"),
                    finding("F4", "nit")])
        out = render(st)
        for name in ("md", "html", "pr"):
            self.assertEqual(headline_count(out[name]), 4, name)
        self.assertEqual(worth_fixing_items(out), {"md": 4, "html": 4, "pr": 4})


    def test_minor_only_polish_keeps_its_place(self):
        st = state([finding("F1", "minor", "Polish"), finding("F2", "minor", "Polish"), finding("F3", "minor", "Tests")])
        md = render(st)["md"]
        self.assertLess(md.index("**Polish (2)**"), md.index("**Tests (1)**"))

    def test_nits_put_polish_last(self):
        st = state([finding("F1", "minor", "Polish"), finding("F2", "minor", "Polish"), finding("F3", "minor", "Tests"),
                    finding("F4", "nit")])
        md = render(st)["md"]
        self.assertLess(md.index("**Tests (1)**"), md.index("**Polish (3)**"))


class Footer(unittest.TestCase):
    def footer(self, lenses):
        pr = render(state(lenses=lenses))["pr"]
        return re.search(r"reviewers: (.*)</sub>", pr).group(1)

    def test_lists_ran_stale_and_unverified(self):
        got = self.footer([
            {"lens": "standards-and-spec", "status": "ran"},
            {"lens": "quality", "status": "stale"},
            {"lens": "security", "status": "unverified", "note": "reason: no-lock"},
            {"lens": "performance", "status": "skipped"},
            {"lens": "web-quality", "status": "failed"},
        ])
        self.assertEqual(got, "standards-and-spec, quality (stale), security (unverified)")

    def test_all_stale_names_every_lens(self):
        got = self.footer([{"lens": n, "status": "stale"} for n in ("quality", "security", "principles")])
        self.assertEqual(got, "quality (stale), security (stale), principles (stale)")

    def test_none_ran(self):
        self.assertEqual(self.footer([{"lens": "quality", "status": "skipped"}]), "none")


class CI(unittest.TestCase):
    def test_failing_without_names(self):
        out = render(state(ci={"status": "failing", "failing": [], "note": "build job red"}))
        for name in ("md", "html", "pr"):
            self.assertNotIn("0 failing", out[name], name)
            self.assertNotIn("Failing CI", out[name], name)
            self.assertIn("CI failing (build job red)", out[name], name)

    def test_failing_without_names_or_note(self):
        out = render(state(ci={"status": "failing", "failing": []}))
        self.assertIn("**Changes requested.** CI failing ·", out["pr"])

    def test_failing_with_names_lists_them(self):
        out = render(state(ci={"status": "failing", "failing": [{"name": "test", "url": "https://x/1"}]}))
        self.assertIn("1 failing CI check(s)", out["pr"])
        self.assertIn("### Failing CI", out["pr"])
        self.assertIn("## Failing CI", out["md"])
        self.assertIn("<h2>Failing CI</h2>", out["html"])

    def test_no_checks(self):
        out = render(state(ci={"status": "no-checks", "failing": []}))
        self.assertIn("**Approve.** nothing blocking · no CI checks configured", out["md"])
        self.assertIn("**Approve.** nothing blocking · no CI checks configured", out["pr"])
        self.assertIn("<strong>Approve</strong><span>nothing blocking · no CI checks configured</span>", out["html"])
        notes_md = out["md"].split("## Review notes", 1)[1]
        self.assertIn("**CI:** no CI checks configured", notes_md)
        notes_html = out["html"].split("<h2>Review notes</h2>", 1)[1]
        self.assertIn("<b>CI</b> no CI checks configured", notes_html)

    def test_notes_line_keeps_its_format(self):
        out = render(state(ci={"status": "passing", "failing": [], "note": "check, e2e"}))
        self.assertIn("**CI:** passing (check, e2e)", out["md"])
        self.assertIn("<b>CI</b> passing · check, e2e", out["html"])

    def test_other_statuses_unchanged(self):
        for status, text in (("passing", "CI green"), ("pending", "CI running"), ("none", "no CI (not a PR)")):
            with self.subTest(status=status):
                self.assertIn(text, render(state(ci={"status": status, "failing": []}))["pr"])


if __name__ == "__main__":
    unittest.main()
