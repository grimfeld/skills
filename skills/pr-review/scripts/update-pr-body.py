#!/usr/bin/env python3
"""Put a marked section into a PR's description, replacing the previous one.

usage: see USAGE below.

The section sits between <!-- <name>:start --> and <!-- <name>:end -->; <name> defaults to
`pr-review` (the review section). build-spec's Decisions section uses `--markers build:decisions`.
Everything else in the description (the author's text, the other sections) is kept byte for byte.
Without markers in the description, the section is appended. A section file without the markers
is wrapped in them.

With a PR number, the body is fetched and patched with `gh api` (REST: `gh pr edit` fails on
repositories that still trip GitHub's Projects (classic) deprecation).

With --body-file, `gh` is never called: the script reads the current body from the file, prints
the spliced body to stdout, and the caller sends it (for example with the GitHub MCP's pull
request update tool). Stdlib only.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

USAGE = """update-pr-body.py [--markers <name>] <pr-number> <section.md>
       update-pr-body.py [--markers <name>] --body-file <current.md> <section.md>"""


def markers(name: str) -> tuple[str, str]:
    return f"<!-- {name}:start -->", f"<!-- {name}:end -->"


def splice(body: str, section: str, name: str = "pr-review") -> str:
    start, end = markers(name)
    section = section.strip()
    if not section.startswith(start):
        section = f"{start}\n{section}\n{end}"
    i = body.find(start)
    j = body.find(end, i + len(start)) if i != -1 else -1
    if i != -1 and j != -1:
        return body[:i] + section + body[j + len(end):]
    return (body.rstrip() + "\n\n" + section + "\n") if body.strip() else section + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(usage=USAGE)
    parser.add_argument("--markers", default="pr-review")
    parser.add_argument("--body-file", type=Path)
    parser.add_argument("args", nargs="+", metavar="[<pr-number>] <section.md>")
    a = parser.parse_args(argv)

    if a.body_file is not None:
        if len(a.args) != 1:
            parser.error("with --body-file, pass only <section.md>")
        section = Path(a.args[0]).read_text()
        body = a.body_file.read_bytes().decode("utf-8")
        sys.stdout.write(splice(body, section, a.markers))
        return 0

    if len(a.args) != 2:
        parser.error("pass <pr-number> <section.md>, or --body-file <current.md> <section.md>")
    pr, section = a.args[0], Path(a.args[1]).read_text()
    url = f"repos/{{owner}}/{{repo}}/pulls/{pr}"
    # Bytes, not text mode: text mode would turn the body's \r\n into \n everywhere.
    body = subprocess.run(["gh", "api", url, "-q", ".body // \"\""],
                          check=True, capture_output=True).stdout.decode("utf-8").rstrip("\n")
    new = splice(body, section, a.markers)
    if new == body:
        print("unchanged")
        return 0
    subprocess.run(["gh", "api", "-X", "PATCH", url, "--input", "-"],
                   input=json.dumps({"body": new}), check=True, capture_output=True, text=True)
    print("updated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
