# Environment check

The full procedure behind "Start" in [SKILL.md](../SKILL.md). Run it once per session, before the first dispatch, and again after anything is installed or changed. It works from any directory; `--root` names the project:

```bash
node <this skill's directory>/scripts/env-check.cjs --root <project root>
```

It installs nothing and reports:

- **Hard requirements**: Node.js 22 or newer for the helper scripts, and git. **The user's version wins**: any Node.js at or above 22 that the user runs, or that the project pins, is used as it is; 24 or newer is only the choice for a new install, through nvm. It also reports the project's pin, whether nvm is installed, and whether the running Node.js is nvm's.
- **Host harness hint**: which agent this session probably runs in, from environment variables. A hint to confirm, never a decision ([host-harness.md](host-harness.md)).
- **Optional external teams**: Codex CLI and OpenAI's Codex plugin, agy and the agy-staff plugin, OpenCode (reachable through ACP), other agent CLIs on `PATH` (Pi, Grok), MCP servers in the project's `.mcp.json`.
- **Project policy and team board**: whether `## Subagent team` exists, records the host, and links a board.

Exit `0` means ready, possibly with warnings; `2` means blocked. If `node` itself is missing, the command fails with "not found": treat that as a failed Node check ("Getting Node.js", below).

## After the check

1. **Tell the user in one short message**: blockers, warnings, missing optional tools, and the fix for each. The report contains the commands.
2. **Install only with consent.** Never change the user's default Node version, shell profile or global packages unasked; prefer per-shell or per-project changes (`nvm install 24 && nvm use 24`). Node.js comes through nvm first ("Getting Node.js", below).
3. **Re-run the check** after any change. Start the work once it no longer reports blockers.
4. **If the user declines or cannot install**, use the fallback below.
5. **Read the compute plan**: `node <this skill's directory>/scripts/compute-config.mjs show --root <project root>`. With `needsInit`, run the one initialization interview, which covers the questions of this step ([compute-config.md](compute-config.md), "Initialization: the one interview"). With a plan, ask nothing about compute unless the plan leaves it open: route by it, and when `review.due` or `ranking.stale` is reported, post the review notice and proceed unless the user objects.
6. **Choose the external teams for this session**: one multi-select question listing each team with its channel and typical work, plus "none" ([external-teams.md](external-teams.md), "Choosing and adjusting external teams"). Skip the question when the policy's `External delegation:` line says `roster` or `none`, when the run is non-interactive, or on first use, where the setup questionnaire covers it; then state the choice in one line. With the same question, confirm each team's confidentiality level unless a recorded one exists ([confidentiality.md](confidentiality.md), "Asking the user"), and ask what the user knows about quota: which channel or model is nearly out and when it resets, which one to spend first or spare, the substitute order, and whether that is for this session or lasting ([quota.md](quota.md), "Asking the user"). When the team question is skipped and external teams may still take work (`roster`), the confidentiality and quota questions are still asked once in an interactive session, unless the ledger and the policy already answer them. Ask the scope of each answer (session, project, global); session answers go into the board's progress record, lasting ones into the compute files or the confidentiality file, and a team's verified capability into the policy's roster.
7. **Record the result** in the policy section (`Environment:` line, [project-setup.md](project-setup.md)). Warnings the user already accepted get one line next time, not a new question.

## Getting Node.js

**The user's own version wins; nvm first, a native install only without it.**

- **Which version.** At or above 22, the version the user already has is the one to use: never suggest an upgrade to 24 for it. When a version must be chosen (Node.js missing or below 22), take the first that is 22 or newer: the project's pin (`.nvmrc`, `.node-version`, `package.json` `volta.node`), the running version, the newest version nvm already has; only when none qualifies, 24 (the check's `nodeTarget`). A version nvm already has needs only `nvm use`, no install.
- **A project pin below 22** stays as it is: run the scripts with a newer Node.js (`nvm exec <version> node <script>`) instead of changing the project.

When Node.js is missing or older than 22:

1. **Ask before installing**, in one short question that says what will happen: "Node.js is missing. May I install Node.js 24 through nvm?", or "... install nvm and then Node.js 24?" (with the version chosen above) when nvm is missing too. Installing downloads and runs software, so it always needs the user's yes; in a non-interactive run, put the question in the end-of-task list and continue without scripts.
2. **nvm present** (`$NVM_DIR`, default `~/.nvm`, holds `nvm.sh`): `. "$NVM_DIR/nvm.sh" && nvm install <version> && nvm use <version>`. This changes no global default; run `nvm alias default <version>` only if the user asks.
3. **nvm missing**: on a yes, install nvm with the install script documented at [nvm-sh/nvm](https://github.com/nvm-sh/nvm) (it adds a line to the shell profile: say so), then step 2. nvm does not run on native Windows; offer the native installer there.
4. **A native install only as the fallback**, when the user does not want nvm: the installer from nodejs.org or the system package manager.
5. **Run the scripts with nvm's Node.js when nvm is installed.** A native Node.js earlier on `PATH` can shadow it; the check reports this on its `nvm` line. Use `nvm use <version>` in the shell that runs them, or `nvm exec <version> node <script>`, with the version chosen above.
6. Re-run the check. If the user declines every install, continue without scripts (below).

## Fallbacks when something is missing

| Missing | Fallback |
|---|---|
| Node.js 22+ | The method needs no scripts. Map tiers from the harness's model list and the vendor pages ([model-tiers.md](model-tiers.md)); write board files by hand from [team-board.md](team-board.md); for external teams, `cli-agent-delegation` lists the raw CLI commands. |
| git | Not workable for team mode: leases, diffs, reviews and commits rely on it. Stay in Solo mode until git is installed. |
| An external CLI | Go down that team's fallback ladder, then to another team of the same tier, then in-house (`cli-agent-delegation`, "Channels and fallbacks"). |
| agy-staff plugin | Use `agy-run.mjs` or the raw `agy` CLI (skill `cli-agent-delegation`). |
| Codex plugin | Nothing lost for jobs: `codex-run.mjs` is the job channel; reviews run through it in `read-only`. |
