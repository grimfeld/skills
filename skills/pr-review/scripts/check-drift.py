#!/usr/bin/env python3
"""Compare each lens's recorded upstream_hash with the upstream skill's current hash.

Hash source, per lens `source`:
  - in ~/.agents/.skill-lock.json  -> that entry's skillFolderHash
  - otherwise                      -> sha256 of the file at upstream_path

Prints `OK <lens>` or `DRIFT <lens> source=<s> path=<p> recorded=<h> current=<h>`.
Exit 0 when nothing drifted, 1 when anything drifted, 2 on a broken lens.
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


def current_hash(source: str, upstream_path: str, lock: dict) -> str | None:
    entry = lock.get(source)
    if entry and entry.get("skillFolderHash"):
        return entry["skillFolderHash"]
    p = Path(os.path.expanduser(upstream_path))
    if not p.is_file():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    lock = json.loads(LOCK.read_text()).get("skills", {}) if LOCK.is_file() else {}
    status = 0
    for lens in sorted(LENSES.glob("*.md")):
        fm = front_matter(lens)
        source, path, recorded = fm.get("source"), fm.get("upstream_path"), fm.get("upstream_hash")
        if not (source and path and recorded):
            print(f"BROKEN {lens.stem} missing source/upstream_path/upstream_hash")
            return 2
        current = current_hash(source, path, lock)
        if current is None:
            print(f"DRIFT {lens.stem} source={source} path={path} recorded={recorded} current=MISSING")
            status = 1
        elif current != recorded:
            print(f"DRIFT {lens.stem} source={source} path={path} recorded={recorded} current={current}")
            status = 1
        else:
            print(f"OK {lens.stem}")
    return status


if __name__ == "__main__":
    sys.exit(main())
