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


TEMPLATE = (
    "## What to build\r\nStuff.  \n\n"
    "<!-- Below this line: filled in by the agent -->\n"
    "## Notes\nkept\n"
)
SLICE = "<!-- slice:start -->\n## Slicing\n- new slice\n<!-- slice:end -->\n"


def fake_gh(d, body):
    """A gh stub on PATH: records its args, serves `body` for GETs, saves the PATCH payload."""
    d = Path(d)
    (d / "body.txt").write_bytes(body.encode())
    gh = d / "gh"
    gh.write_text(
        f'#!/bin/sh\necho "$*" >> "{d}/args.txt"\n'
        f'case "$*" in *PATCH*) cat > "{d}/patch.json";; *) cat "{d}/body.txt";; esac\n')
    gh.chmod(0o755)
    return dict(os.environ, PATH=f"{d}:{os.environ['PATH']}")


class Issue(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.d = Path(self.dir.name)

    def run_script(self, body, section, *args):
        env = fake_gh(self.d, body)
        (self.d / "s.md").write_text(section)
        r = subprocess.run([sys.executable, str(SCRIPT), *args, str(self.d / "s.md")],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def sent(self):
        return json.loads((self.d / "patch.json").read_text())["body"]

    def test_issue_form_fetches_and_patches_the_issue(self):
        body = "head \r\n" + SLICE.replace("new", "old") + "tail  "
        r = self.run_script(body, SLICE, "--issue", "250", "--markers", "slice")
        self.assertEqual(r.stdout, "updated\n")
        args = (self.d / "args.txt").read_text().splitlines()
        self.assertEqual(len(args), 2)
        self.assertIn("repos/{owner}/{repo}/issues/250", args[0])
        self.assertIn("-X PATCH repos/{owner}/{repo}/issues/250", args[1])
        self.assertNotIn("pulls", "".join(args))
        self.assertEqual(self.sent(), "head \r\n" + SLICE.rstrip("\n") + "\ntail  ")

    def test_issue_form_keeps_bytes_outside_markers(self):
        body = "a\r\n  b \n" + SLICE.replace("new", "old") + "\nz\t\n"
        self.run_script(body, SLICE, "--issue", "9", "--markers", "slice")
        sent = self.sent()
        self.assertTrue(sent.startswith("a\r\n  b \n<!-- slice:start -->"))
        self.assertTrue(sent.endswith("<!-- slice:end -->\n\nz\t"))
        self.assertIn("new slice", sent)

    def test_no_markers_appends_after_template_marker_line(self):
        self.run_script(TEMPLATE, SLICE, "--issue", "9", "--markers", "slice")
        self.assertEqual(self.sent(), TEMPLATE.replace(
            "agent -->\n", "agent -->\n" + SLICE.rstrip("\n") + "\n").rstrip("\n"))

    def test_no_markers_no_template_line_appends_at_the_end(self):
        body = "## What to build\nStuff\n"
        self.run_script(body, SLICE, "--issue", "9", "--markers", "slice")
        self.assertEqual(self.sent(), "## What to build\nStuff\n\n" + SLICE)

    def test_unmarked_slicing_section_is_removed(self):
        body = ("Intro\n\n## Slicing\n- old a\n- old b\n\n## Notes\nkeep\n"
                "<!-- Below this line -->\n## Slicing\nsecond, to the end\n")
        self.run_script(body, SLICE, "--issue", "9", "--markers", "slice")
        sent = self.sent()
        self.assertEqual(sent.count("## Slicing"), 1)
        self.assertNotIn("old a", sent)
        self.assertNotIn("second, to the end", sent)
        self.assertIn("## Notes\nkeep\n", sent)
        self.assertTrue(sent.startswith("Intro\n\n## Notes"))
        self.assertIn("<!-- Below this line -->\n<!-- slice:start -->", sent)

    def test_slicing_is_left_alone_for_other_markers(self):
        body = "## Slicing\nkeep\n"
        self.run_script(body, "<!-- pr-review:start -->\nr\n<!-- pr-review:end -->", "9")
        self.assertIn("## Slicing\nkeep", self.sent())

    def test_resplice_keeps_one_slicing_section(self):
        first = self.run_script("## What\nx\n", SLICE, "--issue", "9", "--markers", "slice")
        self.assertEqual(first.stdout, "updated\n")
        again = self.run_script(self.sent(), SLICE.replace("new", "newer"), "--issue", "9", "--markers", "slice")
        self.assertEqual(self.sent().count("## Slicing"), 1)
        self.assertIn("newer slice", self.sent())


class BodyFileSlice(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    write = BodyFile.write
    run_script = BodyFile.run_script

    def test_slice_body_file_removes_unmarked_slicing_and_calls_no_gh(self):
        body = self.write("body.md", "x\n## Slicing\nold\n## Tail\nt\n")
        section = self.write("s.md", SLICE)
        out = self.run_script("--markers", "slice", "--body-file", body, section)
        self.assertEqual(out, "x\n## Tail\nt\n\n" + SLICE)

    def test_decisions_and_notes_sections_survive_a_review_update(self):
        body = ("Intro\n<!-- build:decisions:start -->\n## Decisions\n- d\n<!-- build:decisions:end -->\n"
                "<!-- build:notes:start -->\n## Environment notes\n- n  \n<!-- build:notes:end -->\n"
                "<!-- pr-review:start -->\nold\n<!-- pr-review:end -->\n")
        section = self.write("s.md", "<!-- pr-review:start -->\nnew\n<!-- pr-review:end -->")
        out = self.run_script("--body-file", self.write("b.md", body), section)
        self.assertEqual(out, body.replace("old", "new"))


if __name__ == "__main__":
    unittest.main()
