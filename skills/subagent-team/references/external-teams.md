# External teams (L4) and the liaison

External teams are other vendors' agents that the host harness reaches through a channel: a **CLI** run headless, a **plugin** that wraps a CLI, a protocol server such as **ACP** (Agent Client Protocol) driven by a small client, or an **MCP server** that exposes the agent as tools. They are cheap or strong, never tire of bulk work, and a different model family catches different mistakes. They cannot ask questions mid-run, do not share your context, and each job has a fixed start-up cost.

Only work that passes the outsourcing gate (SKILL.md section 3) goes to them. How to call Codex CLI, agy and OpenCode, wrappers, timeouts, resume and each team's fallback ladder: skill `cli-agent-delegation`.

## The external roster

Recorded in the project's `## Subagent team` section ([project-setup.md](project-setup.md)), one row per team. Like in-house agents, external teams have tiers: **external-fast** (cheap, fast, mechanical work) and **external-strong** (reads code, steadier on large homogeneous work, second opinions). One team often offers both tiers through different models or effort levels.

| Team | Channel | Tiers it can fill | Status in these skills |
|---|---|---|---|
| agy (Google Antigravity) | CLI (`agy -p`), plugin (agy-staff) | external-fast (flash models), external-strong (strong models) | used in real projects |
| Codex CLI | CLI (`codex exec` through `codex-run.mjs`); OpenAI's Codex plugin for Claude Code for reviews | external-strong (and external-fast with a light model at low effort) | CLI used in real projects; plugin checked from its docs and source only |
| OpenCode | ACP (`opencode acp` through `opencode-acp-run.mjs`); `opencode run` as the no-Node fallback | the tier of the model it is configured with (it reaches many providers) | wrapper checked against OpenCode 2.2.5 on small jobs (2026-11); not yet used in real projects |
| Pi coding agent | CLI *unverified* | depends on the configured model | not tested |
| Grok CLI | CLI *unverified* | depends on the models it offers | not tested |
| Any agent behind an MCP server | MCP tools in the host | depends on the agent | not tested |

`scripts/env-check.cjs` reports which of these CLIs are on `PATH`, whether the Codex and agy-staff plugins are installed, and which MCP servers the project's `.mcp.json` declares; `cli-agent-delegation`'s `doctor.mjs` adds versions, Codex's default effort and whether `opencode acp` exists, and `opencode-acp-run.mjs probe` lists OpenCode's models and effort levels without spending tokens. Presence is not capability: a binary called `pi` may be another program. Before the first job with an untested team, run one tiny read-only job (summarise a file, list exported functions) and check that it ran headless, honoured the working directory, and returned a parsable final reply. Record what you found in the roster row (*verified YYYY-MM-DD* or *unverified*).

Rules for every external team:

