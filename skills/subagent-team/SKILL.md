---
name: subagent-team
description: Run multi-file, multi-phase coding work as a team. The main session is the director (product manager + project manager + architect); manager-level subagents split work, design, review and accept; worker subagents and external CLI agents (agy, Codex CLI) implement; the human gets one batched question list at the end. Use this whenever a task spans several files or phases, and whenever you are about to delegate to a subagent or an external agent, choose a model or reasoning effort for one, write a task brief, review or accept delegated work, run work in parallel, set up which models and effort a project's agents use, or decide whether to stop and ask the user, even if the user never says "subagent".
license: MIT
compatibility: The method itself needs nothing but a harness that can spawn subagents. The optional helper scripts need Node.js 18+ (24 recommended) and git; run scripts/env-check.cjs at the start of a session.
metadata:
  version: "0.1.1"
---

# Subagent Team

Treat a large coding task like a small company: one director, a few strong managers, many cheap and fast staff, and a human owner who is asked as little as possible, all at once, at the end.

This skill is the method. Project facts (commands, sensitive modules, shared files, which concrete model sits in which tier) belong in the project's `AGENTS.md` / `CLAUDE.md`, in a `## Subagent team` section created on first use, and project rules always win over this skill.

Harness support: developed and used day to day in **Claude Code**, also used with **Codex** as the main session. Any harness that can spawn subagents can follow it; harness-specific mechanics live in [references/harness-claude-code.md](references/harness-claude-code.md) and [references/harness-codex.md](references/harness-codex.md). For outsourcing to external CLIs, load the companion skill `cli-agent-delegation`; for progress records and mid-task handover, `agent-handover`.

## Start: environment health check

Once per session, before the first dispatch, and again after anything is installed or changed, run the check. It works from any directory; `--root` names the project:

```bash
node <this skill's directory>/scripts/env-check.cjs --root <project root>
```

It checks the hard requirements, the recommended setup and the project policy, and installs nothing:

- **Hard requirements**: Node.js 18 or newer for the helper scripts, and git.
- **Recommended**: Node.js 24.
- **Optional external staff**: Codex CLI, agy, the agy-staff plugin.
- **Project policy**: whether the project already has its `## Subagent team` section.

Exit `0` means ready, possibly with warnings; `2` means blocked. If `node` itself is missing, the command fails with "not found": treat that as a failed Node check. Then:

1. **Tell the user in one short message**: blockers, warnings, missing optional tools, and the fix for each. The report contains the commands.
2. **Install only with consent.** Offer to run the fixes. Never change the user's default Node version, shell profile or global packages unasked; prefer per-shell or per-project changes (`nvm install 24 && nvm use 24`).
3. **Re-run the check** after any change. Start the work once it no longer reports blockers.
4. **If the user declines or cannot install**, continue with the fallback:

| Missing | Fallback |
|---|---|
| Node.js 18+ | The method needs no scripts. Map tiers from the harness's model list and the vendor pages ([references/model-tiers.md](references/model-tiers.md)) instead of `model-roster.mjs`. For external staff, `cli-agent-delegation` lists the raw CLI commands. |
| git | Not workable for team mode: leases, diffs, reviews and commits rely on it. Stay in Solo mode until git is installed. |
| Codex CLI or agy | Keep that work in-house, or use whichever external agent is available. |
| agy-staff plugin | Use the raw `agy` CLI (skill `cli-agent-delegation`). |

5. **Record the result** in the project's policy section (`Environment:` line, see [references/project-setup.md](references/project-setup.md)). Warnings the user already accepted get one line next time, not a new question.

## 0. Pick a mode first

| Mode | Use when | Director edits files? |
|---|---|---|
| **Solo** | 1–2 files, obvious change, nothing to parallelize | Yes, just do it. Skip the rest of this skill. |
| **Standard** (default) | A feature across several files or phases | Writes contracts, wiring and shared files; delegates the rest |
| **Strict** | Long programs with several task lines, high-risk areas (money, auth, irreversible data), or many agents running for days | Never. Every file change goes through a task-line manager → implementer → independent reviewer. See [references/strict-mode.md](references/strict-mode.md) |

Say which mode you picked in one line when you start. Escalate from Standard to Strict when you notice yourself losing track of who is editing what.

