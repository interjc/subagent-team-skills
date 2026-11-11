# Tracking jobs through a liaison, and host notes

Detail behind "Tracking through a liaison" in [SKILL.md](../SKILL.md). Script paths are relative to the skill's directory, not the repository.

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

- The same loop works for `agy-run.mjs` and `opencode-acp-run.mjs`. Use a **fresh `--out-dir` for every round** (first run, each rework, each resume): the wrappers write `summary.json` only at the end, so a reused directory would end the wait at once.
- It checks the lease, runs acceptance commands and checks content structure as described in "Acceptance" in [SKILL.md](../SKILL.md), then sends one rework round for mechanical failures with the concrete output. The brief names each check's execution owner and environment. If a command was refused externally, run it where authorized in-house or leave it pending and escalate; never count a refusal as a pass or loosen the external permissions. Blockers in the final reply are answered only when the answer is already in the brief or the repository; everything else, and any second failure, goes back to whoever assigned the job. Independent in-house review still judges content, especially generated test cases and expected values.
- When the team is unavailable (auth, quota, network), the liaison reports it and does not switch teams on its own: the layer above picks the fallback (Channels and fallbacks in [SKILL.md](../SKILL.md)). For quota it reports the error text and any reset time exactly as printed, with no retry and no waiting for the reset. Every report after a job returns lists the quota signals seen (usage or cost figures, rate-limit or retry warnings), or "none" ([quota.md](quota.md)).

## Host notes

- **Claude Code**: in the main session, run wrappers through `Bash` with `run_in_background: true` and react to the completion notification. Don't use foreground `sleep`, and don't poll. A liaison subagent is the exception: it waits in bounded slices as in the first part of this page, because background notifications may not reach it. The Codex plugin and agy-staff both install here.
- **Codex as host**: Codex is then in-house, so its CLI is not an external team; agy-staff installs as a Codex plugin, and OpenCode works through the wrapper. Request escalated execution when the sandbox blocks agy, OpenCode or the network. Codex hosts poll background work and each wake-up carries their full context, so prefer fewer, larger jobs.
- **OpenCode as host**: `opencode acp` starts its own private server, so the wrapper also works from inside an OpenCode session; it only adds a second perspective with another vendor's model than the session's.
- **Other hosts / other CLIs** (Pi, Grok, DeepSeek-backed agents and others): not tested here. The principles carry over ([other-agents.md](other-agents.md)), but adapt the mechanics yourself. For a new worker CLI, agy-staff's [DESIGN.md](https://github.com/keli-wen/agy-staff/blob/master/docs/DESIGN.md) is a good blueprint. It covers headless mode, a prompt file, one background wait per job, continuation by conversation id, and results written to files.

Measured runs and their lessons: [field-data.md](field-data.md). OpenCode details: [opencode-acp.md](opencode-acp.md). Adding any other ACP agent: [acp-agents.md](acp-agents.md).
