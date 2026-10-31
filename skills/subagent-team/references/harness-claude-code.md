# Claude Code notes

How the method maps onto Claude Code, and the behaviour observed in real sessions. Items marked *observed* were seen in practice and may change with versions; re-check when something does not match.

## Tool mapping

| Action | Claude Code |
|---|---|
| Spawn a subagent (cold start) | `Agent` tool: `subagent_type`, `model`, `effort`, `prompt`, `description`, `isolation`, and in some versions `run_in_background` (parameters vary by version; check the tool's schema) |
| Continue an existing subagent with its context | `SendMessage` to the agent's name or id. A new `Agent` call starts from zero. |
| List running / finished agents | `ListAgents` |
| Run an external CLI agent | `Bash` with `run_in_background: true`; the harness notifies on exit (see skill `cli-agent-delegation`) |
| Wait for a condition without bare `sleep` | `Monitor`, or an `until` loop with an upper bound |
| Skill discovery | `.claude/skills/*/SKILL.md` in the project, `~/.claude/skills/` for the user, or a plugin |
| Native task list (live board) | `TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate` where present: tasks with status, owner and `blockedBy` dependencies, shared by the session's agents *observed in recent versions; not persisted with the repository* |
| Message the main session from a background subagent | `SendMessage` with `to: "main"` (observed); the liaison's escalation path when the director is its next layer |
| Detect the host | `CLAUDECODE=1` and `CLAUDE_CODE_ENTRYPOINT` in the shell environment (observed) |

## Models and effort

- Per-call `model` takes an alias: `sonnet`, `opus`, `haiku`, `fable` (no full ids, no `inherit` on the call). Agent definition files may use full ids.
- Per-call `effort` (`low`, `medium`, `high`, `xhigh`, `max`, depending on the model) overrides the definition's `effort:`; the `CLAUDE_CODE_EFFORT_LEVEL` environment variable overrides both. Older versions rejected the parameter (one session failed with an empty error until `effort` was removed): if a dispatch fails, drop parameters one at a time instead of retrying the same call, and fall back to tier-only selection plus "be thorough" in the brief.
- When you did not pass `effort`, report "effort: inherited from definition/default", never a level you did not set.
- Agent definitions (`.claude/agents/*.md`) fix a model + effort + tool set for repeated use. Frontmatter: `name`, `description` (required), `tools`, `disallowedTools`, `model`, `effort`, `color`, `maxTurns`, `isolation`, and more. Plugin-provided agents ignore `permissionMode`, `hooks` and `mcpServers`. A reviewer definition with `tools: Read, Grep, Glob, Bash` has no edit or write tools, but Bash can still change files: it is read-only by instruction, not by construction. Fingerprint the working tree (see [verification.md](verification.md)). Ready-made definitions: the plugin's `agents/`, prompt in [reviewer-prompt.md](reviewer-prompt.md).

## The layers in Claude Code

- L1 is the main session. L2 and L3 are `Agent` dispatches with a `model` alias per tier and `effort` per call; ready-made L3 reviewer definitions ship in the plugin's `agents/`.
- The native task list is the live view; the board in the repository ([team-board.md](team-board.md)) stays the source of truth, because the task list does not reach external teams or the next session. Create one native task per card when you use both, and put the card path in its description.
- **Nesting depth can be 1.** Some environments set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` (observed in a cloud session): subagents cannot spawn subagents. An L2 task lead then writes the briefs and the root dispatches them (see "Subagents may lack the `Agent` tool" below).
- **Liaisons** need `Bash`. They start the external wrapper detached with an `--out-dir` and wait in bounded foreground slices, below the `Bash` tool's time limit, on the result file; they do not rely on background notifications, which go to the root (next section).

## Background agents (observed)

- `Agent` runs in the background by default. If your very next step depends on the result, dispatch with `run_in_background: false` where the parameter exists; where it does not (agents always run in the background), wait for the completion notification before that step.
- **Nested background agents report to the root.** When an L2 task lead (task lead) subagent dispatches background implementers or reviewers, they appear next to it in the root's `ListAgents`, and their completion reports are delivered to the root, not reliably to the task lead.
- **Task leads get their turn ended while waiting.** A task lead waiting on a background child was repeatedly forced to hand back an "unfinished" report, three or four times in one slice.

What worked:

| # | Who | Action |
|---|---|---|
| 1 | Task lead | Dispatch in the foreground when the next step depends on the child |
| 2 | Root | On a child's completion report, `SendMessage` the task lead with a summary: verdict, changed files, gate numbers, key quotes |
| 3 | Task lead | When forced to hand back, reply with one progress line ("implementer X dispatched, waiting"), no repeated background |
| 4 | Root | When continuing it, say "wait for X's completion, do not start a duplicate implementer" |

The root only forwards in this situation: it does not read the diff, judge acceptance or instruct the implementer. Another option that worked once: after continuing a background implementer, the task lead ran a bounded foreground wait on the implementer's output files until they stopped changing; the hand-back then reached the task lead. Always bound such waits.

- **Subagents may lack the `Agent` tool.** In one cloud session the task lead subagent had no `Agent` tool and could not dispatch. Then: the task lead writes the implementer and reviewer briefs and does acceptance; the root dispatches them per those briefs and passes the results back with `SendMessage`.
- Tools that exist only in the root session (for example a browser extension driving the user's own browser) cannot be delegated. The task lead lists the pages and expected results; the root performs the browser check.

## Other observed behaviour

- **Silent truncation of large writes**: a write once landed only 272 bytes without an error. Check `wc -l` / `wc -c` and the file's last lines after writing; write in sections or retry once with another agent; after two failures, report instead of retrying.
- **Permission prompts block irreversible commands** such as `git stash` and `rm -rf`. Do not design reviews that need them to build a baseline; provide the "before" data in the brief.
- **Plugins are not capabilities.** A plugin can be just a skill that assumes some MCP server or CLI mode exists. When the underlying tool is missing (for example a Codex dispatch plugin that expects a Codex MCP server the installed CLI no longer offers), call the underlying CLI directly and keep the plugin's parameter conventions.
- **Local memory** (`~/.claude/projects/<project>/memory/`) does not travel with the repo or to other tools. Store rules in the repository and keep only pointers in memory (skill `agent-handover`).
- **Attribution**: if the harness supplies commit attribution lines, use them verbatim; do not hard-code model names.
