# Project setup: the team policy

The first time this skill is used in a project, agree with the user on **which host harness runs the work, which model and effort each role uses, which external teams fill which tiers, and where shared state lives**, and write it down where every future session finds it. Ask once; afterwards read the policy and follow it.

## Where the policy lives

A `## Subagent team` section in the project's `AGENTS.md`. If the project has no `AGENTS.md` and uses only `CLAUDE.md`, put the section in `CLAUDE.md`. Both Claude Code (through `CLAUDE.md`) and Codex load these files into every session, so the policy is in context before any skill loads, and it travels with git to every machine and tool.

If the user prefers a separate file, write it (e.g. `docs/agents/subagent-team.md`) and leave a short pointer section in `AGENTS.md` that keeps the `Model policy:`, `Host harness:` and `Team board:` lines and links to the file, so both people and the helper scripts still find them.

## When to run setup

1. Look for the `## Subagent team` section (or the pointer to it). If it has a `Model policy:` line, **use it and do not ask**. If something it names is unavailable (a model was retired, a CLI is not installed), fall back as in the "auto" rules below and tell the user in one line. If it lacks a line that newer versions of this skill add (`Host harness:`, `Team board:`, the external-team table), ask only for the missing items, pre-filled.
2. No section: run the questionnaire before dispatching the first subagent. Solo-mode work (section 0 of SKILL.md) does not need it.
3. The user cannot be asked right now (non-interactive run, or they said "don't ask, just go"): write the section with `Model policy: auto` and `Decided: default, not confirmed`, continue, and include the policy in the end-of-task grill-me list.
4. The user later changes their mind ("use another vendor's model for reviews"): update the section in place, with the date, and add a row to the board's `lessons.md` with the user's words.

## Detect first, then ask

Pre-fill every answer from what you can see, so the user can accept everything in one reply. Start from the environment health check (`scripts/env-check.cjs`, SKILL.md "Start"), which already reports Node.js, git, a host-harness hint, the external CLIs and project MCP servers, and whether a policy and a board exist. Then:

- The host harness and its capabilities: your own tool list and [host-harness.md](host-harness.md).
- Models the harness exposes (the `Agent` tool's model values in Claude Code; Codex's model picker or `~/.codex/models_cache.json`).
- External teams: run the `cli-agent-delegation` skill's `scripts/doctor.mjs` if it is installed, or check `agy --version`, `codex --version`, other agent CLIs, and whether the agy-staff plugin is present. Rank each team's models into external-fast and external-strong ([external-teams.md](external-teams.md)).
- Commands from `package.json`, `Makefile`, CI config; sensitive paths (billing, payment, auth, migrations) and shared files (locale files, doc indexes) from the tree.
- Existing docs: a `docs/` index, progress or decision records, an existing board. Reuse them instead of creating duplicates.
- The current model line-up: [model-tiers.md](model-tiers.md), "Finding the current model line-up".

## The questionnaire

Use the harness's question tool when there is one (recommended option first; if it limits the number of questions per dialog, ask in two dialogs, or offer "accept all detected answers" as the first question); otherwise one message with numbered questions. Keep it to these seven. The user can answer "all recommended".

1. **Host harness** (pre-filled from detection): "This session looks like <host> (evidence: ...). Correct? Do you also run this project from other agents?" Record every host the project is used from.
2. **Model policy**
   - **auto (recommended)**: the director picks the recommended model and effort per role from what is available at the time, following the tier table, and states each choice in one line when dispatching. No per-task confirmation.
   - **fixed**: the user fills in (or confirms) a model and effort per role; the director uses exactly that and asks before deviating.
   - **hybrid**: fixed for the roles the user names (often reviewer and expert), auto for the rest.
