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

The review section (`pr-review` markers) must be the renderer's, for the PR's current head. The
script refuses it (exit 1, description unchanged) when it has no `<sub>pr-review · head `<sha>``
footer, or when that head isn't a prefix of the PR's head SHA. With a PR number, the head is
read in the same API call as the body; with --body-file, pass it as --head <sha> (the `head.sha`
of the same read). Other marker names carry no footer and aren't checked.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

USAGE = """update-pr-body.py [--markers <name>] <pr-number> <section.md>
       update-pr-body.py [--markers <name>] --body-file <current.md> [--head <sha>] <section.md>"""

FOOTER_RE = re.compile(r"<sub>pr-review · head `([0-9a-f]{4,64})`")


def footer_head(section: str):
    """The head SHA the review section's footer names, or None when it has no footer."""
    found = FOOTER_RE.findall(section)
    return found[-1] if found else None


def head_error(section: str, pr_head: str):
    """Why a review section can't go into a PR at pr_head, or None when it can."""
    head = footer_head(section)
    if head is None:
        return "refused: the review section has no pr-review footer; render it with render-report.py"
    if not pr_head or not pr_head.lower().startswith(head):
        return f"refused: the review is of head {head}, but the PR's head is {pr_head or 'unknown'}; review the current head"
    return None


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
    parser.add_argument("--head", help="the PR's head SHA, with --body-file")
    parser.add_argument("args", nargs="+", metavar="[<pr-number>] <section.md>")
    a = parser.parse_args(argv)

    if a.body_file is not None:
        if len(a.args) != 1:
            parser.error("with --body-file, pass only <section.md>")
        section = Path(a.args[0]).read_text()
        if a.markers == "pr-review":
            err = head_error(section, a.head or "")
            if err:
                sys.exit(err if a.head else err + " (pass --head <the PR's head SHA>)")
        body = a.body_file.read_bytes().decode("utf-8")
        sys.stdout.write(splice(body, section, a.markers))
        return 0

    if len(a.args) != 2:
        parser.error("pass <pr-number> <section.md>, or --body-file <current.md> <section.md>")
    pr, section = a.args[0], Path(a.args[1]).read_text()
    url = f"repos/{{owner}}/{{repo}}/pulls/{pr}"
    # Body and head in one read, so the head checked is the head of the body patched. JSON keeps
    # the body's \r\n exactly.
    pr_data = json.loads(subprocess.run(["gh", "api", url, "-q", "{body: (.body // \"\"), head: .head.sha}"],
                                        check=True, capture_output=True).stdout.decode("utf-8"))
    body = pr_data["body"]
    if a.markers == "pr-review":
        err = head_error(section, pr_data.get("head") or "")
        if err:
            sys.exit(err)
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