- **Different family from in-house.** A team that just routes back to your in-house vendor's models adds cost without a second perspective. Pick its other-vendor models.
- **Pin the model and effort per job**; never rely on the external tool's defaults, which often come from a personal config file.
- **Bound every job** with a timeout, and know how to kill it (process group, plugin's cancel command).
- **Results go to files** (final reply, log, summary) so a liaison or a later session can read them.
- **A resumable id** (session, conversation, job id) is recorded on the card the moment the job starts.

## Choosing and adjusting external teams

**At the start of a session** (SKILL.md "Start", step 5) the user picks which detected teams may take work this session. The project policy's `External delegation:` line sets whether that question is asked:

| Value | At session start |
|---|---|
| `ask` (default) | ask one multi-select question, pre-selecting the roster's teams |
| `roster` | use the roster as recorded; state it in one line |
| `none` | keep all work in-house; state it in one line |

Whatever the value, the user can change the choice at any time.

**When the user asks to add, drop or check a team mid-run** ("can Codex review this?", "add OpenCode with model X", "stop using agy", "is agy still signed in?"):

1. **Do not interrupt running jobs.** Cancel one only if the user asks, through its own channel, and confirm it stopped. Queued jobs wait until the check is done.
2. **Check, cheapest first**: `doctor.mjs` (presence, versions, plugins, Codex's default effort); `opencode-acp-run.mjs probe --repo <repo>` for OpenCode (auth methods, models, effort levels, whether the wrapper's permission set applies); the plugin's own check (`/codex:setup`, agy-staff `setup`); then one tiny read-only job for a team or model not used before. A liaison can run these; the director only sees the table.
3. **Report one table**: team, channel, found and version, signed in, model for external-fast and external-strong, may edit or review only, verified date, and what you recommend.
4. **Apply**: update the session choice in the board's progress record; if the change should last, update the roster row and its *Status* in the policy; re-run the gate for queued tasks and re-route their cards (team, model, effort); add a `lessons.md` row with the date and the user's words.

## Fallbacks

Every team has a ladder: its preferred channel, a second channel, a raw command for hosts without Node.js, then another team of the same tier, then in-house. The ladders per team are in `cli-agent-delegation`, "Channels and fallbacks". Rules that hold across teams:

- Go down the same team's ladder when the problem is the channel (plugin missing or broken, no Node). Change teams when the team itself is unavailable (sign-in, quota, network, model retired).
- The fallback team is still another vendor than in-house, and fits the job's tier; a downgrade (external-strong to a flash model) is stated, not silent.
- Never answer a refusal with looser permissions (full access, skipped permission prompts, a shell allow-list of `*`).
- The liaison reports "team unavailable" and stops; the layer above picks the fallback and records it on the card in one line.

### Adapting a new CLI

For a team without a wrapper, find out once, and write it into the roster row:

1. The headless invocation (prompt from a file or stdin, working directory, model and effort flags).
2. Write permission: how to allow edits inside the workspace only, and how to run read-only.
3. Where the final reply goes, and how to get a machine-readable result.
4. How to continue a job with its context (session or conversation id).
5. How it behaves without network, at timeout, and when it wants approval (headless runs must never wait for approval).

### ACP channel notes

An ACP agent runs as a child process and talks JSON-RPC over stdio, so a small client turns it into a headless worker with sessions, explicit model and effort selection, a stop reason, usage, cancellation and resume. The protocol leaves permission control to the agent: the client only sees the requests the agent's own rules route to it. `opencode-acp-run.mjs` therefore injects an OpenCode agent with a deny-by-default permission set and rejects any request that still arrives. Another ACP agent needs its own way to restrict tools before it may edit.

### MCP channel notes

An agent behind MCP is called as a tool of the host, so the call is synchronous for the agent that makes it, and only agents that have that MCP server's tools can use it (*unverified* whether subagents inherit the host's MCP tools in every harness: check the subagent's tool list). Long jobs through MCP block the caller: give them to a liaison, never to the director. Prefer the CLI channel for jobs longer than a few minutes.

## The liaison

A liaison is an **L3, low-tier, low-effort** in-house subagent assigned to one external job, or to one external team for a series of sequential jobs. It spends cheap tokens on waiting, routine checks and simple answers, so the director's and the experts' contexts only see results and real questions.

Raise the liaison to mid tier when its acceptance checks require reading code (docs-against-code syncs, test backfills that must follow patterns).

### What the liaison does

1. **Dispatch** the job exactly as the frozen brief and the card say (team, model, effort, sandbox, lease, timeout), or take over a job id the director already started. Write the job and conversation ids to the card immediately.
2. **Wait** with bounded waits (below). No log reading while the job runs unless it failed.
3. **Collect**: the final reply, then the truth: `git status --short` and `git diff --stat` against the lease.
4. **Check** with the acceptance commands from the card; for content work, the mechanical checks (identical key sets, placeholders and escapes preserved, order kept).
5. **Answer straightforward questions.** External agents report blockers in their final reply ("stopped: the key list has no entry for X"). If the answer is already in the brief, the contract, the card or a repository fact the liaison can look up, it answers by continuing the same job with the answer quoted from its source.
6. **Rework once** for mechanical failures: continue the same job with the concrete failure output.
7. **Report** to the card holder above it at real transitions only: dispatched, returned, accepted or rework, escalated. Keep the card's status and log current; the liaison is the holder of its job's card.

### What the liaison escalates (to L2, or L1 if the flow has no L2)

- anything that needs a decision the brief does not already make, or a contradiction in the spec
- the second failed round (the layer above decides whether to take the work in-house)
- changes outside the lease, or a request to widen it
- a resumable timeout, partial results, or the external team being unavailable (quota, auth, network)
- anything touching a never-outsourced path

The liaison never decides product or architecture, never edits code itself (only its card), never commits, never talks to the user, and never starts a second job for the same work while one is running.

### Waiting without burning the host

- **Claude Code**: dispatch the liaison as a background subagent. Inside it, start the wrapper detached with an `--out-dir`, then wait in the foreground in bounded slices: an `until` loop on the result file (`summary.json` for the wrappers in `cli-agent-delegation`; a fresh `--out-dir` per round, since it is written only at the end) with an upper bound below the shell tool's time limit, the agy-staff plugin's `wait <job> --timeout <below the tool limit>`, or the Codex plugin runtime's `status <job> --wait --timeout-ms <below the tool limit>`, repeated while it returns "still running". Nested background notifications go to the root, not reliably to the liaison ([harness-claude-code.md](harness-claude-code.md)), so the liaison must not rely on them.
- **Codex as host**: each wake-up carries full context, so give the liaison few, long jobs and long wait slices (*unverified* how subagent waits behave; record what you observe).
- **No subagents, or subagents without a shell**: there is no liaison. The director runs the job in the background and reacts to the completion notification, as in `cli-agent-delegation`.

### Liaison brief

The liaison gets a brief like any subagent; template in [brief-template.md](brief-template.md) ("Liaison brief"). It must contain the frozen job brief (or its path), the card path, the acceptance commands, the answer sources it may quote from, and the escalation target.
