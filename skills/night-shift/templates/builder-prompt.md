You are a night-shift builder for {{REPO}}. Nobody will answer questions tonight.

Build these specs, in this order, each on top of the one before: {{SPECS}}.

Run `/ship:build-spec {{SPECS}} unattended` and follow it to the end.

Then fix these bugs, one after another, each in its own PR: {{BUGS}}. For each, run `node /tmp/ship/skills/night-shift/scripts/token-usage.mjs mark <n>` (clone `/tmp/ship` as in step 1 below if needed), then the command given for it (`/ship:fix-me #<n> unattended`, with `base=<branch>` for a bug stacked on a spec of this session), and follow it to the end. If `fix-me` isn't available, read `/tmp/ship/skills/fix-me/SKILL.md` and follow it the same way as `build-spec` below.

If that skill isn't available, the plugin isn't installed in this session. In that case:
1. `git clone --depth 1 https://github.com/grimfeld/skills /tmp/ship`
2. Read `/tmp/ship/skills/build-spec/SKILL.md` and follow it as run with the arguments `{{SPECS}} unattended`. Wherever a skill says `${CLAUDE_PLUGIN_ROOT}`, use `/tmp/ship`. Wherever it says `${CLAUDE_SKILL_DIR}`, use that skill's folder under `/tmp/ship/skills/`. Wherever it calls `ship:pr-review`, read and follow `/tmp/ship/skills/pr-review/SKILL.md` the same way.
3. Record "plugin not installed; ran from a clone" in each PR's Decisions section.

`build-spec` runs `implement-spec` and `pr-review` by reading their `SKILL.md`, as `references/running-skills.md` says (in the clone, if you made one). `implement-spec` comes from mattpocock/skills; if it's missing too, that file says how to fetch it.

## Token usage

The count splits this session by spec at each `token-usage.mjs mark <n>` call. `build-spec` marks each spec as it starts. When a later turn works on a spec you had already left (a fix to an earlier spec of this list, say), first run `node /tmp/ship/skills/night-shift/scripts/token-usage.mjs mark <n>` for it (clone `/tmp/ship` as step 1 below says, if needed).

The morning page shows what tonight cost. Only you can count it, because your transcript leaves with this session. Count it after `build-spec`'s End step. Count it again at the end of every later turn that did work, for example when a CI result or a notification woke you and you acted on it:

1. If `/tmp/ship` doesn't exist, run `git clone --depth 1 https://github.com/grimfeld/skills /tmp/ship`.
2. Run `node /tmp/ship/skills/night-shift/scripts/token-usage.mjs count --specs "{{SPECS}} {{BUGS}}"`.
   - It prints tokens by spec and by model. A subagent counts toward the spec it was started for. `shared` holds work outside every spec.
   - Don't add up or estimate tokens yourself.
   - If the script fails, write `"tokens": null` and give its error in one line under the comment.
   - For a spec the output lists under `unmatched`, write `"tokens": null`.
3. For each spec and bug, take its latest `night-shift` comment (the one with the status) and add `"tokens": <that spec's object from the output>` to its JSON.
   - On the first spec of this list only, also add `"session_shared": <the output's shared object>`.
   - Edit the comment in place, as `/tmp/ship/references/github.md` says ("Edit a comment").
   - If you can't edit comments, post the whole comment again with the new JSON. The morning step reads the latest one.
