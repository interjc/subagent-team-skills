# The compute plan: external resources in local files

Which external team · model · effort takes which responsibility, what replaces it when it fails, when it may be used, how much quota it has left and how it has performed are the user's own configuration. They live in **local files that every session reads**, never in an agent's memory or in chat. This page is the procedure behind "External teams and the liaison" in [SKILL.md](../SKILL.md); `scripts/compute-config.mjs` reads and writes the files. Quota handling is in [quota.md](quota.md), how long an instruction lasts in [user-overrides.md](user-overrides.md), what a team may read in [confidentiality.md](confidentiality.md).

## Where it lives

| Scope | Directory | Holds |
|---|---|---|
| **global** (the user's machine) | `~/.subagent-team/`, a dedicated directory no other tool uses; `$SUBAGENT_TEAM_HOME` overrides it | the plan the user wants in every project; quota (it belongs to the account, not the project); the usage log; the cached model ranking |
| **project** | `<main checkout>/.agent-team/` | this project's differences: a team allowed only here, a different order, a project schedule |
| session | not in these files | "for now" choices: the session choice line in the board's `progress.md`, or the director's notes ([user-overrides.md](user-overrides.md)) |

Files: `compute.json` (the plan and quota), `compute-usage.jsonl` (one line per finished job), `model-ranking.json` (global only). The effective plan is global overridden by project: a project resource replaces the global one field by field, a project routing line replaces that role's global line, a project schedule replaces a global one with the same id, and for quota the most recently checked entry wins.

- The project directory sits in the **main checkout**, so every worktree of the repository shares it; the script finds it through git. On its first project write the script adds `/.agent-team/` to `.git/info/exclude`, which changes no tracked file. `confidentiality.md` sits beside it.
- Never commit these files or copy them into tracked records; the tracked policy carries one pointer line (below). They are written with owner-only permissions, under a lock, by atomic rename, so parallel sessions do not corrupt them.
- Without Node.js 22+, edit the JSON by hand in the same format.

```bash
node scripts/compute-config.mjs paths                 # where the files are for this project
node scripts/compute-config.mjs show                  # effective plan, review due?, ranking age, quota notes, warnings
node scripts/compute-config.mjs resolve --role bulk   # who takes a bulk job right now, in order, and who is excluded and why
```

Paths are relative to this skill's directory; pass `--root <project>` when running from elsewhere. `--help` lists every command.

## What it records

| Field | Meaning |
|---|---|
| resource id | one team · model · effort, e.g. `agy-flash`, `codex-strong`, `opencode-deepseek` |
| `team`, `channel`, `model`, `effort`, `tier` | as in the dispatch line; effort is always pinned, never the tool's default |
| `roles` | its responsibilities: `bulk` (translations, bulk copy, mechanical edits, template fills), `homogeneous` (large homogeneous implementation from a fixed spec), `bounded` (one bounded unit from a frozen spec), `code-sync` (doc or test syncs that need reading code), `review`, `sensitive-review` (read-only second opinion on money, auth, schema or irreversible data). Custom names are allowed |
| `mayEdit` | `false`: review only; excluded from edit roles |
| `fallback` | ordered ids to try when it is unavailable, ending with an in-house entry such as `in-house:mid:medium` |
| `windows` | when it may be used at all: days, hours (may wrap midnight), zone, `from` / `until` |
| `routing` | per role, an explicit order of resource ids; without one, declaration order |
| `schedules` | time-based rules: within a window, `prefer` some resources first or `avoid` others, optionally only for some roles; `until` ends a rule |
| `quota` | per resource: state, checked, resets, credit expiry, source ([quota.md](quota.md)) |
| `review` | when the plan was last reviewed with the user and how often (default every 7 days) |
| `timezone` | zone for windows and usage buckets; the system zone when unset |

**Time windows ("time-sliced use").** Typical uses: a company plan usable on weekdays only; an off-peak price at night (`prefer` the discounted model 00:00-08:00); credits that expire (`prefer ... until=2026-11-30`); a channel to spare during the day when the user works in it interactively (`avoid` 09:00-19:00). Days are the days a window starts on: `fri 22:00-08:00` covers Friday night until Saturday 08:00. Times carry an offset (`2026-11-30T19:00+08:00`); a date alone (`until=2026-11-30`, `--resets 2026-12-01`, `--expires 2026-11-30`) is a whole local day in the window's or the plan's zone.

```bash
node scripts/compute-config.mjs set agy-flash --scope global --team agy --channel agy-staff \
  --model gemini-3.8-flash-high --effort high --tier external-fast --roles bulk \
  --fallback opencode-fast,in-house:mid:medium
node scripts/compute-config.mjs schedule add night-discount --scope global \
  --when "00:00-08:00 tz=Asia/Shanghai" --prefer opencode-fast --roles bulk
node scripts/compute-config.mjs route review codex-strong,opencode-strong --scope project
```

## Initialization: the one interview

The only time the director stops to ask about compute is when `show` reports `needsInit` (no plan in either scope), together with the setup questionnaire or the session-start team question ([project-setup.md](project-setup.md), [environment-check.md](environment-check.md)). Pre-fill everything, so one reply settles it:

1. Detect: the environment check, `cli-agent-delegation`'s doctor and probes (which teams, which models each channel actually offers), and a fresh ranking ("Choosing models: ranking and updates", below).
2. Draft the plan yourself: per team, which model and effort fill which roles, the fallback chain per resource, the routing order per role, and any windows the user already mentioned. Rank by the ranking's performance and price within what each channel can call; keep every team on another vendor than in-house.
3. Ask once, in one dialog: confirm or edit the draft (show it as a table: resource, model · effort, roles, fallback); confidentiality per channel · model; what the user knows about quota and resets; any time-based use ("credits run out on the 30th", "agy only at night"); how often to review (default 7 days); and **where to keep it: global (every project on this machine, recommended for teams the user uses everywhere), this project, or this session only**. Different parts may go to different scopes.
4. Write it: `init --scope <s> --from <draft.json>`, or `set` / `route` / `schedule` per item. Say in one line where it was written.

In a non-interactive run, use the draft for this session only, do not write it, and put the questions in the end-of-task list.

## After that: decide, tell, proceed

Once a plan exists, the director routes by it without asking ([SKILL.md](../SKILL.md), "Escalation and asking the human"):

- Before each batch, `resolve --role <role>` gives the order for now: active schedules, windows, quota and fallbacks applied. Check the pick's confidentiality level and the outsourcing gate yourself; `resolve` knows neither.
- **Changes you make on your own judgement** (moving a role to a newer model the channel now offers, reordering after repeated rework, a fallback after a quota error) are announced in one line and applied: "Plan change: `code-sync` moves from Codex `gpt-6.1-sol` to `gpt-6.2-sol` · high (newer, ranks higher, same price). Say if you object." If the user objects, ask then, interactively. Session-scope changes stay in the session; a change you want to keep is written only after the user has seen the notice and not objected, to the scope the plan already lives in. `fixed` policy rows in `AGENTS.md` are never upgraded silently ([project-setup.md](project-setup.md)).
- **Review notice.** When `show` reports `review.due`, post one short notice at a natural break (not mid-question): the plan as a table, what changed since the last review (new models, quota events, quality flags from `usage`), and what you will do next; then run `reviewed --scope <the plan's scope>` and continue. It is a notice, not a question: continue unless the user objects.

## When the user changes it

Every change the user asks for, including during initialization, gets one short scope question unless their words already settle it: "Keep this for this session, for this project, or globally?" Recommend session for quota-driven preferences ("use OpenCode for now"), global for teams and models the user uses everywhere, project for a difference that only holds here. Then:

| Answer | Write |
|---|---|
| this session | the session choice line in `progress.md`; nothing in the files |
| this project | `--scope project` |
| globally | `--scope global` |

A lasting change to a role, model, effort, fallback or schedule rewrites the entry in place; no history in the file. Running jobs keep their team; queued ones are re-routed ([user-overrides.md](user-overrides.md), "Which work it touches").

## Usage log and quality

After every external job, the layer that accepted or rejected it records the outcome: `record <id> --outcome accepted|rework|in-house|quota|failed|cancelled --task T4.b [--minutes n] [--tokens-in n] [--tokens-out n] [--cost usd]`, with figures from the wrapper's `summary.json` when it has them. `usage [--since-days 30]` summarizes per resource: jobs, outcomes, first-pass rate, time, tokens, cost, jobs per day and per hour of day. It is how the next session knows a channel's track record and when it is actually used.

- `qualityFlag` appears after two content failures in a row or a job taken back in-house: the next job goes to a stronger model or another team ([external-teams.md](external-teams.md), "Quality of a channel"). Only `accepted`, `rework` and `in-house` count as content; `quota`, `failed` and `cancelled` are availability.
- The log is global by default, so it spans projects; each line carries the project directory's name. `--scope project` keeps a project's log apart.

## Choosing models: ranking and updates

Model names go stale within months, and a new model is often out before the user's CLI can select it.

1. **Refresh the ranking** when `show` reports `ranking.stale` (older than 30 days or missing), at initialization, and at each review: `node scripts/model-roster.mjs --arena --save`. It combines OpenRouter's price list with LMArena's Code Arena leaderboard (performance on coding, no key needed) and saves `model-ranking.json` globally. When the arena cannot be read, the price list still prints (exit 3): look up a current coding leaderboard by web search and say which source and date you used ([model-tiers.md](model-tiers.md), "Finding the current model line-up").
2. **Compare with what each channel offers**: write each channel's model list to a file (`agy models`, Codex's `models_cache.json` ids from the doctor, `opencode-acp-run.mjs probe`) and run `check-models --available codex=<file> --available agy=<file>`.
   - `newer`: the channel already offers a newer model of the same family than the plan uses. Decide, tell, proceed (above).
   - `missing`: a ranked model of the team's vendor that the channel does not list. Usually the CLI is out of date. Tell the user, with the update command from `updateHint`, and ask whether to run it for them; updating a global tool needs their yes. A vendor may also simply not offer that model on this channel yet: say so rather than promising the update fixes it. `variants` lists ranked ids that extend a model the channel offers (for example a `-pro` API variant); they are not a reason to update.
3. Re-run `doctor.mjs` after an update and record the new model in the plan with a notice.
