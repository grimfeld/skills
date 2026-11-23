// node --test skills/setup-ship/scripts/land.test.mjs
// Runs the `land` job of the ship.yml template, rendered in auto-merge mode, under bash -eo pipefail as GitHub Actions
// does, against a fake `gh`. It checks what land decides and reports; whether GitHub behaves as the fake does is for
// the live checks recorded on the PR that changes land (see issue #57 for an end-to-end test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const template = readFileSync(join(here, "..", "templates", "ship.yml"), "utf8");

// setup-ship's auto-merge rendering: drop command-mode blocks and the auto-merge markers, fill the two values.
function render(text) {
  return text
    .replace(/^# >>> command mode\n[^]*?^# <<< command mode\n/gm, "")
    .replace(/^# (>>>|<<<) auto-merge mode\n/gm, "")
    .replaceAll("__DEFAULT_BRANCH__", "main")
    .replaceAll("__MERGE_METHOD__", "merge");
}

// The `run: |` script of the land step whose name starts with `name`, de-indented.
function step(workflow, name) {
  const lines = workflow.split("\n");
  const land = lines.indexOf("  land:");
  const start = lines.findIndex((l, i) => i > land && l.startsWith(`      - name: ${name}`));
  const run = lines.findIndex((l, i) => i > start && l === "        run: |");
  const body = [];
  for (const l of lines.slice(run + 1)) {
    if (l !== "" && !l.startsWith("          ")) break;
    body.push(l.slice(10));
  }
  return body.join("\n");
}

const rendered = render(template);
const landScript = step(rendered, "Land the reviewed PRs");
const tokenScript = step(rendered, "Check for SHIP_TOKEN");

// Each PR's behaviour is a file in the scenario directory: <n>.auto / <n>.merge hold "ok", "ok merges" or an error,
// <n>.view holds `gh pr view` JSON, <n>.api holds the REST body. `list` holds `gh pr list` JSON.
const fakeGh = `#!/bin/bash
echo "gh $*" >> "$FAKE/calls"
jqarg() { while [ $# -gt 0 ]; do [ "$1" = --jq ] && { echo "$2"; return; }; shift; done; }
case "$1 $2" in
  "pr list") jq -r "$(jqarg "$@")" "$FAKE/list" ;;
  "pr merge") n=$3; f=merge; [ "$4" = --auto ] && f=auto
    r=$(cat "$FAKE/$n.$f" 2>/dev/null || echo "fake: no $n.$f")
    case "$r" in ok) exit 0 ;; "ok merges") echo '{"state":"MERGED"}' > "$FAKE/$n.view"; exit 0 ;; esac
    echo "$r" >&2; exit 1 ;;
  "pr view") jq -r "$(jqarg "$@")" "$FAKE/$3.view" ;;
  "api repos/"*) [ -f "$FAKE/\${2##*/}.api" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }; cat "$FAKE/\${2##*/}.api" ;;
  *) echo "fake gh: unhandled $*" >&2; exit 99 ;;
esac
`;

function run(script, { event = "workflow_dispatch", only = "", files = {}, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "land-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), fakeGh);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "list"), "[]");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  writeFileSync(join(dir, "summary"), "");
  writeFileSync(join(dir, "calls"), "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`, FAKE: dir, GITHUB_STEP_SUMMARY: join(dir, "summary"),
      GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", SHIP_LABEL: "ship", MERGE_METHOD: "merge",
      DEFAULT_BRANCH: "main", EVENT: event, ONLY: only, ...env,
    },
  });
  return { code: r.status, out: r.stdout + r.stderr, summary: readFileSync(join(dir, "summary"), "utf8"), calls: readFileSync(join(dir, "calls"), "utf8") };
}

const open = (state = "OPEN", mergeStateStatus = "BLOCKED", auto = false) =>
  ({ state, mergeStateStatus, autoMergeRequest: auto ? {} : null });
const child = (o = {}) => ({ state: "open", merged: false, draft: false, base: { ref: "main" }, labels: [{ name: "ship" }], ...o });

test("this repo's ship.yml is the template rendered in auto-merge mode", () => {
  assert.equal(readFileSync(join(root, ".github", "workflows", "ship.yml"), "utf8"), rendered);
  assert.match(rendered, /^# ship\.yml version: 3\n/);
});

test("no SHIP_TOKEN: fails before any PR, naming the fix", () => {
  const r = run(tokenScript, { env: { HAS_SHIP_TOKEN: "false" } });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::No SHIP_TOKEN secret.*Add the SHIP_TOKEN secret \(see docs\/agents\/shipping\.md\)/);
  assert.match(r.summary, /Landing failed/);
  assert.equal(run(tokenScript, { env: { HAS_SHIP_TOKEN: "true" } }).code, 0);
});

test("a dispatch with nothing labelled stays green", () => {
  const r = run(landScript);
  assert.equal(r.code, 0);
  assert.equal(r.summary.trim(), "Nothing to land.");
});

test("a dispatch tries every PR, lists each, and fails when any couldn't land", () => {
  const r = run(landScript, {
    files: {
      list: [1, 2, 3, 4, 5, 6, 7].map((number) => ({ number, isDraft: number === 7 })),
      "1.auto": "ok", "1.view": open(),
      "2.auto": "ok merges",
      "3.auto": "Pull request is in clean status", "3.view": open("OPEN", "CLEAN"), "3.merge": "ok",
      "4.auto": "GraphQL: Resource not accessible by integration (enablePullRequestAutoMerge)", "4.view": open(),
      "5.auto": "Pull request is in unstable status", "5.view": open("OPEN", "UNSTABLE"),
      "5.merge": "GraphQL: Resource not accessible by integration (mergePullRequest)",
      "6.auto": "already queued", "6.view": open("OPEN", "BLOCKED", true),
    },
  });
  assert.equal(r.code, 1);
  const line = (n) => r.summary.split("\n").find((l) => l.startsWith(`- [#${n}](https://github.com/o/r/pull/${n}): `));
  assert.match(line(1), /auto-merge on/);
  assert.match(line(2), /: merged$/);
  assert.match(line(3), /: merged$/);
  assert.match(line(4), /couldn't land it: GraphQL: Resource not accessible by integration \(enablePullRequestAutoMerge\)/);
  assert.match(line(5), /couldn't land it: .*mergePullRequest/, "an unstable PR is merged directly, and its refusal reported");
  assert.match(line(6), /auto-merge already on/);
  assert.equal(line(7), undefined, "drafts are left out");
  assert.match(r.summary, /Merged 2, set 2 to auto-merge, couldn't land 2, skipped 0\./);
  assert.match(r.summary, /Each failure gives GitHub's reason/);
  assert.match(r.out, /::error::#4: /);
});

test("a run that lands or queues everything stays green", () => {
  const r = run(landScript, { files: { list: [{ number: 1, isDraft: false }], "1.auto": "ok merges" } });
  assert.equal(r.code, 0);
  assert.match(r.summary, /Merged 1, set 0 to auto-merge, couldn't land 0/);
  assert.doesNotMatch(r.summary, /Each failure/);
});

test("a merge lands its moved children by number, never through search", () => {
  const r = run(landScript, {
    event: "pull_request",
    only: "7 8 9 10 11 12",
    files: {
      list: [{ number: 99, isDraft: false }],
      "7.api": child(), "7.auto": "ok", "7.view": open(),
      "8.api": child({ draft: true }),
      "9.api": child({ labels: [{ name: "other" }] }),
      "11.api": child({ base: { ref: "feature" } }),
      "12.api": child({ state: "closed", merged: true }),
    },
  });
  assert.doesNotMatch(r.calls, /pr list/);
  assert.doesNotMatch(r.summary, /#99/);
  assert.match(r.summary, /#7\].*auto-merge on/);
  assert.match(r.summary, /#8\].*not landed: it is a draft/);
  assert.match(r.summary, /#9\].*not landed: it has no `ship` label/);
  assert.match(r.summary, /#10\].*couldn't land it: gh: Not Found/);
  assert.match(r.summary, /#11\].*not landed: it targets `feature`, not `main`/);
  assert.match(r.summary, /#12\].*not landed: it is already merged/);
  assert.match(r.summary, /skipped 4\./);
  assert.equal(r.code, 1, "an unreadable child fails the run");
});

test("a merge whose children are all skipped stays green", () => {
  const r = run(landScript, { event: "pull_request", only: "8", files: { "8.api": child({ draft: true }) } });
  assert.equal(r.code, 0);
  assert.match(r.summary, /#8\].*it is a draft/);
});
