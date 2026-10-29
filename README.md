<div align="right">

[English](README.md) | [简体中文](README_ZH.md)

</div>

# Subagent Team Skills

Agent Skills for running coding work as a **team**: one director session, a few strong managers, dozens of cheap and fast staff (in-house subagents and other vendors' CLI agents), and a human who is asked as little as possible, all at once, at the end.

```
Director        1 main session at high tier, high effort        e.g. Claude Opus 5.5 / GPT-6.1 Sol
├── Managers    split, design, review, accept, expert calls     e.g. GPT-6.1 Sol / Claude Opus 5.5 / Claude Fable 5.1
├── Staff       implement, search, translate, backfill tests    e.g. Claude Sonnet 5.5 / Gemini 4 / Gemini 3.8 Flash / DeepSeek 4.1 Flash
└── Human       one batched "grill me" list at the end
```

*(Model names are examples as of 2026-10. The skills themselves use abstract tiers.)*

The method is distilled from the author's day-to-day work on several production projects, mostly with **Claude Code** and also with **Codex**. It covers what to delegate and to whom, how to write briefs that do not come back wrong, how to verify with commands instead of opinions, when to stop and ask the human, and how to keep long-running multi-agent work resumable.

## Which agents are supported

| Agent | Status |
|---|---|
| **Claude Code** | Primary. Developed and used daily; plugin with skills and reviewer agents. |
| **Codex** | Secondary. Used as the main session on real projects; skills install as a plugin. The reviewer agents are Claude Code definitions (use `reviewer-prompt.md` instead). |
| Others (OpenCode, Pi, Cursor, Gemini CLI, ...) | Not tested; quality not guaranteed. The skills follow the open [Agent Skills](https://agentskills.io) format and the method is tool-neutral, so any agent that supports skills can install and load them. Install through `npx skills` or your agent's own plugin/skill marketplace, then adapt the harness-specific parts yourself. |

## Install

**Any agent** (via the [skills CLI](https://github.com/vercel-labs/skills)):

```bash
npx skills add interjc/subagent-team-skills                               # all skills
npx skills add interjc/subagent-team-skills --skill subagent-team         # just the core
```

**Claude Code** (plugin: three skills plus two read-only reviewer agents):

```bash
claude plugin marketplace add interjc/subagent-team-skills
claude plugin install subagent-team@subagent-team-skills
```

In a session, `/plugin marketplace add interjc/subagent-team-skills` followed by `/plugin install subagent-team@subagent-team-skills` opens the plugin panel so you can choose a scope. Third-party marketplaces do not auto-update by default. Update with `claude plugin marketplace update subagent-team-skills && claude plugin update subagent-team@subagent-team-skills`.

**Codex**:

```bash
codex plugin marketplace add https://github.com/interjc/subagent-team-skills
codex plugin add subagent-team@subagent-team-skills
```

Restart the agent afterwards. The helper scripts need **Node.js 20+** and no dependencies.

## Skills

| Skill | What it covers | Loads when |
|---|---|---|
| [`subagent-team`](skills/subagent-team/SKILL.md) (core) | First-use team policy (models and effort per role, or `auto`), modes (solo / standard / strict), team roles, abstract model tiers and effort, the outsourcing gate, contracts-first parallel work, brief templates, executable verification and three-step review, the escalation ladder ending in one batched question list, agent reuse and slot limits, Claude Code and Codex specifics | A task spans several files or phases; you delegate, choose a model or effort, write a brief, review delegated work, or wonder whether to ask the user |
| [`cli-agent-delegation`](skills/cli-agent-delegation/SKILL.md) | Outsourcing to Google Antigravity (`agy`, with or without [agy-staff](https://github.com/keli-wen/agy-staff)) and OpenAI Codex CLI: agy vs Codex, safe wrappers, tracking, resuming, acceptance, measured runs | Sending bulk, fully specified work to another vendor's agent |
| [`agent-handover`](skills/agent-handover/SKILL.md) | Progress records, rules in the repo instead of local memory, commit-hash placeholders, decision records, hand-off and take-over checklists | After accepting work, before a session may end, when switching agents or tools, when resuming someone else's work |

Agents shipped with the Claude Code plugin: `team-reviewer` (routine changes, medium effort) and `team-reviewer-deep` (risky or cross-module changes, high effort). Both are read-only by instruction and have no edit or write tools; they keep Bash so they can run tests, so fingerprint the working tree when it matters (see `verification.md`).

## Helper scripts

| Script | Purpose |
|---|---|
| `skills/subagent-team/scripts/model-roster.mjs` | Lists the newest Anthropic / OpenAI / Google / DeepSeek models with price and context, from OpenRouter's public model list. Use it to map abstract tiers to current models. |
| `skills/cli-agent-delegation/scripts/codex-run.mjs` | Runs `codex exec` / `exec resume` with a required explicit effort. Refuses `ultra` and `danger-full-access`, supports a timeout, writes the log and final message to files, and prints a JSON summary with the session id. |
| `skills/cli-agent-delegation/scripts/agy-run.mjs` | Runs `agy` headless when the agy-staff plugin is not installed. Validates model ids, refuses routing back to Claude/GPT models, maps `--write` to unrestricted mode, and supports continuation by conversation id. |
| `skills/cli-agent-delegation/scripts/doctor.mjs` | Read-only environment report: CLIs and versions, Codex's default effort footgun, available models, agy-staff installation. |

## First use: agree on the team policy

The first time the core skill runs in a project, it looks for a `## Subagent team` section in `AGENTS.md` (or `CLAUDE.md`). If there is none, it detects which models and CLIs are available and asks you five short questions, each with a recommended answer you can accept in one go. It then writes the answers into that section, and later sessions follow it without asking again:

1. **Model policy**:
   - `auto` (recommended): the main session picks the recommended model and effort for each role from what is available, and says what it picked.
   - `fixed`: you set the model and effort for every tier.
   - `hybrid`: fixed for some roles, auto for the rest.
2. **Cost preference**: balanced / economize / max quality.
3. **External staff**: agy (with or without agy-staff), Codex CLI, or none.
4. **Never outsourced and shared files**: e.g. billing, payment and auth paths; locale files and doc indexes.
5. **Commit and push rules**.

Edit the section any time. Template and rules: [project-setup.md](skills/subagent-team/references/project-setup.md).

## Development

```bash
npm test          # offline unit tests (fake codex/agy binaries, fixtures)
npm run check     # frontmatter, links, version sync, reviewer prompt sync, privacy scan
```

Put private terms (project names, internal hosts) in an untracked `.privacy-denylist`, one per line. `npm run check` then fails if any of them appear in the repository. Contributor rules: [AGENTS.md](AGENTS.md).

## Credits

- [agy-staff](https://github.com/keli-wen/agy-staff) by Keli Wen: the agy plugin this repository recommends, and a blueprint for wrapping other worker CLIs.
- [anthropics/skills](https://github.com/anthropics/skills) and the [Agent Skills specification](https://agentskills.io/specification).

## Author

**Justin** · 𝕏 [@interjc](https://x.com/interjc) · [interjc.net](https://interjc.net) · GitHub [@interjc](https://github.com/interjc)

## License

[MIT](LICENSE)
