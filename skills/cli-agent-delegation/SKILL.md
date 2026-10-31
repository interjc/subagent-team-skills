---
name: cli-agent-delegation
description: Outsource well-specified bulk coding work to another vendor's agent through its CLI, a plugin or an MCP server. Covers Google Antigravity (agy), with or without the agy-staff plugin, and OpenAI Codex CLI (codex exec) in depth, plus how to adapt other agent CLIs such as OpenCode, Pi or Grok, driven from Claude Code, Codex or any harness that can run shell commands. Use this when handing translations, mechanical refactors, test or snapshot backfills, doc syncs or a second-opinion review to an external agent; when running agy, codex or another agent headless; when choosing between them; when a liaison subagent dispatches, waits on, resumes or accepts their jobs; or when a dispatch plugin for them is missing or broken.
license: MIT
compatibility: Needs a shell. The helper scripts need Node.js 18+ (24 recommended); external agents need their own CLIs and accounts (Codex CLI, agy). Run scripts/doctor.mjs first.
metadata:
  version: "0.2.0"
---

# CLI Agent Delegation

Outsourced staff are other vendors' agents run headless through their CLIs. They are cheap or strong, they never get tired of bulk work, and a different model family catches different mistakes. But they cannot ask questions, they do not share your context, and each job carries a fixed start-up cost. This skill covers how to use them well. It is the outsourcing arm of the `subagent-team` skill, where external agents form the fourth layer (external teams) and each job is tracked by a low-tier in-house *liaison* subagent. Without that skill, still apply its gate (below).

Tested with **Claude Code** as the host (background `Bash` plus completion notifications). Works from Codex and other hosts that can run shell commands. See the host notes at the end.

## 1. Gate: should this be outsourced at all?

Only when **all four** hold:

1. **Fully specified**: what to do and which files are decided; no product or architecture decisions remain.
2. **No risk**: no business code for billing, payment or auth; no data migrations; no concurrency or data-loss paths; mistakes are easy to see and roll back.
3. **Objective acceptance**: runnable commands, or a checklist anyone can tick (key sets, placeholders, line counts, snapshots).
4. **Bulk or repetitive**: translations from a frozen key list, mechanical renames, filling in from a template, homogeneous integrations, snapshot and exhaustive tests, doc and README syncs.

If writing the brief costs as much as doing the job (a ten-line edit), do not outsource. Tests and snapshots *for* a sensitive module are fine; the module's business code is not.

## 2. agy or Codex?

| Work | Choice | Why |
|---|---|---|
| Translations, bulk copy, mechanical replacement, filling in from a template | agy, fast tier (e.g. `gemini-3.8-flash-high`; `-medium` for purely mechanical) | Cheapest. About five minutes of fixed overhead per job, so bigger batches pay off more. |
| Large homogeneous implementation from a fixed spec | agy, strong tier (e.g. `gemini-4-argon-medium`/`-high`), or Codex at `medium` | Needs steadier reasoning but no decisions |
| Syncs that require reading the code to get right (docs against code, tests following existing patterns) | Codex at `high` | Reads code on its own initiative and checks facts; modest token use |
| Read-only second opinion on a diff or plan | Codex at `medium`–`high` in a `read-only` sandbox, or agy's reviewer persona | Another vendor covers blind spots. The verdict stays with your in-house reviewer. |

Model names are examples from 2026-10. List what is actually available with `agy models` (or `node scripts/agy-run.mjs models`) and Codex's `~/.codex/models_cache.json` (`node scripts/doctor.mjs` lists the Codex ones). Do not use agy to call Claude or GPT models: that routes outsourced work back to your in-house family.

## 3. Before dispatch

Script paths in this skill are relative to the skill's own directory. They need Node.js 18 or newer (24 recommended) and no dependencies; each script refuses to run on an older Node with a clear message. Run the doctor once per session:

```bash
node scripts/doctor.mjs          # Node version, CLIs present? versions? Codex default effort? agy-staff installed?
```

