# Claude Code notes

How the method maps onto Claude Code, and the behaviour observed in real sessions. Items marked *observed* were seen in practice and may change with versions; re-check when something does not match.

## Tool mapping

| Action | Claude Code |
|---|---|
| Spawn a subagent (cold start) | `Agent` tool: `subagent_type`, `model`, `effort`, `prompt`, `description`, `run_in_background`, `isolation` |
| Continue an existing subagent with its context | `SendMessage` to the agent's name or id. A new `Agent` call starts from zero. |
| List running / finished agents | `ListAgents` |
| Run an external CLI agent | `Bash` with `run_in_background: true`; the harness notifies on exit (see skill `cli-agent-delegation`) |
| Wait for a condition without bare `sleep` | `Monitor`, or an `until` loop with an upper bound |
| Skill discovery | `.claude/skills/*/SKILL.md` in the project, `~/.claude/skills/` for the user, or a plugin |

## Models and effort

- Per-call `model` takes an alias: `sonnet`, `opus`, `haiku`, `fable` (no full ids, no `inherit` on the call). Agent definition files may use full ids.
- Per-call `effort` (`low`, `medium`, `high`, `xhigh`, `max`, depending on the model) overrides the definition's `effort:`; the `CLAUDE_CODE_EFFORT_LEVEL` environment variable overrides both. Older versions rejected the parameter (one session failed with an empty error until `effort` was removed): if a dispatch fails, drop parameters one at a time instead of retrying the same call, and fall back to tier-only selection plus "be thorough" in the brief.
- When you did not pass `effort`, report "effort: inherited from definition/default", never a level you did not set.
- Agent definitions (`.claude/agents/*.md`) fix a model + effort + tool set for repeated use. Frontmatter: `name`, `description` (required), `tools`, `disallowedTools`, `model`, `effort`, `color`, `maxTurns`, `isolation`, and more. Plugin-provided agents ignore `permissionMode`, `hooks` and `mcpServers`. A reviewer definition with `tools: Read, Grep, Glob, Bash` is read-only by construction; see the plugin's `agents/` or [reviewer-prompt.md](reviewer-prompt.md).

## Background agents (observed)

- `Agent` runs in the background by default. If your very next step depends on the result, dispatch with `run_in_background: false`.
- **Nested background agents report to the root.** When an orchestrator subagent dispatches background implementers or reviewers, they appear next to it in the root's `ListAgents`, and their completion reports are delivered to the root, not reliably to the orchestrator.
- **Orchestrators get their turn ended while waiting.** An orchestrator waiting on a background child was repeatedly forced to hand back an "unfinished" report, three or four times in one slice.

What worked:

| # | Who | Action |
|---|---|---|
| 1 | Orchestrator | Dispatch in the foreground when the next step depends on the child |
| 2 | Root | On a child's completion report, `SendMessage` the orchestrator with a summary: verdict, changed files, gate numbers, key quotes |
| 3 | Orchestrator | When forced to hand back, reply with one progress line ("implementer X dispatched, waiting"), no repeated background |
| 4 | Root | When continuing it, say "wait for X's completion, do not start a duplicate implementer" |

The root only forwards in this situation: it does not read the diff, judge acceptance or instruct the implementer. Another option that worked once: after continuing a background implementer, the orchestrator ran a bounded foreground wait on the implementer's output files until they stopped changing; the hand-back then reached the orchestrator. Always bound such waits.

- **Subagents may lack the `Agent` tool.** In one cloud session the orchestrator subagent had no `Agent` tool and could not dispatch. Then: the orchestrator writes the implementer and reviewer briefs and does acceptance; the root dispatches them per those briefs and passes the results back with `SendMessage`.
- Tools that exist only in the root session (for example a browser extension driving the user's own browser) cannot be delegated. The orchestrator lists the pages and expected results; the root performs the browser check.

## Other observed behaviour

- **Silent truncation of large writes**: a write once landed only 272 bytes without an error. Check `wc -l` / `wc -c` and the file's last lines after writing; write in sections or retry once with another agent; after two failures, report instead of retrying.
- **Permission prompts block irreversible commands** such as `git stash` and `rm -rf`. Do not design reviews that need them to build a baseline; provide the "before" data in the brief.
- **Plugins are not capabilities.** A plugin can be just a skill that assumes some MCP server or CLI mode exists. When the underlying tool is missing (for example a Codex dispatch plugin that expects a Codex MCP server the installed CLI no longer offers), call the underlying CLI directly and keep the plugin's parameter conventions.
- **Local memory** (`~/.claude/projects/<project>/memory/`) does not travel with the repo or to other tools. Store rules in the repository and keep only pointers in memory (skill `agent-handover`).
- **Attribution**: if the harness supplies commit attribution lines, use them verbatim; do not hard-code model names.
