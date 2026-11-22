# The compute plan in local files

Detail behind "Start" in [SKILL.md](../SKILL.md). The user's external compute plan says which team · model · effort takes which responsibility, what replaces it, when it may be used, how much quota it has and how it has performed. It is the user's configuration, kept in files every session and every tool can read, never in an agent's memory. The `subagent-team` skill ships `scripts/compute-config.mjs`, which reads, merges and writes these files and documents every field; without it, edit them by hand in the format below.

## Files

| Scope | Directory | Use |
|---|---|---|
| global | `~/.subagent-team/` (a dedicated directory no other tool uses), or `$SUBAGENT_TEAM_HOME` | the plan for every project on the machine; the quota ledger and usage log (they belong to the account); `model-ranking.json` |
| project | `.agent-team/` in the repository's main checkout (shared by its worktrees), listed in `.git/info/exclude` | differences that hold only in this project |
| session | none | "for now" choices stay in the session's notes or progress record |

The project file overrides the global one per resource field, per routing role and per schedule id. Neither file is ever committed.

## Format (`compute.json`)

```json
{
  "schema": 1,
  "timezone": "Asia/Shanghai",
  "review": { "lastReviewed": "2026-11-22", "everyDays": 7 },
  "resources": {
    "agy-flash": { "team": "agy", "channel": "agy-staff", "model": "gemini-3.8-flash-high", "effort": "high",
                   "tier": "external-fast", "roles": ["bulk"], "fallback": ["opencode-fast", "in-house:mid:medium"] },
    "codex-strong": { "team": "codex", "channel": "codex-run.mjs", "model": "gpt-6.2-sol", "effort": "high",
                      "tier": "external-strong", "roles": ["code-sync", "review"], "fallback": ["agy-argon"] },
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
- **Windows** (`days` the window starts on, `hours` that may wrap midnight, `tz`, `from`, `until`; times with an offset, a date alone is a whole local day) limit when a resource may be used; **schedules** use the same window to `prefer` or `avoid` resources for some roles, which is how time-sliced use is recorded (off-peak prices, credits until a date, a channel kept free in working hours).
- `compute-usage.jsonl` holds one JSON line per finished job: `at`, `resource`, `model`, `effort`, `outcome` (`accepted`, `rework`, `in-house`, `quota`, `failed`, `cancelled`), optional `task`, `minutes`, `tokensIn`, `tokensOut`, `costUsd`, `project`.

With `subagent-team` installed: `compute-config.mjs show` (effective plan, review due, ranking age, quota notes), `resolve --role bulk` (who takes the job now, who is excluded and why), `set` / `route` / `schedule` / `quota` / `record` / `usage` / `reviewed`.

## Asking and telling

- **Initialization is the only interview**: when no plan exists in either scope. Pre-fill it from `doctor.mjs`, each channel's model list (`agy models`, Codex's `models_cache.json`, `opencode-acp-run.mjs probe`) and a current ranking; confirm roles, model · effort, fallbacks, windows, confidentiality and quota in one dialog; ask where to keep it (global, project, session).
- **After that, decide and tell**: route by the plan; a change you make on your own judgement (a newer model on the channel, a fallback after a quota error, a stronger model after repeated rework) is announced in one line and applied unless the user objects. Every few days (the plan's `everyDays`) post a short review notice of the plan and what changed, then continue.
- **Every change the user asks for** gets one scope question: this session, this project, or globally.

## New models and outdated CLIs

A model ranking with performance and price comes from `subagent-team`'s `model-roster.mjs --arena --save` (OpenRouter prices plus LMArena's Code Arena scores, no key); without it, look up a current coding leaderboard and the vendors' model pages by web search, and note the date. Then compare it with what each channel lists (`compute-config.mjs check-models --available codex=<file> --available agy=<file>`):

- A newer model of the same family that the channel already offers: switch the plan with a one-line notice.
- A ranked model of the team's vendor that the channel does not list: the CLI is probably out of date. Tell the user the update command (Codex CLI: `npm install -g @openai/codex@latest`, or the package manager it came from; agy and OpenCode: their own update commands, *unverified* here) and ask before running it for them. Re-run `doctor.mjs` afterwards.