**First use in a project (Standard and Strict).** Before the first dispatch, look for a `## Subagent team` section in the project's `AGENTS.md` (or `CLAUDE.md`). If it exists, follow its model policy without asking. If not, detect what is available, ask the user a short questionnaire (model policy `auto` / `fixed` / `hybrid`, cost preference, external staff, never-outsourced paths, commit and push rules), and write the section. With `auto`, you pick the recommended model and effort per role yourself and state each pick in one line. Procedure, questions and the section template: [references/project-setup.md](references/project-setup.md).

## 1. The team

```
Director (main session, high tier, high effort)
├── Managers (strong models, ideally from different vendors)
│   ├── decision tasks: split work, design, review a plan, review code, accept results
│   ├── task-line orchestrators (Strict mode only)
│   └── expert: top tier, only for the hardest calls
├── Staff
│   ├── in-house workers: mid tier for specified work, high tier for risky work
│   ├── runners: low tier, search and collect command output
│   └── outsourced staff: external CLI agents (agy, Codex CLI, ...) for bulk work
└── Human: decides what nobody else may decide, once, at the end
```

- **Director**: holds user intent and decisions in a design doc, splits phases, dispatches, integrates, verifies, commits. Writes the contracts (core types, state, interface signatures, directory layout) personally, because everything parallel depends on them. The director's context is the most expensive context in the system: push analysis and reviews out, keep only conclusions.
- **Managers**: one subagent per decision. They return *recommendation + reasons + risks*; the director decides. Review and acceptance tasks get the code and the requirements, never the director's own conclusion, or they will simply agree with it.
- **Staff**: implement inside the contract. Complex, cross-module or risky implementation stays in-house; only work that passes the outsourcing gate (section 3) goes to external agents.
- **Human**: product trade-offs, business calls, credentials, money, anything public or irreversible.

Two principles run through everything:

1. **Delegate by default; decide by judgment.** The question is not "is this big?" but "does this need judgment?". Mechanical work goes out even when it is small enough to do yourself; judgment stays with the director or a manager.
2. **Verification must be executable.** Tests, commands with expected output, diffs, grep counts. Never "a model read it and thinks it is fine". See section 6.

## 2. Tiers and effort

Describe roles with abstract tiers and pick concrete models per harness:

| Tier | Role | Typical effort |
|---|---|---|
| top | expert decisions, evaluating competing designs | high |
| high | director, cross-module design, code review, hard bugs, sensitive modules | medium–high |
| mid | routine decisions, specified implementation, detail-heavy UI | medium–high |
| low | search, run commands, collect output | low |
| external-fast | another vendor's cheap fast model: translations, bulk copy, mechanical edits | vendor's medium/high |
| external-strong | another vendor's strong model: code-reading syncs, large homogeneous implementation, read-only second opinions | vendor's medium/high |

- The director runs at **high tier, high effort**. As of 2026-10 that meant Claude Opus 5.5 or GPT-6.1 Sol at `high`.
- Tier and effort are independent. Mid + high effort suits a precise but fiddly implementation; high + low effort suits a quick architectural sanity check.
- Effort follows **how much can only be settled by reasoning**, not the size of the change. Good tests let a reviewer run at lower effort, because the judgment is already encoded in executable checks.
- The project's `## Subagent team` policy (section 0) decides which concrete model and effort each role gets; under `auto` you choose. Mapping procedure, a role-by-role table, a dated example roster and the `scripts/model-roster.mjs` helper are in [references/model-tiers.md](references/model-tiers.md). Use the models your harness actually exposes, not names from memory. If the harness cannot set effort per call, choose by tier only and ask for a thorough job in the brief.

## 3. Who does it: yourself, in-house, or outsourced

**Do it yourself (or give it to a low-tier runner)** when writing the brief costs as much as doing the work, e.g. a ten-line edit.

**Delegate even though it is tempting to do it yourself**: cross-file mechanical replacements; one-off verification scripts; bulk fact collection (open fifty files, classify call sites); data cleanup and renames under fixed rules. Each needs many tool calls and no judgment.

**Keep with the director**: cross-task priorities, talking to the user, product decisions, contracts, final integration and commit.

**Outsourcing gate.** Send work to an external agent only when *all four* hold; otherwise keep it in-house:

