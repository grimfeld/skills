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


class NeedsPerson(unittest.TestCase):
    def test_decision_tag_names_the_options(self):
        f = finding("F1", "major", "Behaviour", title="Editing a word drops its kind")
        f["options"] = [{"name": "Keep the spec", "what": "both words must form the pair"},
                        {"name": "Change the spec", "what": "either word keeps the kind"}]
        f["decision"] = {"state": "needs-person", "reason": "contradicts the spec's 'mother/godson counts as no kind'", "date": ""}
        out = render(state([f]))
        tag = "needs a person: Keep the spec / Change the spec"
        for name in ("md", "html", "pr"):
            self.assertIn(tag, out[name], name)
        self.assertNotIn("needs-person", out["md"])

    def test_without_options_no_dangling_colon(self):
        f = finding("F1", "major")
        f["decision"] = {"state": "needs-person", "reason": "", "date": ""}
        pr = render(state([f]))["pr"]
        self.assertIn("needs a person)", pr)
        self.assertNotIn("needs a person:", pr)

    def test_other_decisions_unchanged(self):
        f = finding("F1", "major")
        f["decision"] = {"state": "approved", "reason": "unattended: fix before merge", "date": ""}
        self.assertIn("approved: unattended: fix before merge", render(state([f]))["pr"])


class FixRound(unittest.TestCase):
    def test_run_line_and_fixed_list(self):
        fixed = finding("F1", "major", title="The lookup skips the owner check")
        fixed.update(status="fixed", fixed_in="2026-11-23 21:00")
        st = state([fixed, finding("F2", "minor")])
        st["runs"].append(dict(st["runs"][0], date="2026-11-23 21:00", head="fff", mode="fix-round"))
        out = render(st)
        self.assertIn("· Fix round", out["md"].split("\n\n", 2)[1])
        self.assertIn("<span>Fix round</span>", out["html"])
        self.assertIn("· fix round ·", out["pr"])
        self.assertIn("## Fixed since last run", out["md"])
        self.assertIn("The lookup skips the owner check · F1", out["md"])

    def test_full_run_has_no_fix_round_text(self):
        out = render(state([finding("F1", "minor")]))
        for name in ("md", "html", "pr"):
            self.assertNotIn("ix round", out[name], name)


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


def git_repo(d) -> str:
    """A temporary repository with one commit; returns its full HEAD SHA."""
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "PATH": "/usr/bin:/bin:/usr/local/bin"}
    for cmd in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "c"]):
        subprocess.run(["git", "-C", d, *cmd], check=True, capture_output=True, env=env)
    return subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()


def run_script(path, *args):
    return subprocess.run([sys.executable, str(SCRIPT), *args, str(path)], capture_output=True, text=True)


def unstamped(st):
    """Turn a fixture's latest run into a fresh, unstamped one."""
    st["runs"][-1]["date"] = "this-run"
    st["runs"][-1].pop("head", None)
    return st


STAMP_RE = r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC"


