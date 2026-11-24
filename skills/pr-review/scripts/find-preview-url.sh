#!/usr/bin/env bash
# Find a URL for the web-quality lens. Prints "<source>\t<url>" for the first hit.
# Exit 0: found. 1: no preview. 2: usage error. 3: the gh lookup couldn't run: `gh` missing or
# unauthenticated (prints "gh unavailable" to stderr), or `jq` missing ("jq unavailable"). Look through
# the GitHub MCP tools instead.
#
#   find-preview-url.sh gh <pr-number|branch>   GitHub deployment statuses, then Vercel bot comments
#   find-preview-url.sh local                   dev server already listening on a common port
#
# Never starts a server or creates a deployment.
set -uo pipefail

mode="${1:-}"

reachable() { # url -> 0 when it answers with any HTTP status
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1") || return 1
  [[ "$code" != "000" ]]
}

gh_usable() { # gh installed and authenticated; `gh auth status` misses a token the session's proxy injects
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 && return 0
  gh api user --jq .login >/dev/null 2>&1
}

from_gh() {
  local target="$1" sha="" pr=""
  gh_usable || { echo "gh unavailable" >&2; exit 3; }
  command -v jq >/dev/null 2>&1 || { echo "jq unavailable" >&2; exit 3; }
  # REST only: GraphQL (gh pr …) is refused in claude.ai/code cloud sessions.
  if [[ "$target" =~ ^[0-9]+$ ]]; then
    pr="$target"
    sha=$(gh api "repos/{owner}/{repo}/pulls/$pr" --jq .head.sha 2>/dev/null) || sha=""
  else
    sha=$(git rev-parse "$target" 2>/dev/null) || sha=""
    # The branch name goes to jq as data (--arg), never into the filter's text.
    pr=$(gh api --paginate --slurp "repos/{owner}/{repo}/pulls?state=open&per_page=100" 2>/dev/null \
      | jq -r --arg ref "$target" '[.[][] | select(.head.ref == $ref) | .number][0] // empty') || pr=""
  fi

  # 1. GitHub deployments for the head commit: newest successful status with an environment_url.
  if [[ -n "$sha" ]]; then
    local ids id url
    ids=$(gh api "repos/{owner}/{repo}/deployments?sha=$sha&per_page=10" --jq '.[].id' 2>/dev/null) || ids=""
    for id in $ids; do
      url=$(gh api "repos/{owner}/{repo}/deployments/$id/statuses" \
        --jq '[.[] | select(.state=="success" and (.environment_url // "") != "")][0].environment_url // empty' 2>/dev/null)
      if [[ -n "$url" ]]; then printf 'github-deployment\t%s\n' "$url"; return 0; fi
    done
  fi

  # 2. Vercel bot comment on the PR: newest *.vercel.app link, from the bot account only.
  if [[ -n "$pr" ]]; then
    local url
    url=$(gh api --paginate --slurp "repos/{owner}/{repo}/issues/$pr/comments?per_page=100" 2>/dev/null \
      | jq -r '[.[][] | select(.user.login == "vercel[bot]" and .user.type == "Bot") | .body] | reverse | .[]' \
      | grep -oE 'https://[A-Za-z0-9.-]+\.vercel\.app' | grep -v '^https://vercel\.app' | head -1)
    if [[ -n "$url" ]]; then printf 'vercel-comment\t%s\n' "$url"; return 0; fi
  fi
  return 1
}

from_local() {
  local port
  for port in 3000 5173 4321 8080; do
    if reachable "http://localhost:$port"; then printf 'local\thttp://localhost:%s\n' "$port"; return 0; fi
  done
  return 1
}

case "$mode" in
  gh) [[ -n "${2:-}" ]] || { echo "usage: $0 gh <pr-number|branch>" >&2; exit 2; }; from_gh "$2" ;;
  local) from_local ;;
  *) echo "usage: $0 gh <pr-number|branch> | local" >&2; exit 2 ;;
esac
