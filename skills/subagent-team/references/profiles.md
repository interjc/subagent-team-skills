# Profiles: how much to spend, and how

A **profile** sets the spending and throughput posture across the team: how aggressively to parallelize, how to order candidates, and how to use declared accounts. **Constraints** filter which vendors or routes are allowed at all. This page works with [compute-config.md](compute-config.md), [scenarios.md](scenarios.md), [quota.md](quota.md) and [user-overrides.md](user-overrides.md). Back to [SKILL.md](../SKILL.md).

## Built-in profiles

One profile is active at a time (`profile.active` in `compute.json`, overridden per host or per session). `balanced` is the default.

| Profile | In-house seats | Parallelism | Outsourcing gate test 4 | Account strategy | On exhaustion |
|---|---|---|---|---|---|
| `performance` | Prefer flagship seats (`top`/`high`) where judgment matters | `max` | Strict: outsource only when external clearly wins on speed or independence | `fixed` (accounts in declared list order) | Step to next strong same-tier candidate, then the in-house substitute |
| `balanced` *(default)* | Standard tier table (`mid` for specified work, `high` for risky/design) | `normal` | Standard: bulk or bounded unit large enough to amortize start-up | Per `hosts.<id>.serves.<team>.strategy` (`primary-backup` by default) | Follow fallback chain, then in-house substitute |
| `frugal` | Prefer `mid`/`low` seats for routine work; `top` only for principal expert | `low` | Standard; among fitting candidates, `free`/`included` channels come first | Per host strategy; candidates sorted by cost rank first | Fall back to the next cheapest fitting candidate, then the in-house substitute |
| `load-balance` | Standard tier table | `normal` | Standard | `spread` across declared accounts by bucket and weight | Skip exhausted account immediately; keep remaining accounts and fallbacks working |

All profiles share the preferences check (every 30 days by default). The table describes intent; the exact ordering `resolve` applies is below, and risk floors never move.

### Candidate ordering in `compute-config.mjs resolve`

After excluding ineligible candidates (windows, `mayEdit`, home-vendor rule, constraints, exhausted or undeclared accounts), `resolve` orders the remaining candidates by the effective profile (a custom profile uses its base profile's ordering):

- **`balanced`**: configured routing / declaration order; `parallel: "normal"`.
- **`performance`**: configured order with accounts in list order (strategy treated as `fixed`); `parallel: "max"`.
- **`frugal`**: the role's own candidates first (out-of-role fallbacks after them), then stable sort by cost rank (`free` = 0, `included` = 1, `unknown` = 2, `metered` = 3; cost taken from `resource.cost`, else inferred from the account's `billing`: `subscription` → `included`, `free` → `free`, `prepaid`/`metered` → `metered`, else `unknown`), then `external-fast` before `external-strong`, then existing order; `parallel: "low"`.
- **`load-balance`**: the role's own candidates first, then stable sort by quota bucket, then existing order; `parallel: "normal"`. Buckets:
  - `0`: account (or resource quota) has `expires` within 3 days and not yet passed;
  - `1`: state `plenty`;
  - `2`: state `ok`, `unknown`, or no quota record;
  - `3`: state `low`.

## Constraints

Constraints are orthogonal filters stored in `constraints` (top-level, per host in `hosts.<id>.constraints`, or in a session patch):

- `onlyVendors`: non-empty list restricts candidates to those vendors (`denied by constraint` otherwise).
- `denyVendors`: excludes those vendors (`denied by constraint`).
- `inHouseOnly`: boolean; when `true`, excludes every external resource (`in-house only`).

**Narrowing merge rule.** Merging global → project → host → session can only restrict, never widen: `denyVendors` takes the union, `onlyVendors` takes the intersection when both sides are non-empty (else the non-empty side), and `inHouseOnly` takes logical OR.

## Custom profiles and legacy mapping

Define a custom profile in `compute.json` under `profiles.<name>` extending a built-in (or another custom profile; cycles are an error), optionally overriding `parallelism` (`max`, `normal`, `low`) and `note`:

```bash
node scripts/compute-config.mjs profile list
node scripts/compute-config.mjs profile define night-batch --extends load-balance --parallelism max --note "off-peak batch runs" --scope global
node scripts/compute-config.mjs profile use frugal --scope session --session <key>
node scripts/compute-config.mjs profile use performance --scope project --until 2026-12-01
```

`resolve` and `start` report the active profile's source as `default`, `global`, `project`, `host`, or `session`.

**Legacy `Cost preference:` mapping.** Older `AGENTS.md` / `CLAUDE.md` policies carry a `- Cost preference:` line. It maps to built-in profiles as:

| Legacy `Cost preference:` | Profile |
|---|---|
| `economize` | `frugal` |
| `balanced` | `balanced` |
| `max-quality` | `performance` |

Run `node scripts/compute-config.mjs migrate --dry-run --root <project root>` to inspect a legacy policy (and any unmigrated overlays or `in-house-*` routing roles) without writing anything.

## Load-balance rule (`--count` and weights)

When dispatching a batch of `n` independent jobs (1–50), pass `--count <n>` to `resolve`:

```bash
node scripts/compute-config.mjs resolve --role bulk --host <host-id> --count 6
```

It returns `assignments: [{ job, id, account, instance }]`:

