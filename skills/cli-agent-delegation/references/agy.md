# agy (Google Antigravity CLI)

How to run agy as an external team: the agy-staff plugin, the `agy-run.mjs` wrapper, the raw command, and the facts that matter. Script paths are relative to the skill's directory. Gate, brief rules, fallback ladder and acceptance are in [SKILL.md](../SKILL.md). agy also replaces the deprecated Gemini CLI ([acp-agents.md](acp-agents.md)).

## Preferred: the agy-staff plugin

[agy-staff](https://github.com/keli-wen/agy-staff) gives Claude Code, Codex, Pi and OpenCode a set of agy personas: `staffer`, `researcher`, `reviewer`, `implementer` and `ask`, plus `lead` and `jobs`. It also handles background jobs, waiting, continuation, timeouts and dirty-workspace prompts.

```bash
claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff
codex plugin marketplace add https://github.com/keli-wen/agy-staff && codex plugin add agy@agy-staff
```

How to use it inside this method:

- Call `/agy:implementer` (`$agy:implementer` in Codex) for edits, `researcher` for surveys, `reviewer` for a read-only second opinion. Long briefs go in a file and are passed with `--prompt-file`. Choose the model with `--model <id-with-effort-suffix>`, or `--effort` to change only the strength.
- Collect each job with **one background `wait <job-id> --timeout 10m`**. Do not `observe` or read logs while it runs, unless the user asks or the job failed.
- Exit codes of `wait`: `0` finished (not the same as accepted), `1` invalid or refused (for example continuing a running job), `2` the wait slice ended while the job still runs (wait again), `3` error, `4` cancelled, `5` the job itself hit its own timeout and can be continued. On `5`, inspect the partial diff and ask before continuing.
- **Liaison subagents** usually cannot run slash commands. Unless your host lets the subagent invoke the plugin, the main session dispatches with the plugin and hands the job id to the liaison, or the liaison uses `scripts/agy-run.mjs` (below) end to end.
- Follow-ups and rework go through `continue --job <id> --prompt-file <new brief>`, which keeps the conversation.
- **Role ownership stays with your method.** The plugin's generic `lead` guidance ("the lead may handle small tasks itself", "the lead talks to the user") does not override `subagent-team`. The director owns user communication, acceptance and commit.
- The plugin runs agy **unrestricted** by default: it can read the repo, run commands and edit files. Its prompts are guardrails, not permission isolation. Use its `--restricted` / `setup` hardening for untrusted input.

## Without the plugin: `scripts/agy-run.mjs`

```bash
node scripts/agy-run.mjs run --repo /abs/repo --prompt-file /scratch/job.md \
  --model gemini-3.8-flash-high --write --timeout 15m
node scripts/agy-run.mjs run ... --conversation <id>      # continue with context
node scripts/agy-run.mjs models                           # list model ids
```

Raw equivalent of what it runs, from the repo directory (add `--conversation <id>` to continue). Use it when Node.js is missing:

```bash
cd /abs/repo && agy -p "$(cat /scratch/job.md)" --model gemini-3.8-flash-high --output-format json \
  --print-timeout 15m --add-dir /abs/repo --dangerously-skip-permissions   # last flag only for edits
```

With `--write` the wrapper adds `--dangerously-skip-permissions`, because headless edits need it. It saves the final reply to `last.md` (plus `result.json`, `stderr.txt`, `summary.json` in `--out-dir`) and prints a JSON summary whose `conversationId` and `continueHint` let you continue. Defaults: `--timeout 10m` (max `24h`); the wrapper kills agy's process group and every descendant at timeout + 60s. agy 1.4.10 keeps `status: "SUCCESS"` when its print timeout fires and reports it only on stderr (`[agy] print timeout after …`); the wrapper reads stderr and treats that as a timeout. When agy ends a turn while a background task it started is still running, it kills the task; the wrapper then sets `warning`, because the reply may describe work that never finished. Exit codes: `0` ok (a reply came back; `warning` set, `partial: true` if agy hit its time limit mid-answer), `1` usage error, `2` agy reported an error with no reply, `3` launch failure or unparseable output, `5` timed out with no reply (resumable with `--conversation` if an id is known). These are **agy-run's** codes; agy-staff's `wait` uses its own (above). Model ids for Claude or GPT families are refused unless you pass `--allow-any-model`. `--dry-run` shows the command.

The brief travels as a command-line argument, so keep it under 100 KB (the wrapper refuses larger ones). For bigger specs, put the spec in a file inside the repo and make the brief "Read docs/tasks/<job>.md and follow it".

## agy facts that matter

- **Headless, not ACP.** The agy CLI has no native ACP. Community bridges depend on internal interfaces that break between versions and may put personal accounts at risk. Its headless mode covers the "spec → background batch → director checks the diff" pattern. Re-evaluate if official ACP support ships (OpenCode's official ACP server is what [opencode-acp.md](opencode-acp.md) builds on).
- Fixed overhead of about five minutes and millions of cached tokens per job, and context cost grows with batch size. Still far cheaper than translating in a top-tier session.
- **Job state is per worktree.** Serialize agy writing jobs in one checkout, or give each its own worktree. While a job runs, do not edit its files. Add follow-up keys after it returns.
- It needs to run outside restrictive host sandboxes, because it uses local ports and OAuth tokens.
- **`--write` means no permission prompts at all.** A host's permission layer may refuse it. Do not retry with other flags. Ask the user or use Codex with `workspace-write`, which is a real sandbox, or OpenCode with its allow-list. After the user authorizes writes, prove the path once with a tiny job in a scratch directory before a real one.