Report blockers and recommendations to the user and install only with their consent. If Node.js is missing or older than 18, use the raw commands instead of the wrappers: the `codex exec` line in section 4 (always with `-c model_reasoning_effort=…`; bound it with the shell's `timeout 30m …` if available), and agy through agy-staff or the raw `agy -p` command in section 5.

Write the brief to a file in your scratch directory. If the `subagent-team` skill is installed, start from its brief template; either way, apply these outsourcing rules:

- **Fully self-contained.** Paste the spec, the frozen key list, base-language text and insertion points. The agent cannot ask, and may not be able to read paths outside the workspace.
- **Freeze the list first.** Keys or endpoints added after dispatch will not be handled.
- **A file lease plus "must not touch"**: list the files other agents are editing right now.
- **Acceptance commands use executable paths** (`./node_modules/.bin/tsc --noEmit -p .`), not package-manager scripts.
- **"If anything falls outside this spec, stop and explain it in your final reply; do not decide."**
- **Prohibitions**: no state-changing git operations (read-only `git status` / `git diff` is fine), no installs, builds, dev servers or database commands, no reading `.env*`, nothing outside the lease.
- **Report**: files changed and why, uncertain spots, problems noticed but not fixed.

## 4. Codex CLI

Use `codex exec` directly. `scripts/codex-run.mjs` wraps it so the easy mistakes become impossible: effort is always explicit, `ultra` and `danger-full-access` are refused, output goes to known files, and the result is summarized.

```bash
# run in the background (Claude Code: Bash with run_in_background: true); you are notified on exit
node scripts/codex-run.mjs exec --repo /abs/repo --prompt-file /scratch/job.md \
  --model gpt-6.1-sol --effort medium --sandbox workspace-write --timeout 30m
```

- **Effort is required on every call** (`low`, `medium`, `high`, `xhigh`, `max`; codex-cli 0.165.0 accepted all of them). Without `-c model_reasoning_effort=…`, raw Codex inherits `~/.codex/config.toml` (often `high` on a personal machine), not the model's own default. The log header prints the applied value; the wrapper flags any mismatch. Use `low` for mechanical work, `medium` by default, `high` when much code must be read. `xhigh` and `max` rarely pay off: work that needs them should not be outsourced. Never use `ultra`: in the author's use it dispatched its own sub-tasks outside the director's control, so the wrapper refuses it.
- **Sandbox**: `read-only` for reviews (the default), `workspace-write` for edits (it can write the workdir and temp directories; network access follows `[sandbox_workspace_write] network_access` in `~/.codex/config.toml`). The wrapper always passes the sandbox, so a `sandbox_mode` default in `config.toml` does not leak in. In `exec` mode approvals are `never`, so a job never hangs waiting for approval.
- **Tracking**: completion notification → read `last.md` (final reply) → `git status --short` / `git diff --stat` for the truth → `log.txt` only when diagnosing (it shows every command, the replies, and `tokens used`). Add `--json` for JSONL events.
- **Resume** with context: `node scripts/codex-run.mjs resume --repo /abs/repo --session <id> --prompt-file /scratch/followup.md --effort medium --sandbox workspace-write`. The sandbox is not inherited from the first run: without `--sandbox` a resume is `read-only`, so rework cannot edit. The summary's `resumeHint` carries the session id and the original sandbox. Resume has no `-C`/`-s`, so the wrapper runs it from the repo directory and passes the sandbox as config.
- **No network → endless reconnects.** Codex retries indefinitely ("Reconnecting... waiting for network"). There is no default timeout, so set `--timeout` (max `24h`); on expiry the wrapper kills Codex's process group and every descendant. Codex runs tool commands in their own session, outside its group, so killing the group alone would leave them running.
- **Wrapper contract**: files in `--out-dir` (default under the system temp dir): `log.txt`, `last.md`, `summary.json`. The JSON printed on stdout (same as `summary.json`) has `ok`, `exitCode`, `timedOut`, `sessionId`, `effortRequested`/`effortReported`/`effortMismatch`, `sandbox`, `tokensUsed` and a ready `resumeHint`. Exit code: Codex's own, `124` on timeout, `1` for usage or launch errors. `--dry-run` prints the command without running it; `summary <log.txt>` re-parses an existing log.
- Two Codex jobs touching disjoint files can run in the same workspace at the same time.
- A dispatch *plugin* for Codex may assume an MCP server mode the installed CLI no longer has. If its tools do not appear, call `codex exec` directly and keep the plugin's conventions.

The wrapper's `exec` and `resume` argument shapes were checked against codex-cli 0.165.0. Raw equivalent of what it runs:

```bash
codex exec -m gpt-6.1-sol -c model_reasoning_effort=medium -s workspace-write -C /abs/repo \
  -o /scratch/last.md - < /scratch/job.md > /scratch/log.txt 2>&1
```

## 5. agy (Google Antigravity CLI)

### Preferred: the agy-staff plugin

[agy-staff](https://github.com/keli-wen/agy-staff) gives Claude Code, Codex, Pi and OpenCode a set of agy personas: `staffer`, `researcher`, `reviewer`, `implementer` and `ask`, plus `lead` and `jobs`. It also handles background jobs, waiting, continuation, timeouts and dirty-workspace prompts.

```bash
claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff
codex plugin marketplace add https://github.com/keli-wen/agy-staff && codex plugin add agy@agy-staff
```

How to use it inside this method:

- Call `/agy:implementer` (`$agy:implementer` in Codex) for edits, `researcher` for surveys, `reviewer` for a read-only second opinion. Long briefs go in a file and are passed with `--prompt-file`. Choose the model with `--model <id-with-effort-suffix>`, or `--effort` to change only the strength.
- Collect each job with **one background `wait <job-id> --timeout 10m`**. Do not `observe` or read logs while it runs, unless the user asks or the job failed.
- Exit codes of `wait`: `0` finished (not the same as accepted), `1` invalid or refused (for example continuing a running job), `2` still running (wait again), `3` error, `4` cancelled, `5` resumable timeout. On `5`, inspect the partial diff and ask before continuing.
- Follow-ups and rework go through `continue --job <id> --prompt-file <new brief>`, which keeps the conversation.
- **Role ownership stays with your method.** The plugin's generic `lead` guidance ("the lead may handle small tasks itself", "the lead talks to the user") does not override `subagent-team`. The director owns user communication, acceptance and commit.
- The plugin runs agy **unrestricted** by default: it can read the repo, run commands and edit files. Its prompts are guardrails, not permission isolation. Use its `--restricted` / `setup` hardening for untrusted input.

### Without the plugin: `scripts/agy-run.mjs`

```bash
node scripts/agy-run.mjs run --repo /abs/repo --prompt-file /scratch/job.md \
  --model gemini-3.8-flash-high --write --timeout 15m
node scripts/agy-run.mjs run ... --conversation <id>      # continue with context
node scripts/agy-run.mjs models                           # list model ids
```

Raw equivalent of what it runs, from the repo directory (add `--conversation <id>` to continue):

```bash
cd /abs/repo && agy -p "$(cat /scratch/job.md)" --model gemini-3.8-flash-high --output-format json \
  --print-timeout 15m --add-dir /abs/repo --dangerously-skip-permissions   # last flag only for edits
```

With `--write` the wrapper adds `--dangerously-skip-permissions`, because headless edits need it. It saves the final reply to `last.md` (plus `result.json`, `stderr.txt`, `summary.json` in `--out-dir`) and prints a JSON summary whose `conversationId` and `continueHint` let you continue. Defaults: `--timeout 10m` (max `24h`); the wrapper kills agy's process group and every descendant at timeout + 60s. agy 1.4.10 keeps `status: "SUCCESS"` when its print timeout fires and reports it only on stderr (`[agy] print timeout after …`); the wrapper reads stderr and treats that as a timeout. When agy ends a turn while a background task it started is still running, it kills the task; the wrapper then sets `warning`, because the reply may describe work that never finished. Exit codes: `0` ok (a reply came back; `warning` set, `partial: true` if agy hit its time limit mid-answer), `1` usage error, `2` agy reported an error with no reply, `3` launch failure or unparseable output, `5` timed out with no reply (resumable with `--conversation` if an id is known). These are **agy-run's** codes; agy-staff's `wait` uses its own (above). Model ids for Claude or GPT families are refused unless you pass `--allow-any-model`. `--dry-run` shows the command.

The brief travels as a command-line argument, so keep it under 100 KB (the wrapper refuses larger ones). For bigger specs, put the spec in a file inside the repo and make the brief "Read docs/tasks/<job>.md and follow it".

### agy facts that matter

- **Headless, not ACP.** The agy CLI has no native ACP. Community bridges depend on internal interfaces that break between versions and may put personal accounts at risk. ACP's advantages (sessions, per-tool approval, streaming into editors) serve interactive editing. The "spec → background batch → director checks the diff" pattern needs none of them. Re-evaluate if official ACP support ships.
- Fixed overhead of about five minutes and millions of cached tokens per job, and context cost grows with batch size. Still far cheaper than translating in a top-tier session.
- **Job state is per worktree.** Serialize agy writing jobs in one checkout, or give each its own worktree. While a job runs, do not edit its files. Add follow-up keys after it returns.
- It needs to run outside restrictive host sandboxes, because it uses local ports and OAuth tokens.

## 6. Acceptance after the job returns

The job's report is a claim. Acceptance is yours (or your liaison's, for the mechanical steps):

1. `git status --short` and `git diff --stat`: did it stay inside the lease?
2. Run the acceptance commands yourself.
3. Content work (translations, copy, examples) must be reviewed and edited, not just accepted: check that key sets are identical across languages, `{placeholders}` and escapes such as `\n` are preserved, and the order matches the base file.
4. Docs work: check every verifiable fact (versions, scripts, paths, environment variables, endpoints).
5. Small issues: fix them yourself. Larger ones: continue the same job with the concrete failure. **Two failed rounds → take it back in-house.**
6. Commit only after acceptance, and only by the director.

## 7. Tracking jobs through a liaison

When the host can run subagents with shell access, give each external job (or each team's sequence of jobs) to a cheap in-house liaison instead of waiting in the main session:

- The liaison dispatches with the exact command from its brief, writes the job and conversation ids where the team tracks state (a task card, a progress record), and never starts a duplicate.
- **Wait in bounded slices**, not on notifications: subagent background notifications may go to the root session instead. Start the wrapper detached with an explicit `--out-dir`, then wait for its `summary.json` with an `until` loop whose upper bound stays below the host's shell-tool time limit; repeat while the job runs. With agy-staff, repeat `wait <job-id> --timeout <below the limit>` while it exits `2`.

  ```bash
  OUT=/scratch/jobs/T3a; mkdir -p "$OUT"
  nohup node scripts/codex-run.mjs exec --repo /abs/repo --prompt-file /scratch/T3a.md \
    --model <id> --effort medium --sandbox workspace-write --timeout 30m --out-dir "$OUT" > "$OUT/stdout.json" 2>&1 &
  # each later call: wait at most ~9 minutes, then report "still running" and call again
  i=0; until [ -f "$OUT/summary.json" ] || [ $i -ge 54 ]; do sleep 10; i=$((i+1)); done; ls "$OUT"
  ```

- It runs steps 1, 2 and the mechanical part of 3 in section 6, and sends one rework round with the concrete failure. Blockers the external agent reported in its final reply are answered only when the answer is already in the brief or the repository; everything else, and any second failure, goes back to whoever assigned the job.

## 8. Other agents and channels (not tested here)

OpenCode, Pi, Grok CLI and other agent CLIs, and agents exposed through an MCP server, follow the same pattern. Before the first real job, find out and write down once: the headless invocation (prompt from a file or stdin, working directory, model and effort flags); how to allow edits inside the workspace only, and how to run read-only; where the final reply goes and whether there is a machine-readable result; how to continue a job by session or conversation id; and how it behaves without network, at timeout and when it wants approval (a headless run must never wait for approval). Then run one tiny read-only job and check all of that before trusting it with edits.

- Check presence and versions with `<cli> --version`; a binary with the expected name can belong to another program.
- Pin model and effort on every call; do not inherit the tool's personal defaults.
- Bound every job with the shell's `timeout` (or the tool's own) and kill the whole process group on expiry.
- Prefer models from another vendor than your in-house team; a tool that routes back to your own vendor's models adds cost, not perspective.
- MCP calls are synchronous for the agent making them: keep long jobs on the CLI channel, or give them to a liaison, never to the main session.

## 9. Host notes

- **Claude Code**: run wrappers through `Bash` with `run_in_background: true` and react to the completion notification. Don't use foreground `sleep`, and don't poll.
- **Codex as host**: request escalated execution when the sandbox blocks agy or the network. Codex hosts poll background work and each wake-up carries their full context, so prefer fewer, larger jobs.
- **Other hosts / other CLIs** (OpenCode, Pi, Grok, DeepSeek-backed agents and others): not tested here. The principles carry over (section 8), but adapt the mechanics yourself. For a new worker CLI, agy-staff's [DESIGN.md](https://github.com/keli-wen/agy-staff/blob/master/docs/DESIGN.md) is a good blueprint. It covers headless mode, a prompt file, one background wait per job, continuation by conversation id, and results written to files.

Measured runs and their lessons: [references/field-data.md](references/field-data.md).
