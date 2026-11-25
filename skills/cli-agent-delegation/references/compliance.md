# Compliance: how external agents may be called

Rules for calling another vendor's agent so that the user's accounts, subscriptions and data stay safe. They apply to every team and every channel, and they come before convenience. The gate, brief and acceptance rules are in [SKILL.md](../SKILL.md); per-team mechanics are in each team's page.

Sources (2026-11): [T3 Code](https://github.com/pingdotgg/t3code)'s user and internals docs (its FAQ, the Antigravity and ACP provider guides, "adding a provider"), the [agy-staff](https://github.com/keli-wen/agy-staff) README, reference and design notes, and agy's own changelog. What we ran ourselves is marked *verified*; the rest is what those projects document.

## 1. ACP first

**Call an agent through its official ACP server whenever it ships one.** ACP (Agent Client Protocol) is the integration path vendors publish for third-party clients: T3 Code calls itself "within the TOS" of the agents it drives because, outside its two vendor-built integrations, "everything else uses official ACP bindings". Over ACP the agent enforces its own session mode, every permission request comes to the client, and the client can reject it.

| Team | Preferred channel | Why |
|---|---|---|
| agy | `agy acp`, through `scripts/agy-acp-run.mjs` | Google's official ACP server since agy 1.5.0; *verified* 2026-11-22 on 1.5.14 ([agy.md](agy.md)) |
| OpenCode | `opencode acp`, through `scripts/opencode-acp-run.mjs` | Official ACP server ([opencode-acp.md](opencode-acp.md)) |
| Grok Build, Cursor, other Registry agents | their official ACP command, after the admission checklist | [acp-agents.md](acp-agents.md) |
| Codex CLI | `codex exec` through `scripts/codex-run.mjs`, or OpenAI's own Codex plugin | Codex ships no ACP server of its own. Its official headless CLI is the vendor's channel. The Registry's Codex adapter is third-party and *not tested* |

**When a job cannot go through ACP, say so before dispatch.** Name the risk in one line of the dispatch message and record it on the job card, for example: "agy 1.4.10 has no ACP server; T3.b runs in print mode, where `--write` skips every permission check. Update with `agy update`?" The print-mode wrapper `agy-run.mjs` prints that warning on every run and records `channel: "print"` in its summary. The usual reasons are an agent CLI too old for ACP, or a host sandbox that blocks the ACP process.

**Using other skills or plugins alongside this one: borrow their method, keep the call on ACP.** A plugin such as agy-staff brings useful role prompts (implementer, reviewer, researcher, ask), templates and job discipline (one background wait per job, no progress polling). Use those in your brief and your waiting. But dispatch the job through the ACP wrapper, not through the plugin's own runner, when the plugin's runner does not use ACP. agy-staff's companion runs `agy -p --output-format stream-json`, which is print mode. Keep the plugin installed and current for its methods and as a stated fallback. Under a host where no ACP channel exists (Codex's command sandbox, for example), the plugin is the fallback, with the risk stated.

## 2. Keep the agent CLIs and plugins current, and offer the upgrade

Old releases are a compliance problem as well as a feature gap: an agy older than 1.5.0 has no ACP server, and older ACP servers only offered some models to an allow-list of editors.

- `doctor.mjs` reports agy's version against the ACP minimum (1.5.0) and T3 Code's recommended release (1.5.12). It also reports whether `agy acp` exists and agy-staff's installed version; with `--check-updates` it compares that version with the newest release tag. Its `upgrades` list has the exact commands. `env-check.cjs` in `subagent-team` warns about an agy without ACP.
- **Tell the user as soon as an upgrade is needed, and offer to run it.** Run it yourself only after the user says yes, and only through the installer that owns the binary, then check the version again:
  - agy: `agy update`, then `agy --version`. Updating a plugin does not update agy.
  - agy-staff in Claude Code: `claude plugin marketplace update agy-staff && claude plugin update agy@agy-staff`, then restart Claude Code. In Codex: `codex plugin marketplace upgrade && codex plugin add agy@agy-staff`, then restart Codex.
  - OpenCode: `opencode upgrade`. Codex CLI: `npm install -g @openai/codex@latest`, or the installer the user used.
- Never let a job update its own CLI. Never run a package manager that does not provably own the binary.

## 3. Accounts and sign-in belong to the user

- **Sign-in is the user's.** On an auth error, stop and ask the user to sign in with the agent's own command (`agy` once interactively or `agy acp --login`, `opencode auth login`, `codex login --device-auth`, `grok login --device-auth`). Never type, copy, extract or forward credentials or tokens. Never send `/logout` or change an account from a job.
- **User-declared accounts only; never rotate to dodge limits.** The agent uses only accounts the user explicitly declared in the compute plan and signed into, following the rule the user chose (`primary-backup`, `spread`, or `fixed`). It never discovers credentials, signs in, or rotates accounts on its own to dodge a limit, and never routes subscriptions through a proxy that pools accounts. T3 Code declines to build an automatic account switcher because it risks bans for its users. When every declared account for a team is exhausted, the fallback is another channel or another vendor of the same tier, else in-house ([quota.md](quota.md)). Whether a multi-account setup complies with a vendor's terms remains the user's call.
- **No ambient credentials.** An agent must use the account the user signed in with, not an API key or cloud project that happens to be in the environment. `agy-acp-run.mjs` removes `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_QUOTA_PROJECT` and `GOOGLE_GENAI_USE_VERTEXAI` unless the user set them for agy on purpose (`--keep-credential-env`). T3 Code does the same for each provider instance.
- **No community bridges.** Do not use unofficial ACP shims, reverse-engineered APIs, or tools that reuse an agent's OAuth tokens outside the agent. They break between versions and can put the account at risk.

## 4. Identify honestly, ask for nothing extra

- The ACP client names itself truthfully in `initialize` (`clientInfo.name` is the wrapper's own name). Never claim to be an editor on a vendor's allow-list to unlock models: agy before 1.5.1 offered non-Gemini models only to such editors, and agy 1.5.1+ offers every model to every client.
- Advertise no client file-system or terminal capabilities. The agent then uses its own tools under its own rules.
- Pick the most restrictive session mode the job allows: agy `default` for read-only work, `accept-edits` for edits. Never select a mode that approves commands or everything (`auto`, `yolo`), and never pass `--dangerously-skip-permissions` on an ACP channel. Reject every permission request; never answer `allow_always`.
- Health checks use `initialize` only. Opening a session can start hooks and MCP servers or a sign-in, so a session is opened only for a real job, or in an empty scratch directory when probing on purpose.

## 5. What this does not cover

These rules reduce account and data risk. They are not a sandbox: prompt guardrails and rejected tool calls do not isolate a process. For untrusted input, use a discardable worktree as well ([read-only-reviews.md](read-only-reviews.md)). Which teams may see which code is the user's confidentiality call (`subagent-team`, confidentiality levels). Whether a given use is allowed under a vendor's terms is the user's decision: when unsure, ask and record the answer.
