# Entry templates

Angle brackets are fields to fill in. Before writing, look at the last few entries in the target section and match their style.

## Status snapshot: accepted task

```markdown
- **<TASK-ID> snapshot (<YYYY-MM-DD>, <independent reviewer PASS>, <awaiting commit, or committed `<hash>` and <pushed to origin/<branch>, or local only>>, not merged, not deployed; log row in "Completed")**: <one-sentence goal and basis (user decision #N / D-xx)>. <what changed, per exit or module ①②③>. <key observed result, with file:line or command>. Type check exit 0; full tests <N> files (<a> passed, <b> skipped) / <M> tests; <task-specific numbers>.
```

Insert new snapshots at the **top** of the section.

## Status snapshot: in-flight record (session about to end)

```markdown
- **<TASK-ID> in flight (<YYYY-MM-DD HH:MM>, unfinished, written before session end)**:
  - Branch and base: `<branch>` @ `<short-hash>`; files belonging to this task: `<path>`, `<path>` (other changes are not this task's)
  - Edit lease: <main checkout, or absolute worktree path>, held by <task lead name / agent id>
  - Progress: <steps done>; stuck at <step> because <reason>
  - Running: <agent id / name>, or external job `<job-id>` (conversation `<id>`; collect from <worktree> with `wait <job-id>`)
  - Next: <concrete command or file action>
  - Needs the user: <nothing, or open question #N>
```

Once the task is committed, turn this into a normal snapshot or delete it (the log row carries the facts).

## Completed log row

Insert directly below the header separator:

```markdown
| **<TASK-ID> (<one-line scope>; <reviewer verdict>; <awaiting commit, or committed `<hash>` and <pushed, or local only>>, not merged, not deployed)** | <spec reference / decision #> | `<pending-commit>`, or `<hash>` | Changes: <files and points>. Verified: type check <exit>; tests <files>/<tests>; <task numbers, e.g. "17 mutations all red">; <coverage limits: not deployed / no production curl / browser by task lead> |
```

## User decision summary

```markdown
<N>. **<short title>** (<YYYY-MM-DD>): <decision in one or two sentences>. User's words: "<verbatim quote>". Full record: <decision log link / D-xx>.
```

## Open question

```markdown
<N>. **<question>** (<YYYY-MM-DD>, open): background: <one line>. Options: A <…> / B <…> / C <…>. Recommendation: <X> because <…>. Cost of a wrong choice: <…>. Meanwhile: <conservative path taken>.
```

When answered, change it in place instead of deleting it:

```markdown
<N>. (answered <YYYY-MM-DD>) <question>: decided as <…>, recorded as D-xx / user decision #M; no longer open.
```

## Pitfall row

```markdown
| <location / item> | <what it is> | <why it is this way: background and motive> | <guidance: do not "fix" it; do X instead> |
```

## Recovery summary (take-over reply)

```markdown
Recovered context:
- HEAD: `<hash>` on `<branch>`; working tree: <clean, or files and owners>
- In flight: <task ids, state, running agents/jobs>
- Next: <action>
- Awaiting the user: <items or "nothing">
```
