# The compute plan in local files

Detail behind "Start" in [SKILL.md](../SKILL.md). The user's compute plan says which host plans, spending profile, constraints, in-house seats, declared accounts and external resources (team · model · effort) take which responsibility, what replaces each one, when it may be used, how much quota it has and how it has performed. It is the user's configuration, kept in files every session and every tool can read, never in an agent's memory. The `subagent-team` skill ships `scripts/compute-config.mjs`, which reads, merges and writes these files and documents every field; without it, edit them by hand in the format below.

## Files

Plan (user-decided) and per-session state (machine-written) live in separate files:

| Scope | Directory | Use |
|---|---|---|
| global | `~/.subagent-team/` (a dedicated directory no other tool uses), or `$SUBAGENT_TEAM_HOME` | `compute.json` (plan, profiles, declared accounts, seats, hosts, global `quota` and `accountQuota`); `compute-usage.jsonl` (job log); `model-ranking.json`; `compute-state.json` when outside a git repo |
| project | `.agent-team/` in the repository's main checkout (shared by its worktrees), listed in `.git/info/exclude` | `compute.json` (project overrides); `compute-state.json` (per-session state inside a git repo); `confidentiality.md` |
| session | `compute-state.json` (`sessions.<key>`) | session-default overrides (`--scope session --session <key>` on `set`, `route`, `schedule add`, `profile use`), `lastHost`, `notes` and `carryOver` |

`compute.json` keeps `"schema": 1` (additive for 0.6.x readers) and stamps `"rev": 2` on writes by 0.7.0+; reading never rewrites. The project file overrides the global one per id (`resources`, `accounts`, `seats`, `profiles`), one level deep per host (`hosts.<id>`, with `serves` per team), per routing role and per schedule id; `quota` and `accountQuota` keep the newest `checked`; `constraints` only narrows (`denyVendors` union, `onlyVendors` intersection, `inHouseOnly` OR). Neither file is ever committed.

## Format (`compute.json`)

```json
{
  "schema": 1,
  "rev": 2,
  "timezone": "Asia/Shanghai",
  "profile": { "active": "balanced", "by": "user", "at": "2026-11-25", "until": null },
  "constraints": { "onlyVendors": [], "denyVendors": [], "inHouseOnly": false },
  "accounts": {
    "codex-primary": { "vendor": "openai", "team": "codex", "billing": "subscription", "plan": "pro",
                       "cycle": "weekly mon 09:00", "resets": null, "expires": null, "weight": 2, "declared": "2026-11-25" }
  },
  "accountQuota": {
    "codex-primary": { "state": "ok", "checked": "2026-11-25T08:00+09:00", "resets": null, "expires": null, "remaining": 40, "source": "user" }
  },
  "seats": {
    "seat-top": { "team": "claude", "vendor": "anthropic", "model": "claude-fable-5-2", "effort": "high", "tier": "top" }
  },
  "hosts": {
    "t3-code": {
      "name": "T3 Code", "scenario": "harness", "kind": "multi-vendor", "route": "host-switch", "confirmed": "2026-11-25",
      "home": [],
      "serves": {
        "codex": { "strategy": "primary-backup", "accounts": [{ "account": "codex-primary", "instance": "provider-inst-1" }],
                   "options": { "effort": "reasoningEffort" } }
      },
      "roles": { "principal": ["seat-top"], "runner": ["auto:low:low"] }
    }
  },
  "review": { "lastReviewed": "2026-11-24", "everyDays": 7,
              "preferences": { "everyDays": 30, "lastConfirmed": null, "lastAsked": null, "snoozeUntil": null } },
  "resources": {
    "agy-flash": { "team": "agy", "channel": "agy-acp-run.mjs", "model": "gemini-3.8-flash", "effort": "high",
                   "tier": "external-fast", "roles": ["bulk"], "fallback": ["opencode-fast", "in-house:mid:medium"], "cost": "included" },
    "codex-strong": { "team": "codex", "channel": "codex-run.mjs", "model": "gpt-6.2-sol", "effort": "high",
                      "tier": "external-strong", "roles": ["code-sync", "review"], "account": "codex-primary", "cost": "included",
                      "fallback": ["agy-argon"] },
    "opencode-fast": { "team": "opencode", "model": "deepseek/deepseek-v4.1-flash", "effort": "medium",
                       "tier": "external-fast", "roles": ["bulk"], "windows": [{ "hours": "00:00-08:00" }] }
  },
  "routing": { "review": ["codex-strong"] },
  "schedules": [ { "id": "spend-credits", "when": { "until": "2026-11-30" }, "prefer": ["opencode-fast"], "roles": ["bulk"] } ],
  "quota": { "codex-strong": { "state": "exhausted", "checked": "2026-11-22T14:20:00+08:00", "resets": "2026-11-22T19:00:00+08:00", "source": "error text" } }
}
```

