# Quota: watching it, switching, and coming back

External channels run on quota: a subscription window that refills on a schedule, prepaid credits with an expiry date, or a per-model allowance inside one channel. Quota belongs to a **channel · model** pair, not to a team: one model on a channel can be used up while its other models still work. This page is the procedure behind "External teams and the liaison" in [SKILL.md](../SKILL.md): keep an eye on consumption, switch when something runs out, note when it comes back, and let the user steer which quota is spent first. Scope rules for the user's instructions: [user-overrides.md](user-overrides.md).

## The quota ledger

Keep one small table for the session, in the board's `progress.md` under "Channel quota" ([team-board.md](team-board.md)), or in the director's working notes when no board is open. It is state, not policy: it never goes into `AGENTS.md`.

| Channel · model | State | Checked | Resets | Source | Substitute |
|---|---|---|---|---|---|
| Codex CLI · strong model | exhausted | 2026-11-11 14:20 +08:00 | 2026-11-11 19:00 +08:00 | error text | OpenCode · strong model, then in-house mid · high |
| agy · flash | plenty, spend first | 2026-11-11 09:00 +08:00 | weekly, Monday | user | OpenCode · fast model |
| OpenCode · fast model | unknown | — | — | — | in-house mid · medium |

- **State**: `plenty`, `ok`, `low`, `exhausted` or `unknown`. A number is better when you have one ("about 30% of the weekly window left").
- **Resets**: an absolute time with its zone. Convert "in 3 hours" or "resets at 7pm" when you record it; a relative time is useless to the next session. Write `unknown` rather than a guess.
- **Source**: the channel's own error or usage output, the user, or an estimate. Only the first two count as known.

## Watching consumption

Check at four moments, cheapest source first; never spend a job only to measure quota.

1. **Session start.** With the question about which teams may take work, ask what the user knows: which channel is nearly out, which has plenty, when each resets ("Asking the user", below). Carry forward ledger rows from the last session whose reset time has not passed.
2. **Before each batch of dispatches.** Read the ledger. A batch that would not fit what is left on a `low` channel goes to the substitute as a whole, or is split at a clean boundary; do not start a job that is likely to die half-way.
3. **When a job returns.** The liaison reports every quota signal it saw: usage figures the runner exposes, rate-limit or retry warnings in the result or the log, and any "resets at" text, quoted exactly. The layer above updates the ledger. Several throttling warnings in a row mean `low`, even when the job succeeded.
4. **When a job fails on quota.** See "When a channel · model runs out".

Sources, in order: what the job result and log already contain; the channel's own usage or status command where it has a headless one; the user, who can see a dashboard or an interactive status view the agent cannot. Which command each tool offers changes between versions and is *unverified* here: check the tool's help, and record what worked in the roster row. When nothing reports a number, the state is `unknown`; say so instead of assuming plenty.

## When a channel · model runs out

Exhaustion is an availability failure, not a quality one: it does not count against the team ([external-teams.md](external-teams.md), "Quality of a channel"), and it is an exception to "rework goes to the same agent": the rest of the job moves to the substitute.

1. **The liaison stops and reports**: the error text, the reset time if the channel gave one, the job's state and ids, and the partial diff against the lease. It does not retry, wait for the reset, or switch on its own.
2. **Record it** in the ledger: state `exhausted`, the reset time or `unknown`.
3. **Settle the partial work.** The layer above, never the liaison, keeps for review what passes the acceptance checks, has the rest reverted inside the lease, and writes the remaining scope as a fresh brief that states what is already done. Kept work still gets its independent review. Do not resume the dead conversation on another channel.
4. **Pick the substitute** down this ladder, staying in the job's tier, and say the switch in one line on the card ("Codex strong model exhausted until 19:00; T4.b goes to OpenCode `<model>` · high"):

| Step | Substitute | Notes |
|---|---|---|
| 1 | The same-tier model on **another allowed channel** | The agreed substitute order decides which. Still another vendor than in-house, and its confidentiality level must cover the job ([confidentiality.md](confidentiality.md)). |
| 2 | Another model of the same tier on the same channel, when it has its own allowance | A drop below the job's tier is not a ladder step: state it, and use it only for work the weaker model can carry. |
| 3 | **In-house**, when every allowed external option for that tier is out | The table below. The flow changes from `outsource` to `direct`; no liaison is needed. |

In-house substitutes for an external tier:

| External tier | In-house substitute |
|---|---|
| external-fast | low tier for purely mechanical edits with a checkable result; otherwise mid tier · medium |
| external-strong | mid tier · medium, or mid tier · high for work that needs reading code to get right |
| read-only second opinion | none: an in-house review is not another vendor's opinion. Keep the independent in-house senior review and record the missing external opinion on the card; ask the user whether to wait for the reset when the work is money, auth, schema or irreversible data |

Ask the user before switching only when no agreed substitute exists and the switch would widen the session's roster, or when coming in-house would strain the in-house quota the director itself depends on. Under continuous authorization, do not stop to ask: follow the ladder, record the switch, and put the question in the end-of-task list. The ladder never leaves the teams allowed this session; with none of them left, the work comes in-house.

## Coming back

- When a recorded reset time has passed, treat the channel · model as presumed available: the next suitable dispatch may return to it, and that job doubles as the probe. If it fails on quota again, record the new reset time and do not try again before it.
- When the reset time is `unknown`, ask the user once, together with any other pending question; until they answer, keep the channel out for the rest of the session.
- Do not poll, schedule wake-ups or hold work back waiting for a reset unless the user asks for that. Work continues on the substitute; jobs already running there finish there.
- At session end, leave the ledger rows that still matter (exhausted with a future reset, credit expiry dates, a lasting spend-first rule's source) in `progress.md`, so the next session starts from them.

## Spending a channel first

Sometimes the aim is the opposite: a channel has plenty left, or credits that expire soon, and the user wants that quota used before the others.

- A spend-first or spare preference changes the **order among teams that fit the job**. It does not send work out that fails the outsourcing gate, does not drop a job below its tier without saying so, and does not replace an in-house review. Once the user has chosen spend-first, plenty of quota lowers the cost side of the gate's fourth criterion, and nothing else.
- The director does not decide on its own to burn a quota because the ledger says `plenty`; it asks, or follows a recorded rule.
- Scope decides where it is written ([user-overrides.md](user-overrides.md), "How long an instruction lasts"): for this session, the ledger and the session choice line; lasting, the `External order:` line in `AGENTS.md` with its date and a `lessons.md` row, as for any lasting instruction; until a date or "while the credits last", lasting with the end condition, removed and marked overturned when it expires.

## Asking the user

Ask once, with the session-start question about teams, and only what is not already recorded:

1. "Is any channel or model nearly out, and when does it reset?"
2. "Is there one you want spent first (plenty left, or credits about to expire), or one to spare?"
3. "If X runs out, use Y, then in-house?" (the substitute order)
4. "Is that for this session, or should I write it into the project policy?" When the answer is unclear, it is session scope.

Skip the questions in a non-interactive run or when the policy and the ledger already answer them, and state what you are using in one line. Ask again mid-run only when a channel runs out with no agreed substitute, a reset time is unknown, or the ledger shows a large surplus the user has not spoken about and a bulk task is about to be routed; batch it with other questions when the user has authorized continuous work.
