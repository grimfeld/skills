#!/usr/bin/env python3
"""Put the review section into a PR's description, replacing the previous one.

usage: update-pr-body.py <pr-number> .scratch/pr-review/<id>.pr.md

The section sits between <!-- pr-review:start --> and <!-- pr-review:end -->. Everything
else in the description (the author's text, a builder's Decisions section) is kept.
Without markers, the section is appended. Stdlib only; needs an authenticated `gh`.
Uses the REST API: `gh pr edit` fails on repositories that still trip GitHub's
Projects (classic) deprecation.
"""
import json
import subprocess
import sys
from pathlib import Path

START, END = "<!-- pr-review:start -->", "<!-- pr-review:end -->"


def splice(body: str, section: str) -> str:
    section = section.strip()
    i, j = body.find(START), body.find(END)
    if i != -1 and j > i:
        return body[:i] + section + body[j + len(END):]
    return (body.rstrip() + "\n\n" + section + "\n") if body.strip() else section + "\n"


def main() -> int:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pr, section = sys.argv[1], Path(sys.argv[2]).read_text()
    url = f"repos/{{owner}}/{{repo}}/pulls/{pr}"
    body = subprocess.run(["gh", "api", url, "-q", ".body // \"\""],
                          check=True, capture_output=True, text=True).stdout.rstrip("\n")
    new = splice(body, section)
    if new == body:
        print("unchanged")
        return 0
    subprocess.run(["gh", "api", "-X", "PATCH", url, "--input", "-"],
                   input=json.dumps({"body": new}), check=True, capture_output=True, text=True)
    print("updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