- **Roles** (responsibilities): `bulk`, `homogeneous`, `bounded`, `code-sync`, `review`, `sensitive-review`; they match the "Which team?" table in [SKILL.md](../SKILL.md). `mayEdit: false` keeps a resource to reviews.
- **Fallback** chains are ordered and end in-house. They are tried breadth first after the routing order; a fallback outside its own roles is used only with a one-line note.
- **Windows** (`days` the window starts on, `hours` that may wrap midnight, `tz`, `from`, `until`; times with an offset, a date alone is a whole local day) limit when a resource may be used; **schedules** use the same window to `prefer` or `avoid` resources for some roles.
- **Session start and resolution**: with `subagent-team` installed, run `compute-config.mjs start --root <project>` once per session (replaces `show` at session start). It detects the current host, updates `compute-state.json`, loads that host's plan and profile, and returns `ask[]` / `say[]`. Then call `resolve --role <r> [--host <id>] [--session <key>] [--profile <name>] [--count <n>]`:
  - **Account expansion**: when `--host` is passed and `hosts.<id>.serves.<team>` exists, a resource expands into one candidate per declared `serves.<team>.accounts` entry in list order (a pinned `resource.account` keeps only that entry), adding `route` (`host-switch` vs `acp-liaison`), `account`, `instance`, `hostModel`, and mapped `options`.
  - **Account checks**: an account whose `accountQuota` is `exhausted` (with reset not passed) is excluded (`account <id> exhausted until <t>`, or `reset unknown: ask the user once`); an account missing from `accounts` is excluded (`account <id> undeclared`).
  - **Profile ordering and `--count`**: profiles (`performance`, `balanced`, `frugal`, `load-balance`, or custom profiles extending one) order candidates after exclusions; `--count <n>` (1–50) returns `assignments: [{ job, id, account, instance }]` (under `load-balance`, greedily balanced by bucket and account `weight`, capping `low` candidates at one job).
- **Other commands**: `show`, `set`, `route`, `schedule`, `quota`, `profile use|list|define`, `account set|remove|quota`, `seat set|remove`, `host set|remove|show`, `promote`, `reviewed --what models|preferences --decision keep|adjust|later`, `plan check|render|apply`, `migrate --dry-run`, `record` (supports optional `--host`, `--account`, `--instance`, `--session`), and `usage`.
- `compute-usage.jsonl` holds one JSON line per finished job: `at`, `resource`, `model`, `effort`, `outcome` (`accepted`, `rework`, `in-house`, `quota`, `failed`, `cancelled`), optional `task`, `host`, `account`, `instance`, `session`, `minutes`, `tokensIn`, `tokensOut`, `costUsd`, `project`.

## Asking and telling

- **Planning interview on init or a new host**: when `start` reports `needsInit` (no resources, hosts, or seats) or `change: "new"|"unknown"`, gather facts (`doctor.mjs`, probes, fresh ranking), draft up to three variants, validate with `plan check`, render with `plan render`, confirm in one pre-filled dialog of at most five questions, and apply with `plan apply`.
- **After that, decide and tell**: route by `resolve`; a change you make on your own judgement (a newer model on the channel, a fallback after a quota error, a stronger model after repeated rework) is announced in one line and applied unless the user objects. Every 7 days (default) post a short model review notice; every 30 days (default) run the Keep / Adjust / Later preferences check in the single start-up dialog (never mid-task).
- **Overrides default to session scope**: record them with `--scope session --session <key>`, ask once whether to keep them (session / project / global; silence never promotes), and use `promote` if the user wants them lasting.

## New models and outdated CLIs

A model ranking with performance and price comes from `subagent-team`'s `model-roster.mjs --arena --save` (OpenRouter prices plus LMArena's Code Arena scores, no key); without it, look up a current coding leaderboard and the vendors' model pages by web search, and note the date. Then compare it with what each channel lists (`compute-config.mjs check-models --available codex=<file> --available agy=<file>`):

- A newer model of the same family that the channel already offers: switch the plan with a one-line notice.
- A ranked model of the team's vendor that the channel does not list: the CLI is probably out of date. Tell the user the update command (Codex CLI: `npm install -g @openai/codex@latest`, or the package manager it came from; agy: `agy update`; OpenCode: `opencode upgrade`) and offer to run it; run it only after the user agrees ([compliance.md](compliance.md)). Re-run `doctor.mjs` afterwards.
