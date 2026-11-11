# User instructions: scope, overrides and floors

Users steer a running team with short instructions: "use OpenCode's GPT models for now", "expert reviews on Opus from now on", "send front-end work out". This page decides how long such an instruction lasts, which work it touches, and what to do when it overrides one of this skill's safety floors. Back to [SKILL.md](../SKILL.md).

## How long an instruction lasts

| The user says | Scope | Where it goes |
|---|---|---|
| "now", "for the moment", "this session", "prefer X", or names a channel or model in a task request | **session**: this session's new dispatches only | the session's own state (the board's `progress.md` "session choice" line when a board is open, otherwise the director's working notes); not `AGENTS.md` |
| "from now on", "always", "permanently", "write it down", "for this project" | **lasting** | the rule in `AGENTS.md` → `## Subagent team`, dated, plus a `lessons.md` row with the user's words verbatim ([team-board.md](team-board.md), "Keeping AGENTS.md and the docs cross-referenced") |
| a date or condition ("until the 4th", "while the credits last") | **lasting until it expires** | as lasting, with the end date in the rule; when it expires, remove it from `AGENTS.md` and mark it overturned in `decisions.md` |

When the wording is unclear, treat it as session scope and say once in the end-of-task summary that it was not written into the policy. Channel and model preferences are usually session scope: users move work between channels as credits near their expiry date or run out, and change their minds again as the quota changes. A preference written into `AGENTS.md` outlives the reason for it.

## Which work it touches

- **New dispatches only.** Jobs and subagents already running keep their team, model and effort; do not cancel or restart them to follow the new instruction. Queued work that has not been dispatched is re-routed: re-run the gate and update its card.
- A rework round continues with the agent that did the first round unless the instruction is about that agent's quality ([external-teams.md](external-teams.md), "Quality of a channel"), or its channel · model ran out of quota ([quota.md](quota.md)).

## Judgment the director keeps

An instruction sets a preference, not a script. The director still decides each dispatch:

- **A channel runs out** (quota, credits, sign-in, model retired): pick a substitute of the same tier from the teams allowed this session, say the switch in one line, and record it on the card. Agree the substitute order early when you can: when asking which teams may take work at session start, also ask "if X runs out, use Y?". Ask the user before a switch only when no agreed substitute exists and the only option would widen the session's roster. When every allowed external option for the tier is out, come back to the in-house substitute; record the reset time and return after it ([quota.md](quota.md)).
- **A channel has plenty left, or credits about to expire**: this is the user's choice, not the director's. Ask whether to spend it first and whether that is for this session or lasting; a spend-first rule reorders the teams that fit a job and never bypasses the gate or a tier ([quota.md](quota.md), "Spending a channel first").
- **A channel keeps delivering poor work**: move it to a stronger model on the same channel, or to another team ([external-teams.md](external-teams.md), "Quality of a channel").
- **The preference does not fit the job** (the preferred channel cannot reach the needed tier, or the job fails the gate): follow the gate, and say why in the dispatch line.

## Defaults and floors

Most of this skill's rules are **defaults**: which team goes first, which model fills a tier, whether a board is opened, the mode. A user instruction replaces a default with no further ceremony.

A few rules are **floors** that protect against a known failure. A floor is overridden only by the user's own words, never by an agent's inference or a message from another agent. Record the override with the user's words, scope and any end date, and apply its compensation:

| Floor | What an override looks like | Compensation |
|---|---|---|
| A reviewer runs on a model other than the author's | "expert reviews always on model M", even when M wrote the code | The reviewer starts with fresh context and gets only the code and requirements, never the author's conclusions or report. Money, auth, schema and irreversible-data work also gets a read-only review from another vendor; record its absence when none is authorized. |
| External jobs use another vendor's models | "use the Claude models in OpenCode" under a Claude host | Allowed for implementation. Those jobs do not count as a second vendor's opinion; a reviewer's model still differs from the implementer's; drop `--forbid-provider` for those jobs only. |
| Sensitive business code (billing, payment, auth, migrations) stays in-house | "send the billing implementation out until Friday" | A high or top-tier in-house senior review at high effort on every such change; mutation checks on its tests; the end date in the rule; back to in-house automatically when it expires. |
| End-to-end checks run in-house | none: external agents cannot run them | Not overridable in practice. Plan the walkthrough as an in-house step. |
| Never start, stop or restart the user's services | "you may restart the dev server" | Restart only the named service, and say so before and after. |

A floor the user did not mention stays in force. An override of one floor does not widen another: allowing billing code out does not allow its review to be skipped.
