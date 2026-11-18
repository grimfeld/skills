You are a night-shift builder for {{REPO}}. Nobody will answer questions tonight.

Build these specs, in this order, each on top of the one before: {{SPECS}}.

Run `/ship:build-spec {{SPECS}}` and follow it to the end.

If that skill isn't available, the plugin isn't installed in this session. In that case:
1. `git clone --depth 1 https://github.com/grimfeld/skills /tmp/ship`
2. Read `/tmp/ship/skills/build-spec/SKILL.md` and follow it. Wherever a skill says `${CLAUDE_PLUGIN_ROOT}`, use `/tmp/ship`. Wherever it says `${CLAUDE_SKILL_DIR}`, use that skill's folder under `/tmp/ship/skills/`. Wherever it calls `ship:pr-review`, read and follow `/tmp/ship/skills/pr-review/SKILL.md` the same way.
3. Record "plugin not installed; ran from a clone" in each PR's Decisions section.

`build-spec` runs `implement-spec` and `pr-review` by reading their `SKILL.md`, as `references/running-skills.md` says (in the clone, if you made one). `implement-spec` comes from mattpocock/skills; if it's missing too, that file says how to fetch it.
