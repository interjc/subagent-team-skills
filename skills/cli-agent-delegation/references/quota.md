# Quota: watching it, switching, and coming back

Detail behind the quota paragraph in "Start" and "Channels and fallbacks" in [SKILL.md](../SKILL.md). External channels run on quota: a subscription window that refills on a schedule, prepaid credits with an expiry date, or a per-model allowance. Quota belongs to a **channel · model** pair: one model can be used up while the channel's other models still work.

## Keep a ledger

One small table where the team keeps session state (a progress record or the main session's notes), never in the project policy:

| Channel · model | State | Checked | Resets | Source | Substitute |
|---|---|---|---|---|---|
| Codex CLI · strong model | exhausted | 2026-11-11 14:20 +08:00 | 2026-11-11 19:00 +08:00 | error text | OpenCode · strong model, then in-house |

State is `plenty`, `ok`, `low`, `exhausted` or `unknown`. Reset times are absolute, with a zone; convert "in 3 hours" when you write it down, and write `unknown` rather than a guess.

## Where the signals come from

1. **The job itself**: usage or cost figures in the wrapper's `summary.json` when the runner exposes them, rate-limit or retry warnings in the result or log, and the error text of a failed job, which often carries the reset time. Read these after every job; several throttling warnings in a row mean `low` even when the job succeeded.
2. **The channel's own usage or status view.** Whether a tool offers one headless differs by tool and version and is *unverified* here: check its help, and note what worked.
3. **The user**, who can see dashboards and interactive status views the agent cannot. Ask at session start, and again when a reset time is unknown.

Never spend a job only to measure quota, and read the ledger before each batch: a batch that will not fit on a `low` channel goes to the substitute as a whole.

## When a channel · model runs out

Quota exhaustion is availability, not quality; it does not count toward "two failed rounds".

1. Whoever tracks the job stops it there: no retry, no waiting for the reset. A liaison reports the error text, the reset time if given, job ids and the partial diff, and never switches on its own; the layer that assigned the job does steps 2 and 3.
2. Keep for review the partial work that passes the acceptance checks, revert the rest inside the lease, and write the remaining scope as a fresh brief that says what is already done. Do not resume the dead conversation on another channel.
3. Switch, staying in the job's tier, and say it in one line on the job's record:
   - the same-tier model on **another allowed channel** (the table in "Channels and fallbacks", "Team unavailable");
   - then another same-tier model on the same channel when it has its own allowance (a drop below the job's tier is not a ladder step: state it, and use it only for work the weaker model can carry);
   - then **in-house**, once every allowed external option for that tier is out: a cheap in-house model for purely mechanical work, the in-house mid tier otherwise.
4. A read-only second opinion has no in-house substitute: an in-house review is not another vendor's opinion. Keep the in-house senior review, record the missing external opinion, and for money, auth, schema or irreversible-data work ask the user whether to wait for the reset.

Ask the user before switching only when no substitute was agreed and the switch would add a team they did not allow. In an unattended run, follow the ladder, record the switch and report it at the end. The ladder never leaves the teams the user allowed; with none of them left, the work comes in-house.

## Coming back

Once a recorded reset time has passed, the next suitable job may go back to that channel · model and doubles as the probe; if it fails on quota again, record the new time. With no reset time, ask the user once and keep the channel out until they answer. Do not poll or hold work waiting for a reset unless the user asks; jobs already running on the substitute finish there. At session end, leave the rows that still matter (exhausted with a future reset, credit expiry dates) in the progress record so the next session starts from them.

## Spending a channel first

When a channel has plenty left, or credits that expire soon, the user may want it used before the others. That is their choice: ask, do not infer it from a full ledger. A spend-first or spare preference reorders the teams that fit a job; it never sends out work that fails the gate, never drops a job below its tier silently, and never replaces a review. Ask its scope with it: for this session it lives in the ledger; as a lasting rule it goes into the project policy's team order with its date; "until a date" or "while the credits last" is lasting with that end condition and is removed when it ends. Unclear wording means this session only. Plenty of free quota is no reason to send a private repository to a model the user has not cleared for it ([roster-and-verification.md](roster-and-verification.md), "How far each team is trusted").
