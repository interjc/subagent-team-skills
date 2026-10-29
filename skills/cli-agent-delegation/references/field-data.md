# Field data

Measured outsourcing runs from real projects (2026-10). Model names were current at the time.

## agy (fast tier, `gemini-3.8-flash-high`)

| Task | Time | Outcome |
|---|---|---|
| Two languages, ~55 keys, plus one HTTP test file | ~9 min | Usable, all placeholders preserved. Large context cost (~6M cached tokens). Keys added after dispatch were missed. |
| Frozen key list + file lease + runnable acceptance command; two languages × 17 keys | ~5 min | Passed first time, stayed inside the lease |
| Same pattern; two languages × 23 keys, brief included base-language text, insertion points and a line-aligned acceptance command | ~7 min | Passed first time, `\n` escapes preserved; ~1.4M cached tokens |
| Two languages × 53 keys with placeholders and long example prompts | ~9 min | Passed first time, zero placeholder differences; ~4.4M cached tokens. Context cost grows with batch size but stays far below translating in-house. |
| Three translation batches during one five-phase feature (over a hundred keys) | — | All accepted after director review |

Lessons:

- About five minutes of fixed overhead per job, so batch work pays and single edits do not.
- **Freeze the list before dispatch**; agy does not pick up later additions.
- A file lease plus a runnable acceptance command clearly raised the first-pass rate.
- Translations work well as a split: an in-house mid-tier worker writes the two base languages (that needs product context), agy fills in the others.

## Codex CLI

| Model · effort | Task | Time / tokens | Outcome |
|---|---|---|---|
| `gpt-6-luna` · high | Rebuild a docs index covering dozens of documents | ~1.7 min / 82k | Passed first time, inside the lease, no dead links; also flagged documents that looked stale |
| `gpt-6.1-sol` · high | Rewrite the root README from current code (several hundred lines changed) | ~4.8 min / 88k | Versions, scripts, paths, dozens of environment variables and webhook events all correct; one duplicated heading for the director to fix |

Lessons:

- Strong at self-contained work that needs reading a lot of code (doc syncs, independent review). As another vendor's model, it is not anchored to the director's reasoning.
- The two jobs touched disjoint files, ran at the same time in one workspace, and both passed first time.
- The director still verified every checkable fact before committing.
- Pass the effort explicitly: one session found the global config set to `high`, while the model's own default was `low`.

## When outsourcing did not pay

- Tiny edits: the brief took longer to write than the edit.
- Lists that kept changing during the job: the later additions needed a second job anyway.
- Work that turned out to need a product decision. A good brief makes the agent stop and report, which costs a round trip. Keep such work in-house from the start.
