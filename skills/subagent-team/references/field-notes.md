# Field notes

Lessons from several real web and mobile projects, each one either a mistake that cost time or a practice that proved itself. Product details are removed; the lessons are not.

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
