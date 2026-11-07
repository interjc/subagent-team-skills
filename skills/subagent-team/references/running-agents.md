# Running agents

Operational rules for dispatching, continuing and stopping agents, in any harness. Harness mechanics (tool names, background runs, known quirks) are in [harness-claude-code.md](harness-claude-code.md) and [harness-codex.md](harness-codex.md); edit leases and worktrees in Strict mode are in [strict-mode.md](strict-mode.md).

- **Continue, don't respawn.** For follow-ups and rework on the same task line, continue the existing agent's conversation. Still send a self-contained new brief, re-check HEAD, working tree and lease, and say which earlier context still applies.
- **Continuity does not preserve a wrong tier.** If the agent is under-tiered for the task, or the rework adds sensitive content, split that part out to a correctly tiered worker.
- **Slots vs context.** "Concurrency limit reached" is not a context problem: do not retry spawning; wait, reuse an idle agent, or outsource eligible work. A conversation that hit its context or turn limit is replaced: check its partial diff first.
- **Never interrupt running work** to free a slot or tidy up. If the user redirects an active task, cancel it, confirm it actually stopped, then continue or redispatch.
- **Wait for completion notifications**; do not poll logs or intermediate files for reassurance. Liaisons do the waiting for external jobs ([external-teams.md](external-teams.md), "Waiting without burning the host").
- **Launch independent work in one message** so it runs concurrently; in-house and external work run at the same time, each external job with its liaison.
- **Worktrees** only for genuinely parallel writes to the same area, or to protect unfinished state. Never delete a worktree something still depends on; prefer recoverable cleanup over `rm -rf`.
- **Commit a verified snapshot while a writer is still editing.** When a file you want to commit is in another agent's active lease, stage the verified content without its unfinished edits: `git hash-object -w <verified copy>` and `git update-index --cacheinfo 100644,<hash>,<path>`, then commit and check `git show --stat HEAD`. Never stash or revert the writer's work to get a clean tree.
- **Only stop processes you started** (by PID or your own port), never by name pattern; never start, stop or restart the user's dev server. Ask the user to.
- **Audit from the logs, not from memory.** At each milestone, and whenever someone asks whether the process was followed, list what actually ran: each agent's model and effort, and the external jobs. Compare it with the role table and record each deviation with its fix. In Claude Code, `scripts/audit-dispatch.mjs` reads this from the transcripts ([harness-claude-code.md](harness-claude-code.md)).
