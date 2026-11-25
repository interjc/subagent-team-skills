# Quota: watching it, switching, and coming back

External channels run on quota: a subscription window that refills on a schedule, prepaid credits with an expiry date, or a per-model allowance inside one channel. Quota belongs to a **channel · model** pair or a **user-declared account**, not blindly to a whole team: one model or account can be used up while others still work. This page is the procedure behind "External teams and the liaison" in [SKILL.md](../SKILL.md): keep an eye on consumption, switch when something runs out, note when it comes back, and let the user steer which quota is spent first. Profiles and batch spreading are in [profiles.md](profiles.md); override scope rules are in [user-overrides.md](user-overrides.md).

## The quota ledgers (`quota` and `accountQuota`)

Quota belongs to the account, so both ledgers live in the **global compute file**, where every session and project on the machine sees them ([compute-config.md](compute-config.md)); `--scope project` only for an allowance that exists in one project alone. They are state, not policy: they never go into `AGENTS.md`, `progress.md` or agent memory. Without Node.js, edit the `quota` and `accountQuota` objects of `compute.json` by hand.

- **Per-resource quota (`quota`)**: tracks a single `resource` (channel · model) via `compute-config.mjs quota <resource-id> ...`.
- **Per-account quota (`accountQuota`)**: tracks a user-declared account in `accounts` (used by `hosts.<id>.serves` or pinned on `resources.<id>.account`) via `compute-config.mjs account quota <account-id> ...`. Supports an optional `--remaining <0-100>` percentage. When `hosts.<id>.serves` is present, `accountQuota` replaces the per-instance table in legacy `harness-<host id>.md` overlays ([host-harness.md](host-harness.md)).

```bash
node scripts/compute-config.mjs quota codex-strong --state exhausted --resets 2026-11-11T19:00+08:00 --source "error text"
node scripts/compute-config.mjs quota agy-flash --state plenty --expires 2026-11-30 --source user --note "spend first"
node scripts/compute-config.mjs account quota acct-primary --state low --remaining 15 --resets 2026-11-12T09:00+09:00 --source user
node scripts/compute-config.mjs start --root <project>    # surfaces account-expiry (<=3 days) in ask[] and quota notes
```

The ledger, shown as a table:

| Resource or account | State | Remaining | Checked | Resets | Source | Substitute |
|---|---|---|---|---|---|---|
| Codex CLI · strong model | exhausted | — | 2026-11-11 14:20 +08:00 | 2026-11-11 19:00 +08:00 | error text | OpenCode · strong model, then in-house mid · high |
| agy · flash | plenty, spend first | — | 2026-11-11 09:00 +08:00 | weekly, Monday | user | OpenCode · fast model |
| Declared account (`acct-primary`) | low | 15% | 2026-11-11 10:00 +09:00 | 2026-11-12 09:00 +09:00 | user | Secondary declared account (if allowed), else fallback |

- **State**: `plenty`, `ok`, `low`, `exhausted` or `unknown`. A `--remaining` percentage (0–100) is better when you have one.
- **Resets**: an absolute time with its zone. Convert "in 3 hours" or "resets at 7pm" when you record it; a relative time is useless to the next session. Write `unknown` rather than a guess.
- **Source**: the channel's own error or usage output, the user, or an estimate. Only the first two count as known.

## Watching consumption

Check at four moments, cheapest source first; never spend a job only to measure quota.

1. **Session start.** `compute-config.mjs start` reads both ledgers and emits `account-expiry` in `ask[]` when any account or `accountQuota` expires within 3 days (`show` also reports `quotaNotes`). On initialization, or when a row's reset time is unknown, ask what the user knows: which channel or account is nearly out, which has plenty, and when each resets ("Asking the user", below).
2. **Before each batch of dispatches.** Run `compute-config.mjs resolve --role <r> --host <id> [--count <n>]`. It excludes exhausted accounts (`account <id> exhausted until <t>`, or `account <id> exhausted, reset unknown: ask the user once`) and undeclared accounts (`account <id> undeclared`). A batch that would not fit what is left on a `low` channel goes to the substitute as a whole, or is split at a clean boundary (under `load-balance`, a `low` candidate receives at most one job per batch); do not start a job that is likely to die half-way.
3. **When a job returns.** The liaison (or child agent) reports every quota signal it saw: usage figures the runner exposes, rate-limit or retry warnings in the result or the log, and any "resets at" text, quoted exactly. The layer above updates `quota` or `accountQuota`. Several throttling warnings in a row mean `low`, even when the job succeeded.
4. **When a job fails on quota.** See "When a channel · model or account runs out".

Sources, in order: what the job result and log already contain; the channel's own usage or status command where it has a headless one; the user, who can see a dashboard or an interactive status view the agent cannot. Which command each tool offers changes between versions and is *unverified* here: check the tool's help, and record what worked in the roster row. When nothing reports a number, the state is `unknown`; say so instead of assuming plenty.

## When a channel · model or account runs out

Exhaustion is an availability failure, not a quality one: it does not count against the team ([external-teams.md](external-teams.md), "Quality of a channel"), and it is an exception to "rework goes to the same agent": the rest of the job moves to the substitute.

