# Codex notes

Codex has been used as the main session with this method, less extensively than Claude Code. Items marked *unverified* were never independently confirmed; check them before relying on them.

## Tool mapping

| Action | Codex |
|---|---|
| Spawn a subagent (cold start) | `spawn_agent` |
| Continue an existing subagent with its context | `followup_task` |
| List agents | *unverified* |
| Run an external CLI agent (agy) | shell, requesting escalated execution when the sandbox blocks the CLI's network or local ports |
| Native task list / shared memory | none known (*unverified*); use the board in the repository ([team-board.md](team-board.md)) |
| Detect the host | `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED` in the shell environment (*unverified*); confirm with the user |
| Skill discovery | Codex can install skills and plugins (`codex plugin marketplace add <repo>`, then `codex plugin add <plugin>@<marketplace>`); skills that live only inside a project are found reliably when `AGENTS.md` links to them |

Add an index of the project's skills to `AGENTS.md` (name, what it governs, when to read it, with a relative link). That is how a Codex main session finds project skills it was not told about.

## Models and effort

- The main session uses whatever model the user configured; never switch or downgrade it. As of 2026-10 that was GPT-6.1 Sol at `high`.
- Subagents: choose a model and effort within the Codex family by task difficulty (a strong model for judgement work, a light one such as `gpt-6-luna` for simple work). How per-subagent effort is set is *unverified*; record what was actually applied.
- Expert: the top model Codex offers; fallback to the next flagship at its highest effort. Dispatch details *unverified*.

## The layers in Codex

- L1 is the main session; L2 and L3 are `spawn_agent` subagents within the Codex family, chosen by tier. L4 teams are reached through the shell (escalated execution when the sandbox blocks a CLI's network or ports).
- Liaisons: whether a Codex subagent can run a long external job in bounded waits is *unverified*. If not, the director runs external jobs itself and keeps them few and long.
- Codex CLI is also a common L4 team for other hosts. In a project where Codex is the host, prefer another vendor's agent as L4, so external work brings a different model family.

## Behaviour

- The nested-background-agent quirks seen in Claude Code (see [harness-claude-code.md](harness-claude-code.md)) were not observed under Codex (*unverified*). Follow the method as written.
- Subagents may inherit write tools even when acting as reviewers. "The tool exists" is not authorization: state read-only explicitly and fingerprint the working tree (see [verification.md](verification.md)).
- In Codex-managed worktrees, prefer the product's recoverable worktree archive over deleting directories, and back up needed ignored files first; archives usually exclude them.
- As the director or an L2 task lead, Codex polls rather than sleeping until a background job finishes, and every wake-up carries its full context. Keep background external jobs few and long rather than many and short, and avoid frequent status checks.
