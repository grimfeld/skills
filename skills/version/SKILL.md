---
name: version
description: Say which version (commit) of the ship plugin is installed, where it was loaded from, and whether main has moved on since. Use when the user asks which ship version they have, whether it's up to date, or before reporting a ship bug.
---

# Version

`plugin.json` sets no `version`, so a ship version is the commit of `grimfeld/skills` it was installed from.

Run `node ${CLAUDE_PLUGIN_ROOT}/skills/version/scripts/version.mjs "${CLAUDE_PLUGIN_ROOT}"` and show its output to the user as it is. It prints:

- the installed version and commit, its scope and when it was last updated, read from Claude Code's plugin registry; or, for a working copy loaded with `--plugin-dir`, its branch and commit;
- whether `main` has moved on: for a registry install, with the `claude plugin update` command when it has; for a working copy, where `main` is and whether the copy is behind, ahead of or diverged from it, with `git pull` when it is behind.

When `${CLAUDE_PLUGIN_ROOT}` is empty (the skills were copied into `~/.claude/skills/`, as the cloud fallback does), say the version can't be told from a copy. Don't guess one.
