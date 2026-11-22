# Other ACP agents: what T3 Code does, and what carries over

[T3 Code](https://github.com/pingdotgg/t3code) (MIT, `pingdotgg/t3code`) is a control surface that drives Claude Code, Codex, Cursor, Grok Build, OpenCode, Pi, Antigravity, Kiro, Muse Code, fx and any agent in the ACP Registry from one UI. Its FAQ says it stays within the agents' terms because everything outside its vendor-built integrations uses official ACP bindings, and it declines to build account switchers because they risk bans; those rules are in [compliance.md](compliance.md). Its integration design is the most worked-out public answer to "how do we support many agent CLIs without a special case per tool". This page records what we learned from its docs (internals, provider guides, permission modes), checks the parts that matter against real agents, and turns them into a procedure for adding an ACP agent as an external team.

**Status (2026-11):** the T3 Code part comes from its documentation and the shared ACP adapter source, not from running it. The field check below ran the handshake (and, where signed in, session setup) against three installed agents. **No job has been run** on any agent other than the ones with their own page ([codex.md](codex.md), [agy.md](agy.md), [opencode-acp.md](opencode-acp.md)). Treat every agent here as *not tested for work* until the admission checklist passes.

## Verdict

| Question | Answer |
|---|---|
| Use T3 Code itself as our dispatch channel? | **No, optional at most.** It is a GUI plus server product ("very early", mostly closed to contributions), its CLI hands a job to the project's default model and permission mode (initial default: *Full access*), and its documented CLI has no per-call model, effort or sandbox flags. Fine for a user who already runs it; not a channel the skill can rely on. |
| Borrow its design? | **Yes.** ACP as the one generic channel, the ACP Registry as discovery, a per-agent "flavor" only when the spec leaves a gap, honest capability reporting, and an admission checklist. |
| Is a generic ACP runner feasible? | **Yes**, with three agent-specific parts that cannot be generic: how to make the agent read-only, how to set effort, how to continue a session (see "Building a generic runner"). The protocol core now lives in `scripts/acp-core.mjs`, shared by the OpenCode and agy wrappers. |
| Does it cover more tools? | The Registry listed 43 agents on 2026-11 (Gemini CLI, now deprecated here; Grok Build, Cursor, Codex and Claude adapters, Goose, Kimi, Qwen Code, Mistral Vibe, Copilot, Junie, Kilo, Pi and more). Fetch the current list: `curl https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`. |

## How T3 Code supports many agents

1. **Three integration shapes, cheapest first.** An agent that speaks ACP starts as a *generic registry entry* with no per-agent code. It gets a dedicated driver only when it needs behavior the spec does not cover, and then that is a small *flavor* over the shared ACP adapter (Grok and Antigravity are examples). Agents with their own protocol (Codex app server, Claude SDK, Pi RPC) get a native adapter. Rule it enforces: never add agent-id checks to the generic path.
2. **Local ACP command.** Any executable plus literal arguments (no shell expansion) can be added without a registry entry. Models and reasoning options come from ACP itself, including model ids that carry parameters.
3. **Registry entries describe how to launch.** Each has `distribution`: `npx` or `uvx` (a package pinned to an exact version, optional extra `args`) or `binary` (per-platform archive, `cmd`, `args`, optional `sha256`). T3 Code verifies the checksum when present, runs agents from its own tool directory, and offers an *executable override* to use a binary the user already has. Registry agents are third-party code.
4. **Capabilities describe only what the agent really does.** Fork, rollback, steering and subagents are switched off where missing, and the orchestrator falls back (for example to a text summary instead of a native fork). A capability left on that fails at runtime counts as a bug.
5. **Permission modes: offer only what the agent enforces itself.** T3 Code does not imitate a missing mode by answering approvals itself, because its check is weaker than the agent's own enforcement. ACP agents "run their own tools in their own mode"; T3 only answers their approval requests according to the thread's mode.
6. **State belongs to an instance, not a driver.** Two accounts of one agent must not share sessions, catalogs or credentials; ambient credentials the instance did not configure are removed. ACP itself does not describe account isolation.
7. **Health checks never open a session.** Opening one can start MCP servers, run hooks or launch a login browser. Probes use initialization only; authenticated catalog calls wait for an explicit action.
8. **Updates run only through the installer that provably owns the binary**; otherwise the agent's own updater, or manual.
9. **Handoff between agents is a text summary**, never native context. Anything crossing agents must be re-stated.
10. **Outside agents can drive T3 through its MCP server** (OAuth over HTTP) and scripts on the host can use `t3 thread start|send|show|list` (`send --wait` exits 1 on failure, 2 when the agent waits for an answer; `--json`; `--worktree <base-branch>`). Documented, not run here.

## Field check, 2026-11

Run with the wrapper's own `AcpClient` (unchanged), in an empty scratch directory, `initialize` then `session/new`, no prompt sent. agy has its own page and runner, so its row is there for comparison:

| Agent | Launch | `authMethods` | `agentCapabilities.sessionCapabilities` | `session/new` |
|---|---|---|---|---|
| Gemini CLI 0.63.0 (deprecated, see below) | `gemini --acp` | `oauth-personal`, `gemini-api-key`, `vertex-ai`, `gateway` | none (`loadSession: true`) | failed, not signed in: plain message "API key is missing or not configured", no `auth_required` |
| Grok Build 1.0.52 | `grok agent stdio` | `grok.com` | `list`, `resume`, `close` | first run not signed in: "Authentication required"; after sign-in succeeded: **no modes**, options `model` (4 models) and `reasoning_effort` (`xhigh`, `high`, `medium`, `low`; **default `xhigh`**) |
| Cursor agent 2026.10.01 | `agent acp` | `cursor_login` | `list` only (`loadSession: true`) | succeeded; modes `agent`, `plan`, `ask`; 47 models |
| agy 1.5.14 (2026-11-22; [agy.md](agy.md)) | `agy acp` | `oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform` | `resume`, `close`, `load`, `list`, `additionalDirectories` | succeeded; modes `default`, `accept-edits`, `auto`, `plan`; options `model` (9), `thought_level` (`low` to `xhigh`, default `high`), `mode`. Small read-only, write and resume jobs were then run through `agy-acp-run.mjs` |

What this shows:

- **The handshake is generic.** Protocol version 1, JSON-RPC over stdio worked unchanged on all three, as it did on OpenCode. Launch commands differ (`--acp`, `agent stdio`, `acp`); take them from the Registry entry.
- **Capabilities differ and must be read, not assumed.** Only Grok offers `session/resume`; the others offer `loadSession` (which replays the old conversation as updates; see traps).
- **Effort is not a separate option everywhere.** Cursor's `model` option carries parameters inside the value (`name[effort=high,context=300k]`), so "pick a model, then pick an effort" does not map. Another reason T3 Code's docs note model ids "that contain JSON".
- **Not signed in looks different per agent.** `isAuthError` in the wrapper matches `-32000` and the words "auth required"/"authenticat", which catches Grok but not Gemini's message. A generic client needs a per-agent auth-failure pattern, and must report an unknown state as unknown.
- **Grok review today**: decline and offer Codex `read-only` or Cursor in `ask` mode. There is no runner here for Grok yet (see "Building a generic runner").
- **A natively read-only mode may exist** (Cursor `ask`, and `plan`), which is the right thing to select for reviews. Not every agent has one: Grok Build offers no mode at all over ACP, so a read-only job on it cannot be enforced through the protocol (use another team for reviews, or accept edit jobs only in a discardable worktree).
- **Defaults are personal and strong.** Grok starts at `reasoning_effort: xhigh`; pin effort on every job, as with Codex.
- **Effort can be its own option** (Grok: `thought_level` category) or live in the model id (Cursor). Look for the `thought_level` category first.

## Deprecated: Gemini CLI

Gemini CLI has been merged into the Antigravity CLI (`agy`). Do not offer it as an external team; use agy ([agy.md](agy.md): `scripts/agy-acp-run.mjs` over `agy acp`), which reaches the same Gemini models. Only when the user insists on Gemini CLI, treat it like any new ACP agent: run the checklist below first, and say in the roster that it is deprecated. Its Registry entry may still exist; that does not make it a recommended team. The Registry also lists a Google Antigravity ACP entry; we use the `agy acp` server of the agy the user already installed, which is the same official server, rather than a Registry download.

## Admission checklist for a new ACP agent

Do these in order and stop at the first failure. Record the result (launch command, version, capabilities, verified date, edit or review only) in the project's roster.

1. **Gate and vendor.** The job passes the gate in [SKILL.md](../SKILL.md), and the agent does not route back to your in-house vendor.
2. **Find the launch command.** From the Registry entry (`distribution`) or `<cli> --help`. Prefer the CLI the user already installed over a download. If you must run an `npx`/`uvx` package, use the exact pinned version; for a binary, verify `sha256`. Review third-party agents' source and license first, and ask the user before installing anything.
3. **Handshake only.** `initialize` with no client file-system or terminal capabilities. Record `agentInfo.version`, `authMethods` and `agentCapabilities` (`loadSession`, `sessionCapabilities.resume|fork|list|close`, `promptCapabilities`, `mcpCapabilities`). No session exists yet, so no hooks, MCP servers or login can start.
4. **Sign-in belongs to the user.** If `session/new` or a prompt fails with an auth error, stop and ask the user to sign in with the agent's own CLI (many offer a device flow for headless machines, for example `codex login --device-auth`, `grok login --device-auth`). Never handle credentials, and never pass your in-house vendor's API keys through.
5. **Session setup in a scratch directory.** Resolve symlinks first (macOS `/tmp` is a symlink and some agents compare canonical paths). Read `modes` and `configOptions`. Required: the intended model is offered; you know where effort lives (a `thought_level` option, encoded in the model id, or nowhere: say so); and there is a mode that is read-only natively. Without a read-only mode the agent may only do edit jobs inside a worktree you can discard.
6. **Pin and verify.** Set model, effort and mode with `session/set_config_option` (or `session/set_mode`), then read the response and check the value stuck. Options can appear after the session opens or only once a model runs; wait until the option is advertised before writing it, and treat one the live session does not offer as unavailable, not as success. A "default" entry is a sentinel for "switch back", never a model id to send.
7. **Prove enforcement with one tiny job.** In the scratch directory, in read-only mode, ask it to create a file; confirm no file exists and that a permission request (if any) was rejected. Then in edit mode ask for the same file and confirm it appears. Only now run the first real job, small, with the diff checked.
8. **Write it down.** Roster row, plus the lesson if the agent surprised you.

## Client policy for permission requests

ACP gives the client no portable sandbox. The agent's own mode and settings are the real enforcement; whatever the client answers is a second, weaker layer ("client-boundary"). So:

- **Pick the mode first.** An agent in a bypass or auto mode never asks, so a client that rejects requests protects nothing. Refuse to run if you cannot confirm the mode you set.
- **Reject by default**, so a headless run never waits. Never answer with `allow_always`: it can outlive the session. Use `allow_once` only for the kinds the job may do (`edit`, `delete`, `move` in a write job); keep `execute` rejected unless the agent has an allow-list of its own, and let the liaison run acceptance commands.
- **Never allow a `switch_mode` request.** It is how plan or ask modes end.
- Every request needs a decline option the agent honors; pass the agent's own option ids through unchanged. A display label is not a valid reply.
- Capabilities `fs` and `terminal` stay off, so the agent uses its own tools under its own rules. T3 Code runs terminals itself only for an agent (Devin) that needs it.

## Traps several T3 Code adapters hit

Each applies to a headless runner too:

- **Cancel before the turn starts** can be ignored or can leave an unsaved session. Wait for the first update (or the prompt response) before treating `session/cancel` as effective; on timeout still kill the process group afterwards.
- **Work the agent starts itself** (background commands, subagents) can finish or start after the turn ended. The summary may describe work that never finished; check the diff, as with agy.
- **`session/load` replays the old conversation** as `session/update` notifications. Ignore updates until your new prompt is sent, or the "final reply" mixes in old text. (Per the ACP spec; not yet seen in our wrapper, which uses `session/resume`.)
- **Rework without resume.** ACP cannot rewind a conversation. If neither `resume` nor `loadSession` is offered, rework is a fresh session whose brief contains the first run's diff and the concrete failure. The same applies when a fallback team takes the job: the handoff is text only.
- **Quota and rate limits are not generic failures.** Report them as such with the reset time if given, so the layer above can switch teams instead of retrying.
- **Probes must not start sessions** except in an empty scratch directory and when you ask for it. `session/new` can start hooks and MCP servers in a real repository.
- **Never self-update an agent CLI** from a job. Updates belong to the installer that owns the binary.

## Building a generic runner (partly done)

`scripts/acp-core.mjs` holds the generic parts: `AcpClient` (JSON-RPC framing), `startAgent` with any launch command and arguments, process-group stop and kill, a session-update tracker, the reject-by-default permission answer. Two wrappers sit on it, each with its own flavor: `opencode-acp-run.mjs` (read-only through an injected agent in `OPENCODE_CONFIG_CONTENT`, a separate effort option) and `agy-acp-run.mjs` (read-only through the native `default` mode, `accept-edits` for writes, a `thought_level` option, credential variables stripped). What still stops a single runner for every agent:

- Read-only enforcement differs per agent: an injected agent (OpenCode), a native mode (`default` on agy, `ask` or `plan` on Cursor), or nothing (Grok), in which case edit jobs only.
- Both assume `model` plus a separate effort option (`effort` or `thought_level`); Cursor encodes effort in the model id.
- Resume uses `session/resume` only; Gemini and Cursor offer `loadSession`.
- The auth-error test is OpenCode- and Grok-shaped.

Next step if more agents need it: one `acp-run.mjs` with a flavor table (launch command, how to reach read-only, where effort lives, how to resume, auth-failure pattern) over `acp-core.mjs`, `probe` doing the handshake only. Test it offline with a fake ACP agent like the existing fake `opencode` and fake `agy acp`, then run the admission checklist once per real agent. Until then, write a small flavor wrapper on `acp-core.mjs`, or use the agent's own headless CLI after the same checklist, with the non-ACP risk stated.
