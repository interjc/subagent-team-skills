# Scenarios: who is in-house, who is external

The host the user runs this session in sets the **scenario**: which vendor or models are in-house, how other vendors are reached, where accounts live, and what the session can actually run. This page works with [host-harness.md](host-harness.md) (detection and capabilities) and [profiles.md](profiles.md) (spending and planning). Back to [SKILL.md](../SKILL.md).

## The five scenarios

`scenario` sits next to `kind` (`vendor-native`, `multi-vendor`, `unknown`) in `hosts.<id>` and in `env-check.cjs`. `kind` still decides the route (`vendor-native` → `acp-liaison`, `multi-vendor` → `host-switch`); `scenario` captures how the host is structured so the director settles the right things.

| Scenario | Examples (as of 2026-11) | In-house | External | Accounts | Default route |
|---|---|---|---|---|---|
| `vendor-native` | Claude Code (verified), Codex (verified), agy (*unverified*), Gemini CLI (*unverified*, deprecated — merged into agy), Claude Desktop / ChatGPT / Codex Desktop (*unverified*) | the host vendor's own model family | other vendors' CLIs, plugins, ACP servers or MCP servers | one sign-in in the host; each external CLI holds its own sign-in | `acp-liaison` |
| `harness` | T3 Code (partly exercised 2026-11), Cursor (*unverified*), Orca (*not tested*) | the host's own subagent or child-agent runtime, on the director's vendor | other vendors served by the harness as providers, plus any unserved CLI via ACP | declared per provider in `hosts.<id>.serves` (may hold more than one user-declared account per vendor) | `host-switch` (ACP + liaison for unserved teams) |
| `open-router` | OpenCode (*unverified*), Pi (*not tested*) | whichever vendor/model fills the director and in-house agent definitions | other model families configured in the router or provider list, plus any CLI via ACP | API keys or provider sign-ins configured in the host; optional declared accounts in `compute.json` | `host-switch` (ACP + liaison when a separate CLI sandbox is wanted) |
| `bot` | Chat or messaging bot front ends (*not tested*) | the single model backing the bot | none directly unless the bot has shell access to CLIs | managed by the bot host; never discovered or rotated by the agent | `none` (or `acp-liaison` if shell + CLIs exist) |
| `unknown` | Unrecognized or new client (*unverified*) | the session's model | undecided until confirmed | undecided until confirmed | ask the user (`host-scenario`) |

Every host other than Claude Code, Codex and T3 Code is *unverified*; Orca, Pi and bot front ends are *not tested*. Never infer that an installed CLI on `PATH` (`codex`, `agy`, `opencode`, `pi`) is the host: an installed CLI is only a possible external team.

## Dispatch versus family

Keep two questions separate:

- **Dispatch** is *how work travels*: an in-house subagent, a host switch to another provider's child agent, or an external CLI/ACP job tracked by a liaison.
- **Family** is *whose model runs the work* (vendor and model line).

**Family — not dispatch — decides review independence and confidentiality.** A child agent dispatched by host switch on another vendor's model counts as another vendor's opinion only when the served model is confirmed, and sends code to that vendor under that vendor's confidentiality level ([confidentiality.md](confidentiality.md)). Conversely, two accounts of the same vendor are still one vendor for review independence and confidentiality.

**Home vendor rule.** Each host plan records `home`: the vendor(s) that are native to this host. On a host whose `home` contains a vendor, non-`in-house-*` external roles exclude that vendor's resources (`home vendor on this host: dispatch in-house`) so work does not loop out to the same vendor through a wrapper.

## Settle-list per scenario

Before the first dispatch on a new host, settle these six items and store them in `hosts.<id>` ([compute-config.md](compute-config.md)):

