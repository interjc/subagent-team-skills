---
name: subagent-team
description: Run multi-file, multi-phase coding work as a small software organisation in four layers. The main session is the director; in-house expert subagents design, review and accept; in-house execution subagents implement and test; external teams (other vendors' agents via CLI, plugin or MCP, such as agy, Codex CLI or OpenCode) take gated bulk work through a low-tier liaison; the human gets one batched question list at the end. Detects and confirms the host harness, keeps shared state on a team board in the repository (or the harness's native task list), and keeps AGENTS.md and docs cross-referenced. Use this whenever a task spans several files or phases, and whenever you are about to split work or choose a task's flow, delegate to a subagent or an external agent, pick a model or effort for one, write a brief, track an external job, review or accept delegated work, set up a project's team policy, record a lesson or user adjustment, or decide whether to ask the user, even if the user never says "subagent".
license: MIT
compatibility: The method itself needs nothing but a harness that can spawn subagents. The optional helper scripts need Node.js 18+ (24 recommended) and git; run scripts/env-check.cjs at the start of a session.
metadata:
  version: "0.2.0"
---

# Subagent Team

Treat a large coding task like a small software organisation: a director, a team of in-house experts, an in-house execution team, external contractor teams, and a human owner who is asked as little as possible, all at once, at the end.

This skill is the method. Project facts (commands, sensitive modules, shared files, the host harness, which concrete model or external team fills which tier) belong in the project's `AGENTS.md` / `CLAUDE.md`, in a `## Subagent team` section created on first use. Project rules always win over this skill.

Harness support: developed and used day to day in **Claude Code**, also used with **Codex** as the main session. Any harness that can spawn subagents can follow it; host detection and mechanics live in [references/host-harness.md](references/host-harness.md), [references/harness-claude-code.md](references/harness-claude-code.md) and [references/harness-codex.md](references/harness-codex.md). For calling external CLIs, load the companion skill `cli-agent-delegation`; for progress records and mid-task handover, `agent-handover`.

## Start: environment health check

Once per session, before the first dispatch, and again after anything is installed or changed, run the check. It works from any directory; `--root` names the project:

```bash
node <this skill's directory>/scripts/env-check.cjs --root <project root>
```

It installs nothing and reports:

- **Hard requirements**: Node.js 18 or newer for the helper scripts, and git. **Recommended**: Node.js 24.
- **Host harness hint**: which agent this session probably runs in, from environment variables. A hint to confirm, never a decision (section 0).
- **Optional external teams**: Codex CLI, agy, the agy-staff plugin, other agent CLIs on `PATH` (OpenCode, Pi, Grok), MCP servers in the project's `.mcp.json`.
- **Project policy and team board**: whether `## Subagent team` exists, records the host, and links a board.

Exit `0` means ready, possibly with warnings; `2` means blocked. If `node` itself is missing, the command fails with "not found": treat that as a failed Node check. Then:

1. **Tell the user in one short message**: blockers, warnings, missing optional tools, and the fix for each. The report contains the commands.
2. **Install only with consent.** Never change the user's default Node version, shell profile or global packages unasked; prefer per-shell or per-project changes (`nvm install 24 && nvm use 24`).
3. **Re-run the check** after any change. Start the work once it no longer reports blockers.
4. **If the user declines or cannot install**, continue with the fallback:

| Missing | Fallback |
|---|---|
| Node.js 18+ | The method needs no scripts. Map tiers from the harness's model list and the vendor pages ([references/model-tiers.md](references/model-tiers.md)); write board files by hand from [references/team-board.md](references/team-board.md); for external teams, `cli-agent-delegation` lists the raw CLI commands. |
| git | Not workable for team mode: leases, diffs, reviews and commits rely on it. Stay in Solo mode until git is installed. |
| An external CLI | Keep that work in-house, or use whichever external team is available. |
| agy-staff plugin | Use the raw `agy` CLI (skill `cli-agent-delegation`). |

5. **Record the result** in the policy section (`Environment:` line, [references/project-setup.md](references/project-setup.md)). Warnings the user already accepted get one line next time, not a new question.

## 0. Host harness, policy and mode

**Host harness.** Compatibility has two levels: the host the user runs (it decides what the in-house team can be) and the external teams it can reach. On first use, take the env-check hint plus your own tool list (an `Agent` tool with `model` / `effort`, `spawn_agent`, a task-list tool, MCP tools), and **confirm the host with the user**. Then establish its capabilities once: subagents, per-subagent model and effort, nested dispatch, background runs, a native task list, shell for subagents. Detection hints, the capability checklist and what to do when something is missing: [references/host-harness.md](references/host-harness.md).

