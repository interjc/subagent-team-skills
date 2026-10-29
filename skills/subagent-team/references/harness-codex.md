# Codex notes

Codex has been used as the main session with this method, less extensively than Claude Code. Items marked *unverified* were never independently confirmed; check them before relying on them.

## Tool mapping

| Action | Codex |
|---|---|
| Spawn a subagent (cold start) | `spawn_agent` |
| Continue an existing subagent with its context | `followup_task` |
| List agents | *unverified* |
| Run an external CLI agent (agy) | shell, requesting escalated execution when the sandbox blocks the CLI's network or local ports |
| Skill discovery | Codex can install skills and plugins (`codex plugin marketplace add <repo>`, then `codex plugin add <plugin>@<marketplace>`); skills that live only inside a project are found reliably when `AGENTS.md` links to them |

Add an index of the project's skills to `AGENTS.md` (name, what it governs, when to read it, with a relative link). That is how a Codex main session finds project skills it was not told about.

## Models and effort

- The main session uses whatever model the user configured; never switch or downgrade it. As of 2026-10 that was GPT-6.1 Sol at `high`.
- Subagents: choose a model and effort within the Codex family by task difficulty (a strong model for judgement work, a light one such as `gpt-6-luna` for simple work). How per-subagent effort is set is *unverified*; record what was actually applied.
- Expert: the top model Codex offers; fallback to the next flagship at its highest effort. Dispatch details *unverified*.

## Behaviour

- The nested-background-agent quirks seen in Claude Code (see [harness-claude-code.md](harness-claude-code.md)) were not observed under Codex (*unverified*). Follow the method as written.
- Subagents may inherit write tools even when acting as reviewers. "The tool exists" is not authorization: state read-only explicitly and fingerprint the working tree (see [verification.md](verification.md)).
- In Codex-managed worktrees, prefer the product's recoverable worktree archive over deleting directories, and back up needed ignored files first; archives usually exclude them.
- As an orchestrator, Codex polls rather than sleeping until a background job finishes, and every wake-up carries its full context. Keep background external jobs few and long rather than many and short, and avoid frequent status checks.
