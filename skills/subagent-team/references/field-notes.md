# Field notes

Lessons from several real web and mobile projects, each one either a mistake that cost time or a practice that proved itself. Product details are removed; the lessons are not.

## Four-week delegation audit (2026-11)

The repository report *Field report: four weeks of delegation in one project (2026-10 to 2026-11)* reviewed 194 in-house agents and 60 external jobs in one mobile-and-services monorepo. These are observational results: work was assigned by risk, some outcome labels were inferred, and the sample does not establish a model ranking or a causal benefit from effort settings. Model names below are dated examples as of 2026-11.

| Observation | Decision it supports |
|---|---|
| Seven Codex CLI `gpt-6.1-sol` · high read-only reviews of billing and auth all produced useful, confirmed defects; 21 of 72 in-house reviews returned blockers, with only one finding rebutted with evidence | Retain senior in-house review and add another-vendor review on risky work; reproduce claims rather than counting votes |
| Known rework: Opus 5.5 20/30; Sonnet 5.5 12/18, on differently assigned work | Budget review-and-fix rounds by risk; equal observed rates do not make tiers interchangeable |
| Of 49 low-effort Haiku 5.5 liaisons, 42 delivered cleanly, 3 had gaps, 2 correctly escalated and 2 failed by returning immediately after dispatch | Keep the relay cheap; put waiting and collection in its explicit completion criteria |
| Above-high implementation effort still left review findings; small specified edits at medium were quick | Use medium/high for implementation; send unresolved design questions to an expert |
| Sandboxed workers could not run some acceptance commands; a large generated test file passed commands without an in-house content review | Assign in-house execution capacity and independent semantic review, including for tests |

The audit reinforces existing separation of duties; it does not justify outsourcing sensitive implementation, removing review for stronger authors or claiming every channel is verified. Current support levels remain in [external-teams.md](external-teams.md); dispatch rules in [model-tiers.md](model-tiers.md), review closure in [verification.md](verification.md), and the method in [SKILL.md](../SKILL.md).

## Lessons from two projects in one week (2026-11)

Collected from the policy sections and boards of a mobile-and-services monorepo and a web SaaS project after a week of daily use.

- **A plan with every path saves a rework round.** Credit enforcement went back for rework over a lost admin cost record and an endless poll at zero balance. Both were paths through the change (an existing caller, a client polling a new refusal) that a path-by-path plan, reviewed before code, would have shown. Plans now list each new state's effect on callers, polling, retries, cost records and old clients ([SKILL.md](../SKILL.md), "Workflow").
- **The user asked for shallower live checks, twice.** After a provider switch, one live call per provider's main model was enough; ledger forensics and full walkthroughs were not wanted. For a cron path, waiting for the next run cost an hour; a test of the handler proved the same thing ([verification.md](verification.md), "How deep live checks go").
- **A regression ran while an external job was still editing.** The dev server hot-reloaded half-written files and one failed response never reproduced. Walk after the writers stop.
- **Channel preferences followed quota.** The external order changed three times in six days (OpenCode first, then last, then first again) as credits neared expiry or ran out, and each change was appended to the policy with its history. The section grew to about 40 dense lines with expired rules beside current ones. Preferences like these are session scope; lasting changes rewrite the rule in place ([user-overrides.md](user-overrides.md), [project-setup.md](project-setup.md), "Keeping the section short").
- **A user instruction never reached the roster.** A task request named OpenCode's GPT models, the work used them, and the project's roster still listed only the older teams. A roster lists what a team can do; it is updated when a team is verified, not when it is preferred.
- **The board drifted and nobody ran the check.** Every card said `done` (not a status word), the index still said `planned`, and the completed log named tasks without cards. `team-board.mjs status` printed every warning and returned ok. It now has `set` for transitions and `--strict` for close-out ([team-board.md](team-board.md)).
- **A lesson was "promoted to" local memory.** The rule existed only on one machine. `status` now flags it.
- **Floors were overridden by the user, on purpose.** Expert reviews on the same model as the author; Claude models through OpenCode under a Claude host; billing code sent out for three days (ended early after one). Each was the user's call and each needed a compensation (fresh-context review, "not a second vendor", a senior review and an end date), now listed in [user-overrides.md](user-overrides.md).
- **Mechanical renames went better as a script** with a checked mapping than as repeated model edits; an agy job that exited 0 with network `ERROR` lines in its log was not accepted; and a verified snapshot was committed with `git hash-object` / `git update-index --cacheinfo` while a worker still held the file ([running-agents.md](running-agents.md)).

## Pace and authorization

- Once the user authorizes continuous work, gather decisions toward the end: hard questions go to the strongest model, undecidable ones to *Open questions*, and the user gets one list at the end. Interrupting the user repeatedly costs more than a wrong, reversible small decision.
- Commit each independently verifiable unit when its checks pass; it makes rollback and review easy. Do not push unless the user or the project rules say so.
- Before delivery, give the user a list of *default assumptions* to correct in bulk instead of asking item by item.
- An implementer refused to edit `AGENTS.md` because a message from another agent is not the user's authorization. That was correct. Quote the user's words (with date and the files they cover) in the brief; when authorization is incomplete, the director goes back to the user instead of "insisting" in a brief.

## Contracts and parallel work

