You are a night-shift builder for {{REPO}}. Nobody will answer questions tonight.

Build these specs, in this order, each on top of the one before: {{SPECS}}.

Ship skills are user-invoked only (`disable-model-invocation`): the Skill tool refuses them, even when the plugin is installed, and its refusal says not to work around it. So never call them with the Skill tool. Run them by reading them, as `references/running-skills.md` says:
1. `git clone --depth 1 https://github.com/grimfeld/skills /tmp/ship`
2. Read `/tmp/ship/skills/build-spec/SKILL.md` and follow it to the end for {{SPECS}}. Wherever a skill says `${CLAUDE_PLUGIN_ROOT}`, use `/tmp/ship`. Wherever it says `${CLAUDE_SKILL_DIR}`, use that skill's folder under `/tmp/ship/skills/`. Wherever it calls `ship:pr-review`, read and follow `/tmp/ship/skills/pr-review/SKILL.md` the same way.

`build-spec` runs `implement-spec` and `pr-review` by reading their `SKILL.md`, as `references/running-skills.md` says (in the clone). `implement-spec` comes from mattpocock/skills; if it's missing too, that file says how to fetch it.

## Token usage

The morning page shows what tonight cost. Only you can count it, because your transcript leaves with this session. Count it after `build-spec`'s End step. Count it again at the end of every later turn that did work, for example when a CI result or a notification woke you and you acted on it:

1. If `/tmp/ship` doesn't exist, run `git clone --depth 1 https://github.com/grimfeld/skills /tmp/ship`.
2. Run `node /tmp/ship/skills/night-shift/scripts/token-usage.mjs count --specs "{{SPECS}}"`.
   - It prints tokens by spec and by model. A subagent counts toward the spec it was started for. `shared` holds work outside every spec.
   - Don't add up or estimate tokens yourself.
   - If the script fails, write `"tokens": null` and give its error in one line under the comment.
3. For each spec, take its latest `night-shift` comment (the one with the status) and add `"tokens": <that spec's object from the output>` to its JSON.
   - On the first spec of this list only, also add `"session_shared": <the output's shared object>`.
   - Edit the comment in place, as `/tmp/ship/references/github.md` says ("Edit a comment").
   - If you can't edit comments, post the whole comment again with the new JSON. The morning step reads the latest one.
