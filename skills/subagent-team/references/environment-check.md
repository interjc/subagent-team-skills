# Environment check

The full procedure behind "Start" in [SKILL.md](../SKILL.md). Run it once per session, before the first dispatch, and again after anything is installed or changed. It works from any directory; `--root` names the project:

```bash
node <this skill's directory>/scripts/env-check.cjs --root <project root>
```

It installs nothing and reports:

- **Hard requirements**: Node.js 18 or newer for the helper scripts, and git. **Recommended**: Node.js 24.
- **Host harness hint**: which agent this session probably runs in, from environment variables. A hint to confirm, never a decision ([host-harness.md](host-harness.md)).
- **Optional external teams**: Codex CLI and OpenAI's Codex plugin, agy and the agy-staff plugin, OpenCode (reachable through ACP), other agent CLIs on `PATH` (Pi, Grok), MCP servers in the project's `.mcp.json`.
- **Project policy and team board**: whether `## Subagent team` exists, records the host, and links a board.

Exit `0` means ready, possibly with warnings; `2` means blocked. If `node` itself is missing, the command fails with "not found": treat that as a failed Node check.

## After the check

1. **Tell the user in one short message**: blockers, warnings, missing optional tools, and the fix for each. The report contains the commands.
2. **Install only with consent.** Never change the user's default Node version, shell profile or global packages unasked; prefer per-shell or per-project changes (`nvm install 24 && nvm use 24`).
3. **Re-run the check** after any change. Start the work once it no longer reports blockers.
4. **If the user declines or cannot install**, use the fallback below.
5. **Choose the external teams for this session**: one multi-select question listing each team with its channel and typical work, plus "none" ([external-teams.md](external-teams.md), "Choosing and adjusting external teams"). Skip the question when the policy's `External delegation:` line says `roster` or `none`, when the run is non-interactive, or on first use, where the setup questionnaire covers it; then state the choice in one line. With the same question, confirm each team's confidentiality level unless a recorded one exists ([confidentiality.md](confidentiality.md), "Asking the user"), and ask what the user knows about quota: which channel or model is nearly out and when it resets, which one to spend first or spare, the substitute order, and whether that is for this session or lasting ([quota.md](quota.md), "Asking the user"). When the team question is skipped and external teams may still take work (`roster`), the confidentiality and quota questions are still asked once in an interactive session, unless the ledger and the policy already answer them. Write the answers into the board's progress record; a lasting change goes into the policy's roster, its `External order:` line, or the confidentiality file.
6. **Record the result** in the policy section (`Environment:` line, [project-setup.md](project-setup.md)). Warnings the user already accepted get one line next time, not a new question.

## Fallbacks when something is missing

| Missing | Fallback |
|---|---|
| Node.js 18+ | The method needs no scripts. Map tiers from the harness's model list and the vendor pages ([model-tiers.md](model-tiers.md)); write board files by hand from [team-board.md](team-board.md); for external teams, `cli-agent-delegation` lists the raw CLI commands. |
| git | Not workable for team mode: leases, diffs, reviews and commits rely on it. Stay in Solo mode until git is installed. |
| An external CLI | Go down that team's fallback ladder, then to another team of the same tier, then in-house (`cli-agent-delegation`, "Channels and fallbacks"). |
| agy-staff plugin | Use `agy-run.mjs` or the raw `agy` CLI (skill `cli-agent-delegation`). |
| Codex plugin | Nothing lost for jobs: `codex-run.mjs` is the job channel; reviews run through it in `read-only`. |
