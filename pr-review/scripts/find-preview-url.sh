#!/usr/bin/env bash
# Find a URL for the web-quality lens. Prints "<source>\t<url>" for the first hit; exit 1 when none.
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

from_gh() {
  local target="$1" sha="" pr=""
  if [[ "$target" =~ ^[0-9]+$ ]]; then
    pr="$target"
    sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid 2>/dev/null) || sha=""
  else
    sha=$(git rev-parse "$target" 2>/dev/null) || sha=""
    pr=$(gh pr list --head "$target" --json number --jq '.[0].number' 2>/dev/null) || pr=""
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

  # 2. Vercel bot comment on the PR: newest *.vercel.app link.
  if [[ -n "$pr" ]]; then
    local url
    url=$(gh pr view "$pr" --json comments \
      --jq '[.comments[] | select(.author.login | test("vercel"; "i")) | .body] | reverse | .[]' 2>/dev/null \
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
