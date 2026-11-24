#!/usr/bin/env python3
"""Put a marked section into a PR's or issue's description, replacing the previous one.

usage: see USAGE below.

The section sits between <!-- <name>:start --> and <!-- <name>:end -->; <name> defaults to
`pr-review` (the review section). build-spec's Decisions section uses `--markers build:decisions`,
its Environment notes `--markers build:notes`; slice writes a spec's Slicing section with `--markers slice`.
Everything else in the description (the author's text, the other sections) is kept byte for byte.
Without markers in the description, the section is appended at the end. With `--markers slice` only,
it goes directly after the spec template's marker line (a line starting with `<!-- Below this line`)
when there is one, and an unmarked `## Slicing` section outside code fences (its heading to the next
`## ` line or the end) is removed in the same splice, so a re-slice leaves one Slicing section. A section file
without the markers is wrapped in them.

With a PR number, or `--issue <n>` for an issue, the body is fetched and patched with `gh api`
(REST: `gh pr edit` fails on repositories that still trip GitHub's Projects (classic) deprecation).

With --body-file, `gh` is never called: the script reads the current body from the file, prints
the spliced body to stdout, and the caller sends it (for example with the GitHub MCP's pull
request or issue update tool). Stdlib only.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

USAGE = """update-pr-body.py [--markers <name>] <pr-number> <section.md>
       update-pr-body.py --issue <n> [--markers <name>] <section.md>
       update-pr-body.py [--markers <name>] --body-file <current.md> <section.md>"""


def markers(name: str) -> tuple[str, str]:
    return f"<!-- {name}:start -->", f"<!-- {name}:end -->"


def remove_slicing(body: str) -> str:
    """Drop an unmarked `## Slicing` section: its heading line up to the next `## ` line or the end."""
    out, skipping, in_fence = [], False, False
    for line in body.splitlines(keepends=True):
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
        elif not in_fence and line.rstrip() == "## Slicing":
            skipping = True
        elif not in_fence and skipping and line.startswith("## "):
            skipping = False
        if not skipping:
            out.append(line)
    return "".join(out)


def splice(body: str, section: str, name: str = "pr-review") -> str:
    start, end = markers(name)
    section = section.strip()
    if not section.startswith(start):
        section = f"{start}\n{section}\n{end}"
    i = body.find(start)
    j = body.find(end, i + len(start)) if i != -1 else -1
    if i != -1 and j != -1:
        return body[:i] + section + body[j + len(end):]
    if name == "slice":
        # Specs sliced before the markers existed have a bare `## Slicing`; the first marked splice
        # replaces it, and a new section goes where the spec template asks for it.
        body = remove_slicing(body)
        lines = body.splitlines(keepends=True)
        for k, line in enumerate(lines):
            if line.startswith("<!-- Below this line"):
                head = "".join(lines[:k + 1])
                if not head.endswith("\n"):
                    head += "\n"
                return head + section + "\n" + "".join(lines[k + 1:])
    return (body.rstrip() + "\n\n" + section + "\n") if body.strip() else section + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(usage=USAGE)
    parser.add_argument("--markers", default="pr-review")
    parser.add_argument("--body-file", type=Path)
    parser.add_argument("--issue", metavar="<n>")
    parser.add_argument("args", nargs="+", metavar="[<pr-number>] <section.md>")
    a = parser.parse_args(argv)
    if a.issue is not None and not re.fullmatch(r"[1-9][0-9]*", a.issue):
        parser.error("--issue takes a positive integer")

    if a.body_file is not None:
        if len(a.args) != 1:
            parser.error("with --body-file, pass only <section.md>")
        section = Path(a.args[0]).read_text()
        body = a.body_file.read_bytes().decode("utf-8")
        sys.stdout.write(splice(body, section, a.markers))
        return 0

    if a.issue is not None:
        if len(a.args) != 1:
            parser.error("with --issue, pass only <section.md>")
        kind, number, section = "issues", a.issue, Path(a.args[0]).read_text()
    else:
        if len(a.args) != 2:
            parser.error("pass <pr-number> <section.md>, --issue <n> <section.md>, or --body-file <current.md> <section.md>")
        kind, number, section = "pulls", a.args[0], Path(a.args[1]).read_text()
    url = f"repos/{{owner}}/{{repo}}/{kind}/{number}"
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
