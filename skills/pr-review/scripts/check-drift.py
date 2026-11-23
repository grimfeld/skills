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
  BROKEN <lens> ...                                              front matter incomplete, or upstream_hash
                                                                 not a lowercase 40- or 64-hex digest

Exit 0 when nothing drifted (unverifiable lenses included), 1 when anything drifted, 2 on a broken lens.
Usage: check-drift.py [--lenses <dir>]   (--lenses defaults to this skill's lenses/ folder)
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Literal, NamedTuple

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


HASH_KINDS = {40: "folder", 64: "file"}


class Result(NamedTuple):
    outcome: Literal["ok", "drift", "unverifiable"]
    current: str | None = None  # the same-kind current hash, for ok and drift
    reason: str | None = None  # why it can't compare, for unverifiable


def hash_kind(h: str) -> str | None:
    """"folder" or "file" for a lowercase 40- or 64-hex digest, None for anything else."""
    return HASH_KINDS.get(len(h)) if re.fullmatch(r"[0-9a-f]+", h) else None


def check(source: str, upstream_path: str, recorded: str, lock: dict | None) -> Result:
    """`recorded` must already have a kind (main reports it BROKEN otherwise)."""
    kind = hash_kind(recorded)
    entry = (lock or {}).get(source) or {}
    p = Path(os.path.expanduser(upstream_path))
    current = {
        "folder": entry.get("skillFolderHash"),
        "file": hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None,
    }
    same = current[kind]
    if same:
        return Result("ok" if same == recorded else "drift", current=same)
    if kind == "folder" and lock is None:
        return Result("unverifiable", reason="no-lock")
    if any(current.values()):
        return Result("unverifiable", reason="hash-kind")
    return Result("unverifiable", reason="missing-upstream")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Check each pr-review lens against its upstream skill.")
    parser.add_argument("--lenses", type=Path, default=LENSES, help="the lenses folder (default: this skill's)")
    lenses = parser.parse_args(argv).lenses
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
        if hash_kind(recorded) is None:
            print(f"BROKEN {lens.stem} upstream_hash is not a 40- or 64-character lowercase hex digest")
            return 2
        r = check(source, path, recorded, lock)
        if r.outcome == "drift":
            print(f"DRIFT {lens.stem} source={source} path={path} recorded={recorded} current={r.current}")
            status = 1
        elif r.outcome == "unverifiable":
            print(f"UNVERIFIABLE {lens.stem} reason={r.reason}")
        else:
            print(f"OK {lens.stem}")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
