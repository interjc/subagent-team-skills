<div align="right">

[English](README.md) | [简体中文](README_ZH.md) | [日本語](README_JA.md)

</div>

# Subagent Team Skills

Agent Skills for running coding work as a **small software organisation**: four layers, plus a human who is asked as little as possible.

- **L1 Director**: one main session. Splits the work, picks each task's flow, writes contracts, integrates, commits
- **L2 In-house experts**: strong subagents. Detail design, task lines, review and acceptance, expert calls
- **L3 In-house execution**: cheap, fast subagents. Implement and test, review independently, search, and act as **liaisons** for external teams
- **L4 External teams**: other vendors' agents reached through a CLI, a plugin or MCP (agy, Codex CLI, ...), for well-specified bulk work
- **Human**: asked everything at once, at the end

```
L1  Director            1 main session at high tier, high effort       e.g. Claude Opus 5.5 / GPT-6.1 Sol
L2  In-house experts    detail design, task leads, review, expert calls  e.g. GPT-6.1 Sol / Claude Opus 5.5 / Claude Fable 5.1
L3  In-house execution  implement + test, review, search, liaisons       e.g. Claude Sonnet 5.5 / Claude Haiku 5.5
L4  External teams      translations, bulk edits, test backfills, 2nd opinions  e.g. Gemini 4 / Gemini 3.8 Flash (agy) / GPT-6.1 Sol (Codex CLI) / DeepSeek 4.1 Flash
    Human               one batched "grill me" list at the end
```

*(Model names are examples as of 2026-10. The skills themselves use abstract tiers.)*

A **layer** is responsibility and decision rights; a **tier** is model strength. They are chosen independently: an L3 liaison runs on a low tier, an L3 implementer of risky work on a high one. In-house and external teams both have tiers.

The method is distilled from the author's day-to-day work on several production projects, mostly with **Claude Code** and also with **Codex**. It covers:

- how to break work down like an engineering manager, and give each task a flow (which layers take part, which are skipped)
- what to delegate and to whom; how to write briefs that do not come back wrong
- how a low-tier liaison tracks external work, so only hard questions reach the experts or the director
- how to verify with commands instead of opinions
- when to stop and ask the human
- how team state persists in the project, with `AGENTS.md` and `docs/` cross-referencing each other and capturing lessons, so work can be handed over at any time

## Which agents are supported

Compatibility has two levels: the **host agent** that runs your main session, and the **external teams** it can reach.

Host agents:

