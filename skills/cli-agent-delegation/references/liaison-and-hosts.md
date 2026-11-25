# Tracking jobs through a liaison, and host notes

Detail behind "Tracking through a liaison" in [SKILL.md](../SKILL.md). Script paths are relative to the skill's directory, not the repository.

## Which route: host kind and scenario

| Client the session runs in | Kind | Scenario | Another vendor's model goes |
|---|---|---|---|
| Claude Code (verified), Codex (verified), agy (*unverified*), Gemini CLI (*unverified*, deprecated) (as of 2026-11) | vendor-native | `vendor-native` | through that vendor's ACP server (Codex: `codex exec`) with a wrapper from this skill, tracked by a liaison |
| T3 Code (partly exercised 2026-11), Cursor (*unverified*), Orca (*not tested*) (as of 2026-11) | multi-vendor | `harness` | as an in-house subagent, child agent or forked thread on that model (host switch); no wrapper, no liaison |
| OpenCode (*unverified*), Pi (*not tested*) (as of 2026-11) | multi-vendor | `open-router` | as an in-house named agent on that model (host switch); ACP + liaison only when a separate CLI sandbox is wanted |
| Bot front ends (*not tested*) | unknown | `bot` | probe capabilities first (shell + files, files only, or chat only); ACP + liaison only if shell + CLIs exist |

