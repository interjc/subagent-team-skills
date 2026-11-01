# OpenCode through ACP

[OpenCode](https://opencode.ai) can be an external team through its [Agent Client Protocol](https://agentclientprotocol.com) server, [`opencode acp`](https://opencode.ai/v2/docs/cli/acp/). The client starts `opencode acp` as a child process and the two exchange newline-delimited JSON-RPC over stdio. `scripts/opencode-acp-run.mjs` is that client, built for headless delegation: one prompt per run, pinned model and effort, a permission set the wrapper controls, a timeout, and a JSON summary.

**Status (2026-11):** checked against OpenCode 2.2.5 with a handshake, the probe, and small read-only, write and resume jobs on a scratch repository. It has not yet been used for real project work, so treat the first jobs in a project like any untested team: one small read-only job first, then edits.

## Why ACP and not `opencode run`

Both are headless. ACP adds what a liaison needs:

| Need | ACP (`opencode acp`) | `opencode run` |
|---|---|---|
| Pin model and effort | `session/set_config_option` for `model`, `effort`, `mode`, verified from the response | `--model provider/model#variant`, `--agent` |
| Know the result | `stopReason` (`end_turn`, `max_tokens`, `refusal`, `cancelled`), `usage`, cost | JSONL events, exit code |
| Never wait for approval | each `session/request_permission` reaches the client, which rejects it and records it | depends on the permission rules; `--auto` approves everything not denied |
| Stop cleanly | `session/cancel`, then process-group kill | kill only |
| Continue with context | `session/resume` with the same `cwd` | `--session <id>` (*unverified* for headless continuation) |
| Private config | always a private server, so injected config applies | needs `--standalone`; without it the shared background service ignores injected config |

ACP's interactive features (editor diffs, forms, live streaming) are not used.

## What the wrapper does

1. Starts `opencode acp` in `--repo` (its own process group) with an injected agent in `OPENCODE_CONFIG_CONTENT`. The variable is not in the v2 docs but works in 2.2.5; the probe reports `injectedAgentsVisible` so you can check it on any version.
2. `initialize` with no client file-system or terminal capabilities, so OpenCode uses its own tools inside its own permission rules.
3. `session/new` with `cwd` = the repo (or `session/resume` for `--session`). OpenCode loads that directory's config: models, agents, `AGENTS.md`, MCP servers.
4. Selects the agent, then the model, then the effort (each can change the options after it), and refuses to prompt if any value is not offered or does not stick.
5. Sends the brief as one text block, collects agent messages, tool calls, retries and usage, and rejects any permission request.
6. On timeout: `session/cancel`, a short grace, then SIGTERM and SIGKILL to the process group and every descendant. On normal end: `session/close`, which keeps the saved session for `--session`.

## The injected permission set

OpenCode's base policy allows everything. The wrapper's agent turns that around; the last matching rule wins:

```text
*                    *               deny
read, glob, grep     *               allow
edit                 *               allow        (only with --write)
shell                git status|diff|log|show|blame|ls-files, ls, pwd, wc   allow
shell                <each --allow-shell pattern>                            allow
shell                git *--output*  deny
webfetch, websearch  *               allow        (only with --allow-web)
read                 *.env, *.env.*  deny         (*.env.example allowed)
external_directory   *               deny
```

Everything else (subagents, questions, skills, MCP tools, other shell commands) is denied. Observed with 2.2.5: in read-only mode the edit tools are not offered at all; a denied shell command fails with "Permission denied" and the model continues; writes outside the repository are refused as an external directory.

- **Acceptance commands** need explicit patterns, e.g. `--allow-shell './node_modules/.bin/tsc *' --allow-shell './node_modules/.bin/vitest run *'`. A pattern ending in ` *` also matches the bare command. `--allow-shell '*'` is refused.
- Shell runs with your user's authority. The allow-list is the protection, so keep it to the commands the job needs.
- `--agent <id>` uses an agent from the project's own config instead, with its own permissions. The wrapper still rejects every permission request that reaches it.
- Some denied tools may still appear in the model's tool list; calling them fails.

## Commands

```bash
# capabilities, no tokens spent: version, auth methods, models, agents, effort levels
node scripts/opencode-acp-run.mjs probe --repo /abs/repo --model opencode/deepseek-v4.1-flash-free

# read-only job (a review, a survey)
node scripts/opencode-acp-run.mjs run --repo /abs/repo --prompt-file /scratch/job.md \
  --model <provider/model> --effort high --forbid-provider <in-house vendor> --timeout 20m

# edit job with acceptance commands allowed
node scripts/opencode-acp-run.mjs run --repo /abs/repo --prompt-file /scratch/job.md \
  --model <provider/model> --effort medium --write --allow-shell './node_modules/.bin/tsc *' \
  --timeout 30m --out-dir /scratch/jobs/T3a-r1

# rework in the same session (resumeHint in the summary has the exact line)
node scripts/opencode-acp-run.mjs run --repo /abs/repo --session ses_... --prompt-file /scratch/fix.md \
  --model <provider/model> --effort medium --write
```

- **Model and effort**: `--model` must be one of the models the probe lists for that directory; `--effort` one of that model's levels, or `default`. Pick another vendor's model than your in-house team and pass your in-house provider to `--forbid-provider` (e.g. `anthropic` when the host is Claude Code).
- **Outputs** in `--out-dir`: `last.md` (the final message, after the last tool call), `reply.md` (all assistant text), `events.jsonl` (every ACP message, for diagnosis), `stderr.txt`, `summary.json`. The summary has `ok`, `exitCode`, `stopReason`, `timedOut`, `partial`, `sessionId`, `opencodeVersion`, the applied `agent` / `model` / `effort`, `toolCalls`, `failedToolCalls`, `permissionRequests`, `usage`, `cost`, `retries`, `lastRetryError`, `authRequired`, `warning`, `error` and `resumeHint`.
- **Exit codes**: `0` finished (a length limit with a partial reply also exits 0 with `partial: true`), `1` usage, `2` agent error (refusal, auth required, no reply), `3` launch, protocol or setup failure (model, effort or agent not offered), `5` timeout (resumable with `--session`).
- **Warnings are not failures.** Failed tool calls and rejected permission requests mean the agent may describe work it could not do; check the diff.
- **Switching a resumed session from read-only to `--write`** works, but the model may still believe from its history that it cannot edit. Say so in the follow-up brief ("you now have edit permission").
- Sessions persist in OpenCode's normal session list (the probe deletes its own). One session runs one prompt at a time, so never send two jobs to the same session at once.

## Facts that matter

- **Auth**: OpenCode uses the provider credentials it already has. When a prompt fails with ACP's `auth_required`, the summary says `authRequired: true`; the user signs in with `opencode auth login` (or `opencode acp --login`). Never handle credentials yourself.
- **No network**: OpenCode retries failing model calls and reports each retry (`opencode/retry`); the wrapper records them and the timeout bounds the job.
- **Debugging**: `opencode --print-logs acp` writes OpenCode's logs to stderr. The wrapper keeps stderr in `stderr.txt`; reproduce by hand with that flag if you need more.
- **Free and gateway models** (the `opencode/` provider) are convenient for a first verification job, but check their terms and data handling before sending project code.

## Fallback: `opencode run` without Node.js

Without Node.js 18+, inject the same agent by hand and use `opencode run`. `--standalone` is required, or the shared background service will not see the injected agent ("Agent not found"):

```bash
cd /abs/repo && OPENCODE_CONFIG_CONTENT='{"agents":{"subagent-team-readonly":{"description":"read-only delegate","mode":"primary","permissions":[
  {"action":"*","resource":"*","effect":"deny"},
  {"action":"read","resource":"*","effect":"allow"},{"action":"glob","resource":"*","effect":"allow"},{"action":"grep","resource":"*","effect":"allow"},
  {"action":"shell","resource":"git status *","effect":"allow"},{"action":"shell","resource":"git diff *","effect":"allow"},
  {"action":"read","resource":"*.env","effect":"deny"},{"action":"read","resource":"*.env.*","effect":"deny"},
  {"action":"external_directory","resource":"*","effect":"deny"}]}}}' \
  opencode run --standalone --agent subagent-team-readonly --model '<provider/model>#<effort>' \
  --format json "$(cat /scratch/job.md)" < /dev/null > /scratch/run.jsonl 2> /scratch/run.err
```

For edits, add `{"action":"edit","resource":"*","effect":"allow"}` after the read rules (and name the agent accordingly). The brief travels as a command-line argument, so keep it short (well under 100 KB) and point to a spec file inside the repository for anything long. The JSONL has `tool_use` events (with `status` and errors) and `text` events (the reply), each with the `sessionID`. There is no built-in timeout: bound it with `timeout 30m` (GNU coreutils; `gtimeout` on macOS with Homebrew) or run it under a liaison that kills it. Observed with 2.2.5 on a read-only job; continuation with `--session` is *unverified*.
