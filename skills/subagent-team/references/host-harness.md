# The host harness: detect, confirm, adapt

The host harness is the agent the user runs this session in. It decides what the in-house team can be (can it spawn subagents? pick a model and effort per subagent? run them in the background?), how external teams are reached (shell, plugins, MCP), and whether there is a native task list. So the first compatibility question is not "which model" but "which host".

## Detect, then confirm

1. **Detect.** `scripts/env-check.cjs` reports a host hint from the environment variables harnesses set for the commands they run. Also look at what you can see directly: your own tool list is the most reliable evidence (an `Agent` tool with `model` and `effort` parameters, `spawn_agent`, a task-list tool, MCP tools).
2. **Confirm with the user** on first use, in the setup questionnaire ([project-setup.md](project-setup.md)): "This session looks like it runs in <host> (evidence: ...). Is that right, and do you also run this project from other agents?" Pre-fill the answer so it costs one click.
3. **Record** it in the policy section: `- Host harness: <name> (confirmed YYYY-MM-DD)`; list every host the project is used from. If a later session detects a host the policy does not list, say so in one line and add it after the user confirms.

Environment hints (only the Claude Code entries were observed by the authors; the rest are *unverified* and may change between versions):

| Host | Variables |
|---|---|
| Claude Code | `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`; some versions also set `AI_AGENT` |
| Codex | `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_THREAD_ID` (*unverified*) |
| OpenCode | `OPENCODE` (*unverified*) |
| Gemini CLI | `GEMINI_CLI` (*unverified*) |
| Cursor | `CURSOR_AGENT`, `CURSOR_TRACE_ID` (*unverified*) |

A hint is never a decision: the same shell may be nested (a Codex job started from Claude Code inherits Claude Code's variables), and variables change between versions.

## Capability checklist

For the confirmed host, establish once, and write the answers into the policy (or the host notes, for hosts with a reference file):

| Capability | Why it matters | If missing |
|---|---|---|
| Spawn subagents | L2 and L3 exist in-house | Director runs L2 work as a separate, explicit design step and does L3 work itself (Solo-like); external teams can still take gated work |
| Choose a model per subagent | tiers can differ per layer | Choose by role only; ask for thoroughness in the brief |
| Choose effort per subagent | tier and effort independent | Tier only; record "effort: inherited" |
| Subagents can spawn subagents | L2 task leads can dispatch L3 | Root dispatches per the L2 lead's briefs and forwards results ([strict-mode.md](strict-mode.md)) |
| Background subagents and completion notifications | parallel work, no polling | Dispatch in the foreground, fewer and larger units |
| Message a running or finished subagent | continue instead of respawn | New agent with a full brief and the previous report pasted in |
| Native task list or shared memory | live coordination | The board's cards only ([team-board.md](team-board.md)) |
| Shell access, for the director and for subagents | external CLIs, liaisons | No liaison; the director runs external jobs, or no external teams |
| MCP servers | external teams as tools | CLI channel only |
| A question tool | the setup questionnaire | One message with numbered questions |

## Known hosts

- **Claude Code** (primary): [harness-claude-code.md](harness-claude-code.md).
- **Codex** (secondary): [harness-codex.md](harness-codex.md).
- **Other hosts** (OpenCode, Pi, Gemini CLI, Cursor and others): not tested with these skills. They can install them through the Agent Skills format. Run the capability checklist above, map whatever subagent mechanism they offer onto L2 and L3, and keep the board in the repository, which works everywhere. Write what you verify into the project's policy section, marked with the date, so the next session does not redo it.

The same CLI can be a host in one project and an external team in another (Codex as the main session, or Codex CLI as an L4 contractor). The role comes from how it is used, not from the tool.