What the multi-vendor harnesses and routers offer (OpenCode and Cursor are *unverified* as hosts; Orca, Pi and bot front ends are *not tested*; T3 Code had host detection, per-child provider/model, and child agents on another vendor's provider exercised in 2026-11, with the rest *unverified*):

- **T3 Code** is a GUI over agent CLIs the user has signed in (Claude Code, Codex, Cursor, OpenCode, agy and ACP agents). Its releases describe switching provider or model between turns, forking a thread and a delegate tool that starts child agents on any provider. Use a child agent or a forked thread for the job, not the director's own thread: a mid-thread switch drops the prompt cache and carries the context only as a handoff summary. Each provider bills on the user's own sign-in for it, so quota is per declared account in `hosts.t3-code.serves`.
- **OpenCode** (`open-router`) sets a model per agent (`model: <provider>/<model>` in an agent's file or the config's `agent` block), so a subagent per external tier does the job. An inline per-call override is not built in (open feature request in 2026): define the agents in advance.
- **Cursor** (`harness`) lets subagent definitions name a `model`, but forum reports through 2026 show the orchestrating agent overriding it, and the CLI exposing few models to subagents. Check the served model on every job; when it is wrong, take ACP + liaison or ask the user.
- **Orca** (`harness`, *not tested*), **Pi** (`open-router`, *not tested*) and **bot front ends** (`bot`, *not tested*): not tested with these skills as hosts; confirm scenario and capabilities on first use (`subagent-team`, `scenarios.md`) before routing external work.

Rules on the host-switch route: one job, one subagent with a frozen brief and a lease; pin model and effort; confirm the served model (from the harness's display or the agent's result) before the job counts as another vendor's opinion; record the outcome in the usage log under a resource for that provider · model whose channel is `host` (`compute-config.mjs set ... --channel host`); keep the vendor's confidentiality level and the quota ledger as on the ACP route. Models the harness does not serve, and work the user wants on the vendor's own sandbox, accounts or quota, keep the ACP + liaison route.

When the route is not obvious (an unknown client, conflicting hints, a harness that can only switch the whole thread, both routes available with different accounts or quota), the user picks: one question with **host switch**, **ACP + liaison** and **in-house only**, your recommendation pre-selected, and the scope of the answer (session, project, global). In a non-interactive run take ACP + liaison where it works, else in-house only, and list the question for the end of the task.

## Tracking jobs through a liaison

When the host can run subagents with shell access, give each external job (or each team's sequence of jobs) to a cheap in-house liaison instead of waiting in the main session:

- The liaison dispatches with the exact command from its brief, writes the job and conversation ids where the team tracks state (a task card, a progress record), and never starts a duplicate.
- **Dispatch is not completion.** Keep waiting until the job returns, collect its final result and run the mechanical checks before final delivery. A wait slice ending only means wait again while the job is healthy and within its timeout. On a blocker or job timeout, explicitly escalate with state, ids, partial results and the next action; do not automatically resume or switch teams.
- **Wait in bounded slices**, not on notifications: subagent background notifications may go to the root session instead. Start the wrapper detached with an explicit `--out-dir`, then wait for its `summary.json` with an `until` loop whose upper bound stays below the host's shell-tool time limit; repeat while the job runs. With agy-staff, repeat `wait <job-id> --timeout <below the limit>` while it exits `2`; with the Codex plugin's runtime, repeat `status <job-id> --wait --timeout-ms <below the limit>`.

  ```bash
  OUT=/scratch/jobs/T3a-r1; mkdir -p "$OUT"        # a fresh --out-dir per round (r2, r3, ...)
  nohup node scripts/codex-run.mjs exec --repo /abs/repo --prompt-file /scratch/T3a.md \
    --model <id> --effort medium --sandbox workspace-write --timeout 30m --out-dir "$OUT" > "$OUT/stdout.json" 2>&1 &
  # each later call: wait at most ~9 minutes, then call again if still running within the job timeout
  i=0; until [ -f "$OUT/summary.json" ] || [ $i -ge 54 ]; do sleep 10; i=$((i+1)); done; ls "$OUT"
  ```

- The same loop works for `agy-acp-run.mjs` (the preferred agy channel), `opencode-acp-run.mjs` and the print-mode fallback `agy-run.mjs`. Use a **fresh `--out-dir` for every round** (first run, each rework, each resume): the wrappers write `summary.json` only at the end, so a reused directory would end the wait at once.
- It checks the lease, runs acceptance commands and checks content structure as described in "Acceptance" in [SKILL.md](../SKILL.md), then sends one rework round for mechanical failures with the concrete output. The brief names each check's execution owner and environment. If a command was refused externally, run it where authorized in-house or leave it pending and escalate; never count a refusal as a pass or loosen the external permissions. Blockers in the final reply are answered only when the answer is already in the brief or the repository; everything else, and any second failure, goes back to whoever assigned the job. Independent in-house review still judges content, especially generated test cases and expected values.
- When the team is unavailable (auth, quota, network), the liaison reports it and does not switch teams on its own: the layer above picks the fallback (Channels and fallbacks in [SKILL.md](../SKILL.md)). For quota it reports the error text and any reset time exactly as printed, with no retry and no waiting for the reset. Every report after a job returns lists the quota signals seen (usage or cost figures, rate-limit or retry warnings), or "none" ([quota.md](quota.md)).

## Host notes

- **Claude Code**: in the main session, run wrappers through `Bash` with `run_in_background: true` and react to the completion notification. Don't use foreground `sleep`, and don't poll. A liaison subagent is the exception: it waits in bounded slices as in the first part of this page, because background notifications may not reach it. The Codex plugin and agy-staff both install here; agy jobs still go through `agy-acp-run.mjs`, with agy-staff's personas in the brief ([compliance.md](compliance.md)).
- **Codex as host**: Codex is then in-house, so its CLI is not an external team; agy-staff installs as a Codex plugin, and agy and OpenCode work through their ACP wrappers. Request escalated execution when the sandbox blocks agy (its language-server port and OAuth credentials), OpenCode or the network; if escalation is refused, agy-staff's runner is the print-mode fallback, with the risk stated. Codex hosts poll background work and each wake-up carries their full context, so prefer fewer, larger jobs.
- **OpenCode as host**: a multi-vendor harness, so other vendors' models it is configured for are reached by host switch (an agent with its own `model`), not through this skill. `opencode acp` starts its own private server, so the wrapper also works from inside an OpenCode session, for example to keep a job on a separate sandbox or session.
- **agy as host** (*unverified*): vendor-native by default, so Codex and OpenCode are external teams through their channels here. agy also serves some other vendors' models on some plans; filling a tier with those in-house is the user's choice, asked once.
- **T3 Code** (partly exercised 2026-11) and **Cursor** (*unverified*): route by host switch for the models they serve ("Which route: host kind and scenario", above); a liaison only for jobs that still go through ACP.
- **Orca, Pi and bot front ends as hosts** (*not tested*): confirm scenario and capabilities first (`subagent-team`, `scenarios.md`). For bot hosts, run external CLI wrappers only when the capability probe confirms shell access and working CLIs.
- **Other CLIs** (Pi, Grok, DeepSeek-backed agents and others): not tested here. The principles carry over ([other-agents.md](other-agents.md)), but adapt the mechanics yourself. For a new worker CLI, agy-staff's [DESIGN.md](https://github.com/keli-wen/agy-staff/blob/master/docs/DESIGN.md) is a good blueprint. It covers headless mode, a prompt file, one background wait per job, continuation by conversation id, and results written to files.

Measured runs and their lessons: [field-data.md](field-data.md). OpenCode details: [opencode-acp.md](opencode-acp.md). Adding any other ACP agent: [acp-agents.md](acp-agents.md).