**Team policy.** Look for `## Subagent team` in `AGENTS.md` (or `CLAUDE.md`). If it exists, follow it without asking. If not, detect what is available and ask a short questionnaire (host harness, model policy `auto` / `fixed` / `hybrid`, cost preference, external teams and their tiers, team board, never-outsourced paths, commit and push rules), then write the section. Procedure and template: [references/project-setup.md](references/project-setup.md).

**Mode** (how formal the paperwork is):

| Mode | Use when | Director edits files? |
|---|---|---|
| **Solo** | 1–2 files, obvious change, nothing to parallelize | Yes, just do it. Skip the rest of this skill. |
| **Standard** (default) | A feature across several files or phases | Writes contracts, wiring and shared files; delegates the rest |
| **Strict** | Long programs with several task lines, high-risk areas (money, auth, irreversible data), or many agents running for days | Never. Every code task runs a `designed` flow with an L2 task lead and an independent reviewer; the board is mandatory. See [references/strict-mode.md](references/strict-mode.md) |

Say which mode you picked in one line when you start. Escalate from Standard to Strict when you notice yourself losing track of who is editing what.

## 1. The organisation: four layers

```
L1  Director            the main session: intent, task breakdown, flows, contracts, integration, commit
L2  In-house experts    high / top-tier subagents: detail design, task leads, senior review, acceptance, expert calls
L3  In-house execution  mid / low-tier subagents: implement + test, independent review, runners, liaisons
L4  External teams      other vendors' agents via CLI / plugin / MCP: gated bulk work, second opinions
    Human               decides what nobody else may, once, at the end
```

- **L1 Director**: holds the user's intent and decisions; splits the program into tasks and **chooses each task's flow** (which layers take part); writes contracts (core types, state, interface signatures, directory layout) because everything parallel depends on them; grants edit leases; integrates, verifies, commits. The director's context is the most expensive in the system: push analysis, waiting and reviews down; keep only conclusions.
- **L2 In-house experts**: designers turn a task into sub-tasks and briefs; task leads own a task line; senior reviewers review risky or cross-module work and accept at task level; the principal expert (top tier) takes the hardest calls. They return *recommendation + reasons + risks*. Review and acceptance tasks get the code and the requirements, never the director's own conclusion.
- **L3 In-house execution**: implementers deliver code with tests; independent reviewers and testers verify read-only; runners search and collect output; **liaisons** track external teams (section 5).
- **L4 External teams**: only work that passes the outsourcing gate (section 3). Their output is a claim until accepted in-house.
- **Human**: product trade-offs, business calls, credentials, money, anything public or irreversible.

A layer is responsibility; a tier is model strength. They are chosen independently (section 2). Responsibilities, never-does lists, and who writes which document: [references/org-layers.md](references/org-layers.md).

Two principles run through everything:

1. **Delegate by default; decide by judgment.** The question is not "is this big?" but "does this need judgment?". Mechanical work goes out even when it is small enough to do yourself; judgment stays with L1 or L2.
2. **Verification must be executable.** Tests, commands with expected output, diffs, grep counts. Never "a model read it and thinks it is fine". See section 8.

## 2. Tiers and effort

| Tier | Typical layer and role | Typical effort |
|---|---|---|
| top | L2 principal expert: hardest design calls, evaluating competing designs | high |
| high | L1 director; L2 designers, task leads, senior reviewers; L3 implementers of risky work | medium–high |
| mid | L3 implementers of specified work, routine reviewers; L2 for routine splits | medium–high |
| low | L3 runners and liaisons | low |
| external-fast | L4: another vendor's cheap fast model for translations, bulk copy, mechanical edits | vendor's medium/high |
| external-strong | L4: another vendor's strong model for code-reading syncs, large homogeneous implementation, read-only second opinions | vendor's medium/high |

- The director runs at **high tier, high effort**: the session's own model, never switched. As of 2026-10 that meant Claude Opus 5.5 or GPT-6.1 Sol at `high`.
- Tier and effort are independent. Mid + high effort suits a precise but fiddly implementation; high + low effort suits a quick architectural sanity check. Effort follows **how much can only be settled by reasoning**, not the size of the change.
- External teams have tiers too: one team can fill external-fast with a flash model and external-strong with its strong model. The project's roster records which team and model fills which external tier ([references/external-teams.md](references/external-teams.md)).
- The project policy decides concrete models; under `auto` you choose and state each pick in one line. Mapping procedure, role table, dated example roster and `scripts/model-roster.mjs`: [references/model-tiers.md](references/model-tiers.md). Use what the harness actually exposes, not names from memory. If the harness cannot set effort per call, choose by tier only and ask for a thorough job in the brief.

