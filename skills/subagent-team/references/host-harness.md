# The host harness: detect, confirm, adapt

The host harness is the agent the user runs this session in. It decides what the in-house team can be (can it spawn subagents? pick a model and effort per subagent? run them in the background?), how external teams are reached (shell, plugins, MCP), and whether there is a native task list. So the first compatibility question is not "which model" but "which host". For the five host scenarios and per-scenario checklists, see [scenarios.md](scenarios.md).

## Detect, then confirm

1. **Detect.** `scripts/env-check.cjs` reports a host hint from the environment variables harnesses set for the commands they run, together with its `kind`, `scenario`, and `sessionVar` (the *name* of the detected session-id variable, never its value). Also look at what you can see directly: your own tool list is the most reliable evidence (an `Agent` tool with `model` and `effort` parameters, `spawn_agent`, a delegate tool, a task-list tool, MCP tools). Never infer that an installed CLI on `PATH` is the host.
2. **Confirm with the user** on first use, in the setup questionnaire ([project-setup.md](project-setup.md)) or when `compute-config.mjs start` asks `host-scenario`: "This session looks like it runs in <host> (evidence: ...). Is that right, and do you also run this project from other agents?" Pre-fill the answer so it costs one click.
3. **Record** it in the policy section (`- Host harness: <name> (confirmed YYYY-MM-DD)`) and save the host's plan under `hosts.<id>` in `compute.json` (`compute-config.mjs host set` or `plan apply`, [compute-config.md](compute-config.md)). List every host the project is used from. If a later session detects a host the policy does not list, confirm it with the user and create its host plan.

Environment hints (only the Claude Code and T3 Code Claude-provider entries were observed by the authors; the rest are *unverified* or *not tested* and may change between versions):

| Host | Kind | Scenario | Variables |
|---|---|---|---|
| Claude Code | vendor-native | `vendor-native` | `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`; some versions also set `AI_AGENT` |
| Codex | vendor-native | `vendor-native` | `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_THREAD_ID` (*unverified*) |
| OpenCode | multi-vendor | `open-router` | `OPENCODE`, `OPENCODE_SESSION_ID` (*unverified*) |
| Gemini CLI | vendor-native | `vendor-native` | `GEMINI_CLI` (*unverified*; deprecated — merged into agy) |
| Cursor | multi-vendor | `harness` | `CURSOR_AGENT`, `CURSOR_TRACE_ID` (*unverified*) |
| T3 Code | multi-vendor, wrapper | `harness` | `T3CODE_THREAD_ID`, `T3CODE_CLI_PATH`; its Claude Code provider also sets `CLAUDE_CODE_ENTRYPOINT=t3-code` (observed 2026-11 with the Claude Code provider; other providers *unverified*) |
| Orca | multi-vendor | `harness` | none known; name only (*not tested*) |
| Pi | multi-vendor | `open-router` | none known; name only (*not tested*) |
| Bot front ends | unknown | `bot` | none known; name only (*not tested*) |

**Wrapper hosts.** T3 Code runs other vendors' agent CLIs as its providers, so their variables (`CLAUDECODE`, `CODEX_THREAD_ID`) sit next to its own. That is not a nested shell: the wrapper is the host and decides the route, and the check reports the inner CLI as `runtime`. No variable is known for agy, Orca, Pi, Claude Desktop, ChatGPT / Codex Desktop, or bot front ends; recognise them from the tool list, the model list, the recorded policy name or the user's answer. The *Kind* and *Scenario* columns are the defaults reported as `kind` and `scenario`.