| Agent | Status |
|---|---|
| **Claude Code** | Primary. Developed and used daily; plugin with skills and reviewer agents. |
| **Codex** | Secondary. Used as the main session on real projects; skills install as a plugin. The reviewer agents are Claude Code definitions (use `reviewer-prompt.md` instead). |
| Others (OpenCode, Pi, Cursor, Gemini CLI, ...) | Not tested; quality not guaranteed. The skills follow the open [Agent Skills](https://agentskills.io) format and the method is tool-neutral, so any agent that supports skills can install and load them. Install through `npx skills` or your agent's own plugin/skill marketplace, then adapt the harness-specific parts yourself. |

You do not have to say which host you use: the environment check makes a first guess from environment variables, confirms it with you on first use, and records it in the project policy. The team then adapts to what that host can do, such as spawning subagents, choosing a model and effort per subagent, or a native task list.

External teams:

| External team | Channel | Status |
|---|---|---|
| **agy** (Google Antigravity) | CLI, or the [agy-staff](https://github.com/keli-wen/agy-staff) plugin | Used in real projects; wrapper script included |
| **Codex CLI** | CLI (`codex exec`) | Used in real projects; wrapper script included |
| OpenCode, Pi, Grok CLI, agents exposed through MCP | CLI / MCP | Not tested. The skill gives a checklist for adapting a new CLI and verifying it with one small read-only job first |

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

Restart the agent afterwards.

**Requirements.** The method itself needs nothing. The optional helper scripts have no dependencies, but they need:

- **Node.js 18 or newer** (hard minimum, measured on Node 18 / 20 / 22 / 24). Below it the scripts refuse to run with a clear message.
- **Node.js 24** (recommended, pinned in [`.nvmrc`](.nvmrc)).
- **git**.

At the start of a session the core skill runs an **environment health check** (`env-check.cjs`). It reports:

- blockers and warnings, with the exact fix for each;
- a first guess at the host agent (for you to confirm);
- which external teams are available: Codex CLI, agy, agy-staff, other agent CLIs on `PATH`, MCP servers in the project's `.mcp.json`;
- whether your project already has a team policy and a team board.

The agent installs anything only with your consent and then re-checks. If you decline, it continues with documented fallbacks.

## How the team works

**The director gives every task a flow**, written on the task's card. Layers a task does not need are skipped, and brought in on demand when a question needs them:

| Flow | Path | Use when |
|---|---|---|
| `solo` | the director does it | one or two files, obvious change |
| `direct` | director → execution → director | the director's brief already settles every decision |
| `outsource` | director → liaison → external team → in-house review → director | bulk, fully specified work with command-based acceptance |
| `designed` | director → experts → execution → expert acceptance → director | needs detail design, spans modules, or touches a sensitive area |
| `designed+outsource` | as above, with a mechanical tail the experts freeze and send out | a design task with bulk work inside |
| `consult` | director → expert → director | a decision only, no code |

- **L2** settles the details: sub-tasks, briefs, acceptance commands. **L3 and L4** execute and test, and hand in real acceptance output; an independent reviewer re-runs it and hunts for risks. Integration and commit always stay with the director.
- **Questions go up one layer at a time**: external team → liaison → experts → director → human. Each layer answers what it can and passes the rest up; only questions that need a human (product trade-offs, money, credentials, public or irreversible actions) reach the final grill-me list.
- **The liaison** is a low-tier in-house subagent assigned to one external job: it dispatches, waits with bounded waits, collects the result, checks the changes stayed in scope, runs the acceptance commands, answers straightforward questions whose answer is already in the brief, and sends one round of mechanical rework. Only questions that need judgement go to the experts or the director, so waiting and routine checks never fill the main session's context.
- **Persistent state**: where the host has a native mechanism (such as Claude Code's shared task list), use it for live coordination. Whenever external teams, several sessions or Strict mode are involved, or the host has nothing native, state goes onto the **team board** in the repository, which is the source of truth:

```text
docs/agent-team/
├── README.md       # board index: reading order, task table, link back to AGENTS.md
├── progress.md     # status snapshot, completed log, next-up queue, user decisions, open questions, pitfalls
├── decisions.md    # numbered decisions, appended, never rewritten
├── lessons.md      # user adjustments and lessons learned; promoted rules link to AGENTS.md
└── tasks/<ID>.md   # one card per task or external job: flow, holder (its only writer), lease, log, questions, result
```

- **Docs that reference each other**: the `## Subagent team` section of `AGENTS.md` holds the team policy and links to the board; the board links back. Each rule has one home and everything else links to it. When you adjust the process, it goes into `lessons.md` right away (dated, in your words), and project-wide rules go into `AGENTS.md`.

## Skills

| Skill | What it covers | Loads when |
|---|---|---|
| [`subagent-team`](skills/subagent-team/SKILL.md) (core) | Detecting and confirming the host agent; first-use team policy; the four layers and the layer / tier split; task breakdown and per-task flows; the outsourcing gate and liaisons; the team board and `AGENTS.md` / `docs/` cross-references; modes (solo / standard / strict); brief templates; executable verification and three-step review; the layer-by-layer escalation ladder; agent reuse and slot limits; Claude Code and Codex specifics | A task spans several files or phases; you split work, pick a flow, delegate, choose a model or effort, write a brief, track external work, review delegated work, record a lesson, or wonder whether to ask the user |
| [`cli-agent-delegation`](skills/cli-agent-delegation/SKILL.md) | Outsourcing to Google Antigravity (`agy`, with or without [agy-staff](https://github.com/keli-wen/agy-staff)) and OpenAI Codex CLI: agy vs Codex, safe wrappers, tracking, resuming, acceptance, measured runs; bounded waiting for liaisons; a checklist for adapting OpenCode, Pi, Grok or other CLIs and MCP | Sending bulk, fully specified work to another vendor's agent |
| [`agent-handover`](skills/agent-handover/SKILL.md) | Progress records, task cards and lessons, rules in the repo instead of local memory, commit-hash placeholders, decision records, hand-off and take-over checklists | After accepting work, before a session may end, when switching agents or tools, when resuming someone else's work |

Agents shipped with the Claude Code plugin: `team-reviewer` (routine changes, medium effort) and `team-reviewer-deep` (risky or cross-module changes, high effort). Both are read-only by instruction and have no edit or write tools; they keep Bash so they can run tests, so fingerprint the working tree when it matters (see `verification.md`).

## Helper scripts

| Script | Purpose |
|---|---|
| `skills/subagent-team/scripts/env-check.cjs` | Environment health check at session start: Node.js (minimum 18, recommended 24), git, a host-agent hint, external teams (Codex CLI, agy, agy-staff, other agent CLIs, project MCP servers), the project's team policy and team board. Written in conservative syntax so it still runs and explains on an old Node. |
| `skills/subagent-team/scripts/team-board.mjs` | The team board: `init` creates the `docs/agent-team/` skeleton (never overwrites), `new` adds a task card and its index row, `status` summarises task states and open questions, and reports drift between the index, the cards and `AGENTS.md`. |
| `skills/subagent-team/scripts/model-roster.mjs` | Lists the newest Anthropic / OpenAI / Google / DeepSeek models with price and context, from OpenRouter's public model list. Use it to map abstract tiers to current models. |
| `skills/cli-agent-delegation/scripts/codex-run.mjs` | Runs `codex exec` / `exec resume` with a required explicit effort. Refuses `ultra` and `danger-full-access`, supports a timeout, writes the log and final message to files, and prints a JSON summary with the session id. |
| `skills/cli-agent-delegation/scripts/agy-run.mjs` | Runs `agy` headless when the agy-staff plugin is not installed. Validates model ids, refuses routing back to Claude/GPT models, maps `--write` to unrestricted mode, and supports continuation by conversation id. |
| `skills/cli-agent-delegation/scripts/doctor.mjs` | Read-only environment report: CLIs and versions, Codex's default effort footgun, available models, agy-staff installation. |

## First use: agree on the team policy

The first time the core skill runs in a project, it looks for a `## Subagent team` section in `AGENTS.md` (or `CLAUDE.md`).

If there is none, it detects the host agent, the available models, the external teams and the project's existing docs, then asks you seven short questions. Each comes with a recommended answer pre-filled from what it found, and you can accept them all in one go. It writes the answers into that section, and later sessions follow it without asking again:

1. **Host agent**: confirm the detected one, and say whether the project is also used from other agents.
2. **Model policy**:
   - `auto` (recommended): the main session picks the recommended model and effort for each role from what is available, and says what it picked.
   - `fixed`: you set the model and effort for every tier.
   - `hybrid`: fixed for some roles, auto for the rest.
3. **Cost preference**: balanced / economize / max quality.
4. **External teams**: which ones, through which channel (CLI / plugin / MCP), which model fills the external-fast and external-strong tiers for each, which may edit files and which only review.
5. **Team board**: `docs/agent-team/` plus the host's native task list is recommended.
6. **Never outsourced and shared files**: e.g. billing, payment and auth paths; locale files and doc indexes.
7. **Commit and push rules**.

Edit the section any time. Template and rules: [project-setup.md](skills/subagent-team/references/project-setup.md). When you later adjust the process, the section is updated and the change is recorded in `lessons.md`.

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
