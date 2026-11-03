# Verification, review and acceptance

Asking a model to "read the code and think about what could go wrong" is slow, expensive, unrepeatable and cannot run in CI. Turn verification into things that run.

## Who does what

| Role | Verification job |
|---|---|
| Implementer | Writes unit tests and a runnable verification list; it knows best what changed and where the edges are |
| Reviewer | Audits those tests first, executes them, then hunts for risks outside them |
| L2 (where the flow has it) and L1 director | Accept: scope check, targeted re-runs, factual checks, fills gaps the brief missed; L1 always runs the integration gate |
| Liaison (external jobs) | Runs the acceptance commands and mechanical checks on the job's output; escalates instead of judging; never runs end-to-end checks |
| External teams (L4) | Static checks and unit or snapshot tests only; no end-to-end checks (below) |
| Browser / end-to-end | Last layer, a few targeted checks, never open-ended exploration; arranged by L1 |

## What to unit-test

Worth it: business invariants, compliance rules, pure functions and data transforms, anything involving money or entitlements. Not worth it: rendering details, configuration changes that are obviously right or wrong at a glance, mirror tests for small reversible edits.

Ask the implementer to explain why it wrote these tests and not others; that exposes whether it understood the boundaries better than the tests themselves do.

## Review in three steps (order matters)

1. **Audit the tests** (cheapest, most valuable):
   - Do they test a real problem, or pad the count with constant assertions?
   - Are assertions strong? "Does not throw" is not verification; assert values, structure, boundaries.
   - What changed path is covered by no test and no checklist item?
   - Can every manual step be executed exactly as written? "Check the page looks fine" cannot.
   Gaps → NEEDS_CHANGES, and the implementer adds tests. The reviewer does not patch files.
2. **Execute**: run the tests, every command in the verification list, every browser step that the reviewer can actually perform. Paste real output; do not restate the implementer's output.
3. **Hunt outside the checklist**: now read code, with specific questions. Would this change affect something neither the brief nor the tests mention? The implementer answers for the brief; the reviewer answers for the result.

Reviewers without browser tools must not be asked to "check in the browser". The task lead or director performs browser checks and passes the evidence into the review brief; the final report says which layer did what.

## Sensitive work: two independent reviews

For money, auth, schema and irreversible-data changes, arrange an in-house senior review and an authorized read-only review by another vendor's strong model at high effort. The external review supplements the senior review; it does not accept the task. If the roster cannot supply it, the fallback is one independent in-house senior review with the missing external opinion recorded; stricter project review gates still apply ([SKILL.md](../SKILL.md), "Breakdown, flows and the outsourcing gate").

- Review the same revision or scoped working-tree fingerprint. Run the two reviews in parallel where possible and withhold their findings from each other until both return. Give requirements and code, not a preferred verdict.
- Ask for concrete failure paths: a result lost after charging, retries or duplicate settlement, cross-user reads, missing schema constraints, and each read that decides a later write. Pick the cases relevant to the change; do not require this checklist on routine work.
- Treat findings as claims. The fixer reproduces the trigger or checks decisive source evidence before changing code. Record confirmed / rebutted / unresolved, with evidence; disagreement is settled by evidence, not reviewer votes. A sandbox-blocked reproduction stays unverified until an authorized in-house runner checks it.
- Budget two review-and-fix rounds for risky units, whatever the implementer tier. This is a planning allowance: re-review changed paths and affected invariants, stop when confirmed blockers are closed and gates pass. An unresolved finding with material correctness impact blocks acceptance: escalate to an in-house expert instead of repeating the same failed fix.

## Generated tests need semantic review

External test and snapshot backfills need an independent in-house content review after mechanical acceptance, even if the liaison ran every command successfully. Compare cases and expected values with the frozen requirements: do they enforce the intended invariant, cover failure paths, and fail for the defect they claim to guard? Passing generated tests alone does not prove this. Keep that judgment with a reviewer at the module's risk floor, not a low-tier liaison.

## End-to-end checks for outsourced work

External CLI agents in general cannot run end-to-end checks: they have no browser or device, run sandboxed or without network, and their briefs forbid dev servers, builds and databases. So by rule, the **director (L1) arranges every end-to-end check for outsourced work**, never the external team or its liaison.

