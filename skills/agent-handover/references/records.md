# Keeping the records

How to write the files in the file map of [SKILL.md](../SKILL.md): what goes in each progress-record section, wording, the commit-hash placeholder, and decision records. Copy-ready entries: [entry-templates.md](entry-templates.md).

## Progress record sections

| Section | Write | When |
|---|---|---|
| Status snapshot | One entry per recently committed or in-flight task: id, date, state, commit (or placeholder), gate numbers, push and deploy state; in-flight records when a session may end | On acceptance or commit; before a likely interruption |
| Completed log | New row **at the top**: task id / spec reference / commit / key acceptance numbers | After each smallest deliverable is accepted |
| Next-up queue | Remove what's done; queue new work in the director's order; keep engineering work and owner-only operations separate | On completion or reprioritization |
| User decisions | Numbered summary pointing to the decision log | **Immediately** when the user decides |
| Open questions | Questions awaiting the user, mirrored in the index | When discovered; update status when answered (never delete) |
| Pitfalls | Location, what it is, why it is this way, "do not fix this" guidance | When a compromise, deviation or trap is found |
| Handover protocol | Where each kind of update goes | Only when the process changes |

Documentation sync is part of "done". A unit whose progress record and affected docs are not updated is not delivered. The sync can go in the same commit or a follow-up docs commit, but it must land before the next task starts.

## Wording conventions

- Use absolute dates (`2026-10-01`), never "today" or "this round".
- Keep separate facts separate, each backed by evidence: **committed** (hash), **pushed** (to which branch), **merged**, **built**, **verified on device**, **released**, **deployed**. Example: "committed `abc1234` and pushed to `origin/dev`; not merged; not deployed". Only change merge or deploy state when whoever does it says so; never infer it.
- Status words: planned / in progress / passed / failed / blocked / unverified. Never mark planned work as done.
- **Do not hard-code counts that change** ("17 decisions", "D-01 to D-17", "the following three"). Point at the list, or count on the spot (`grep -c '^### D-' docs/decisions.md`). Historical facts in logs ("checked 128 links") stay as written.
- Cite sections by their actual heading text and code by file:line. Mark runtime behaviour you have not observed as "unverified".

## The commit-hash placeholder

A commit hash is unknown until the commit exists, so the task writes `<pending-commit>` and the **next task that edits docs fills it in**. Never amend to backfill.

1. After acceptance, before commit: write `<pending-commit>` in the snapshot and the log row, and status "awaiting commit".
2. The director commits.
3. The next docs-editing task finds the real hash (`git log --oneline -10`), replaces every placeholder, rewrites stale wording ("not yet committed", "awaiting commit") into the status conventions above, and checks pushed state with `git merge-base --is-ancestor <hash> origin/<branch> && echo pushed || echo local-only`. Its own placeholder stays for the task after it.
4. Self-check, so that only the current task's placeholder remains:

   ```bash
   grep -rn --include='*.md' -e '<pending-commit>' -e 'not yet committed' -e 'awaiting commit' docs; echo "exit=$?"
   ```

Lesson: backfill with a grep over all docs, not just the log table. A placeholder once survived in three other sections for a whole task.

## Decision records

- **Never rewrite**: the decision, motivation, evidence at the time, rejected options, overturn conditions. When overturned, add an "overturned" note with the reason under the heading and keep the original.
- **Must update with implementation**: status fields such as "implementation plan" or "status (date)". Mark them "landed" with the commit. Otherwise the decision log contradicts the completed log, and someone redoes shipped work.
- New decision: append it to the log, add a row to the index, and add a summary line to the progress record.
- The user's words that set a rule are quoted verbatim with the date. Later agents can then check the authority behind a rule.
