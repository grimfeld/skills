# Running another skill

The ship skills, `implement-spec`, `to-tickets` and `retro` are all user-invoked only (`disable-model-invocation: true`), except the ship skill `version`, which stays model-invocable. The Skill tool refuses the others, so one skill can't call another with it. Run them by reading them instead:

1. **Find its `SKILL.md`.**
   - A ship skill: `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`.
   - Any other: `find -L ~/.claude ~/.agents -path '*/<name>/SKILL.md' | head -1`. A skill can be listed twice, once through a symlink (`~/.claude/skills/<name>` pointing into `~/.agents`); the first match, under `~/.claude`, is the one to use.
   - Not found: clone its repository (`git clone --depth 1 https://github.com/<owner>/skills /tmp/<owner>-skills`), then find it there with `find /tmp/<owner>-skills -path '*/<name>/SKILL.md'`. Ship skills come from grimfeld/skills; `implement-spec`, `to-tickets`, `retro` and `prototype` from mattpocock/skills (`prototype` is model-invocable, so it is called with the Skill tool and cloned only when missing). In a pull request or ticket, record that it ran from a clone.
2. **Fill in what the harness would have.** The file isn't expanded when you read it.
   - `${CLAUDE_SKILL_DIR}`: the folder holding that `SKILL.md`.
   - `${CLAUDE_PLUGIN_ROOT}`: the plugin's root, two folders above a ship skill's `SKILL.md`.
   - `$ARGUMENTS`: the arguments the caller passes.
3. **Follow it in this session, to the end.** Then go back to the caller's next step. Where the caller says it replaces or skips one of the skill's steps, the caller wins.

Skills without that flag, such as `grilling` and `domain-modeling`, are still called with the Skill tool.