## 3. Task breakdown, flows and the outsourcing gate

**Break work down like an engineering manager**: program → task (`T3`) → sub-task or external job (`T3.a`). Split along ownership boundaries (one module, one contract owner, one lease); make every unit independently verifiable with its own acceptance commands; peel the mechanical tail off judgement work and route it outward; isolate risky parts so they alone get the high tier and senior review; size each unit for one agent's context; make dependencies explicit; start with contracts and whatever is on the critical path. Details: [references/org-layers.md](references/org-layers.md), "Breaking work down".

**Choose a flow per task** and write it on the task's card:

| Flow | Path | Use when |
|---|---|---|
| `solo` | L1 | trivial; writing a brief costs more than the work |
| `direct` | L1 → L3 → L1 | the director's brief settles every decision |
| `outsource` | L1 → L3 liaison → L4 → L3 review → L1 | bulk, fully specified, passes the gate |
| `designed` | L1 → L2 → L3 → L2 accept → L1 | needs detail design, spans modules, or is sensitive |
| `designed+outsource` | L1 → L2 → L3 + (L3 liaison → L4) → L2 accept → L1 | as `designed`, with a mechanical tail L2 freezes and sends out |
| `consult` | L1 → L2 expert → L1 | a decision only, no code |

Skipped layers can still be summoned when a question needs them. Outside `solo`, every code change gets an independent review, execution layers hand in real acceptance output, and the integration gate and commit stay with L1.

**Keep with the director**: cross-task priorities, talking to the user, product decisions, contracts, final integration and commit. **Delegate even though it is tempting to do it yourself**: cross-file mechanical replacements, one-off verification scripts, bulk fact collection, renames under fixed rules.

**Outsourcing gate.** Send work to an external team only when *all four* hold; otherwise keep it in-house:

1. **Fully specified**: what to do and which files are decided; no product or architecture decisions remain.
2. **No risk**: does not touch business logic in billing, payment or auth, data migrations, concurrency or data-loss paths; a mistake is easy to spot and roll back.
3. **Objective acceptance**: runnable commands or a checklist anyone can tick (key sets, placeholders, line counts, snapshots).
4. **Bulk or repetitive**: translations, homogeneous integrations, filling in from a template, snapshot and exhaustive tests, doc syncs, mechanical refactors.

**Exception: read-only second opinions.** A review of a diff or plan by another vendor's model changes nothing, so criterion 4 does not apply; the external verdict is input for the in-house reviewer, never the acceptance itself. Tests and snapshots *for* a sensitive module can be outsourced; the module's business code cannot.

## 4. Workflow (Standard mode)

1. **Design doc and board.** Decision table, architecture, task breakdown with each task's flow, assignment table (layer, tier, effort, in-house or which external team), risks. For work that involves external teams or may span sessions, open the team board (section 6) and create one card per task.
2. **Contracts first.** The director writes types, state, interface signatures, component names and props, directory conventions, and makes the type check pass. When two workers need the same computation, the contract names its owner; the other only calls it.
3. **Design (flows with L2).** The L2 designer turns its task into sub-tasks, briefs, leases and acceptance commands, and freezes the specs of anything going to L4.
4. **Dispatch.** Every writer owns a lease; one writer per file at a time. Launch independent work in one message so it runs concurrently; in-house and external work run at the same time, each external job with its liaison.
5. **Execute and test (L3, L4).** Implementers deliver code with tests and real acceptance output; independent reviewers audit, run and probe (section 8). Tricky problems go up the ladder (section 7).
6. **Accept.** L2 accepts its task where it is in the flow; otherwise L1. Then the director integrates: wiring, shared files (locale files, doc indexes, contracts), dead code.
7. **Verify.** Type check, lint, tests, then a short targeted manual pass on the user's running dev server. Do not start, stop or restart the user's services; ask them to.
8. **Review across phases.** A final cross-phase review catches what phase reviews cannot see (lifecycle ordering between subsystems, module-level caches, leftover dead code and keys).
9. **Record and commit.** Update the cards, the progress record, lessons and `AGENTS.md` (section 9). Where the project or user allows the agent to commit, commit each independently verifiable unit once checks pass. Push, merge or deploy only as the project's rules or the user allow.

## 5. External teams and the liaison

External teams are reached through a **CLI** (headless), a **plugin** that wraps one, or an **MCP server**. The project's roster lists each team, its channel, which external tier each of its models fills, and whether it may edit or only review. Before trusting an untested team, run one tiny read-only job and record what you found.

