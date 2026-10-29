# Model tiers

The skill never hard-codes a vendor. In-house agents use four tiers, outsourced agents two:

| Tier | Position | Default effort |
|---|---|---|
| top | strongest reasoning, slowest, most expensive; expert decisions and critical design evaluations only | high |
| high | strong reasoning; director, cross-module design, hard bugs, code review, sensitive modules | medium–high |
| mid | best value; routine decisions, specified implementation, detail-heavy UI | medium–high |
| low | fastest, cheapest; search, running commands, collecting output | low |
| external-fast | another vendor's cheap fast model; translations, bulk copy, mechanical replacements | vendor's medium/high |
| external-strong | another vendor's strong model; code-reading syncs, large homogeneous implementation, read-only second opinions | vendor's medium/high |

The two external tiers decide *how carefully* the work is done, not *whether risky work may be outsourced*: both only accept work that passes the outsourcing gate (SKILL.md section 3), with one exception: read-only second opinions, whose verdict stays in-house.

## Role → tier → effort

| Task | Role | Tier · effort |
|---|---|---|
| Orchestration, contracts, integration, commit | director | high · high |
| Routine split, single-module design, acceptance against a precise spec | manager | mid · medium–high |
| Cross-module split, architecture, phase code review, sensitive-module acceptance | manager | high · medium–high |
| Quick architectural judgement, second look | manager | high · low–medium |
| Specified component / API / storage implementation | worker | mid · medium |
| Detail-heavy UI (responsive, touch interaction) | worker | mid · high |
| Splitting a large file without behaviour change, cross-module change, hard bug | worker | high · high |
| Billing / payment / auth logic | director or worker | high · medium–high |
| Search, collect command output | runner | low · low |
| The hardest design calls, options that all have flaws | expert | top · high |
| Translations, bulk copy, mechanical replacements | outsourced | external-fast |
| Doc syncs that require reading code, test backfills following existing patterns | outsourced | external-strong · high |
| Large homogeneous implementation from a fixed spec | outsourced | external-strong · medium |
| Read-only second opinion from another vendor | outsourced | external-strong · medium–high; verdict stays in-house |

Reviewer effort: single file, straightforward logic, clear blast radius → medium; many files, cross-module, irreversible consequences → high or above.

## Deciding the mapping

The project's policy decides; see [project-setup.md](project-setup.md) for the first-use questionnaire and the `## Subagent team` section it writes to `AGENTS.md`.

1. **Policy `fixed` or `hybrid`**: use the concrete models and efforts in the section's table; ask before deviating.
2. **Policy `auto`** (or a role marked `auto`): pick the best fit per tier from what the current harness and machine actually expose, respecting the cost preference, and state each pick in one line at dispatch. Check external models with the CLIs themselves (`agy models`, Codex's `~/.codex/models_cache.json`), never from memory.
3. **No section yet**: run the setup questionnaire first. If the user cannot be asked, use `auto` and record it as "default, not confirmed".

## Finding the current model line-up

Model names go stale within months. To refresh your sense of what is current:

1. **What you can actually call** is authoritative: the harness's model list (Claude Code's `Agent` tool `model` values, Codex's model picker / `models_cache.json`), `agy models`. A model you cannot call is irrelevant.
2. **Cross-vendor overview**: `node scripts/model-roster.mjs` fetches OpenRouter's public model list (no API key) and prints the newest models per vendor (Anthropic, OpenAI, Google, DeepSeek by default) with listing date, context window and price per million tokens. One schema across vendors makes it the quickest way to rank models into tiers by capability and price. It reflects what OpenRouter serves; ids differ from your harness's.
3. **Tie-breaker for "which is the current flagship" and deprecations**: the vendors' own model pages ([Anthropic](https://platform.claude.com/docs/en/about-claude/models/overview), [OpenAI](https://platform.openai.com/docs/models), [Google Gemini](https://ai.google.dev/gemini-api/docs/models)).

```bash
node scripts/model-roster.mjs                          # newest 8 per vendor, last 365 days
node scripts/model-roster.mjs --vendors anthropic,google --limit 4
node scripts/model-roster.mjs --json > roster.json     # for further processing
```

Paths are relative to the `subagent-team` skill directory. Behind an HTTP(S) proxy, run with `NODE_USE_ENV_PROXY=1` on a Node release that supports it (recent 22.x and 24.x; it worked on 22.22). Without it, Node's built-in `fetch` ignores `HTTPS_PROXY`; on older Node, run the script where OpenRouter is reachable or pass a saved list with `--file`. The `listed` column is the date OpenRouter listed the model, which is close to but not the vendor's release date. If OpenRouter is unreachable the script exits 2 and points to the vendor pages below.

Ranking heuristic: within a vendor, the newest model at the highest price is usually the top or high tier, the newest mid-priced one mid, the cheapest recent "flash/mini/haiku"-class model low or external-fast. Confirm with the vendor page when two candidates look close.

## Example roster (as of 2026-10)

An example, not a rule. It shows the shape: a strong director, a few strong managers from *different vendors* (so reviews and second opinions do not share blind spots), and a broad pool of cheaper staff.

| Layer | Models used | Notes |
|---|---|---|
| Director | Claude Opus 5.5 (Claude Code) or GPT-6.1 Sol (Codex), effort high | one main session |
| Managers | GPT-6.1 Sol, Claude Opus 5.5, Claude Fable 5.1 | split, design, review, expert calls |
| Staff | Claude Sonnet 5.5, Gemini 4, Gemini 3.8 Flash, DeepSeek 4.1 Flash | dozens of tasks over a project |

Tier mapping that went with it in Claude Code + agy + Codex CLI:

| Tier | Model |
|---|---|
| top | `fable` |
| high | `opus` |
| mid | `sonnet` |
| low | `haiku` |
| external-fast | agy `gemini-3.8-flash-high` (`-medium` for purely mechanical work) |
| external-strong | agy `gemini-4-argon-medium` / `-high`, or Codex `gpt-6.1-sol` at medium–high |

Notes that held at the time:

- agy model ids carry the effort as a suffix (`-low` / `-medium` / `-high`); `agy models` lists them. agy can also route to Claude or GPT models; do not use that, it just takes a detour back to in-house models.
- Codex effort is `-c model_reasoning_effort=<level>` (levels seen at the time: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`; codex-cli 0.165.0 accepted and echoed `max`; what a given model honours is up to the model) and must be passed **every time**: when omitted, Codex reads `~/.codex/config.toml` (often `high` on a personal machine), which differs from the model's own default. Outsourced work is usually `medium`, `high` when much code must be read; `xhigh`/`max` rarely pay off (needing that much reasoning usually means the work should not be outsourced); never `ultra`, which in the author's use dispatched its own sub-tasks outside the director's control.
- With Codex as the main session, GPT-6.1 Sol at `high` was the director, the in-family `gpt-6-luna` handled simple work, and the expert was the top model Codex offered.

Other harnesses: rank whatever models they expose into the same tiers by capability and price. If effort cannot be set per call, choose by tier only.