A hint is never a decision: the same shell may be nested (a Codex job started from Claude Code inherits Claude Code's variables), and variables change between versions.

## Host kind: who reaches the other vendors

The host's `kind` decides how L4 work travels, and `scenario` describes how the host is structured ([scenarios.md](scenarios.md)). Settle both together with the host, before the first external dispatch:

| Kind | Scenarios | Examples (as of 2026-11) | The host's own models | Route for another vendor's model |
|---|---|---|---|---|
| **vendor-native** | `vendor-native` | Claude Code, Codex, agy (*unverified*), Gemini CLI (*unverified*, deprecated) | one vendor's family | **ACP + liaison**: the vendor's ACP server (Codex: `codex exec`) driven by a wrapper, tracked by a low-tier liaison (skill `cli-agent-delegation`) |
| **multi-vendor** | `harness`, `open-router` | T3 Code (partly exercised 2026-11), OpenCode (*unverified*), Cursor (*unverified*), Orca (*not tested*), Pi (*not tested*) | several vendors, picked per subagent, child agent or thread | **host switch**: an in-house dispatch whose model is set to the other vendor's model; no wrapper, no liaison |
| **unknown** | `bot`, `unknown` | Bot front ends (*not tested*), unrecognized clients | single backing model or unknown | Ask the user (`host-scenario`) and probe capabilities ([scenarios.md](scenarios.md), "Bot hosts: capability probe (*not tested*)") |

**Route precedence** (in `env-check.cjs`): an explicit `External route:` line in the policy (other than `auto`) > live detection when the host is detected (not `unknown`) and not mixed > the kind recorded in the policy's `Host harness:` line > the name match > ask the user. When the recorded policy kind and live detection disagree, confirm the host with the user and use the live host's plan.

**Re-check at every session start with `compute-config.mjs start`** (not `show`), and again when a session is resumed, handed over, or shows new models. The **current session's evidence picks the host plan**; `lastHost` in `compute-state.json` only explains a change (`unknown`, `new`, `changed`, `runtime-changed`, `served-changed`, `same`) and never selects a plan. One line is enough when nothing changed: "Host: T3 Code (harness, multi-vendor); L4 work goes by host switch."

### Host switch (multi-vendor harness)

The external tiers stay; only the channel changes. An external-fast or external-strong role is filled by a subagent or child agent of the harness running the other vendor's model:

- **Spawn, never switch the director.** Use the harness's per-agent model: a subagent definition with its own model (OpenCode's `model: <provider>/<model>` on an agent; Cursor's subagent `model`), a delegate or child-agent tool on another provider (T3 Code), or a forked thread on the target model. Changing the model of the director's own thread loses the prompt cache and squeezes the context through a handoff summary; the director stays on its model ([SKILL.md](../SKILL.md), "Tiers and effort"). If the harness can only switch the whole thread, treat it as a vendor-native client for routing (below).
- **Confirm the model that actually ran.** Community reports (2026) show per-subagent models being overridden by the orchestrating agent (Cursor) or rejected for forked context (Codex). Read the served model from the harness's display or the agent's result; a job whose model cannot be confirmed does not count as another vendor's opinion, and the card says so.
- **What drops**: the ACP wrapper, `--out-dir` waits, the liaison and the ACP warning. The subagent reports directly, like any in-house agent; the flow is `direct` or `designed` with the model on the card, and the gate result still recorded.
- **What stays**: the outsourcing gate's first three tests for the external tiers (they are still models you do not steer mid-run), the brief, the lease, independent review on a model other than the author's, end-to-end checks by the director, the confidentiality level of that vendor · model (the code still reaches that vendor), pinned model and effort, the quota ledger per resource or declared account, and the usage log. Test 4 relaxes: there is no job start-up cost, so smaller units may go.
- **Per-host plans (`hosts.<id>`) and legacy overlays.** A multi-vendor harness can hold several provider instances (user-declared accounts) of one vendor. In 0.7.0+, that mapping lives in `compute.json` under `hosts.<id>` ([compute-config.md](compute-config.md)): `serves.<team>` stores `strategy` (`primary-backup`, `spread` or `fixed`), `accounts` (ordered `{ account, instance }` pairs referencing user-declared `accounts`), `options` (e.g. `"effort": "reasoningEffort"` so child calls pin effort), and `models` (host model-id overrides), while `hosts.<id>.roles`, `routing`, `profile` and `constraints` hold host-specific overrides. `compute-config.mjs resolve --role <r> --host <id>` expands served resources across declared accounts and applies `accountQuota`. Existing Markdown overlays (`harness-<host id>.md`) remain readable and listed by `show`; once `hosts.<id>.serves` is present, `show` marks the overlay `superseded: true` and `start` reports it in `say[]`. Overlays are never auto-converted from Markdown: run `compute-config.mjs migrate --dry-run` to spot them, then confirm and write `hosts.<id>` with `host set` or `plan apply`. Two accounts of one vendor are still one vendor for review independence and confidentiality; only accounts the user declared belong in `accounts` and `serves` ([quota.md](quota.md)).
- **Per model, not per host.** The switch covers the models the harness serves. A model in the compute plan that the harness does not offer still goes by ACP + liaison when the shell and the vendor's CLI are there; otherwise take the same-tier model the harness does offer and say so.
- *Status*: OpenCode and Cursor as hosts are *unverified* with these skills; Orca, Pi and bot front ends are **not tested**. T3 Code: host detection, per-child provider and model, and child agents on another vendor's provider were exercised in 2026-11; the rest is *unverified*. Record what you verify in the policy and `hosts.<id>.capabilities`, dated.

### ACP + liaison (vendor-native client)

The host serves one family, so other vendors are external teams: ACP where an official server exists, a liaison per job, as in "External teams and the liaison" in [SKILL.md](../SKILL.md). agy also serves some other vendors' models on some plans; by default agy is still treated as vendor-native, and serving those models in-house is the user's choice, asked once like any route question.

### When the route is not obvious, the user picks

Do not guess when the evidence is thin or the options compete. Ask one question with the options and your recommendation (pre-selected), then record the answer and its scope (session, project, global):

- the host is unknown, or hints conflict (nested shells, no variable, a GUI over a CLI);
- the harness is multi-vendor but per-subagent models are missing or unreliable, so only a thread switch is available;
- both routes work and differ in accounts or quota (the harness's subscription versus the vendor CLI's own plan);
- the compute plan names a channel that the host would replace.

Options: **host switch** (cheaper, shares the harness's tools and permissions; needs a confirmed per-agent model), **ACP + liaison** (the vendor's own sandbox, accounts and quota; needs a shell and the CLI), **in-house only** (no other vendor this session). In a non-interactive run, take ACP + liaison where a vendor-native route works, else in-house only, and put the question in the end-of-task list. The answer goes to the policy's `External route:` line ([project-setup.md](project-setup.md)) and `hosts.<id>.route`; a session-only answer stays in `compute-state.json`.

## Capability checklist

For the confirmed host, establish once, and write the answers into `hosts.<id>.capabilities` (dated `verified YYYY-MM-DD`, `missing` or `unverified`) and the policy:

| Capability | Why it matters | If missing |
|---|---|---|
| Spawn subagents (`subagents`) | L2 and L3 exist in-house | Director runs L2 work as a separate, explicit design step and does L3 work itself (Solo-like); external teams can still take gated work |
| Choose a model per subagent (`perAgentModel`) | tiers can differ per layer | Choose by role only; ask for thoroughness in the brief |
| Choose effort per subagent | tier and effort independent | Tier only; record "effort: inherited" |
| Choose another vendor's model per subagent | the host-switch route for L4 work | ACP + liaison, or ask the user ("Host kind", above) |
| Subagents can spawn subagents | L2 task leads can dispatch L3 | Root dispatches per the L2 lead's briefs and forwards results ([strict-mode.md](strict-mode.md)) |
| Background subagents and completion notifications (`background`) | parallel work, no polling | Dispatch in the foreground, fewer and larger units |
| Message a running or finished subagent | continue instead of respawn | New agent with a full brief and the previous report pasted in |
| Native task list or shared memory | live coordination | The board's cards only ([team-board.md](team-board.md)) |
| Shell access (`shell`), for the director and for subagents | external CLIs, liaisons | No liaison; the director runs external jobs, or no external teams |
| File read/write access (`files`) | direct edits, board and plan files | Chat-only advisory mode ([scenarios.md](scenarios.md)) |
| MCP servers | external teams as tools | CLI channel only |
| A question tool | the setup questionnaire | One message with numbered questions |

## Known hosts

- **Claude Code** (primary, verified): [harness-claude-code.md](harness-claude-code.md).
- **Codex** (secondary, verified): [harness-codex.md](harness-codex.md).
- **T3 Code** (partly exercised 2026-11): wrapper harness (`scenario: "harness"`, `kind: "multi-vendor"`). Detection, per-child provider and model, and child agents on another vendor's provider were exercised; other capabilities are *unverified*.
- **Other hosts** — OpenCode (*unverified*), Cursor (*unverified*), agy (*unverified*), Gemini CLI (*unverified*, deprecated — merged into agy), **Orca** (*not tested*), **Pi** (*not tested*), and **bot front ends** (*not tested*): they install these skills through the Agent Skills format. Classify the scenario ([scenarios.md](scenarios.md)), run the capability checklist above, map whatever subagent mechanism they offer onto L2 and L3, and keep the board in the repository, which works everywhere. Write what you verify into `hosts.<id>` and the policy section, marked with the date, so the next session does not redo it.

The same CLI can be a host in one project and an external team in another (Codex as the main session, or Codex CLI as an L4 contractor). The role comes from how it is used, not from the tool.
