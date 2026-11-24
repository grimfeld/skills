"""Tests for update-pr-body.py.
Run: uv run --no-project python -m unittest discover -s skills/pr-review/scripts"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("update-pr-body.py")

BODY = (
    "Closes #7\r\n\r\nIntro paragraph.\n"
    "<!-- build:decisions:start -->\n## Decisions\n- old decision\n<!-- build:decisions:end -->\n"
    "\n<!-- pr-review:start -->\n## Review\nold review\n<!-- pr-review:end -->\n"
    "Trailing text  \n"
)


FOOT = "<sub>pr-review · head `abc1234` · 2026-11-24 10:00 UTC · reviewers: quality</sub>"
HEAD = "abc1234" + "0" * 33


class BodyFile(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write(self, name, text):
        p = Path(self.dir.name, name)
        p.write_bytes(text.encode())
        return str(p)

    def run_script(self, *args):
        # An empty PATH proves --body-file never reaches for gh.
        env = dict(os.environ, PATH="")
        r = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr.decode())
        return r.stdout.decode()

    def test_replaces_review_section_and_keeps_the_rest_byte_identical(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", f"<!-- pr-review:start -->\n## Review\nnew review\n{FOOT}\n<!-- pr-review:end -->\n")
        out = self.run_script("--body-file", body, "--head", HEAD, section)
        self.assertEqual(out, BODY.replace("old review", f"new review\n{FOOT}"))

    def test_named_markers_splice_only_their_section(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", "<!-- build:decisions:start -->\n## Decisions\n- new decision\n<!-- build:decisions:end -->")
        out = self.run_script("--markers", "build:decisions", "--body-file", body, section)
        self.assertEqual(out, BODY.replace("- old decision", "- new decision"))

    def test_section_without_markers_is_wrapped(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", "## Decisions\n- wrapped\n")
        out = self.run_script("--markers", "build:decisions", "--body-file", body, section)
        self.assertEqual(out, BODY.replace("- old decision", "- wrapped"))

    def test_markers_absent_appends_the_section(self):
        body = self.write("body.md", "Closes #7\n\nIntro.\n")
        section = self.write("s.md", f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->\n")
        out = self.run_script("--body-file", body, "--head", HEAD, section)
        self.assertEqual(out, f"Closes #7\n\nIntro.\n\n<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->\n")

    def test_empty_body_gets_the_section(self):
        body = self.write("body.md", "")
        section = self.write("s.md", f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->")
        self.assertEqual(self.run_script("--body-file", body, "--head", HEAD, section),
                         f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->\n")

    def test_end_marker_before_start_is_not_used(self):
        body = self.write("body.md", "<!-- pr-review:end -->\nkeep\n<!-- pr-review:start -->\nold\n<!-- pr-review:end -->\n")
        section = self.write("s.md", f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->")
        self.assertEqual(self.run_script("--body-file", body, "--head", HEAD, section),
                         f"<!-- pr-review:end -->\nkeep\n<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->\n")

    def refused(self, *args):
        env = dict(os.environ, PATH="")
        r = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, env=env)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, b"")
        return r.stderr.decode()

    def test_wrong_head_is_refused(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->")
        self.assertIn("head abc1234", self.refused("--body-file", body, "--head", "def5678" + "0" * 33, section))

    def test_missing_head_is_refused(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->")
        self.assertIn("--head", self.refused("--body-file", body, section))

    def test_section_without_footer_is_refused(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", "<!-- pr-review:start -->\n## Review\nhand typed\n<!-- pr-review:end -->")
        self.assertIn("no pr-review footer", self.refused("--body-file", body, "--head", HEAD, section))

    def test_body_file_with_extra_argument_is_a_usage_error(self):
        r = subprocess.run([sys.executable, str(SCRIPT), "--body-file", "x", "a", "b"], capture_output=True)
        self.assertEqual(r.returncode, 2)


class PrNumber(unittest.TestCase):
    """The gh path, with a stub gh that serves a body and records the PATCH payload."""

    def test_markers_reach_the_patch(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "body.txt").write_text(BODY)
            gh = d / "gh"
            (d / "pr.json").write_text(json.dumps({"body": BODY, "head": HEAD}))
            gh.write_text(f'#!/bin/sh\ncase "$*" in *PATCH*) cat > "{d}/patch.json";; *) cat "{d}/pr.json";; esac\n')
            gh.chmod(0o755)
            section = d / "s.md"
            section.write_text("## Decisions\n- new decision\n")
            env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}")
            r = subprocess.run([sys.executable, str(SCRIPT), "--markers", "build:decisions", "7", str(section)],
                               capture_output=True, text=True, env=env)
            self.assertEqual((r.returncode, r.stdout), (0, "updated\n"), r.stderr)
            sent = json.loads((d / "patch.json").read_text())["body"]
            self.assertEqual(sent, BODY.replace("- old decision", "- new decision"))


class HeadCheck(unittest.TestCase):
    """The head and footer checks as pure functions, with no gh."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("update_pr_body", SCRIPT)
        cls.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.mod)

    def test_footer_head_is_read(self):
        self.assertEqual(self.mod.footer_head(f"x\n{FOOT}\n"), "abc1234")
        self.assertIsNone(self.mod.footer_head("## Review\nno footer"))

    def test_prefix_of_the_pr_head_passes(self):
        self.assertIsNone(self.mod.head_error(FOOT, HEAD))

    def test_other_head_fails(self):
        self.assertIn("review the current head", self.mod.head_error(FOOT, "abc1235" + "0" * 33))

    def test_unknown_or_placeholder_head_fails(self):
        self.assertIsNotNone(self.mod.head_error(FOOT, ""))
        self.assertIsNotNone(self.mod.head_error(FOOT.replace("abc1234", "?"), HEAD))

    def test_no_footer_fails(self):
        self.assertIn("no pr-review footer", self.mod.head_error("## Review\n", HEAD))


class PrNumberHead(unittest.TestCase):
    def test_wrong_head_leaves_the_description_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "pr.json").write_text(json.dumps({"body": BODY, "head": "fff" + "0" * 37}))
            gh = d / "gh"
            gh.write_text(f'#!/bin/sh\ncase "$*" in *PATCH*) touch "{d}/patched";; *) cat "{d}/pr.json";; esac\n')
            gh.chmod(0o755)
            section = d / "s.md"
            section.write_text(f"<!-- pr-review:start -->\n{FOOT}\n<!-- pr-review:end -->\n")
            env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}")
            r = subprocess.run([sys.executable, str(SCRIPT), "7", str(section)], capture_output=True, text=True, env=env)
            self.assertNotEqual(r.returncode, 0)
            self.assertFalse((d / "patched").exists())


if __name__ == "__main__":
    unittest.main()