1. **Fully specified**: what to do and which files are decided; no product or architecture decisions remain.
2. **No risk**: does not touch business logic in billing, payment or auth, data migrations, concurrency or data-loss paths; a mistake is easy to spot and roll back.
3. **Objective acceptance**: runnable commands or a checklist anyone can tick (key sets, placeholders, line counts, snapshots).
4. **Bulk or repetitive**: translations, homogeneous integrations, filling in from a template, snapshot and exhaustive tests, doc syncs, mechanical refactors.

**Exception: read-only second opinions.** A review of a diff or plan by another vendor's model changes nothing, so criterion 4 does not apply; the external verdict is input for your in-house reviewer, never the acceptance itself.

Tests and snapshots *for* a sensitive module can be outsourced; the module's business code cannot. Outsourced deliverables are only done after in-house acceptance, and content (copy, translations, examples) must be reviewed and edited, not just accepted. How to call agy and Codex, track jobs and resume them: skill `cli-agent-delegation`.

## 4. Workflow (Standard mode)

1. **Design doc.** Decision table, architecture, phased checklist, assignment table (who, tier, effort, in-house or outsourced), risks, plus two empty sections: *Lessons* and *Open questions*.
2. **Contracts first.** The director writes types, state, interface signatures, component names and props, directory conventions, and makes the type check pass. When two workers need the same computation, the contract names its owner; the other only calls it.
3. **Split and dispatch.** Every writer owns a set of files (a *lease*); one writer per file at a time. Decide in-house vs outsourced item by item. Launch independent work in one message so it runs concurrently; in-house and outsourced work can run at the same time.
4. **Integrate.** Wire things together, update shared files (locale files, doc indexes, contracts), delete dead code.
5. **Verify.** Type check, lint, tests, then a short targeted manual pass on the user's running dev server. Do not start, stop or restart the user's services; ask them to.
6. **Review.** One high-tier manager reviews each phase (medium effort is usually enough); a final cross-phase review at the end catches what phase reviews cannot see (lifecycle ordering between subsystems, module-level caches, leftover dead code and keys).
7. **Record and commit.** Lessons go into the design doc; project-wide rules into `AGENTS.md`; reusable method into this skill's [references/field-notes.md](references/field-notes.md) or your own fork. Where the project or user allows the agent to commit, commit each independently verifiable unit once checks pass. Push, merge or deploy only as the project's rules or the user allow.

## 5. Briefs

A subagent knows only what you write. Every brief is self-contained and covers: goal; background with **verified facts** (marked "verified, do not re-check", with file:line or command) separated from **things to verify yourself** (with "if it differs, stop and report" instructions); the read-only contract; the file lease (may edit / must not touch); reference files to imitate; constraints *with reasons*; runnable acceptance commands; deliverables; report format.

Standing prohibitions for every worker unless the brief says otherwise: no state-changing git operations (add, commit, stash, checkout, reset, push; read-only `git status` / `git diff` for evidence is expected); do not start or restart dev servers; do not edit `.env*` or read secrets; no repo-wide rewriting commands (`eslint --fix .`, formatters) while others work in parallel; do not edit shared files. Ask workers to *report* new i18n keys or shared-file changes instead of writing them.

Outsourced briefs additionally paste in every spec they need (the external agent cannot ask questions or read your chat), use executable paths in acceptance commands (`./node_modules/.bin/tsc --noEmit -p .`), and say: "If anything falls outside this spec, stop and explain it in your final reply; do not decide."

Templates for implementer, outsourced, reviewer and expert briefs, plus a pre-dispatch checklist: [references/brief-template.md](references/brief-template.md).

## 6. Verification and review

- **Implementers deliver tests with the code**: unit tests for invariants, pure logic, money and permission rules (and a sentence on why these tests and not others); a list of runnable commands with expected results for what cannot be unit-tested; concrete "step → expected result" items for the few things that need a browser.
- **Reviewers work in this order**: (1) audit the tests (do they test real behaviour, are assertions strong, what is uncovered, can every manual step be executed?); (2) execute them and paste real output; (3) only then read code, with specific questions, hunting for risks the brief and tests missed. Test gaps mean NEEDS_CHANGES, not "looks fine".
- Reviewers are read-only, never review their own implementation, and preferably use a different model (ideally a different vendor) from the implementer.
- **Acceptance is the director's**: a subagent's "done" is a claim. Look at the diff, check it stayed inside the lease, run the acceptance commands, verify factual claims (versions, paths, env vars, endpoints) in docs.
- **Rework**: small fix → do it yourself; bigger → send the concrete failure back to the *same* agent (it keeps its context). Outsourced work that fails twice comes back in-house.
- Browser checks are the last, targeted layer, never an open-ended exploration.

