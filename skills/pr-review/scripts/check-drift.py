#!/usr/bin/env python3
"""Compare each lens's recorded upstream_hash with the upstream skill's current hash.

A recorded hash has a kind, read from its length:
  - 40 hex: a folder hash, from ~/.agents/.skill-lock.json (that source's skillFolderHash)
  - 64 hex: a file hash, the sha256 of the file at upstream_path
A lens is compared only against a current hash of the same kind. `source: local` lenses are
written here and never drift.

Prints one line per lens:
  OK <lens>
  DRIFT <lens> source=<s> path=<p> recorded=<h> current=<h>     the upstream changed
  UNVERIFIABLE <lens> reason=<r>                                 can't compare; runs as written
    no-lock           a folder hash, and there is no lock file
    hash-kind         only a current hash of the other kind exists
    missing-upstream  the upstream is in neither the lock nor on disk
  BROKEN <lens> ...                                              front matter incomplete

Exit 0 when nothing drifted (unverifiable lenses included), 1 when anything drifted, 2 on a broken lens.
Usage: check-drift.py [--lenses <dir>]
"""
import hashlib
import json
import os
import sys
from pathlib import Path

LOCK = Path.home() / ".agents" / ".skill-lock.json"
LENSES = Path(__file__).resolve().parent.parent / "lenses"


def front_matter(path: Path) -> dict:
    lines = path.read_text().splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    out = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" in line:
            key, value = line.split(":", 1)
            out[key.strip()] = value.strip().strip('"')
    return out


def hash_kind(h: str) -> str | None:
    return {40: "folder", 64: "file"}.get(len(h))


def check(source: str, upstream_path: str, recorded: str, lock: dict | None) -> tuple[str, str | None]:
    """Return ("ok"|"drift", current) or ("unverifiable", reason)."""
    entry = (lock or {}).get(source) or {}
    p = Path(os.path.expanduser(upstream_path))
    current = {
        "folder": entry.get("skillFolderHash"),
        "file": hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None,
    }
    kind = hash_kind(recorded)
    same = current.get(kind)
    if same:
        return ("ok" if same == recorded else "drift"), same
    if kind == "folder" and lock is None:
        return "unverifiable", "no-lock"
    if any(current.values()):
        return "unverifiable", "hash-kind"
    return "unverifiable", "missing-upstream"


def main(argv: list[str]) -> int:
    lenses = Path(argv[argv.index("--lenses") + 1]) if "--lenses" in argv else LENSES
    lock = json.loads(LOCK.read_text()).get("skills", {}) if LOCK.is_file() else None
    status = 0
    for lens in sorted(lenses.glob("*.md")):
        fm = front_matter(lens)
        source, path, recorded = fm.get("source"), fm.get("upstream_path"), fm.get("upstream_hash")
        if source == "local":
            print(f"OK {lens.stem} (local, no upstream)")
            continue
        if not (source and path and recorded):
            print(f"BROKEN {lens.stem} missing source/upstream_path/upstream_hash")
            return 2
        outcome, detail = check(source, path, recorded, lock)
        if outcome == "drift":
            print(f"DRIFT {lens.stem} source={source} path={path} recorded={recorded} current={detail}")
            status = 1
        elif outcome == "unverifiable":
            print(f"UNVERIFIABLE {lens.stem} reason={detail}")
        else:
            print(f"OK {lens.stem}")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