3. **Cost preference**: balanced (recommended) / economize (prefer mid and low tiers, top tier only for the expert, outsource aggressively) / max quality (high tier for all reviews and risky work, top tier for design).
4. **External teams** (pre-filled from detection): which teams, through which channel (CLI, plugin, MCP), which model fills external-fast and external-strong, and which may edit files versus review only. "None" is a valid answer.
5. **Team board** (recommended: `docs/agent-team/` plus the host's native task list where it has one): where shared state lives ([team-board.md](team-board.md)). Projects that never involve external teams or multiple sessions may choose `native`.
6. **Never outsourced and shared files** (pre-filled): paths whose business code stays in-house; files only the director writes.
7. **Commit and push**: may the agent commit after checks pass? Push to which branches, if any? (Default: commit locally, never push without being asked.)

## The section to write

```markdown
## Subagent team
<!-- Policy for the subagent-team skill. Edit freely; the skill reads it at the start of each task. -->
- Host harness: <e.g. Claude Code> (confirmed <YYYY-MM-DD>)   <!-- every host the project is used from -->
- Model policy: auto            <!-- auto | fixed | hybrid -->
- Cost preference: balanced     <!-- balanced | economize | max-quality -->
- Decided: <YYYY-MM-DD>, confirmed by the user   <!-- or: default, not confirmed -->
- Environment (checked <YYYY-MM-DD>): Node.js <version>, git <version>, Codex CLI <version or none>, agy <version or none>, agy-staff <yes or no>; accepted warnings: <none, or e.g. "Node 22, not upgrading">
- Team board: docs/agent-team/README.md + native task list   <!-- or: native -->

| Layer | Role | Tier | Model | Effort |
|---|---|---|---|---|
| L1 | Director (main session) | high | the session's own model (never switched) | high |
| L2 | Designer / task lead | high | auto | medium |
| L2 | Senior reviewer (risky, cross-module) | high | auto, ≠ implementer's model | medium; high for risky changes |
| L2 | Principal expert | top | auto (fallback: next flagship at max effort) | high |
| L3 | Implementer: specified work | mid | auto | medium |
| L3 | Implementer: cross-module / hard bug / sensitive | high | auto | high |
| L3 | Reviewer / tester (routine) | mid | auto, ≠ implementer's model | medium |
| L3 | Runner, liaison | low | auto | low |

| External team | Channel | external-fast | external-strong | May edit? | Status |
|---|---|---|---|---|---|
| <e.g. agy> | <plugin agy-staff, or CLI> | <model id> | <model id> | yes | <verified YYYY-MM-DD> |
| <e.g. Codex CLI> | CLI | — | <model id> · medium–high | yes | <verified YYYY-MM-DD> |

- Never outsourced: <paths>
- Shared files (director only): <paths>
- Acceptance commands: <type check>, <lint>, <tests> (executable paths)
- Commit / push: <e.g. commit locally after checks; push only when asked; never merge main>
- Lessons and user adjustments: docs/agent-team/lessons.md
```

With `fixed` or `hybrid`, replace `auto` in the rows the user fixed with a concrete model (and effort). Model names in a fixed row are the user's choice; do not "upgrade" them silently when newer models appear. Mention the newer option once, in the end-of-task summary.

After writing the section, create the board if the policy names one (`scripts/team-board.mjs init`), and check that the section and the board index link to each other ([team-board.md](team-board.md), "Keeping AGENTS.md and the docs cross-referenced").

## Rules for "auto"

- Pick from models the harness can actually call, by the tier table in [model-tiers.md](model-tiers.md): the strongest available model for top, the vendor's current flagship for high, its balanced model for mid, its fastest for low.
- Never change the director's own model; the user chose it when starting the session.
- Keep reviewers on a different model from the implementer they review (ideally another vendor).
- Liaisons and runners take the cheapest model that can run shell commands reliably.
- External teams: pick each team's other-vendor models for its two tiers; never a model that routes back to the in-house vendor.
- Respect the cost preference.
- State the choice at dispatch ("worker: <model> · medium") and list the models used in the final report. When a pick turns out wrong (too weak, too slow), adjust and note it in the design doc's *Lessons*. Do not write per-task picks into `AGENTS.md`; the policy stays "auto".
- If the preferred model is unavailable (refused, out of quota, slot limit), fall back one step and say so.
