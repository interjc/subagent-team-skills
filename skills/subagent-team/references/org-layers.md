# The organisation: four layers, flows, task breakdown

Run the team like a small software organisation. A **layer** says what an agent is responsible for and may decide; a **tier** (see [model-tiers.md](model-tiers.md)) says how strong its model is. The two are independent: a low-tier liaison sits in L3, and a high-tier reviewer for a risky change can sit in L2 or L3.

## The four layers

| Layer | Who | Decides | Does | Never does |
|---|---|---|---|---|
| **L1 Director** | the main session (one) | priorities, the task breakdown, each task's flow, contracts, cross-task conflicts, what goes to the human | talks to the user; writes the task cards and contracts; grants edit leases; integration gate; commit | waits on implementers directly in Strict mode; lets a subagent talk to the user |
| **L2 In-house experts** | high / top-tier subagents | detail design inside a task, interpretation of the spec, accept or send back, technical calls escalated from below | designers (detail design, sub-task split, briefs), task leads (own a task line), senior reviewers (risky or cross-module review, task-level acceptance), principal expert (top tier, hardest calls) | implement; commit; decide product or business questions |
| **L3 In-house execution** | mid / low-tier subagents (high tier for risky work) | nothing beyond the brief | implementers (code plus tests), independent reviewers and testers (read-only), runners (search, run commands), liaisons (track external teams) | widen the scope; review their own work; commit |
| **L4 External teams** | other vendors' agents via CLI, plugin or MCP | nothing | fully specified bulk work, read-only second opinions | anything that fails the outsourcing gate (SKILL.md section 3) |
| **Human** | the user | product and business calls, money, credentials, public or irreversible actions | answers one batched question list | is interrupted mid-way for something a layer could decide |

The director's context is the most expensive in the system. Everything that can be pushed down a layer is.

## Flows: the director picks one per task

When the director designs a task, it writes the flow into the task card (`- Flow:`). Layers not in the flow are skipped; they can still be summoned on demand for an escalation.

| Flow | Path | Use when |
|---|---|---|
| `solo` | L1 | one or two files, obvious change, writing a brief would cost more than doing it |
| `direct` | L1 → L3 → L1 | the director's brief already settles every decision (contract exists, single module) |
| `outsource` | L1 → L3 liaison → L4 → L3 review → L1 | bulk, fully specified work that passes the outsourcing gate, spec frozen by the director |
| `designed` | L1 → L2 → L3 → L2 accept → L1 | the task needs detail design, spans modules, or touches a sensitive area |
| `designed+outsource` | L1 → L2 → L3 + (L3 liaison → L4) → L2 accept → L1 | as `designed`, with a mechanical tail that L2 freezes and routes outward |
| `consult` | L1 → L2 expert → L1 | a decision only, no code: compare options, assess a risk |

Rules that hold in every flow except `solo`:

- **Independent review** by an agent that did not implement, preferably on a different model. Routine changes: an L3 reviewer. Risky or cross-module changes: an L2 senior reviewer.
- **Execution layers test and accept against the brief**: L3 and L4 run the acceptance commands and hand in real output; the reviewer re-runs them. Task-level acceptance belongs to L2 when L2 is in the flow, otherwise to L1.
- **The integration gate and the commit are always L1's.**

Choosing a flow:

1. Does the task need judgement beyond what the director can write down in one brief? Yes → include L2.
2. Is part of it mechanical, fully specified and verifiable by commands? That part goes to L4 through a liaison; the rest stays in L3.
3. Is it money, auth, data migration or anything irreversible? Then L2 designs and a senior reviewer reviews, whatever the size; L4 may only write tests and snapshots for it.
4. When in doubt between two flows, pick the lighter one and let escalation pull the heavier layer in.

The mode (SKILL.md section 0) sets how formal the paperwork is; the flow sets who works on a task. Strict mode forces `designed` (or `designed+outsource`) for every code task, with an L2 task lead per task line ([strict-mode.md](strict-mode.md)).

## Breaking work down

The director splits the program; L2 splits a task into sub-tasks. The same rules apply at both levels.

- **Hierarchy and ids**: program → task (`T3`) → sub-task or external job (`T3.a`, `T3.b`). One card per unit on the team board ([team-board.md](team-board.md)).
- **Split along ownership boundaries**: one module, one contract owner, one edit lease. Two units must never need to edit the same file at the same time. Interface-coupled work stays in one unit, or the contract is written first and both sides only consume it.
- **Every unit is independently verifiable**: it has its own acceptance commands, and passing them means something. A unit that can only be checked together with another is not a separate unit.
- **Separate judgement from bulk.** Peel the mechanical tail (translations from a frozen key list, snapshots, homogeneous adapters, doc syncs) off a task and route it to L4, so L3 spends its effort where judgement is needed.
- **Isolate risk.** Put the risky part in its own unit, so it alone gets the high tier, the senior reviewer and the human question, while the rest moves fast.
- **Size for one agent**: a unit fits one agent's context without compaction, and its brief fits on about two pages. Bigger: split. Smaller than the cost of writing the brief: merge, or let the director do it.
- **Dependencies are explicit**: on the card (`Parent:` and the log) and in the native task list where the harness has one. Contracts and shared types come first; they are on the critical path for everything parallel.
- **Order by critical path, then by risk**: start what blocks others, then what is most likely to surprise you.

## Escalation through the layers

Questions travel **up to the next layer present in the flow**; that layer either answers or passes it further up. A skipped layer can be summoned: an L3 agent in a `direct` flow escalates to L1, and L1 may open a `consult` with an L2 expert before answering.

| From | First stop | Answers there | Goes further up when |
|---|---|---|---|
| L4 external job | its L3 liaison | facts already in the brief, contract or repository; where a file is; which documented convention applies | anything needing a decision, a spec contradiction, a second failed round, a scope change |
| L3 implementer, reviewer, liaison | L2 designer or task lead (L1 if no L2) | technical calls inside the task's design | the design itself is wrong, another task is affected, a contract must change |
| L2 | L1 | cross-task priorities, contract changes, lease changes | product or business call, money, credentials, public or irreversible |
| L1 | principal expert (`consult`), then the human | hard technical trade-offs | only a human may decide: goes to the open questions and the end-of-task grill-me list |

Each question is written where it can be found: an `[open]` item in the asking unit's card, with who asked, who should answer, the options, and what the asker does meanwhile (the conservative path). The answer is written in place (`[answered <date> by <who>]`), and the asker is continued with it. Questions are never deleted.

An escalation message is short and self-contained:

```text
ESCALATE <task id> → <L2 name | L1 | human>
Question: <one sentence>
Context: <what was tried; file:line or command output>
Options: A <...> / B <...>; recommendation: <X> because <...>
Meanwhile: <conservative path, or "blocked">
Card: <path to the card>
```

## Who writes which document

| Document | Writer |
|---|---|
| `AGENTS.md` `## Subagent team` policy and project-wide rules | L1, with the user's consent for rule changes |
| Board index, progress record, decisions, lessons ([team-board.md](team-board.md)) | L1 (L2 task leads in Strict mode, for their own task lines' entries, as the lease says) |
| A task card | its holder only: L1, the L2 lead, or the L3 liaison for an external job |
| Design notes for a task | the L2 designer |
| Code and tests | L3 and L4, inside their lease |

One writer per file at a time, the same rule as for code. Everyone else reports to the writer by message.
