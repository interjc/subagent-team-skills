# Codex CLI

How to run OpenAI's Codex CLI as an external team: the `codex-run.mjs` wrapper, OpenAI's Codex plugin for Claude Code, and the raw command. Script paths are relative to the skill's directory. Gate, brief rules, fallback ladder and acceptance are in [SKILL.md](../SKILL.md); waiting for jobs through a liaison is in [liaison-and-hosts.md](liaison-and-hosts.md).

## Jobs: `scripts/codex-run.mjs`

The wrapper makes the easy mistakes impossible: effort is always explicit, `ultra` and `danger-full-access` are refused, output goes to known files, and the result is summarized.

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

## The Codex plugin for Claude Code

OpenAI publishes [codex-plugin-cc](https://github.com/openai/codex-plugin-cc), the Codex counterpart of agy-staff: slash commands and a forwarding subagent on top of the local Codex CLI and its app server, with the same sign-in and `config.toml`.

```bash
claude plugin marketplace add openai/codex-plugin-cc && claude plugin install codex@openai-codex
# in a session: /reload-plugins, then /codex:setup (checks install and sign-in)
```

What it offers: `/codex:review` (read-only review of uncommitted changes, or `--base <ref>`), `/codex:adversarial-review [focus]` (read-only, steerable), `/codex:rescue` (hand a task to Codex), `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:transfer`. Reviews and rescues take `--background`. How to use it inside this method:

- **Second opinions**: `/codex:review --background` or `/codex:adversarial-review --background <the risk to probe>`, then `/codex:result`. The findings are input for your in-house reviewer, never the acceptance. The plugin's own rule "after review findings, stop and ask the user which to fix" yields to `subagent-team`: the director decides, and only product calls go to the user's end-of-task list.
- **Jobs, if the user prefers the plugin to the wrapper**: call its runtime directly from the liaison, with the install path the doctor reports: `node "<install path>/scripts/codex-companion.mjs" task --background --write --model <id> --effort <level> --prompt-file /scratch/job.md` returns a job id; wait with `status <job-id> --wait --timeout-ms <below the shell tool limit> --json`, repeated; then `result <job-id> --json`; stop with `cancel <job-id>`. Check status and results through the same channel you dispatched with: the runtime keeps job state in the plugin's data directory when Claude Code runs it, and in a fallback directory otherwise.
- **Pin model and effort every time.** Without them the plugin uses `config.toml` defaults, the same trap as raw `codex exec`. Its effort values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh` (no `max`). `--write` means the `workspace-write` sandbox, otherwise `read-only`; approvals are `never`.
- `/codex:rescue` defaults to a write-capable run, leaves model and effort unset unless you name them, and its forwarding subagent runs on a Claude model. Prefer the explicit `task` call above for outsourced jobs.
- `--resume-last` continues the latest task thread in the repository, not one you choose. With parallel Codex jobs, use `codex-run.mjs resume --session <id>`.
- There is no job timeout; use `cancel`. Keep the optional review gate (a `Stop` hook) off in team runs: it can loop and drain usage.
- Only `codex@openai-codex` is OpenAI's. Forks exist with other defaults (some run `danger-full-access`); the doctor flags them.
- Checked against the plugin's README and source (version 1.0.6, 2026-07); not yet used in real projects with this method.

`codex mcp-server` has been removed from Codex, so dispatch plugins and guides built on it no longer work. Use the wrapper or the plugin above.

## Without Node.js: the raw command

What the wrapper runs, checked against codex-cli 0.165.0. Always pass the effort; bound the job with the shell's `timeout 30m …` where available:

```bash
codex exec -m gpt-6.1-sol -c model_reasoning_effort=medium -s workspace-write -C /abs/repo \
  -o /scratch/last.md - < /scratch/job.md > /scratch/log.txt 2>&1
```

The log header prints `session id: <id>`. Rework with context, from the repository directory (resume has no `-C` or `-s`; without the sandbox override it runs read-only):

```bash
cd /abs/repo && codex exec resume -m gpt-6.1-sol -c model_reasoning_effort=medium -c 'sandbox_mode="workspace-write"' \
  -o /scratch/last-r2.md <session-id> - < /scratch/fix.md > /scratch/log-r2.txt 2>&1
```