Every external job gets a **liaison**: an L3, low-tier, low-effort in-house subagent that tracks it so the director's context does not.

- **Does**: dispatches exactly per the frozen brief (or takes over a started job id); records job and conversation ids on the card at once; waits with bounded waits; collects the final reply and the real `git status` / `git diff --stat`; runs the acceptance commands; answers straightforward questions whose answer is already in the brief, contract, card or repository, by continuing the same job; sends one mechanical rework round; keeps the card current; reports at real transitions only.
- **Escalates** to L2 (L1 if the flow has no L2): any decision the brief does not make, spec contradictions, a second failed round, changes outside the lease, resumable timeouts, the team being unavailable, anything near a never-outsourced path.
- **Never**: decides product or architecture, edits code, commits, talks to the user, or starts a duplicate job.

Raise the liaison to mid tier when its checks require reading code. Without subagents (or without shell access for them) there is no liaison; the director runs the job in the background and reacts to the completion notification. Channels, the roster, adapting a new CLI, harness-specific waiting: [references/external-teams.md](references/external-teams.md). Calling agy and Codex: skill `cli-agent-delegation`.

## 6. The team board: shared, persistent state

Agents in different layers, external teams, later sessions and other harnesses must see the same state.

- **Use the host's native mechanism when it has one** (a shared task list, agent messaging) for live coordination inside the session.
- **Use the board in the repository** (`docs/agent-team/`: index, one card per task or job, progress record, decisions, lessons) whenever an external team is involved, the work may span sessions or be handed over, in Strict mode, or when the host has nothing native. When both are used, the board is the source of truth; mirror at real transitions, not every tick.
- **One holder per card**, the only writer: the director, an L2 lead, or the liaison for an external job. Open questions are `[open]` items on the asking unit's card, answered in place, never deleted.

`scripts/team-board.mjs` creates the skeleton (`init`), adds cards and index rows (`new`), and lists open escalations and drift (`status`). Layout, card template and rules: [references/team-board.md](references/team-board.md).

## 7. Escalation and asking the human

Once the user authorizes continuous work, **do not stop mid-way to ask**. Questions go **up to the next layer present in the flow**, which answers or passes them on; go up only when the current rung cannot decide:

1. **Liaison or L3** answers what the brief, contract or repository already settles.
2. **L2 expert** (designer, task lead, senior reviewer): technical calls inside the task's design.
3. **L1 director**: cross-task priorities, contract and lease changes; conventions that are reversible and small. Records the decision and reason.
4. **Principal expert** (`consult`): a top-tier subagent, read-only, for architecture trade-offs, bugs that resist reproduction, or when every option has a hard flaw. If the top tier is unavailable, use the next flagship at its highest effort and say so. Expert advice is data, not orders: check its basis, and let the implementer prove it with scenario tests.
5. **Human**: the expert cannot decide, or the question is a product or business call, needs accounts, keys or payment, or is public-facing. Record it under *Open questions*, take the most conservative path (or skip), and keep going.

These always need the human, whatever the expert says: reducing what users already have, irreversible data operations, prices and revenue, public commitments.

Every escalation carries the question, context with evidence, options with a recommendation, and what the asker does meanwhile; format in [references/org-layers.md](references/org-layers.md). At the end, hand over one **grill-me list**: one question per item, each with one line of background, 2–3 options, your recommendation and why, the cost of choosing wrong, and what you did meanwhile. Order by impact, merge what can be merged, and ask only what only a human can answer.

## 8. Briefs, verification and review

**Briefs.** A subagent knows only what you write. Every brief is self-contained: goal; background with **verified facts** (marked "verified, do not re-check", with file:line or command) separated from **things to verify yourself** (with "if it differs, stop and report"); the read-only contract; the lease (may edit / must not touch); reference files to imitate; constraints *with reasons*; runnable acceptance commands; deliverables; report format; the card path and escalation target. Standing prohibitions unless the brief says otherwise: no state-changing git operations (read-only `git status` / `git diff` is expected); no starting or restarting dev servers; no editing `.env*` or reading secrets; no repo-wide rewriting commands while others work in parallel; no editing shared files (report new i18n keys or shared-file changes instead). Outsourced briefs paste in every spec they need, use executable paths in acceptance commands, and say: "If anything falls outside this spec, stop and explain it in your final reply; do not decide." Templates (implementer, outsourced, liaison, reviewer, expert) and a pre-dispatch checklist: [references/brief-template.md](references/brief-template.md).

**Verification.**