| Scenario | Providers / accounts | Agents | In-house vs external | Models | Effort option ids | Fallback |
|---|---|---|---|---|---|---|
| `vendor-native` | Host sign-in + declared external CLI accounts (`accounts`) | Native subagents (L2/L3) + ACP/CLI wrappers with liaisons (L4) | `home`: the host's vendor; other vendors are external | Host's own model list for `seats`; CLI probes (`doctor.mjs`, `agy models`, `opencode-acp-run.mjs probe`) for `resources` | Native subagent effort param; wrapper `--effort` flags | External fallback chain ending in `in-house:<tier>:<effort>` |
| `harness` | Declared accounts mapped to harness provider instances in `hosts.<id>.serves.<team>.accounts` (`strategy`: `primary-backup`, `spread` or `fixed`) | Native subagents or harness child/delegate agents; liaisons only for unserved CLIs | `home`: director's vendor (or empty if every provider is routed explicitly); other served vendors go by `host-switch` | Harness capability list + `serves.<team>.models` (when harness ids differ from plan ids) | `serves.<team>.options` (e.g. `"effort": "reasoningEffort"`) so child calls never fall back to a low default | Next declared account (by strategy), then next model/team, then `in-house:<tier>:<effort>` |
| `open-router` | User-declared provider accounts or pay-as-you-go billing (`billing`: `metered` / `prepaid` / `subscription`) | Predefined named agents per role/tier (e.g. OpenCode agent files with `model: <provider>/<model>`) | `home`: the director's vendor family; other families in the router count as external families dispatched by `host-switch` | Router's probed model list (`opencode-acp-run.mjs probe` or host model list) | `serves.<team>.options` for provider reasoning/effort keys | Cheaper/other family in the router, then `in-house:<tier>:<effort>` |
| `bot` | Whatever backs the bot (user states billing/limits); no credential discovery | Determined by the bot capability probe below | Director is the bot; external CLIs only if shell exists | What the user confirms the bot runs | Usually inherited (not settable per call) | Same session sequentially, or user-carried briefs |
| `unknown` | Ask the user (Q0 `host-scenario`) before assuming any provider | Run the capability checklist ([host-harness.md](host-harness.md)) | Confirm director's vendor first | Read from host tools or ask | Verify before pinning | Conservative default: `in-house` until confirmed |

## Presets per scenario

Starting shapes to draft from during the planning interview ([profiles.md](profiles.md), "The planning interview"); every concrete model and account id comes from live detection and the user's answers:

- **`vendor-native`**: `kind: "vendor-native"`, `route: "acp-liaison"`, `home: ["<host-vendor>"]`. In-house roles use `seats` or `auto:<tier>[:<effort>]`; external roles (`bulk`, `homogeneous`, `bounded`, `code-sync`, `review`, `sensitive-review`) use ACP/CLI `resources` with `fallback` chains ending in `in-house:mid:medium` (or `in-house:mid:high` for code-reading work).
- **`harness`**: `kind: "multi-vendor"`, `route: "host-switch"`, `home: ["<director-vendor>"]` (or `[]` when every provider is mapped through `serves`). `hosts.<id>.serves` maps each served team to its declared accounts and instance ids, effort option mapping, and model id overrides. Unserved CLIs keep `route: "acp-liaison"`.
- **`open-router`**: `kind: "multi-vendor"`, `route: "host-switch"`, `home: ["<director-vendor>"]`. Often paired with `frugal` when billing is `metered`, or `balanced` with a small set of named agents per tier.
- **`bot`**: `kind: "unknown"`, `route: "none"` (or `"acp-liaison"` if shell + external CLIs are verified). Records probed `capabilities` and no `serves` block.

## Bot hosts: capability probe (*not tested*)

Bot front ends (chat apps, messaging integrations) have no bot-specific scripts in these skills. On first use in a bot host, probe five capabilities and record each as `verified YYYY-MM-DD`, `missing` or `unverified` in `hosts.<id>.capabilities`:

`shell` · `files` · `subagents` · `perAgentModel` · `background`

The probe places the bot into one of three classes:

| Class | Capabilities present | How the team runs |
|---|---|---|
| **Shell + files** | `shell` and `files` (no `subagents`) | Solo-like in-house (director runs L2 design as an explicit step before editing), with background CLI/ACP jobs where external CLIs exist and `background` works; `compute-config.mjs` and `team-board.mjs` run normally. |
| **Files only** | `files`, no `shell` | Use the method (design doc, contracts, board files in `docs/agent-team/`, independent review prompts) and edit `compute.json` by hand; no helper scripts and no external CLI jobs. |
| **Chat only** | Neither `shell` nor `files` | Advisory mode: the bot writes briefs, plans and review checklists; the user carries them to tools and pastes back results. Paste the rendered plan card (from `plan render` or the role table) at the start of each session; nothing persists on disk. |

When a bot host also supports `subagents` (and optionally `perAgentModel`), treat it like `harness` or `vendor-native` according to the models it can spawn, and mark each verified capability with the date.

## Unknown host: the `host-scenario` question

When `compute-config.mjs start` sees an unrecognized host (`change: "unknown"`) or a detected host with no entry in `hosts` (`change: "new"`), it emits an `ask` item with `id: "host-scenario"`:

- Question: *"Where does this session run?"*
- Options: `vendor-native`, `harness`, `open-router`, `bot`, `unknown` (recommended from the environment hint's scenario, if any).
- Never guess silently from installed CLIs on `PATH`. Confirm the host and scenario with the user, establish capabilities once, and save the host plan with `compute-config.mjs host set` or `plan apply` ([compute-config.md](compute-config.md)).
