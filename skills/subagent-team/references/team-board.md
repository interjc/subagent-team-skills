# The team board: shared, persistent state

Agents in different layers, external teams, later sessions and other harnesses must all see the same state: which tasks exist, which flow each follows, who holds it, what waits for whom, what was decided and learned. Chat history is not shared, and a harness's private state rarely survives the session or reaches external agents. So the state lives where all of them can read it.

## Native first, documents for what must last

| Mechanism | Who can read it | Survives the session | Use for |
|---|---|---|---|
| The harness's native task list or shared memory (where it exists) | in-house agents of this session | usually not | live coordination: claiming, dependencies, in-progress status |
| Messages between agents (`SendMessage`, `followup_task`) | the addressed agent | no | transitions and escalations, as they happen |
| The board in the repository (`docs/agent-team/`) | everyone, including external teams and future sessions | yes, with git | task cards, flows, holders, open questions, decisions, lessons |
| Local agent memory (per-user, per-machine) | that tool on that machine | yes, locally | pointers only, never the only copy of a rule (skill `agent-handover`) |

Rules:

1. **Use the native mechanism when the host has one** for live, in-session coordination. What is native per harness: [harness-claude-code.md](harness-claude-code.md), [harness-codex.md](harness-codex.md), [host-harness.md](host-harness.md).
2. **Use the board** when any of these holds: an external team is involved, the work spans sessions or may be handed over, Strict mode, more than a handful of concurrent tasks, or the host has no native task list.
3. **When both are used, the board is the source of truth.** Mirror into it at real transitions (created, dispatched, returned, escalated, accepted, committed), not at every progress tick.
4. Record the choice in the project policy: `- Team board: docs/agent-team/README.md` (optionally `+ native task list`), or `- Team board: native` for projects that agreed to skip the documents.

## Layout

```text
docs/agent-team/
├── README.md       # board index: reading order, task table, links back to AGENTS.md
├── progress.md     # status snapshot, completed log, next-up queue, user decisions, open questions, pitfalls
├── decisions.md    # numbered decisions, never rewritten
├── lessons.md      # user adjustments and lessons learned, with "promoted to" links
└── tasks/
    ├── T3.md       # one card per task
    └── T3.a.md     # one card per sub-task or external job
```

`progress.md`, `decisions.md` and the conventions for writing them (absolute dates, separate committed / pushed / deployed facts, the `<pending-commit>` placeholder, never-rewritten decisions) follow skill `agent-handover`. If a project already keeps these elsewhere (for example `docs/<program>/progress.md`), point the board index at them instead of creating duplicates: one authoritative home per kind of record.

Create the skeleton with the helper (never overwrites):

```bash
node <this skill's directory>/scripts/team-board.mjs init --root <project root>
node <this skill's directory>/scripts/team-board.mjs new --root <project root> --id T3 --title "Settings page" --flow designed --holder lead-T3
node <this skill's directory>/scripts/team-board.mjs status --root <project root>
```

`status` prints one JSON object: task counts by status, every `[open]` question with its target (and how many wait for the human), and warnings for drift: a card missing from the index, an index status that disagrees with the card, a card without a holder, an unknown status, or `AGENTS.md` not linking to the board. Exit codes: `0` ok (warnings allowed), `1` usage, `2` no board, `3` card already exists. Without Node.js, create the same files by hand from the templates below.

## Task card

```markdown
# T3.a: Translate the settings keys (fr, de)

- Status: waiting-external      <!-- planned | in-progress | waiting-external | escalated | in-review | accepted | committed | cancelled -->
- Flow: outsource (L1 → L3 liaison → L4 → L3 review → L1)
- Holder: liaison-T3a (L3, low tier)    <!-- the only writer of this card -->
- Parent: T3
- Team / model / effort: agy, <fast model>, <effort>
- Lease: locales/fr.json, locales/de.json
- Brief: docs/agent-team/briefs/T3.a.md
- Job: <job id>, conversation <id>
- Escalate to: L2 (lead-T3)

## Acceptance
- node scripts/check-locales.mjs → exit 0, identical key sets

## Log
- 2026-10-31 10:02 dispatched (agy, <model>)
- 2026-10-31 10:09 returned; 2 placeholders dropped; rework round 1 sent

## Questions
- [open] Q1 (2026-10-31, from: agy job, to: L2): plural forms for "item": ICU or two keys? Meanwhile: job paused, other keys done.
- [answered 2026-10-31 by liaison-T3a] Q2: where is the base file? → locales/en.json (brief, "Starting point")

## Result
<verdict, changed files, gate numbers; then a row in ../progress.md "Completed log">
```

Card rules:

- **One holder, one writer.** The holder is the layer leading that unit: the director, an L2 lead, or the L3 liaison for an external job. Everyone else sends the holder a message; the holder writes. A change of holder is a log line.
- Status words are exactly the list above, so `status` can count them.
- Questions use `[open]` and `[answered <date> by <who>]`, with `to: <L2 | L1 | human>`. Never delete one.
- The index row (`README.md` "Tasks") mirrors the card's status; the director updates it at transitions. `status` reports when they disagree.
- Acceptance numbers go to the completed log once; the card's Result points there.
- External agents read their brief, not the card. If a brief is longer than a command-line argument allows, keep it in the repository (for example `docs/agent-team/briefs/<id>.md`) and add it to the lease as read-only.

## Keeping AGENTS.md and the docs cross-referenced

The board only works if every agent finds it. Wire it in once, then keep it current:

1. `AGENTS.md` (or `CLAUDE.md`) → `## Subagent team` contains `- Team board: docs/agent-team/README.md`. Codex and Claude Code load these files every session, so the pointer is always in context.
2. The board index links back to `AGENTS.md` for rules and the team policy, and never restates them.
3. Every brief names the card path and the board index, so a subagent can read decisions and lessons relevant to its area.
4. **Each rule has one home.** Project-wide rules: `AGENTS.md`. Process decisions: `decisions.md`. Lessons and user adjustments: `lessons.md`. Task facts: the card. Everything else links.

When to write (the director, or whoever the lease names):

| Trigger | Write |
|---|---|
| The user corrects the process or states a preference ("always ask before outsourcing auth tests") | a `lessons.md` row with the date and the user's words, verbatim; if it is a project-wide rule, the rule itself in `AGENTS.md` and a "promoted to" link in the row |
| The user decides a product or design question | `decisions.md` entry plus a summary line in `progress.md` |
| An escalation reveals that a brief or contract was missing something | `lessons.md` row; fix the template or the contract |
| An outsourced job fails twice or turns out not to pay off | `lessons.md` row, and adjust the roster row for that team |
| A task is accepted or committed | card Result, completed-log row, index status |
| A compromise or trap is found | `progress.md` pitfalls |
| The session may end | in-flight records (skill `agent-handover`) |

Documentation sync is part of "done": a task whose card, index and progress record are not updated is not delivered.
