# agy (Google Antigravity CLI)

How to run agy as an external team. The preferred route is agy's official ACP server, `agy acp`, through `scripts/agy-acp-run.mjs`; agy-staff provides the working method, and print mode is a fallback with a stated risk. Script paths are relative to the skill's directory. Gate, brief rules, fallback ladder and acceptance are in [SKILL.md](../SKILL.md); why ACP comes first is in [compliance.md](compliance.md). agy also replaces the deprecated Gemini CLI ([acp-agents.md](acp-agents.md)).

## Choosing the model: two levels

Whichever channel you use, every agy job picks one of two levels on purpose, for each dispatch and each rework round. Over ACP the model and the thinking level are two separate settings (`--model gemini-4-argon --effort medium`). Print mode and older compute plans write them as one suffixed id (`gemini-3.8-flash-high`); `agy-acp-run.mjs` splits such an id for you. As of 2026-11:

| Level | Model (e.g.) | Think of it as | Use for |
|---|---|---|---|
| external-strong | `gemini-4-argon` at `medium` / `high` | an outside contractor at about the in-house mid tier (Claude Sonnet 5.5 level) | large homogeneous implementation from a fixed spec, test backfills following existing patterns, read-only reviews |
| external-fast | `gemini-3.8-flash` at `high` (`medium` for purely mechanical work); `gemini-4-hydrogen` is agy-staff's default fast worker, *not yet measured here* | a cheaper contractor one step below, with more staying power: lower cost, and its quota lasts longer over long or repeated batches | translations, bulk copy, mechanical replacements, filling in from a template, long runs of similar jobs |

- Start with the fast level when the acceptance check is fully mechanical (key sets, placeholders, snapshots). Use Argon when the work means reading existing code or keeping many files consistent with each other.
- If the fast level fails the acceptance check because it reasoned badly (not because the brief was wrong), retry once on Argon. Do not keep retrying on the fast level. Moving down from Argon, for quota or cost, is a downgrade: say so in one line and record it on the job's card.
- agy's own default model (`gemini-4-neon` at `high` on 2026-11-22) and the orchestrator variants have no tier assigned here yet; do not inherit them, pin a model on every job.
- Argon being roughly at the in-house mid tier does not let it take work that fails the outsourcing gate. The gate decides *whether* work goes out; the level only decides *how carefully* it is done.
- List what the account really offers before the first job: `node scripts/agy-acp-run.mjs probe --session-check --repo <empty scratch dir>` (no prompt, no quota). agy also offers Claude and GPT models to some plans; under a host of the same vendor they route work back home and never count as a second opinion. The wrapper refuses them unless `--allow-any-model`.

## Preferred: `agy acp` through `scripts/agy-acp-run.mjs`

Needs agy 1.5.0 or newer (1.5.12 or newer recommended); `doctor.mjs` checks it. Every flag below was checked against agy 1.5.14 on 2026-11-22, including the real read-only and write jobs described under "What the field check showed".

```bash
node scripts/agy-acp-run.mjs probe                                   # handshake only: version, auth methods, capabilities
node scripts/agy-acp-run.mjs probe --session-check --repo /abs/empty # + modes, models, thinking levels (empty dir only)
node scripts/agy-acp-run.mjs run --repo /abs/repo --prompt-file /scratch/job.md \
  --model gemini-3.8-flash --effort high --write --timeout 20m --out-dir /scratch/agy-T3a-1
node scripts/agy-acp-run.mjs run ... --session <id> --out-dir /scratch/agy-T3a-2   # rework, same conversation
```

What it does on every run:

- Starts `agy acp` in the repo, names itself truthfully (`clientInfo: agy-acp-run`), and advertises no file-system or terminal capability, so agy uses its own tools under its own rules.
- Refuses agy older than 1.5.0, warns below 1.5.12, and removes ambient Google credential variables (see [compliance.md](compliance.md)).
- Selects the session mode, then the model, then the thinking level, and checks that each one stuck. Read-only jobs use `default` mode (agy asks before every edit and command); `--write` uses `accept-edits` (agy itself approves edits inside the workspace). It never selects `auto` and never passes `--dangerously-skip-permissions`.
- **Rejects every permission request** and lists each in the summary. **Commands are rejected in both modes**, so an agy job never runs tests or builds. The liaison runs the acceptance commands in-house.
- Sends the brief as one prompt (no command-line size limit), waits, then closes the session. Closing also stops subagents and background tasks agy started; a tool call still running at that moment is flagged (`unfinishedToolCalls`).
- Writes `last.md`, `reply.md`, `events.jsonl`, `stderr.txt` and `summary.json` to `--out-dir` (a fresh one per round), and prints the summary. `resumeHint` continues the session with `session/resume`; updates replayed from history are ignored.
- Exit codes: `0` reply received (`warning` set when something needs a look, `partial` at a length limit), `1` usage, `2` the agent gave no usable result, `3` setup (agy too old, model, level or mode not offered, launch failure), `5` timeout (resumable), `130`/`143` interrupted. The summary separates the causes: `deniedAction` (agy stopped at a rejected request), `authRequired` (the user signs in), `quotaExhausted` (record it in the quota ledger; never retry or switch accounts).

### What the field check showed (agy 1.5.14, 2026-11-22)

- Modes `default`, `accept-edits`, `auto` and `plan`; options `model`, `thought_level` (`low`, `medium`, `high`, `xhigh`; default `high`) and `mode`; `session/resume`, `session/close`, `loadSession`; ACP protocol version 1.
- Read-only job asked to create a file and run `touch`: the edit came as a permission request, the wrapper rejected it, no file appeared, the command did not run.
- **A rejected request ends agy's turn at once, with no reply.** Write the brief so that the job never needs a denied action: read-only jobs make no edits, and no job runs shell commands ("Do not run any shell commands; the checks run elsewhere"). `deniedAction` in the summary means the brief, not the model, needs fixing.
- Write job: the file was created without a request in `accept-edits`. A command in the same mode still came as a request and was rejected. Resume continued the earlier conversation.
- Whether rules from agy's own `settings.json` (for example the allow-list agy-staff's `setup` writes) let commands run without a request in an ACP session is *unverified*; the wrapper rejects every request it does receive.

## agy-staff: the method, not the runner

