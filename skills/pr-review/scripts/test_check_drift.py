"""Tests for check-drift.py.

Run from the repository root:
    uv run --no-project python -m unittest discover -s skills/pr-review/scripts -p 'test_*.py'
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "check-drift.py"
FOLDER_HASH = "a" * 40


def file_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class DriftCheck(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.home = root / "home"
        self.lenses = root / "lenses"
        self.home.mkdir()
        self.lenses.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def lens(self, name, source, recorded):
        path = f"~/.claude/skills/{source}/SKILL.md"
        (self.lenses / f"{name}.md").write_text(
            f"---\nlens: {name}\nsource: {source}\nupstream_path: {path}\nupstream_hash: {recorded}\n---\n\n# {name}\n"
        )

    def upstream(self, source, text):
        p = self.home / ".claude" / "skills" / source / "SKILL.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def lock(self, skills):
        p = self.home / ".agents" / ".skill-lock.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"skills": {k: {"skillFolderHash": v} for k, v in skills.items()}}))

    def run_check(self):
        env = dict(os.environ, HOME=str(self.home))
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "--lenses", str(self.lenses)],
            env=env, capture_output=True, text=True,
        )
        return r.returncode, r.stdout.splitlines()

    def test_no_lock_folder_hash_is_unverifiable(self):
        self.lens("quality", "code-review-and-quality", FOLDER_HASH)
        self.upstream("code-review-and-quality", "anything")
        code, out = self.run_check()
        self.assertEqual(out, ["UNVERIFIABLE quality reason=no-lock"])
        self.assertEqual(code, 0)

    def test_no_lock_and_no_upstream_is_no_lock(self):
        self.lens("web-quality", "web-quality-audit", FOLDER_HASH)
        code, out = self.run_check()
        self.assertEqual(out, ["UNVERIFIABLE web-quality reason=no-lock"])
        self.assertEqual(code, 0)

    def test_lock_present_upstream_absent_is_missing_upstream(self):
        self.lock({"other": "b" * 40})
        self.lens("web-quality", "web-quality-audit", FOLDER_HASH)
        code, out = self.run_check()
        self.assertEqual(out, ["UNVERIFIABLE web-quality reason=missing-upstream"])
        self.assertEqual(code, 0)

    def test_folder_hash_against_file_only_is_hash_kind(self):
        self.lock({"other": "b" * 40})
        self.lens("quality", "code-review-and-quality", FOLDER_HASH)
        self.upstream("code-review-and-quality", "body")
        code, out = self.run_check()
        self.assertEqual(out, ["UNVERIFIABLE quality reason=hash-kind"])
        self.assertEqual(code, 0)

    def test_file_hash_against_lock_only_is_hash_kind(self):
        self.lock({"ub-mode": "b" * 40})
        self.lens("principles", "ub-mode", file_hash("x"))
        code, out = self.run_check()
        self.assertEqual(out, ["UNVERIFIABLE principles reason=hash-kind"])
        self.assertEqual(code, 0)

    def test_lock_unchanged_is_ok(self):
        self.lock({"code-review-and-quality": FOLDER_HASH})
        self.lens("quality", "code-review-and-quality", FOLDER_HASH)
        code, out = self.run_check()
        self.assertEqual(out, ["OK quality"])
        self.assertEqual(code, 0)

    def test_lock_changed_is_drift(self):
        self.lock({"code-review-and-quality": "c" * 40})
        self.lens("quality", "code-review-and-quality", FOLDER_HASH)
        code, out = self.run_check()
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0].startswith("DRIFT quality "), out)
        self.assertIn(f"current={'c' * 40}", out[0])
        self.assertEqual(code, 1)

    def test_drift_alongside_unverifiable_still_exits_1(self):
        self.lock({"code-review-and-quality": "c" * 40})
        self.lens("quality", "code-review-and-quality", FOLDER_HASH)
        self.lens("web-quality", "web-quality-audit", FOLDER_HASH)
        code, out = self.run_check()
        self.assertIn("UNVERIFIABLE web-quality reason=missing-upstream", out)
        self.assertTrue(any(l.startswith("DRIFT quality ") for l in out), out)
        self.assertEqual(code, 1)

    def test_file_hash_compared_without_lock(self):
        self.lens("principles", "ub-mode", file_hash("v1"))
        self.upstream("ub-mode", "v1")
        self.assertEqual(self.run_check(), (0, ["OK principles"]))
        self.upstream("ub-mode", "v2")
        code, out = self.run_check()
        self.assertTrue(out[0].startswith("DRIFT principles "), out)
        self.assertEqual(code, 1)

    def test_file_hash_compared_with_lock_entry(self):
        self.lock({"ub-mode": "b" * 40})
        self.lens("principles", "ub-mode", file_hash("v1"))
        self.upstream("ub-mode", "v1")
        self.assertEqual(self.run_check(), (0, ["OK principles"]))

    def test_file_hash_upstream_absent_is_missing_upstream(self):
        self.lens("principles", "ub-mode", file_hash("v1"))
        code, out = self.run_check()
        self.assertEqual(out, ["UNVERIFIABLE principles reason=missing-upstream"])
        self.assertEqual(code, 0)

    def test_local_lens_is_ok(self):
        (self.lenses / "design-fidelity.md").write_text("---\nlens: design-fidelity\nsource: local\n---\n")
        code, out = self.run_check()
        self.assertEqual(out, ["OK design-fidelity (local, no upstream)"])
        self.assertEqual(code, 0)

    def test_malformed_hash_is_broken(self):
        for bad in ("abc123", "g" * 40, "A" * 64):
            with self.subTest(recorded=bad):
                self.lens("quality", "code-review-and-quality", bad)
                self.upstream("code-review-and-quality", "body")
                code, out = self.run_check()
                self.assertTrue(out[-1].startswith("BROKEN quality"), out)
                self.assertEqual(code, 2)

    def test_broken_lens_exits_2(self):
        (self.lenses / "bad.md").write_text("---\nlens: bad\nsource: x\n---\n")
        code, out = self.run_check()
        self.assertTrue(out[0].startswith("BROKEN bad"), out)
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