- Write the contract before parallel dispatch: core types, state, interface signatures, component names and props, directories. Dispatch only once it type-checks.
- When two workers need the same computation (say a price estimate), the contract assigns it to one module and one owner; otherwise you get two implementations with different results.
- Shared files (locale files, doc indexes, contracts) are written by the director only. Pre-writing every key the feature needs into all locale files and letting workers only reference them was the most robust variant.
- Workers report new i18n keys; the director collects them in one list (key / base language / English), a script diffs "keys referenced in code" against "locale files + list", and one outsourced batch fills the remaining languages.
- Changing a protocol on both client and server in parallel: the director wrote only the shared request/response types and error codes, letting the type checker flag every place to change on both sides, then dispatched both workers at once. The client's in-memory fake server belonged to the server worker; the client worker only read it. Both sides matched first time.

## Review and acceptance

- A subagent's "done" is self-reported. Look at the diff and run the commands.
- Give reviewers the code and requirements, not your conclusion, or they confirm your assumptions.
- Review even after everything is green: in one large component split, review after green tests and a browser pass found 14 real problems (data loss, races, mobile overflow). Happy paths get tested; failure paths (storage unavailable, failed writes, rapid double clicks, closing the page) are mostly found by review.
- Review fixes are also split by file across parallel workers, with any new contract field (for example a new state field and its type) defined before dispatch so both sides can start.
- Per-phase reviews plus one final cross-phase review: touch interaction, shutdown order between subsystems, isolation of module-level caches, dead code and unused keys showed up mostly in the final one.
- Experts are not infallible. A top-tier recommendation ("push oldest-first on first upload") was disproved by the implementing worker's scenario test, which showed it would delete local data; the fix went newest-first. Briefs now say: "If the goal and a test disagree, follow the test and explain in the report."
- A pure documentation slice: the independent reviewer checked the "verified" claims against source and found that a page mounted two instances of a widget sharing the same default storage key, a fact neither the implementer nor the director had noticed.
- A brief listing "already verified, do not re-check" facts cut a worker's run from over ten minutes to about three.
- An audit of a long run found a money review on a mid-tier model and an under-tiered implementer kept through every rework round, while each individual dispatch had looked reasonable. Tier mistakes compound silently; audit from the logs at milestones.
- External teams stayed unused for most of a long run although both were installed. Nobody decided against them; the gate was simply never run.
- On a ledger with money and concurrency, a senior in-house review reported no defect, and a read-only second opinion from another vendor, run at the same time, found four that reproduced in the real runtime, all a value read outside a batch and written inside one. Run both on money, withhold each from the other, and judge by reproduction, not by vote. The next round asked the reviewer to list every read that decides a later write and name its guard; that table found the remaining cases and is worth asking for up front.

## A complete example

A multi-phase feature built in five phases: the director wrote contracts, integration and browser regression; about 20 subagent tasks ran (the high tier for splitting, risky implementation, billing-related work and all reviews; the mid tier for storage, UI and layout; an external fast agent for three translation batches, over a hundred keys); each phase had one or two review-and-fix rounds; the user was never interrupted mid-way, and open questions were delivered together in the design doc.

Typical shape that kept recurring: **director builds the skeleton → several mid-tier workers fill it in parallel (with clearly specified bulk work outsourced at the same time) → high-tier review.**

More assignment examples:

| Project | Work | Who |
|---|---|---|
| Core module refactor | Architecture, migration steps, billing strategy extraction, final review | director (high) |
| | Registry: skeleton by director, then three families of adapters | 3 mid-tier workers in parallel |
| | Billing lifecycle characterization tests, adapter request-body tests | mid · high (precise but fiddly, money-adjacent) |
| | Golden snapshots, catalog snapshots, exhaustive price tables, env parsing tests | external-fast (mechanical, tedious, fully specifiable) |
| | Import path rewrites, constant moves | external-fast or low tier |
| | Per-phase diff review | high · medium |
| Template feature (full stack) | Schema, migration, CRUD API, limits | mid · medium → high-tier review |
| | Parsing route, dialogs and editor | mid · high |
| | The remaining built-in templates from 3 hand-written exemplars | external → director edits |
| | 4-language i18n | 2 base languages by a mid-tier worker, 2 by an external agent |
| README and docs index sync | Self-contained briefs, fact checks, final fixes, commit | director |
| | Rewrite root README from current code | Codex, strong model, high |
| | Rebuild the docs index | Codex, light model, high |

The two Codex jobs touched disjoint files, ran at the same time in one workspace, and both passed first time.

## Environment

- Use the user's running dev server and logged-in browser for regression; never start or stop their services. Ask them to restart when needed.
- After large refactors, a dev bundler can keep a stale module graph; restart, it is not a code bug.
- After a dev server restart, an old tab on a protected page can loop on session refresh; close it and open a new one.
- Browser automation that injects a whole string at once can trigger framework warnings real typing never does; reproduce with real input before chasing it.
- Non-interactive agent shells may resolve a different `node` or package-manager binary than the user's interactive shell (no profile loaded). When something behaves oddly, check `node -v` / `which <tool>` first, and do not "fix" the user's toolchain; use the project's documented binary paths.

## Commits

- `git rm` / `git mv` stage immediately; a later commit picks them up even if you only `git add` other files. Check `git diff --cached --stat` before committing and `git show --stat HEAD` after.
- With several phases in flight in one workspace, stage explicit paths per phase; never `git add -A`.

## Cost

- For regression runs, pick the cheapest adequate model per category and estimate the spend first, so verification does not eat the budget.
- External fast agents have a fixed overhead (about five minutes and millions of cached tokens per job); tiny edits are not worth it. A strong external model syncing docs took two to five minutes and about 90k tokens.