- External briefs carry static checks and unit or snapshot tests only. An end-to-end step in an external brief is a brief bug; an external report that says it "checked in the browser" or "ran the app" is unverified.
- When an outsourced change touches anything user-facing (UI, routes, API responses, generated copy shown to users), the card records `E2E: pending director` with the flows to walk and their expected results; the liaison or L2 lists them, and the job is accepted but the task is not done.
- L1 runs those checks itself, or hands them to an in-house agent that actually has the tools (browser, device, the real stack), on the user's running dev server where possible. Batch them: one walkthrough after several jobs land is cheaper than one per job.
- The final report says which checks the external team ran and which L1 arranged.

## Reviewer hygiene

- Read-only, stated explicitly in the prompt ("do not modify, revert, stage or clean anything"). Some harnesses give subagents write tools anyway; having a tool is not permission.
- Never the implementer of the same change; preferably a different model or vendor.
- Scope check with a scoped status, not a bare `git status`: files outside the task (docs written by another task, files a dev server regenerates) are ignored, not investigated or reverted.

  ```bash
  git status --short -- ':(exclude)docs' ':(exclude)AGENTS.md'
  ```

- **Fingerprint the working tree** at the start and end of a review: scoped `git status --short`, the hash of `git diff --binary -- <paths>` (pipe into `git hash-object --stdin`), and a sorted list of untracked files with `git hash-object <file>` each. If start and end differ, the tree changed during the review: the review is void; find out whether the reviewer overstepped or another writer was active.
- **Verify "verified" facts in docs against source.** Documentation, decision records and skills are reviewed like code: every claim written as verified (file:line, default value, call relation) gets checked. A wrong document sends the next implementation off on a false premise.
- Line numbers and quotes in a review report are leads; go back to the source before acting on them.

## Mutation checks: the strongest evidence

Break the guarded logic on purpose, watch the test fail, restore, prove the file is byte-identical, watch it pass.

```bash
: "${TMPDIR:?}"                                  # never let the backup land in /
BK="$TMPDIR/rule.ts.orig"                        # one variable for the backup path, no fallbacks
cp src/rule.ts "$BK" && test -s "$BK"            # backup exists and is non-empty, or stop
sed '14s/.*/  return false;/' "$BK" > "$BK.mut" && test -s "$BK.mut" && cp "$BK.mut" src/rule.ts
<test command for this rule>; echo "exit=$?"      # expect: failure
cp "$BK" src/rule.ts
cmp "$BK" src/rule.ts; echo "cmp exit=$?"         # expect: 0
<test command for this rule>; echo "exit=$?"      # expect: pass
```

- Only an agent holding the edit lease mutates files; reviewers audit the mutation evidence.
- Put the list of rules to mutate in the brief's deliverables; require "break → red → restore → cmp 0 → green" output per item.
- A mutation run needs a control: run the unmutated code through the same script first and require it to pass. Count a suite that fails to load as a failure, because a runner that reads only failed-test totals reports a broken mutant, or a broken script, as a survivor or a kill that never happened.
- Pitfall: `cp a "$TMPDIR/x" || cp a other/x` followed by reading from `other/x` truncated a target to 0 bytes once. One backup variable, `test -s` before overwriting, write the mutant to a temp file first.
- For data-loss fixes, require each fix to be temporarily reverted to show its test fails; otherwise the test may not lock anything.

## Acceptance by the accepting layer (L2 or L1)

- Scoped status and diff: did the change stay inside the lease? Are there user changes mixed in?
- Did the reviewer run the quality gate itself and paste output? Re-run only if work changed after the review, evidence is stale, or the reviewer skipped something.
- One targeted, executable check of each **conclusive** claim.
- All findings closed, or listed as open.
- New files: `git diff --check` ignores untracked files. Use `git diff --no-index --check /dev/null <file>` and read the output; its exit code is non-zero whenever the file differs from `/dev/null`, with or without warnings.
- Shared logic: a report saying "all exits use the shared check" is not proof. `git grep` the call sites and compare with the list of exits in the brief; anything in the list and missing from the grep is a leak.
- When the reviewer followed a brief that had a gap, the accepting layer fills the gap, again with something executable. Example: to prove a set of new URL-blocking rules hits no public page, compile the rules and run them against every public URL you can list.
- After a rework round, compare the test names against the previous version (`grep -E "^\s*(it|test)\("` on both, then `diff`). Every removed name needs a reason. A worker's scripted edit can delete unrelated tests, and the suite stays green.
- User-facing work is not accepted on type checks and tests alone. Walk the feature once on the real stack: real API, real model output, real device or browser. Model output with an unexpected shape and a rule that blocks a valid request both passed every unit test in one project and surfaced only in a walkthrough.
- A dependency change in a native app needs one real build and launch. A patch bump of a package with a prebuilt native framework crashed at launch with a missing symbol, while the type check, tests and JS bundle all passed. Pin such a package exactly when the version it resolves to is what broke.
- Small rework can be closed by the accepting layer without a new review round only if **all** hold: every change is inside the reviewer's findings; the change is small (wording, a line, a single condition, no new files); each finding can be re-checked executably (grep, diff, a targeted test). The report must say "closed by acceptance re-check", list the findings, the commands and outputs. Anything outside the findings goes back to a full review.