1. **The liaison stops and reports**: the error text, the reset time if the channel gave one, the job's state and ids, and the partial diff against the lease. It does not retry, wait for the reset, or switch on its own.
2. **Record it** in the ledger (`compute-config.mjs quota <id> --state exhausted --resets <time>` or `account quota <account-id> --state exhausted --resets <time>`), and log the job with `record <id> --outcome quota [--host <id>] [--account <acct>] [--instance <inst>]`.
3. **Settle the partial work.** The layer above, never the liaison, keeps for review what passes the acceptance checks, has the rest reverted inside the lease, and writes the remaining scope as a fresh brief that states what is already done. Kept work still gets its independent review. Do not resume the dead conversation on another channel.
4. **Pick the substitute** down this ladder, staying in the job's tier (`compute-config.mjs resolve --role <role> --host <id>` applies declared account expansion, the fallback chain and both quota ledgers for you), and say the switch in one line on the card ("Codex strong model exhausted until 19:00; T4.b goes to OpenCode `<model>` · high"):

| Step | Substitute | Notes |
|---|---|---|
| 1 | Another **user-declared account** for the same served team, when the user's rule allows it | Listed in `accounts` and `hosts.<id>.serves.<team>.accounts` under `primary-backup` or `spread` (never under `fixed`, and never an undeclared account). |
| 2 | The same-tier model on **another allowed channel** | The resource's `fallback` chain in the compute plan decides which. Still another vendor than in-house, and its confidentiality level must cover the job ([confidentiality.md](confidentiality.md)). |
| 3 | Another model of the same tier on the same channel, when it has its own allowance | A drop below the job's tier is not a ladder step: state it, and use it only for work the weaker model can carry. |
| 4 | **In-house**, when every allowed external option for that tier is out | The table below. The flow changes from `outsource` to `direct`; no liaison is needed. |

**Accounts are user-declared only.** The agent uses only accounts the user explicitly listed in `accounts` and signed into, following the strategy (`primary-backup`, `spread`, or `fixed`) and profile the user chose. Never discover credentials, sign in, rotate accounts on your own to dodge a limit, or route through an account-pooling proxy (`cli-agent-delegation`, `references/compliance.md`). Spreading work across two or more accounts the user explicitly declared and authorized ("may work be spread across your accounts of `<vendor>`?" in the planning interview, [profiles.md](profiles.md)) is valid under `spread` or the `load-balance` profile; undeclared accounts are always excluded.

In-house substitutes for an external tier:

| External tier | In-house substitute |
|---|---|
| external-fast | low tier for purely mechanical edits with a checkable result; otherwise mid tier · medium |
| external-strong | mid tier · medium, or mid tier · high for work that needs reading code to get right |
| read-only second opinion | none: an in-house review is not another vendor's opinion. Keep the independent in-house senior review and record the missing external opinion on the card; ask the user whether to wait for the reset when the work is money, auth, schema or irreversible data |

Ask the user before switching only when no agreed substitute exists and the switch would widen the session's roster, or when coming in-house would strain the in-house quota the director itself depends on. Under continuous authorization, do not stop to ask: follow the ladder, record the switch, and put the question in the end-of-task list. The ladder never leaves the teams allowed this session; with none of them left, the work comes in-house.

## Coming back

- When a recorded reset time has passed, treat the channel · model or declared account as presumed available: the next suitable dispatch may return to it, and that job doubles as the probe. If it fails on quota again, record the new reset time and do not try again before it.
- When the reset time is `unknown`, ask the user once, together with any other pending question; until they answer, keep the channel or account out for the rest of the session.
- Do not poll, schedule wake-ups or hold work back waiting for a reset unless the user asks for that. Work continues on the substitute; jobs already running there finish there.
- Both ledgers are already durable; at session end, make sure every quota event of the session was written to `quota` or `accountQuota`. Nothing about quota is copied into `progress.md`.

## Spending a channel first and spreading across declared accounts

Sometimes the aim is the opposite: a channel or account has plenty left, or credits that expire soon, and the user wants that quota used before the others, or wants batch work spread across multiple declared accounts.

- A spend-first preference or `load-balance` profile changes the **order among candidates that fit the job**. It does not send work out that fails the outsourcing gate, does not drop a job below its tier without saying so, and does not replace an in-house review. Once the user has chosen spend-first (or `load-balance` near expiry), plenty of quota lowers the cost side of the gate's fourth criterion, and nothing else.
- Under `load-balance`, `resolve --count <n>` prioritizes accounts or resources expiring within 3 days (bucket 0), then `plenty` (bucket 1), `ok`/`unknown` (bucket 2), and `low` (bucket 3, at most one job), weighted by `accounts.<id>.weight` ([profiles.md](profiles.md), "Load-balance rule (`--count` and weights)").
- The director does not decide on its own to burn a quota or spread across accounts because the ledger says `plenty`; it asks once or follows the user's recorded profile and strategy.
- Scope decides where a change is written ([user-overrides.md](user-overrides.md), "How long an instruction lasts"): session scope defaults to `compute-state.json` (`--scope session --session <key>`); lasting rules go to `compute.json` (`--scope project` or `--scope global`) via `profile use` (with optional `--until`), `schedule add` (with `until=`), or `quota` / `account quota` (`--expires`).

## Asking the user

Ask once, in the planning interview ([profiles.md](profiles.md)) or when `start` emits an expiry/quota question, and only what is not already recorded:

1. "Is any channel or declared account nearly out, and when does it reset?"
2. "Is there one you want spent first (plenty left, or credits about to expire), or one to spare? If you have several accounts of `<vendor>`, may work be spread across them?"
3. "If X runs out, use Y, then in-house?" (the fallback chain)
4. "Is that for this session, this project, or global?" Silence keeps it in session scope.

Skip these in a non-interactive run or when the plan and ledgers already answer them, and state what you are using in one line. Ask again mid-run only when a channel runs out with no fallback or a reset time is unknown; batch it with other questions when the user has authorized continuous work.
