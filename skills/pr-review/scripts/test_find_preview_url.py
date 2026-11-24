"""Tests for find-preview-url.sh's exit codes.
Run: uv run --no-project python -m unittest discover -s skills/pr-review/scripts"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("find-preview-url.sh")
BASH = shutil.which("bash")
# Tools the script may call besides gh. Linked into a PATH of their own, so gh is never found by accident.
TOOLS = ["git", "jq", "head", "grep", "curl"]


class PreviewFinder(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.bin = Path(tmp.name)
        for tool in TOOLS:
            if path := shutil.which(tool):
                (self.bin / tool).symlink_to(path)

    def stub_gh(self, script):
        gh = self.bin / "gh"
        gh.write_text("#!/bin/sh\n" + script)
        gh.chmod(0o755)

    def run_finder(self, *args):
        env = {"PATH": str(self.bin), "HOME": os.environ.get("HOME", "/tmp")}
        return subprocess.run([BASH, str(SCRIPT), *args], capture_output=True, text=True, env=env)

    def test_gh_missing_exits_3_with_message(self):
        r = self.run_finder("gh", "1")
        self.assertEqual((r.returncode, r.stderr), (3, "gh unavailable\n"))
        self.assertEqual(r.stdout, "")

    def test_gh_unauthenticated_exits_3_with_message(self):
        self.stub_gh("exit 1\n")  # auth status and every API call fail
        r = self.run_finder("gh", "1")
        self.assertEqual((r.returncode, r.stderr), (3, "gh unavailable\n"))

    @unittest.skipUnless(shutil.which("jq"), "needs jq")
    def test_no_preview_still_exits_1(self):
        # Authenticated gh that finds nothing: no head sha, no deployments, no comments.
        self.stub_gh('[ "$1" = auth ] && exit 0\ncase "$*" in *--slurp*) echo "[[]]";; esac\nexit 0\n')
        r = self.run_finder("gh", "1")
        self.assertEqual(r.returncode, 1, r.stderr)

    def test_jq_missing_exits_3(self):
        (self.bin / "jq").unlink(missing_ok=True)
        self.stub_gh('[ "$1" = auth ] && exit 0\nexit 0\n')
        r = self.run_finder("gh", "1")
        self.assertEqual((r.returncode, r.stderr), (3, "jq unavailable\n"))

    def test_missing_target_is_usage_error(self):
        self.assertEqual(self.run_finder("gh").returncode, 2)


if __name__ == "__main__":
    unittest.main()
