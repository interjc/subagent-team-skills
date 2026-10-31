# Verification, review and acceptance

Asking a model to "read the code and think about what could go wrong" is slow, expensive, unrepeatable and cannot run in CI. Turn verification into things that run.

## Who does what

| Role | Verification job |
|---|---|
| Implementer | Writes unit tests and a runnable verification list; it knows best what changed and where the edges are |
| Reviewer | Audits those tests first, executes them, then hunts for risks outside them |
| L2 (where the flow has it) and L1 director | Accept: scope check, targeted re-runs, factual checks, fills gaps the brief missed; L1 always runs the integration gate |
| Liaison (external jobs) | Runs the acceptance commands and mechanical checks on the job's output; escalates instead of judging |
| Browser | Last layer, a few targeted checks, never open-ended exploration |

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
- Use your own ports for measurements; leave the user's port alone.
- After a large refactor, a dev server can hold a stale module graph (errors about constants that no longer exist). A restart fixes it; it is not a code bug. Ask the user to restart their server.

## Do not hand inferences to the user as facts

Runtime behaviour inferred from code is "unverified" until observed. After observing, cite the basis: file:line, command and output, a curl result. Inferences have been wrong in both directions: a framework turned out to add a header that the code "obviously" lacked.