- **Implementers deliver tests with the code**: unit tests for invariants, pure logic, money and permission rules (and why these tests); runnable commands with expected results for what cannot be unit-tested; concrete "step → expected result" items for the few browser checks.
- **Reviewers work in this order**: (1) audit the tests; (2) execute them and paste real output; (3) only then read code, hunting for risks the brief and tests missed. Test gaps mean NEEDS_CHANGES.
- Reviewers are read-only, never review their own implementation, and preferably use a different model (ideally a different vendor) from the implementer.
- **Acceptance**: a subagent's "done" is a claim. Look at the diff, check the lease, run the acceptance commands, verify factual claims in docs. L2 accepts where the flow has it; L1 always runs the integration gate.
- **Rework**: small fix → the accepting layer does it or sends it back; bigger → send the concrete failure to the *same* agent. External work that fails twice comes back in-house.

Review procedure, working-tree fingerprints, mutation checks, command pitfalls: [references/verification.md](references/verification.md).

## 9. Keep the project's docs alive

The project's own documents are how the next agent, session or tool runs this process well. Keep them current as part of "done", not as an afterthought:

- **`AGENTS.md` → `## Subagent team`** holds the policy (host, models, external roster, board location, never-outsourced paths, commit rules) and a link to the board index. The board index links back. Each rule has **one** home; everything else links to it.
- **User adjustments and lessons**: when the user corrects the process or states a preference, write a row in the board's `lessons.md` right away, with the date and the user's words verbatim; if it is a project-wide rule, write the rule in `AGENTS.md` and link it from the row. Escalations that exposed a brief gap, outsourcing that did not pay off, and traps that cost time get rows too.
- **At the end of each phase** spend a few minutes on: what was redone, which brief was unclear, which tool bit you, which outsourcing paid off. Promote rules every project should follow into `AGENTS.md`, and method improvements into this skill's [references/field-notes.md](references/field-notes.md) or your own fork.
- Rules and preferences live in the repository, never only in an agent's local memory (skill `agent-handover`).

What to write where, and when: [references/team-board.md](references/team-board.md), "Keeping AGENTS.md and the docs cross-referenced".

## 10. Running agents

- **Continue, don't respawn.** For follow-ups and rework on the same task line, continue the existing agent's conversation. Still send a self-contained new brief, re-check HEAD, working tree and lease, and say which earlier context still applies.
- **Slots vs context.** "Concurrency limit reached" is not a context problem: do not retry spawning; wait, reuse an idle agent, or outsource eligible work. A conversation that hit its context or turn limit is replaced: check its partial diff first.
- **Never interrupt running work** to free a slot or tidy up. If the user redirects an active task, cancel it, confirm it actually stopped, then continue or redispatch.
- **Wait for completion notifications**; do not poll logs or intermediate files for reassurance. Liaisons do the waiting for external jobs.
- **Worktrees** only for genuinely parallel writes to the same area, or to protect unfinished state. Never delete a worktree something still depends on; prefer recoverable cleanup over `rm -rf`.
- **Only stop processes you started** (by PID or your own port), never by name pattern; never touch the user's dev server.

## References

- [references/host-harness.md](references/host-harness.md): detecting and confirming the host harness, capability checklist, other hosts
- [references/project-setup.md](references/project-setup.md): first-use questionnaire and the `## Subagent team` policy section
- [references/org-layers.md](references/org-layers.md): the four layers, flows, task breakdown, escalation, who writes which document
- [references/external-teams.md](references/external-teams.md): external roster, channels (CLI, plugin, MCP), tiers, the liaison
- [references/team-board.md](references/team-board.md): native vs repository state, board layout, task cards, `scripts/team-board.mjs`, docs cross-references
- `scripts/env-check.cjs`: environment health check (Node.js minimum 18 / recommended 24, git, host hint, external teams, policy, board)
- [references/model-tiers.md](references/model-tiers.md): tier mapping, role table, dated roster, `scripts/model-roster.mjs`
- [references/brief-template.md](references/brief-template.md): implementer, outsourced, liaison, reviewer and expert briefs; pre-dispatch checklist
- [references/verification.md](references/verification.md): review procedure, fingerprints, mutation checks, command pitfalls
- [references/strict-mode.md](references/strict-mode.md): Strict mode across the layers, edit leases, status messages, final reports
- [references/harness-claude-code.md](references/harness-claude-code.md): Agent / SendMessage / task list / background agents, effort, known quirks
- [references/harness-codex.md](references/harness-codex.md): spawn_agent / followup_task, skill discovery, unverified areas
- [references/field-notes.md](references/field-notes.md): lessons from real projects
- [references/reviewer-prompt.md](references/reviewer-prompt.md): reusable read-only reviewer instructions
