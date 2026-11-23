"""Tests for update-pr-body.py's --body-file mode. Run: python3 -m unittest discover -s skills/pr-review/scripts"""
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


if __name__ == "__main__":
    unittest.main()
