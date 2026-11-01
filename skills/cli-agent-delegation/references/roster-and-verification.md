# Agreeing on teams, and re-checking them

The full procedure behind the short "Start" section of [SKILL.md](../SKILL.md).

Script paths in this skill are relative to the skill's own directory. Run the doctor once per session:

```bash
node scripts/doctor.mjs          # Node version; Codex CLI, its default effort and the Codex plugin; agy and agy-staff; OpenCode and `opencode acp`
```

Report blockers and recommendations to the user and install only with their consent.

**Ask which teams may take work.** Before the first external job, ask the user one multi-select question: which of the detected teams may take work in this session (for each: channel, what it would do, e.g. "Codex CLI: reviews and code-reading syncs"), plus "none, keep everything in-house". Pre-select the teams the project's roster already lists. Skip the question when the `subagent-team` skill already asked it this session, when the project policy says `External delegation: roster` (use the roster) or `none` (stay in-house), or when the run is non-interactive; then state the choice in one line. Record the answer where the team keeps state (the board's progress record; the policy if the user wants it permanent).

**Verify and adjust when the user asks** ("can Codex take this?", "add OpenCode", "stop using agy", "is agy still working?"), at any point in the run:

1. Do not interrupt running jobs. Cancel one only when the user asks, through its own channel (`/codex:cancel`, agy-staff `cancel`, the wrapper's process), and confirm it stopped.
2. Check, cheapest first: `node scripts/doctor.mjs` (presence, versions, plugins); for OpenCode `node scripts/opencode-acp-run.mjs probe --repo <abs repo>` (version, auth methods, models, effort levels, no tokens spent); `agy models` or `node scripts/agy-run.mjs models`; `/codex:setup` when the Codex plugin is installed. Only one tiny read-only job proves a team end to end; run one for a team or model not used before.
3. Report one table to the user: team, channel, found and version, signed in, models for external-fast and external-strong, may edit or review only, verified date.
4. Apply: update the session's choice; for a lasting change, update the roster row in the project policy; re-route queued (not running) jobs and update their cards; write the change with the user's words into the board's lessons.
