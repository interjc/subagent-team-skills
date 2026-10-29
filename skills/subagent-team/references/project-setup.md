# Project setup: the team policy

The first time this skill is used in a project, agree with the user on **which model and effort each role uses**, and write it down where every future session finds it. Ask once; afterwards read the policy and follow it.

## Where the policy lives

A `## Subagent team` section in the project's `AGENTS.md`. If the project has no `AGENTS.md` and uses only `CLAUDE.md`, put the section in `CLAUDE.md`. Both Claude Code (through `CLAUDE.md`) and Codex load these files into every session, so the policy is in context before any skill loads, and it travels with git to every machine and tool.

If the user prefers a separate file, write it (e.g. `docs/agents/subagent-team.md`) and leave a one-line pointer section in `AGENTS.md`, so it can still be found.

## When to run setup

1. Look for the `## Subagent team` section (or the pointer to it). If it has a `Model policy:` line, **use it and do not ask**. If something it names is unavailable (a model was retired, a CLI is not installed), fall back as in the "auto" rules below and tell the user in one line.
2. No section: run the questionnaire before dispatching the first subagent. Solo-mode work (section 0 of SKILL.md) does not need it.
3. The user cannot be asked right now (non-interactive run, or they said "don't ask, just go"): write the section with `Model policy: auto` and `Decided: default, not confirmed`, continue, and include the policy in the end-of-task grill-me list.
4. The user later changes their mind ("use another vendor's model for reviews"): update the section in place, with the date.

## Detect first, then ask

Pre-fill every answer from what you can see, so the user can accept everything in one reply. Start from the environment health check (`scripts/env-check.cjs`, SKILL.md "Start"), which already reports Node.js, git, the external CLIs and whether a policy exists. Then:

- Models the harness exposes (the `Agent` tool's model values in Claude Code; Codex's model picker or `~/.codex/models_cache.json`).
- External staff: run the `cli-agent-delegation` skill's `scripts/doctor.mjs` if it is installed, or check `agy --version`, `codex --version`, and whether the agy-staff plugin is present.
- Commands from `package.json`, `Makefile`, CI config; sensitive paths (billing, payment, auth, migrations) and shared files (locale files, doc indexes) from the tree.
- The current model line-up: [model-tiers.md](model-tiers.md), "Finding the current model line-up".

## The questionnaire

Use the harness's question tool when there is one (several questions in one dialog, recommended option first); otherwise one message with numbered questions. Keep it to these five. The user can answer "all recommended".

1. **Model policy**
   - **auto (recommended)**: the director picks the recommended model and effort per role from what is available at the time, following the tier table, and states each choice in one line when dispatching. No per-task confirmation.
   - **fixed**: the user fills in (or confirms) a model and effort per role; the director uses exactly that and asks before deviating.
   - **hybrid**: fixed for the roles the user names (often reviewer and expert), auto for the rest.
2. **Cost preference**: balanced (recommended) / economize (prefer mid and low tiers, top tier only for the expert, outsource aggressively) / max quality (high tier for all reviews and risky work, top tier for design).
3. **External staff** (pre-filled from detection): agy via agy-staff, agy raw CLI, Codex CLI, none. Mark which may edit files and which are review-only.
4. **Never outsourced and shared files** (pre-filled): paths whose business code stays in-house; files only the director writes.
5. **Commit and push**: may the agent commit after checks pass? Push to which branches, if any? (Default: commit locally, never push without being asked.)

## The section to write

```markdown
## Subagent team
<!-- Policy for the subagent-team skill. Edit freely; the skill reads it at the start of each task. -->
- Model policy: auto            <!-- auto | fixed | hybrid -->
- Cost preference: balanced     <!-- balanced | economize | max-quality -->
- Decided: <YYYY-MM-DD>, confirmed by the user   <!-- or: default, not confirmed -->
- Environment (checked <YYYY-MM-DD>): Node.js <version>, git <version>, Codex CLI <version or none>, agy <version or none>, agy-staff <yes or no>; accepted warnings: <none, or e.g. "Node 22, not upgrading">

| Role | Tier | Model | Effort |
|---|---|---|---|
| Director (main session) | high | the session's own model (never switched) | high |
| Manager: routine split / acceptance | mid | auto | medium |
| Manager: architecture / code review | high | auto | medium |
| Worker: specified implementation | mid | auto | medium |
| Worker: cross-module / hard bug / sensitive | high | auto | high |
| Runner: search, collect output | low | auto | low |
| Reviewer | ≠ implementer's model | auto | medium; high for risky changes |
| Expert | top | auto (fallback: next flagship at max effort) | high |
| External-fast | — | <e.g. agy gemini-3.8-flash-high, or none> | — |
| External-strong | — | <e.g. Codex gpt-6.1-sol, or none> | medium–high |

- External staff: <agy (agy-staff plugin) may edit; Codex CLI may edit; or none>
- Never outsourced: <paths>
- Shared files (director only): <paths>
- Acceptance commands: <type check>, <lint>, <tests> (executable paths)
- Commit / push: <e.g. commit locally after checks; push only when asked; never merge main>
```

With `fixed` or `hybrid`, replace `auto` in the rows the user fixed with a concrete model (and effort). Model names in a fixed row are the user's choice; do not "upgrade" them silently when newer models appear. Mention the newer option once, in the end-of-task summary.

## Rules for "auto"

- Pick from models the harness can actually call, by the tier table in [model-tiers.md](model-tiers.md): the strongest available model for top, the vendor's current flagship for high, its balanced model for mid, its fastest for low.
- Never change the director's own model; the user chose it when starting the session.
- Keep reviewers on a different model from the implementer they review (ideally another vendor).
- Respect the cost preference.
- State the choice at dispatch ("worker: <model> · medium") and list the models used in the final report. When a pick turns out wrong (too weak, too slow), adjust and note it in the design doc's *Lessons*. Do not write per-task picks into `AGENTS.md`; the policy stays "auto".
- If the preferred model is unavailable (refused, out of quota, slot limit), fall back one step and say so.
