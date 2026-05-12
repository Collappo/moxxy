---
name: skill-author
description: Draft and persist a new Markdown skill for moxxy.
---

# Skill author — how to ship a new skill

Skills are Markdown files with YAML frontmatter. They are **prompt-only** — they don't contain executable code. They live in one of four locations; the loader honors this precedence (high → low):

1. `./.moxxy/skills/<slug>.md` — project scope, checked into git.
2. `~/.moxxy/skills/<slug>.md` — user scope, default for auto-synthesized skills.
3. `<plugin>/skills/<slug>.md` — bundled with a plugin.
4. `@moxxy/skills-builtin` — framework defaults.

## Required frontmatter

```yaml
---
name: <kebab-case slug, lowercase, starts with a letter, <=60 chars>
description: <one sentence, <=120 chars — this is what the router shows to the model>
triggers: [<2-5 short phrases the user might say>]
allowed-tools: [<tool names>]
---
```

`@moxxy/sdk` exposes `skillFrontmatterSchema` (zod). Run it locally against your draft to catch validation issues before committing.

## Body

The body is the instructions the agent reads when this skill is invoked. Keep it under 30 lines — long context belongs in code or files the skill reads at runtime, not in the skill itself.

Good body shape:

```md
1. Read <X>.
2. Check <Y>.
3. Decide branch <Z>.
4. Edit/Write <result>.
```

Bad body shape: prose paragraphs, examples longer than 5 lines, restating things the model already knows.

## Workflow

1. Decide scope: `project` (team-shared, checked in) or `user` (default, machine-local).
2. Pick a slug: `[a-z][a-z0-9-]*`, ≤60 chars. Check for collisions in the target dir.
3. Write the file with the frontmatter above.
4. If `moxxy` is running interactively, the registry hot-reloads on next prompt (or call `reload_skills`). Otherwise, the next session boot will pick it up.
5. Verify by running `node packages/cli/dist/bin.js skills list` — your skill should appear.

## Auto-synthesis

When the agent itself decides a skill is needed (the user's intent matches nothing existing), it calls the built-in `synthesize_skill` tool. That tool:

- Drafts the frontmatter and body via the active provider.
- Prompts the user before writing (permission rule: `prompt`).
- Writes to `~/.moxxy/skills/<slug>.md` by default; `scope: 'project'` redirects to `./.moxxy/skills/`.
- Appends to `~/.moxxy/skills/.meta/created.jsonl` for the audit trail.
- Emits `SkillCreatedEvent` and hot-reloads the registry.

If you are the synthesizing agent, follow the same conventions: keep frontmatter slug-clean, keep the body short, declare exactly the tools you need (no more). The skill author tool atomically swaps the registry (`SkillRegistryImpl.replaceAll`) so concurrent skill lookups never observe an empty registry mid-rebuild.

## Don't

- **Don't put executable code in a skill.** Skills are prompts. If you need an action, declare a tool (or a plugin that contributes one) and reference it from the skill body.
- **Don't list `allowed-tools` you don't actually use.** The list constrains what the agent can call while operating under this skill; tighter is safer.
- **Don't write long prose.** If the body exceeds ~30 lines, you're documenting, not instructing. Move docs to a referenced file the skill tells the agent to Read.
- **Don't include secrets, paths, or env vars in the body.** Skills travel via `~/.moxxy/skills/` and (for project scope) into the git repo.
- **Don't hand-create skills in `<plugin>/skills/`.** Plugin skills are bundled by the plugin's `skillsDir` field; the loader picks them up automatically.