[agy-staff](https://github.com/keli-wen/agy-staff) (MIT) gives Claude Code, Codex, Pi, OpenCode and DeepSeek Harness a set of agy personas: `staffer`, `researcher`, `reviewer`, `implementer` and `ask`, plus `lead`, `brain` and `jobs`. **Keep it installed and current** (install, upgrade and smoke test below), and use it as follows.

**Borrow its method.** Its personas are good brief openers: the implementer's dirty-workspace rule (name the files that were already changed, never overwrite or deliver them), the reviewer's severity-ranked findings with `file:line`, the researcher's cited sources with unverified claims marked. Its job discipline matches ours: one background wait per job, no progress polling, inspect the partial diff before continuing a job that hit its own timeout. Put those into the brief file you pass to `agy-acp-run.mjs`.

**Do not dispatch through its runner when ACP is available.** Its companion runs `agy -p … --output-format stream-json --add-dir <repo>`, which is print mode. By default it runs **unrestricted**, so agy may edit files and run commands with no approval, and its prompts are guardrails, not permission isolation. Use it to dispatch only as the stated fallback: `agy acp` is unavailable, or the host cannot start it.

When you do fall back to it:

- `/agy:implementer` (`$agy:implementer` in Codex) for edits, `researcher` for surveys, `reviewer` for a read-only second opinion. Long briefs go in a file and are passed with `--prompt-file`. Choose the model with `--model <id>` and `--effort <level>`.
- Collect each job with **one background `wait <job-id> --timeout 10m`**; do not `observe` or read logs while it runs. `wait` exit codes: `0` finished (not the same as accepted), `1` invalid or refused, `2` the wait slice ended while the job still runs (wait again), `3` error, `4` cancelled, `5` the job hit its own timeout and can be continued (inspect the partial diff and ask first).
- Follow-ups go through `continue --job <id> --prompt-file <new brief>`. Run `wait`, `status` and `result` in the same permission context that started the job; otherwise a running job looks crashed.
- Use its `--restricted` profile (after its `setup`) for untrusted input; it shrinks the blast radius but is not a sandbox.
- **Role ownership stays with your method.** Its `lead` guidance ("the lead may handle small tasks itself", "the lead talks to the user") does not override `subagent-team`: the director owns user communication, acceptance and commit.
- Liaison subagents usually cannot run slash commands: the main session dispatches with the plugin and hands the job id to the liaison.

Install, upgrade, smoke test. The upgrade command is offered as soon as `doctor.mjs --check-updates` finds a newer release, and run after the user agrees:

```bash
claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff
claude plugin marketplace update agy-staff && claude plugin update agy@agy-staff     # upgrade, then restart Claude Code
codex plugin marketplace add https://github.com/keli-wen/agy-staff && codex plugin add agy@agy-staff
codex plugin marketplace upgrade && codex plugin add agy@agy-staff                  # upgrade, then restart Codex
```

Smoke test after install or upgrade: `/agy:ask reply with OK` (Codex: `$agy:ask reply with OK`). Updating the plugin does not update agy itself: run `agy update`, then `agy --version`.

## Fallback: print mode through `scripts/agy-run.mjs`

Only when `agy acp` is unavailable (agy older than 1.5.0: offer `agy update` first) or the host cannot run it. Every run prints the non-ACP risk on stderr and records `channel: "print"`; repeat that risk in the dispatch line.

```bash
node scripts/agy-run.mjs run --repo /abs/repo --prompt-file /scratch/job.md \
  --model gemini-3.8-flash-high --write --timeout 15m
node scripts/agy-run.mjs run ... --conversation <id>      # continue with context
node scripts/agy-run.mjs models                           # list model ids
```

Raw equivalent, from the repo directory, when Node.js is missing:

```bash
cd /abs/repo && agy -p "$(cat /scratch/job.md)" --model gemini-3.8-flash-high --output-format json \
  --print-timeout 15m --add-dir /abs/repo --dangerously-skip-permissions   # last flag only for edits
```

With `--write` the wrapper adds `--dangerously-skip-permissions`, because headless edits need it: agy then runs with no approval at all, commands included. Without `--write`, actions that need approval are silently not performed. It saves the final reply to `last.md` (plus `result.json`, `stderr.txt`, `summary.json` in `--out-dir`) and prints a JSON summary whose `conversationId` and `continueHint` let you continue. Defaults: `--timeout 10m` (max `24h`); the wrapper kills agy's process group and every descendant at timeout + 60s. agy 1.4.10 kept `status: "SUCCESS"` when its print timeout fired and reported it only on stderr; the wrapper reads stderr and treats that as a timeout. When agy ends a turn while a background task it started is still running, it kills the task; the wrapper then sets `warning`. Exit codes: `0` ok (`warning` set, `partial: true` if agy hit its time limit mid-answer), `1` usage error, `2` agy reported an error with no reply, `3` launch failure or unparseable output, `5` timed out with no reply (resumable with `--conversation`). These are **agy-run's** codes; agy-acp-run and agy-staff's `wait` use their own. Model ids for Claude or GPT families are refused unless you pass `--allow-any-model`. The brief travels as a command-line argument, so keep it under 100 KB.

## agy facts that matter

- Fixed overhead of about five minutes and millions of cached tokens per job (measured in print mode), and context cost grows with batch size. Still far cheaper than translating in a top-tier session.
- **A reply is not success when the run shows errors.** Print mode can exit 0 while its log has network `ERROR` lines; over ACP a turn can end after rejected requests or with tool calls still running. Check the summary's `warning`, `deniedAction` and `unfinishedToolCalls`, then the diff, before acceptance.
- **Job state is per worktree.** Serialize agy writing jobs in one checkout, or give each its own worktree. While a job runs, do not edit its files. Add follow-up keys after it returns.
- agy needs its local language-server port and its OAuth credentials, so it must run outside restrictive host sandboxes (Codex's `workspace-write` blocks both). Start and manage a job in the same permission context.
- **Never loosen permissions after a refusal.** No print-mode `--write` as a way around a rejected ACP request, no `auto` mode. Ask the user, or use Codex with `workspace-write` (a real sandbox) or OpenCode with its allow-list. Before the first print-mode write job, prove the path once with a tiny job in a scratch directory.