## Command pitfalls that make checks pass silently

| Pitfall | Effect | Do instead |
|---|---|---|
| `grep -c` inside an `&&` chain | A count of 0 exits 1 and skips every later check, which looks like success | Separate checks with `;` and read every printed number |
| Redirecting check output to `/dev/null` and reading only the exit code | You cannot see what matched or how often | Paste real output; add `echo "exit=$?"` if the code matters |
| Reading only the exit code of `git diff --no-index --check` | Non-zero even without whitespace problems | Read the output; no output means clean |
| Flags that silently do nothing on another platform (BSD `grep -P`) | "No matches" that never could have matched | Run a positive control first: a sample that must match |
| Unquoted multi-path variables in zsh used as a pathspec | zsh does not word-split, the pathspec matches nothing, the diff hash is the empty-blob hash `e69de29…` | Write pathspecs literally; treat an empty-blob hash as a broken command first |
| Linting only changed files and calling the rest "pre-existing" | CI lints the whole repo and stays red for weeks | Gate on the same command CI runs |
| `git add <list>` containing a path already moved by `git mv`, followed by `; git commit` | `git add` fails entirely, the commit still runs and records only the staged rename | `git add -- <paths> && git diff --cached --stat -M`, read the stat, then commit separately; list only new paths for renames |
| Writing a large file in one go | A safety filter or tool hiccup truncated the file without an error | `wc -l` / `wc -c` after writing and look at the last lines; write in sections if needed |
| Testing a server/client module boundary with unit tests | Unit tests render directly and never cross the framework's bundling boundary; production 500s | For boundary changes, build for production and request each affected route; add a static guard if possible |

Positive control for the whitespace check:

```bash
printf 'bad  \n' > "$TMPDIR/ws-probe.md"
git diff --no-index --check /dev/null "$TMPDIR/ws-probe.md"; echo "exit=$?"
# expect a "trailing whitespace" warning
```

## Test data and caches

- Only use the development/test database the project designates. Never connect to anything that might be production, whatever the file name suggests.
- Prefix seeded data per task (`zz-<task>-`), deliver seed and cleanup scripts, and paste the "0 rows left" output after cleanup.
- Know your cache lifetimes: requesting a slug before seeding can cache "not found" for days; cleaned-up data can stay visible as long. Avoid stray requests and use the project's cache invalidation path.
- Bump cache keys when a cached shape changes; stale values under a new reading are a classic fail-open.

## Processes

- Stop only what you started: by the PID you recorded (`$!`) or the listener on your own port, after checking it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
- Never kill by name pattern (`pkill -f next`, `pkill node`); one such command once took down the user's dev server.
- Test runners leave orphans. A runner that times out, or an infinite-loop mutant, can leave its server process at 100% CPU for hours under PID 1, and other agents then misread the load as flaky tests or false kills. Before a long test or mutation run and again at each milestone, list processes with parent PID 1 and check each one's working directory (`lsof -a -p <pid> -d cwd`). End only those inside your own scratch folder, by PID; report any others. The server may sit under an orphaned runner instead, so a list of server processes under PID 1 can come back clean while they live on: check the runner's process too. A mutation script should start each suite in its own process group, kill the group on timeout (a plain timeout on a shell kills only the shell), and scan for strays after every run. Briefs for agents that run tests say to end what they start.
- Use your own ports for measurements; leave the user's port alone.
- After a large refactor, a dev server can hold a stale module graph (errors about constants that no longer exist). A restart fixes it; it is not a code bug. Ask the user to restart their server.

## Do not hand inferences to the user as facts

Runtime behaviour inferred from code is "unverified" until observed. After observing, cite the basis: file:line, command and output, a curl result. Inferences have been wrong in both directions: a framework turned out to add a header that the code "obviously" lacked.
