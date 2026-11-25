# Quota: watching it, switching, and coming back

Detail behind the quota paragraph in "Start" and "Channels and fallbacks" in [SKILL.md](../SKILL.md). External channels run on quota: a subscription window that refills on a schedule, prepaid credits with an expiry date, or a per-model allowance. Quota belongs to a **channel · model** pair or a **user-declared account**: one model or account can be used up while others still work.

## Keep a ledger (`quota` and `accountQuota`)

Quota belongs to the account, so both ledgers live in the global compute plan, `~/.subagent-team/compute.json` ([compute-plan.md](compute-plan.md)):

- **Resource quota (`quota`)**: `compute-config.mjs quota <resource-id> --state exhausted --resets <time> --source "error text"`
- **Account quota (`accountQuota`)**: `compute-config.mjs account quota <account-id> --state low --remaining 15 --resets <time> --source user` (global by default; `--scope project` only for a project-only allowance)

Never copy quota state into the project policy, a progress record or agent memory. As a table:

| Resource or account | State | Remaining | Checked | Resets | Source | Substitute |
|---|---|---|---|---|---|---|
| Codex CLI · strong model | exhausted | — | 2026-11-11 14:20 +08:00 | 2026-11-11 19:00 +08:00 | error text | OpenCode · strong model, then in-house |
| Declared account (`codex-primary`) | low | 15% | 2026-11-11 10:00 +09:00 | 2026-11-12 09:00 +09:00 | user | Secondary declared account (if allowed), else fallback |

State is `plenty`, `ok`, `low`, `exhausted` or `unknown`; `accountQuota` also accepts `--remaining <0-100>`. Reset times are absolute, with a zone; convert "in 3 hours" when you write it down, and write `unknown` rather than a guess.

## Where the signals come from

1. **The job itself**: usage or cost figures in the wrapper's `summary.json` when the runner exposes them, rate-limit or retry warnings in the result or log, and the error text of a failed job, which often carries the reset time. Read these after every job; several throttling warnings in a row mean `low` even when the job succeeded.
2. **The channel's own usage or status view.** Whether a tool offers one headless differs by tool and version and is *unverified* here: check its help, and note what worked.
3. **The user**, who can see dashboards and interactive status views the agent cannot. Ask at session start (`compute-config.mjs start` surfaces accounts or quotas expiring within 3 days), and again when a reset time is unknown.

Never spend a job only to measure quota, and read the ledgers via `compute-config.mjs resolve --role <r> --host <id>` before each batch: `resolve` excludes exhausted or undeclared accounts, and a batch that will not fit on a `low` channel goes to the substitute (or gets at most one job under `load-balance`).

## When a channel · model or account runs out

Quota exhaustion is availability, not quality; it does not count toward "two failed rounds".

1. Whoever tracks the job stops it there: no retry, no waiting for the reset. A liaison reports the error text, the reset time if given, job ids and the partial diff, and never switches on its own; the layer that assigned the job does steps 2 and 3.
2. Record it in `quota` or `accountQuota` and log the job with `record <id> --outcome quota [--host <id>] [--account <acct>] [--instance <inst>]`. Keep for review the partial work that passes the acceptance checks, revert the rest inside the lease, and write the remaining scope as a fresh brief that says what is already done. Do not resume the dead conversation on another channel.
3. Switch, staying in the job's tier, and say it in one line on the job's record:
   - another **user-declared account** for the same served team, when listed in `accounts` and `hosts.<id>.serves.<team>.accounts` under `primary-backup` or `spread` (never under `fixed`, and never an undeclared account);
   - then the same-tier model on **another allowed channel** (the table in "Channels and fallbacks", "Team unavailable");
   - then another same-tier model on the same channel when it has its own allowance (a drop below the job's tier is not a ladder step: state it, and use it only for work the weaker model can carry);
   - never discover credentials, sign in, or rotate accounts on your own to get round a limit, and never route through a proxy that pools accounts ([compliance.md](compliance.md));
   - then **in-house**, once every allowed external option for that tier is out: a cheap in-house model for purely mechanical work, the in-house mid tier otherwise.
4. A read-only second opinion has no in-house substitute: an in-house review is not another vendor's opinion. Keep the in-house senior review, record the missing external opinion, and for money, auth, schema or irreversible-data work ask the user whether to wait for the reset.

Ask the user before switching only when no substitute was agreed and the switch would add a team they did not allow. In an unattended run, follow the ladder, record the switch and report it at the end. The ladder never leaves the teams the user allowed; with none of them left, the work comes in-house.

## Coming back

Once a recorded reset time has passed, the next suitable job may go back to that channel · model or declared account and doubles as the probe; if it fails on quota again, record the new time. With no reset time, ask the user once and keep the channel or account out until they answer. Do not poll or hold work waiting for a reset unless the user asks; jobs already running on the substitute finish there. The ledger file outlives the session, so the next session starts from it; record every quota event there as it happens, and log the job with outcome `quota`.

## Spending a channel first and spreading across declared accounts

When a channel or declared account has plenty left, or credits that expire soon, the user may want it used before the others, or may authorize spreading batch jobs across multiple declared accounts (`load-balance` profile or `spread` strategy in `subagent-team`). That is always the user's choice: ask, do not infer it from a full ledger. A spend-first or `load-balance` preference reorders candidates that fit the job; it never sends out work that fails the gate, never drops a job below its tier silently, and never replaces a review. Overrides default to session scope (`--scope session --session <key>`); lasting rules go to project or global `compute.json` via `profile use` (with optional `--until`), `schedule add` (with `until=`), or `quota` / `account quota` (`--expires`). Plenty of free quota is no reason to send a private repository to a model the user has not cleared for it ([roster-and-verification.md](roster-and-verification.md), "How far each team is trusted").