class Stamp(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.repo = Path(self.dir.name, "repo")
        self.repo.mkdir()
        self.sha = git_repo(str(self.repo))
        self.path = Path(self.dir.name, "pr-1.json")

    def write(self, st):
        self.path.write_text(json.dumps(st))

    def outputs_exist(self):
        return [self.path.with_suffix(e).exists() for e in (".md", ".html", ".pr.md")]

    def window(self):
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).replace(second=0, microsecond=0)

    def test_stamp_fills_date_head_first_seen_and_fixed_in(self):
        new, fixed, old = finding("F1", "major"), finding("F2", "minor"), finding("F3", "minor")
        new["first_seen"] = "this-run"
        fixed.update(status="fixed", fixed_in="this-run")
        self.write(unstamped(state([new, fixed, old])))
        before = self.window()
        r = run_script(self.path, "--stamp", str(self.repo))
        after = self.window()
        self.assertEqual(r.returncode, 0, r.stderr)
        saved = json.loads(self.path.read_text())
        run = saved["runs"][-1]
        self.assertRegex(run["date"], f"^{STAMP_RE}$")
        from datetime import datetime, timezone
        stamped = datetime.strptime(run["date"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
        self.assertTrue(before <= stamped <= after, (before, stamped, after))
        self.assertEqual(run["head"], self.sha[:7])
        f1, f2, f3 = saved["findings"]
        self.assertEqual(f1["first_seen"], run["date"])
        self.assertEqual(f2["fixed_in"], run["date"])
        self.assertEqual(f3["first_seen"], "2026-11-23 20:00")
        self.assertIn(f"head `{self.sha[:7]}` · {run['date']}", self.path.with_suffix(".pr.md").read_text())

    def test_stamping_twice_is_refused(self):
        self.write(unstamped(state()))
        self.assertEqual(run_script(self.path, "--stamp", str(self.repo)).returncode, 0)
        saved = self.path.read_text()
        for p in (self.path.with_suffix(e) for e in (".md", ".html", ".pr.md")):
            p.unlink()
        r = run_script(self.path, "--stamp", str(self.repo))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("run already stamped", r.stderr)
        self.assertEqual(self.path.read_text(), saved)
        self.assertEqual(self.outputs_exist(), [False] * 3)

    def test_unstamped_render_is_refused(self):
        self.write(unstamped(state()))
        r = run_script(self.path)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("run not stamped", r.stderr)
        self.assertEqual(self.outputs_exist(), [False] * 3)

    def test_bad_root_is_refused(self):
        self.write(unstamped(state()))
        before = self.path.read_text()
        r = run_script(self.path, "--stamp", str(Path(self.dir.name, "missing")))
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(), before)
        self.assertEqual(self.outputs_exist(), [False] * 3)

    def test_rerender_keeps_the_stamp(self):
        self.write(unstamped(state()))
        run_script(self.path, "--stamp", str(self.repo))
        stamped = self.path.read_text()
        r = run_script(self.path)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.path.read_text(), stamped)

    def test_earlier_runs_keep_their_dates(self):
        st = state()
        st["runs"].append({"date": "this-run", "ci": {"status": "passing"}, "lenses": [{"lens": "quality", "status": "ran"}]})
        self.write(st)
        run_script(self.path, "--stamp", str(self.repo))
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved["runs"][0], st["runs"][0])

    def test_two_stamped_runs_label_new_still_open_and_fixed(self):
        old, gone = finding("F1", "minor"), finding("F2", "minor", title="Gone")
        old["first_seen"] = gone["first_seen"] = "this-run"
        self.write(unstamped(state([old, gone])))
        run_script(self.path, "--stamp", str(self.repo))
        st = json.loads(self.path.read_text())
        # A review takes minutes; move the first stamp an hour back so the second can't share its minute.
        first = st["runs"][0]["date"]
        earlier = "2000-01-01 00:00 UTC"
        st["runs"][0]["date"] = earlier
        for f in st["findings"]:
            self.assertEqual(f["first_seen"], first)
            f["first_seen"] = earlier
        st["runs"].append({"date": "this-run", "ci": {"status": "passing"}, "lenses": [{"lens": "quality", "status": "ran"}]})
        new = finding("F3", "minor", title="Brand new")
        new["first_seen"] = "this-run"
        st["findings"][1].update(status="fixed", fixed_in="this-run")
        st["findings"].append(new)
        self.write(st)
        r = run_script(self.path, "--stamp", str(self.repo))
        self.assertEqual(r.returncode, 0, r.stderr)
        md = self.path.with_suffix(".md").read_text()
        self.assertRegex(md, r"- Finding F1 \(`src/F1.py:1`\) _still open_ · F1")
        self.assertRegex(md, r"- Brand new \(`src/F3.py:1`\) _new_ · F3")
        self.assertIn("## Fixed since last run\n\n- Gone · F2", md)
