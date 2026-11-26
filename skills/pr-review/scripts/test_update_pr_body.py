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
        section = self.write("s.md", "<!-- pr-review:start -->\n## Review\nnew review\n<!-- pr-review:end -->\n")
        out = self.run_script("--body-file", body, section)
        self.assertEqual(out, BODY.replace("old review", "new review"))

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
        section = self.write("s.md", "<!-- pr-review:start -->\nreview\n<!-- pr-review:end -->\n")
        out = self.run_script("--body-file", body, section)
        self.assertEqual(out, "Closes #7\n\nIntro.\n\n<!-- pr-review:start -->\nreview\n<!-- pr-review:end -->\n")

    def test_empty_body_gets_the_section(self):
        body = self.write("body.md", "")
        section = self.write("s.md", "<!-- pr-review:start -->\nreview\n<!-- pr-review:end -->")
        self.assertEqual(self.run_script("--body-file", body, section),
                         "<!-- pr-review:start -->\nreview\n<!-- pr-review:end -->\n")

    def test_end_marker_before_start_is_not_used(self):
        body = self.write("body.md", "<!-- pr-review:end -->\nkeep\n<!-- pr-review:start -->\nold\n<!-- pr-review:end -->\n")
        section = self.write("s.md", "<!-- pr-review:start -->\nnew\n<!-- pr-review:end -->")
        self.assertEqual(self.run_script("--body-file", body, section),
                         "<!-- pr-review:end -->\nkeep\n<!-- pr-review:start -->\nnew\n<!-- pr-review:end -->\n")

    def test_try_it_goes_above_decisions_the_first_time(self):
        body = self.write("body.md", BODY)
        section = self.write("s.md", "## Try it\n1. Open it.\n")
        out = self.run_script("--markers", "build:try-it", "--before", "build:decisions", "--body-file", body, section)
        try_it = "<!-- build:try-it:start -->\n## Try it\n1. Open it.\n<!-- build:try-it:end -->\n\n"
        self.assertEqual(out, BODY.replace("<!-- build:decisions:start -->", try_it + "<!-- build:decisions:start -->"))

    def test_try_it_is_replaced_in_place_next_to_the_other_sections(self):
        try_it = "<!-- build:try-it:start -->\n## Try it\nold steps\n<!-- build:try-it:end -->\n\n"
        current = BODY.replace("<!-- build:decisions:start -->", try_it + "<!-- build:decisions:start -->")
        body = self.write("body.md", current)
        section = self.write("s.md", "<!-- build:try-it:start -->\n## Try it\nnew steps\n<!-- build:try-it:end -->\n")
        out = self.run_script("--markers", "build:try-it", "--before", "build:decisions", "--body-file", body, section)
        self.assertEqual(out, current.replace("old steps", "new steps"))
        # The other two sections are untouched, byte for byte.
        self.assertIn("- old decision", out)
        self.assertIn("old review", out)

    def test_before_a_section_that_is_not_there_appends(self):
        body = self.write("body.md", "Closes #7\n\nIntro.\n")
        section = self.write("s.md", "## Try it\nsteps\n")
        out = self.run_script("--markers", "build:try-it", "--before", "build:decisions", "--body-file", body, section)
        self.assertEqual(out, "Closes #7\n\nIntro.\n\n<!-- build:try-it:start -->\n## Try it\nsteps\n<!-- build:try-it:end -->\n")

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
            gh.write_text(f'#!/bin/sh\ncase "$*" in *PATCH*) cat > "{d}/patch.json";; *) cat "{d}/body.txt";; esac\n')
            gh.chmod(0o755)
            section = d / "s.md"
            section.write_text("## Decisions\n- new decision\n")
            env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}")
            r = subprocess.run([sys.executable, str(SCRIPT), "--markers", "build:decisions", "7", str(section)],
                               capture_output=True, text=True, env=env)
            self.assertEqual((r.returncode, r.stdout), (0, "updated\n"), r.stderr)
            sent = json.loads((d / "patch.json").read_text())["body"]
            self.assertEqual(sent, BODY.rstrip("\n").replace("- old decision", "- new decision"))


if __name__ == "__main__":
    unittest.main()