Details, reviewer brief contents, working-tree fingerprints, mutation checks, and command pitfalls that make checks silently pass: [references/verification.md](references/verification.md).

## 7. Escalation and asking the human

Once the user authorizes continuous work, **do not stop mid-way to ask**. Climb this ladder; go up a rung only when the current one cannot decide:

1. **Director decides**: there is a convention, it is reversible, the impact is small. Record the decision and reason in the design doc.
2. **Manager subagent**: compare options, assess risk, review.
3. **Expert**: a top-tier subagent, read-only, for architecture trade-offs, bugs that resist reproduction, or when every option has a hard flaw. If the top tier is unavailable, use the next flagship at its highest effort and say so. Expert advice is data, not orders: check its basis, and let the implementer prove it with scenario tests (and object in its report if a test contradicts it).
4. **Human**: the expert cannot decide, or the question is a product or business call, needs accounts, keys or payment, or is public-facing. Write it under *Open questions*, take the most conservative path (or skip), and keep going.

These always need the human, whatever the expert says: reducing what users already have, irreversible data operations, prices and revenue, public commitments.

At the end, hand over one **grill-me list**: one question per item, each with one line of background, 2–3 options, your recommendation and why, the cost of choosing wrong, and what you did meanwhile. Order by impact, merge what can be merged, and ask only what only a human can answer. If something truly blocks and has no conservative path, finish everything else first, then ask everything together.

## 8. Running agents

- **Continue, don't respawn.** For follow-ups and rework on the same task line, continue the existing agent's conversation (it keeps its context). Still send a self-contained new brief, re-check HEAD, working tree and lease, and say which earlier context still applies.
- **Slots vs context.** "Concurrency limit reached" is not a context problem: do not retry spawning; wait, reuse an idle agent, or outsource eligible work. A conversation that hit its context or turn limit is replaced: check its partial diff first.
- **Never interrupt running work** to free a slot or tidy up. If the user redirects an active task, cancel it, confirm it actually stopped, then continue or redispatch.
- **Wait for completion notifications**; do not poll logs or intermediate files for reassurance. Read progress only when the user asks or something failed.
- **Worktrees** only for genuinely parallel writes to the same area, or to protect unfinished state. Otherwise share one checkout with disjoint leases. Never delete a worktree something still depends on; prefer recoverable cleanup over `rm -rf`.
- **Only stop processes you started** (by PID or your own port), never by name pattern; never touch the user's dev server.

## 9. Keep the method alive

At the end of each phase spend a few minutes on: what was redone, which brief was unclear, which tool bit you, which outsourcing paid off and which did not. Write it into the design doc's *Lessons*; promote rules that every project should follow into `AGENTS.md` or this skill. Rules and preferences live in the repository, not only in an agent's local memory (see skill `agent-handover`).

## References

- [references/project-setup.md](references/project-setup.md): first-use questionnaire and the `## Subagent team` policy section
- `scripts/env-check.cjs`: environment health check (Node.js minimum 18 / recommended 24, git, external CLIs, project policy)
- [references/model-tiers.md](references/model-tiers.md): tier mapping, role table, dated roster, `scripts/model-roster.mjs`
- [references/brief-template.md](references/brief-template.md): implementer, outsourced, reviewer and expert briefs; pre-dispatch checklist
- [references/verification.md](references/verification.md): review procedure, fingerprints, mutation checks, command pitfalls
- [references/strict-mode.md](references/strict-mode.md): four-layer task lines, edit leases, status messages, final reports
- [references/harness-claude-code.md](references/harness-claude-code.md): Agent / SendMessage / background agents, effort, known quirks
- [references/harness-codex.md](references/harness-codex.md): spawn_agent / followup_task, skill discovery, unverified areas
- [references/field-notes.md](references/field-notes.md): lessons from real projects
- [references/reviewer-prompt.md](references/reviewer-prompt.md): reusable read-only reviewer instructions
