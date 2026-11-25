# The compute plan: local files, host plans and state

Which models fill in-house seats and external roles, which host plan applies, which spending profile and vendor constraints are active, what replaces a failing resource, when each resource may run, how much quota it or its declared account has left, and how it has performed are the user's own configuration. They live in **local files that every session reads**, never in an agent's memory or in chat. This page is the procedure behind "Start" and "External teams and the liaison" in [SKILL.md](../SKILL.md); `scripts/compute-config.mjs` reads and writes the files. Scenarios are in [scenarios.md](scenarios.md), profiles and the planning interview in [profiles.md](profiles.md), quota in [quota.md](quota.md), override scope in [user-overrides.md](user-overrides.md), and confidentiality in [confidentiality.md](confidentiality.md).

## Where it lives

Plan (user-decided) and state (machine-written per session) live in separate files.

| Scope | Directory | Files and purpose |
|---|---|---|
| **global** (the user's machine) | `~/.subagent-team/`, a dedicated directory no other tool uses; `$SUBAGENT_TEAM_HOME` overrides it | `compute.json` (plan, profiles, declared accounts, seats, hosts, global quota and `accountQuota`); `compute-usage.jsonl` (job log); `model-ranking.json` (cached ranking); `compute-state.json` (only when outside a git repo); legacy `harness-<host>.md` overlays |
| **project** | `<main checkout>/.agent-team/` | `compute.json` (project overrides); `compute-state.json` (machine-written per-session state when inside a git repo); `confidentiality.md`; optional project `harness-<host>.md` overlays |
| **session** | `compute-state.json` (`sessions.<key>`) | "for now" overrides written via `--scope session --session <key>` (accepted by `set`, `route`, `schedule add`, `profile use`), plus `notes` and `carryOver` ([user-overrides.md](user-overrides.md)) |

- **Additive compatibility (`schema: 1`, `rev: 2`).** `compute.json` keeps `"schema": 1` so older cached plugin versions (0.6.x) can still read the shared global file. Every write stamps `"rev": 2`; reading never rewrites.
- **Merge rules (global < project < host < session).** `resources`, `accounts`, `seats`, and `profiles` shallow-merge per id (project wins). `hosts` merges one level deep per host id, with `serves` merged per team. `quota` and `accountQuota` keep the entry with the newest `checked`. `profile` replaces (project wins). In `review.preferences`, `lastConfirmed`, `lastAsked` and `snoozeUntil` keep the newest date, so a global "keep" is not masked by an older project date; `everyDays` is project wins. `constraints` narrows only: `denyVendors` union, `onlyVendors` intersection when both non-empty (else the non-empty one), `inHouseOnly` OR. To build the effective plan for host `H` and session `K`, apply `hosts[H]` (`routing` per role, non-null `profile`, `constraints`) and then `sessions[K].patch` the same way.
- **`compute-state.json`** holds `lastHost` (`id`, `runtime`, `served` fingerprint, `at`, `session`), `sessions` (per-session `host`, `runtime`, `startedAt`, `touchedAt`, `patch`, `notes` with `saveAsked: null | session | project | global`), and `carryOver`. On every write, sessions whose `touchedAt` is older than 14 days are pruned and their unasked notes (`saveAsked: null`) move to `carryOver` (newest 10 kept). Session keys come from `--session`, else a 16-hex SHA-256 hash of `<hostId>:<envValue>` from the first present of `OPENCODE_SESSION_ID`, `T3CODE_THREAD_ID`, `CODEX_THREAD_ID` (never storing the raw env value), else a generated 12-hex key (`generated: true`). Passing `--served <file>` hashes sorted, unique, trimmed lines into a `sha256:` fingerprint.
- The project `.agent-team/` sits in the **main checkout**, shared by worktrees; on its first project write the script adds `/.agent-team/` to `.git/info/exclude`, touching no tracked file. All writes use owner-only permissions (`0600`), under a lock, by atomic rename. Never commit these files or copy account ids, instance ids or fingerprints into tracked records.
- Without Node.js 22+, edit the JSON by hand in the same format.

```bash
node scripts/compute-config.mjs paths                              # where the files are for this project
node scripts/compute-config.mjs start --root <project>             # session start: detect host, update state, emit ask[]/say[]
node scripts/compute-config.mjs show --root <project> [--host <id>] # read-only effective plan, rev, hosts, overlays, warnings
node scripts/compute-config.mjs resolve --role bulk --host <id>    # who takes the job now, account/instance, exclusions
```

Paths are relative to this skill's directory; pass `--root <project>` when running from elsewhere. `--help` lists every command. Exit codes: `0` ok, `1` usage error, `2` no config, `3` invalid config/draft, `4` fs/lock error, `5` unknown id, `6` already exists.

## What `compute.json` records

| Field | Meaning |
|---|---|
| `schema`, `rev` | `schema: 1` (kept for compatibility); `rev: 2` (stamped on writes by 0.7.0+) |
| `profile` | Active profile: `{ active, by, at, until }`. `active` is a built-in (`performance`, `balanced`, `frugal`, `load-balance`) or a key in `profiles`; `until` is a time/date or `null` ([profiles.md](profiles.md)) |
| `profiles` | Custom profiles keyed by id: `{ extends, parallelism, note }` (`parallelism`: `max`, `normal`, `low`; cycles are an error) |
| `constraints` | Orthogonal filters: `{ onlyVendors: [], denyVendors: [], inHouseOnly: false }` |
| `accounts` | User-declared accounts only: `{ vendor, team, billing, plan, cycle, resets, expires, weight, declared, note }`. `billing`: `subscription`, `prepaid`, `metered`, `free`; `declared` is a date; `weight` > 0 (default 1) |
| `accountQuota` | Per-account quota ledger: `{ state, checked, resets, expires, remaining, source, note }`. `remaining` is 0–100 if present ([quota.md](quota.md)) |
| `seats` | In-house seats: `{ team, vendor, model, effort, tier, note }`. `tier`: `top`, `high`, `mid`, `low`; `model` and `effort` required |
| `hosts` | Per-host plans keyed by host id: `name`, `scenario` (`vendor-native`, `harness`, `open-router`, `bot`, `unknown`), `kind` (`vendor-native`, `multi-vendor`, `unknown`), `route` (`acp-liaison`, `host-switch`, `none`), `confirmed`, `home` (vendor list), `capabilities`, `serves` (per team: `strategy` in `primary-backup`/`spread`/`fixed`, `accounts: [{ account, instance }]`, `options`, `models`), `roles` (seat ids, resource ids, or `auto:<top|high|mid|low>[:<effort>]`), `routing`, `profile`, `constraints`, `overlay` |
| `resources` | External resources keyed by id: `team`, `channel`, `model`, `effort` (always pinned), `tier`, `roles` (`bulk`, `homogeneous`, `bounded`, `code-sync`, `review`, `sensitive-review`, or custom), `mayEdit`, `fallback` (ending in `in-house:<tier>:<effort>`), `windows`, optional `account` (pins a declared account), optional `cost` (`free`, `included`, `metered`) |
| `routing` | Per role, an explicit ordered list of resource ids; without one, declaration order |
| `schedules` | Time-based rules: within a window (`when`), `prefer` or `avoid` resources, optionally for listed `roles`; `until` ends a rule |
| `quota` | Per-resource quota ledger: `state`, `checked`, `resets`, `expires`, `source`, `note` ([quota.md](quota.md)) |
| `review` | `lastReviewed` and `everyDays` (model review notice, default 7), plus `preferences: { everyDays, lastConfirmed, lastAsked, snoozeUntil }` (Keep / Adjust / Later check, default 30) |
| `timezone` | IANA zone for windows and usage buckets; the system zone when unset |

Reference checks (unknown account in `serves` or `resources`, unknown seat or resource in `hosts.<id>.roles`) emit `configWarnings` rather than failing read commands; `plan check` treats them as errors in a draft. `needsInit` is `true` only when there are no `resources`, no `hosts`, and no `seats` (an approved zero-worker host plan is still a plan).

**Time windows ("time-sliced use").** Typical uses: a company plan usable on weekdays only; an off-peak price at night (`prefer` the discounted model 00:00–08:00); credits that expire (`prefer ... until=2026-11-30`); a channel kept free during working hours (`avoid` 09:00–19:00). Days are the days a window starts on: `fri 22:00-08:00` covers Friday night until Saturday 08:00. Times carry an offset (`2026-11-30T19:00+08:00`); a date alone (`until=2026-11-30`, `--resets 2026-12-01`, `--expires 2026-11-30`) is a whole local day in the window's or the plan's zone.

## Commands

### Session start and inspection

- `start [--root <dir>] [--host <id>] [--runtime <id>] [--session <key>] [--served <file>] [--at <time>]` — run once per session instead of `show`. Never writes `compute.json`; updates `compute-state.json` (`lastHost`, `sessions[key]`). Computes `change` (`unknown`, `new`, `changed`, `runtime-changed`, `served-changed`, `same`) from current evidence, loads that host's effective plan and profile, and returns `host`, `session`, `profile`, `constraints`, `review` (`models` and `preferences`), `ranking`, `harnessOverlays`, `ask[]` (ordered: `host-scenario`, `host-served-changed`, `preferences-review`, `unsaved-overrides`, `repeat-override`, `account-expiry`, `profile-until-passed`), and `say[]`.
- `show [--root <dir>] [--at <time>] [--host <id>] [--session <key>]` — read-only inspection (no state write). Reports `rev`, `profile`, `constraints`, `accounts`, `accountQuota`, `seats`, `profiles`, `hosts`, `effectiveHost` (with `--host`), and `harnessOverlays` (`superseded: true` when `hosts[overlay.host].serves` exists).
- `resolve --role <r> [--host <id>] [--session <key>] [--profile <name>] [--count <n>] [--at <time>]` — resolves candidates for `<r>`. Resolves in-house `hosts[H].roles[r]` entries (seats and `auto:<tier>[:<effort>]`), expands served resources across declared `serves.<team>.accounts` with `route`, `account`, `instance`, `hostModel` and `options`, applies home-vendor, constraint and quota exclusions, orders by the active profile, and with `--count <n>` (1–50) returns `assignments` ([profiles.md](profiles.md)).

### Writing and managing the plan

```bash
# Profiles
node scripts/compute-config.mjs profile list
node scripts/compute-config.mjs profile use frugal --scope session --session <key>
node scripts/compute-config.mjs profile define night --extends load-balance --parallelism max --note "off-peak" --scope global

# User-declared accounts and account quota
node scripts/compute-config.mjs account set acct-primary --scope global --vendor openai --team codex --billing subscription --plan pro --cycle "weekly mon 09:00" --weight 2
node scripts/compute-config.mjs account quota acct-primary --state ok --remaining 40 --source user
node scripts/compute-config.mjs account remove acct-primary --scope global

# In-house seats and per-host plans
node scripts/compute-config.mjs seat set seat-top --scope global --team claude --vendor anthropic --model claude-fable-5-2 --effort high --tier top
node scripts/compute-config.mjs seat remove seat-top --scope global
node scripts/compute-config.mjs host set t3-code --scope global --from host-draft.json
node scripts/compute-config.mjs host show t3-code
node scripts/compute-config.mjs host remove t3-code --scope global

# Resources, routing, schedules (support --scope session --session <key> as well as project/global)
node scripts/compute-config.mjs set agy-flash --scope global --team agy --channel agy-acp-run.mjs \
  --model gemini-3.8-flash --effort high --tier external-fast --roles bulk \
  --fallback opencode-fast,in-house:mid:medium
node scripts/compute-config.mjs schedule add night-discount --scope global \
  --when "00:00-08:00 tz=Asia/Shanghai" --prefer opencode-fast --roles bulk
node scripts/compute-config.mjs route review codex-strong,opencode-strong --scope project

# Session promotion and review cadence
node scripts/compute-config.mjs promote --session <key> --scope project --all
node scripts/compute-config.mjs promote --session <key> --decline --what "profile use frugal"
node scripts/compute-config.mjs reviewed --scope global --what models
node scripts/compute-config.mjs reviewed --scope global --what preferences --decision keep
node scripts/compute-config.mjs reviewed --scope global --what preferences --decision later --snooze-days 3
```

`host set <id> --scope project|global` accepts either `--from <file.json>` or inline flags (`--name`, `--scenario`, `--kind`, `--route`, `--home a,b`, `--confirmed <date>`). `--scope session` requires `--session <key>` (exit 1 otherwise).

### Drafts, rendering and migration

- `plan check --from <file> [--host <id>]` — validates a full or partial `compute.json` draft. Returns `{ ok, errors, warnings }`; exits `3` on errors (schema errors, missing `effort` on a resource or seat, undeclared account, unknown ids in routing or host roles, home-vendor resource on a non-`in-house-*` route). Warns when a fallback chain never reaches an `in-house:` entry or when every review candidate shares a vendor with every edit candidate.
- `plan render [--from <file>] [--host <id>] [--session <key>]` — returns `{ ok, markdown }`, a Markdown table (`Role | Candidate | Model · effort | Route | Account → instance | Fallback`) from a draft or the effective plan.
- `plan apply --from <file> --scope project|global` — keyed merge into that scope's `compute.json`, stamps `rev: 2`, validates, and reports `{ ok, scope, file, changed }`.
- `migrate --dry-run [--root <dir>]` — read-only report of `rev`, `overlaysWithoutHost`, `inHouseRoutingRoles`, `policyCostPreference` (from `- Cost preference:` in `AGENTS.md` / `CLAUDE.md`) and `legacyProfile`. Running `migrate` without `--dry-run` exits `1` and points to `plan apply` after user confirmation.

## Initialization and session-start cadence

- **Planning interview** (`needsInit: true` or a new/unknown host): follow [profiles.md](profiles.md), "The planning interview" — gather facts, draft up to three variants with a high-tier model, validate with `plan check`, render with `plan render`, ask one pre-filled dialog of at most five questions, then apply with `plan apply`.
- **After that: decide, tell, proceed.** Route by `resolve --role <role> --host <id>` without asking (still check confidentiality and the outsourcing gate yourself; `resolve` knows neither). Model or ordering changes you make on your own judgement are announced in one line and applied unless the user objects; `fixed` policy rows in `AGENTS.md` are never upgraded silently ([project-setup.md](project-setup.md)).
- **Two cadences, one dialog per session (never mid-task):**
  - **Model review notice (every 7 days by default)**: when `start` reports `review.models.due`, refresh the ranking, compare against channel model lists, drop outdated models, add well-ranked new ones, post one short notice of the updated table and what changed, write the changes to the plan's scope, run `reviewed --scope <S> --what models`, and proceed unless the user objects.
  - **Preferences check (every 30 days by default)**: when `start` emits `preferences-review`, merge it into the session's start-up dialog (Keep / Adjust / Later) and record the answer with `reviewed --scope <S> --what preferences --decision keep|adjust|later [--snooze-days <n>] [--every-days <n>]`.

## When the user changes it

Overrides default to **session scope** (`--scope session --session <key>`). Ask once whether to keep the change (`session`, `project`, or `global`) unless the user's words settle it; silence never promotes ([user-overrides.md](user-overrides.md)).

| Answer | Action |
|---|---|
| this session *(default)* | keep in `compute-state.json` (`--scope session --session <key>`); if declining a prompt, run `promote --session <key> --decline --all` |
| this project | write `--scope project`, or promote an existing session override with `promote --session <key> --scope project --all` |
| globally | write `--scope global`, or promote with `promote --session <key> --scope global --all` |

Running jobs keep their team; queued ones are re-routed ([user-overrides.md](user-overrides.md), "Which work it touches").

## Usage log and quality

After every external job, the layer that accepted or rejected it records the outcome:

```bash
node scripts/compute-config.mjs record <id> --outcome accepted|rework|in-house|quota|failed|cancelled \
  --task T4.b [--host <host-id>] [--account <acct-id>] [--instance <inst-id>] [--session <key>] \
  [--minutes n] [--tokens-in n] [--tokens-out n] [--cost usd]
```

Old usage lines without the new optional fields stay readable. `usage [--since-days 30]` summarizes per resource: jobs, outcomes, first-pass rate, time, tokens, cost, jobs per day and per hour of day.

- `qualityFlag` appears after two content failures in a row or a job taken back in-house: the next job goes to a stronger model or another team ([external-teams.md](external-teams.md), "Quality of a channel"). Only `accepted`, `rework` and `in-house` count as content; `quota`, `failed` and `cancelled` are availability.
- The log is global by default, so it spans projects; each line carries the project directory's name. `--scope project` keeps a project's log apart.

## Choosing models: ranking and updates

Model names go stale within months, and a new model is often out before the user's CLI can select it.

1. **Refresh the ranking** when `start` or `show` reports `ranking.stale` (older than 30 days or missing), at initialization, and at each model review: `node scripts/model-roster.mjs --arena --save`. It combines OpenRouter's price list with LMArena's Code Arena leaderboard (performance on coding, no key needed) and saves `model-ranking.json` globally. When the arena cannot be read, the price list still prints (exit 3): look up a current coding leaderboard by web search and say which source and date you used ([model-tiers.md](model-tiers.md), "Finding the current model line-up").
2. **Compare with what each channel offers**: write each channel's model list to a file (`agy models`, Codex's `models_cache.json` ids from the doctor, `opencode-acp-run.mjs probe`) and run `check-models --available codex=<file> --available agy=<file>`.
   - `newer`: the channel already offers a newer model of the same family than the plan uses. Decide, tell, proceed (above).
   - `missing`: a ranked model of the team's vendor that the channel does not list. Usually the CLI is out of date. Tell the user, with the update command from `updateHint`, and ask whether to run it for them; updating a global tool needs their yes. A vendor may also simply not offer that model on this channel yet: say so rather than promising the update fixes it. `variants` lists ranked ids that extend a model the channel offers (for example a `-pro` API variant); they are not a reason to update.
3. Re-run `doctor.mjs` after an update and record the new model in the plan with a notice.