- Under **`load-balance`**, jobs are assigned greedily: each job picks the candidate minimizing `(bucket, (assigned + 1) / weight, index)`, where `weight` comes from `accounts.<id>.weight` (positive number, default `1`). A bucket-3 (`low`) candidate takes **at most one job** so a nearly depleted account is not drained by a whole batch. Out-of-role fallbacks take jobs only when no in-role candidate is left, so `pick` and the first assignment always agree.
- Under all other profiles, every job in the batch goes to `pick`.

Only user-declared accounts appear in `assignments`; the agent never discovers credentials, signs in, or rotates accounts on its own ([quota.md](quota.md)).

## Risk floors never move

A profile adjusts cost, speed and batch ordering. It **never** lowers a safety floor ([user-overrides.md](user-overrides.md), "Defaults and floors"):

- Business logic in billing, payment, auth, migrations and irreversible data stays in-house even under `frugal`.
- Senior review of sensitive changes remains `high` or `top` tier at `high` effort on a model other than the author's, paired with another vendor's read-only second opinion when authorized.
- Only the user's own explicit words override a floor, with its required compensation.

## The planning interview

When `compute-config.mjs start` reports `needsInit: true` (no resources, no hosts and no seats) or a new/unknown host needs a plan, run one planning interview — never split it across several turns mid-task:

1. **Gather facts**: run `compute-config.mjs start`, `cli-agent-delegation`'s `doctor.mjs` and channel probes, a fresh ranking (`model-roster.mjs --arena --save` when stale or missing), `compute-config.mjs usage`, and existing quota records.
2. **Draft up to three variants** using a **high-tier** model: the director drafts directly when it is high tier, or calls an L2 `consult` when the director runs below high tier. On a bot host without subagents, the bot drafts itself and says so.
   - Pick the **recommended profile from evidence**:
     - Two or more declared accounts of one vendor, or credits expiring within 14 days → `load-balance`
     - Only `metered` billing across declared accounts/channels → `frugal`
     - Legacy `Cost preference: max-quality` or the user's explicit request for top quality → `performance`
     - Otherwise → `balanced`
3. **Validate and render**: run `compute-config.mjs plan check --from <draft.json> [--host <id>]` (fix every error; exit 3 means invalid draft) and `compute-config.mjs plan render --from <draft.json> [--host <id>]` to get the role table (`Role | Candidate | Model · effort | Route | Account → instance | Fallback`).
4. **Ask one dialog of at most five pre-filled questions** (skip Q0 when the host is already known):
   - **Q0 (new/unknown host only)**: Scenario — *"Where does this session run?"* (`host-scenario`, pre-selected from evidence).
   - **Q1**: Profile — confirm the recommended profile (and any constraints such as `onlyVendors`, `denyVendors`, `inHouseOnly`).
   - **Q2**: Accounts — for each vendor/team the user wants to use: billing tier/plan, reset cycle, any expiry date, primary account, and *"may work be spread across your accounts of `<vendor>`?"* (only accounts the user explicitly declares and signed into).
   - **Q3**: Role table — show the table from `plan render` for confirmation or edits.
   - **Q4**: Persistence and cadence — where to keep the plan (`session`, `project` or `global`) and how often to run the preferences check (default every 30 days).
5. **Apply**: on confirmation, run `compute-config.mjs plan apply --from <draft.json> --scope project|global` `plan apply` takes only `project` or `global`. When the user wants the plan for this session only, or in a non-interactive run, do not run `plan apply`: apply the draft piece by piece with `set`, `route`, `schedule add` and `profile use` using `--scope session --session <key>`, and list the pending confirmation in the end-of-task grill-me list.

## Lifecycle and cadence

- **Session default.** Any mid-session override (`set`, `route`, `schedule add`, `profile use`) defaults to `--scope session --session <key>`, writing to `compute-state.json`. Ask once whether to keep it (`session` / `project` / `global`); silence never promotes ([user-overrides.md](user-overrides.md)).
- **Promotion and carry-over.** Use `compute-config.mjs promote --session <key> --scope project|global --all` (or `--what "<note>"` for one override) to make a session override lasting, or `--decline` to mark it session-only. Unasked notes from sessions older than 14 days move into `carryOver` and surface on the next `start` as `unsaved-overrides`; the same override appearing in two or more sessions surfaces as `repeat-override` (recommended `project`).
- **Two cadences**:
  - **Model review (7-day notice)**: `review.everyDays` (default 7). Refresh the ranking, update the line-up, post one short notice and continue unless the user objects; close with `reviewed --scope <S> --what models` ([compute-config.md](compute-config.md)).
  - **Preferences check (30-day Keep / Adjust / Later)**: `review.preferences.everyDays` (default 30). When `start` returns `preferences-review`, ask in the start-up dialog: **Keep** (recommended), **Adjust**, or **Later** (snooze 3 days by default). Record the answer with `compute-config.mjs reviewed --scope <S> --what preferences --decision keep|adjust|later [--snooze-days <n>] [--every-days <n>]`.
- **Event triggers** that also prompt at session start (never mid-task):
  - host is `new` or `changed` (or `served-changed`),
  - `profile.until` has passed (`profile-until-passed`),
  - an account or `accountQuota` expires within 3 days (`account-expiry`),
  - two quota exhaustions or quality flags within 7 days (a director judgment from the usage log and ledger, not an `ask[]` item: raise it in the preferences dialog).
- **One compute dialog per session, never mid-task.** The only exception is the one scope question in reply to the user's own instruction ([user-overrides.md](user-overrides.md)). Merge every `ask[]` item from `compute-config.mjs start` into the single start-up dialog, and keep work moving once confirmed.
