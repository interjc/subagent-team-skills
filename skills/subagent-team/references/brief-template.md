# Brief templates

A subagent knows only what you write. The more specific the brief, the less rework. Use the fields that apply; delete the rest.

## Implementer brief

```markdown
## Goal
<one sentence: the observable outcome and why it matters>

## Starting point
Repository: <absolute path>    Branch / HEAD: <branch> @ <short hash>
Working tree: <clean | existing changes and who owns them>

## Background
- Design doc: <path> (sections you must read: ...)
- Decisions that affect this task (only the relevant ones, not the whole doc)

## Verified (do not re-check)
- <fact> (how it was verified: <file:line> or <command + output summary>)
- Write root causes, not just symptoms: not "login fails" but "the session cookie is
  set for the wrong domain, so the API never receives it" (otherwise the worker may fix the wrong file).

## Verify yourself first
- <claim>: check with <command / experiment>.
  - Result A → do <plan X>
  - Result B, or anything that contradicts this brief → stop, report the difference,
    do not widen the scope

## Contract (read-only)
- <types file>, <state/store file>, <interface file>
- You export: <component/function names and props>. You use: <others' names and props>

## File lease
May create or edit: <exact paths or narrow globs>
Must not touch: <files other agents are editing>, shared files (locale files, doc indexes, contracts)

## Reference
Imitate <path> for <naming / structure / test style>.

## Behaviour to preserve
- <existing behaviour list; mandatory for refactors and file splits>
- <edge cases>

## Constraints (with reasons)
- No state-changing git operations (add, commit, stash, checkout, reset, push): the director reviews
  the diff and commits. Read-only `git status` / `git diff` is fine and needed for evidence.
- Do not start or restart dev servers; the user's server is already running at <url>.
- Do not edit .env* or read secrets.
- No repo-wide rewriting commands (eslint --fix ., formatters): others are editing in parallel.
- <task-specific prohibitions, each with its reason so you don't "helpfully" work around it>

## New i18n keys / shared-file changes
Do not write them. List them in your report: key + base-language text (+ English).

## Acceptance commands (run until clean; paste real output)
- Type check: <command>
- Lint (changed files): <command>
- Tests: <command>
If a failure already existed before your change, report it as pre-existing; do not fix it.

## Deliverables
1. Code + tests: unit tests for invariants, pure logic, money/permission rules.
   Say why you wrote these tests and not others.
2. Runnable verification list for what cannot be unit-tested: command + expected result, in pairs.
3. Browser steps only where needed: "open X → Y is visible / link goes to Z", concrete enough to follow.
4. Evidence: `git status --short`, `git diff --stat`, real output of every acceptance command,
   `wc -l` of every new file.
5. Every place you deviated from this brief, and why.

## Report format
- Files changed (one line each)
- Deviations from the contract and why
- Unfinished parts / open risks
- New i18n keys or shared-file changes needed
```

## Extra rules for outsourced (external CLI) briefs

External agents only know the brief and cannot ask follow-up questions.

- **Fully self-contained**: paste the spec, key lists, base-language text and insertion points into the brief. Do not just give a path the agent may not be able to read (files outside the workspace especially).
- **Freeze the list first**: an external agent will not pick up keys or endpoints you add after dispatch.
- **Acceptance commands use executable paths** (`./node_modules/.bin/tsc --noEmit -p .`, `./node_modules/.bin/eslint <files>`), not package-manager scripts, which may fail on engine checks or a different shell environment.
- **No decisions**: "If anything falls outside this spec, stop and explain it in your final reply; do not decide."
- **Prohibitions**: state-changing git operations (read-only status/diff is fine); installing packages, builds, dev servers, database commands; reading `.env*`; editing outside the lease.
- **Report**: files changed and why, uncertain spots, problems noticed but not fixed.

## Reviewer brief

Reviewers start cold and are read-only.

1. **Task background**: the original problem, root-cause judgement, what the implementer was told, scope limits.
2. **"Before" evidence**: reviewers usually cannot reach production or stash changes to build a baseline. If you have pre-fix data (captured HTML, error output, screenshots), paste it; otherwise the honest verdict is "cannot confirm".
3. **Where the implementer's tests and verification list are**, and the order: audit them, then execute them, only then read code.
4. **The implementer's main claims, one per line**, each to be verified independently.
5. **The points in the implementer's brief that required its own judgement**: check those hardest.
6. **Output format**: verdict (PASS / NEEDS_CHANGES) · test-quality assessment · execution results (real output) · findings outside the checklist (location, trigger, evidence, impact, by severity) · what was checked and what was not.
7. Give code and requirements, **not your conclusion**. State "read-only: do not modify, revert, stage or clean anything".

## Expert brief

The expert is a read-only top-tier subagent. It answers "how should this be decided", not "is this diff correct".

1. **Question**: what must be decided, why now, what happens if nothing is decided.
2. **Verified facts**, each with a source (file:line, command + output summary).
3. **Candidate options** with pros and cons; or "none yet, please propose".
4. **Constraints**: decisions already made by the user, hard rules, out-of-bounds areas.
5. **Output**: conclusion, reasons, confidence, risks, and what information is missing if no reliable conclusion is possible. Ask it to name the model and effort it actually ran with, and whether a fallback was used.

## Pre-dispatch checklist

- [ ] Is there an objective definition of done (commands that pass, a behaviour list)?
- [ ] Do the leases of parallel agents overlap? (They must not.)
- [ ] Did you write a guess as a fact? Mark uncertain items "verify first".
- [ ] Verified facts and things-to-verify are separate, with an instruction for mismatches.
- [ ] Deliverables require real output, `wc -l` of new files, and mutation checks where applicable.
- [ ] Review briefs carry code and requirements, not your conclusion.
- [ ] Outsourced work passes all four gate criteria; otherwise reassign in-house.
- [ ] The next step depends on this result? Then dispatch in the foreground or plan how you will be notified.
- [ ] Authorization for anything beyond the default (editing docs or agent config, deploying) is quoted verbatim from the user, with the files it covers.
