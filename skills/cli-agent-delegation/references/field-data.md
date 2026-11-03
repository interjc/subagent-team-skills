# Field data

Measured outsourcing runs from real projects (2026-10 to 2026-11), plus explicitly labelled wrapper verification runs. Model names were current at the time. The operating rules are in [SKILL.md](../SKILL.md).

## Four-week audit (2026-11)

The repository report *Field report: four weeks of delegation in one project (2026-10 to 2026-11)* covers 60 external jobs in 74 runs, plus 16 earlier agy jobs whose acceptance was not recorded. It is one project's observational sample, not a randomized model comparison: risk drove assignments, some outcomes were inferred, and a worker reporting done is not verified acceptance.

- **Review value:** seven Codex CLI `gpt-6.1-sol` · high reviews of billing and auth all found useful, confirmed defects. This supports another-vendor read-only review alongside in-house senior review, not external implementation of sensitive logic. See [read-only-reviews.md](read-only-reviews.md).
- **Effort:** above-high implementation runs still needed review fixes; small specified edits at medium were fast. Use medium/high for implementation and route unresolved design questions in-house; these unlike tasks do not prove a causal speed or quality difference.
- **Liaison completion:** 49 low-tier liaisons included 42 clean deliveries and two failures that returned immediately after dispatch. Require a collected result and mechanical checks, or an explicit escalation, before final delivery ([liaison-and-hosts.md](liaison-and-hosts.md)).
- **Verification:** sandbox refusals moved acceptance execution to the in-house layer. One generated test file passed commands without independent content review. Plan both authorized in-house execution and semantic review of cases and expected values.
- **Failure classification:** effort resets, sandbox refusal and resume timeouts were environment failures. Preserve state and report the missing evidence; do not infer model incapability or loosen permissions.

Historical job outcomes do not replace a channel's admission checks. Current OpenCode wrapper verification remains the separately scoped evidence below; other teams' support levels are stated in [SKILL.md](../SKILL.md).

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
| Mid-tier model · medium (`workspace-write`) | Small pure scoring module with a frozen signature and a spec | 1 round / ~27k | Passed in one round; both acceptance commands passed when the liaison ran them |

Lessons:

- Strong at self-contained work that needs reading a lot of code (doc syncs, independent review). As another vendor's model, it is not anchored to the director's reasoning.
- The two jobs touched disjoint files, ran at the same time in one workspace, and both passed first time.
- The director still verified every checkable fact before committing.
- Pass the effort explicitly: one session found the global config set to `high`, while the model's own default was `low`.

## OpenCode through ACP (verification runs, not project work)

Small jobs on a scratch repository with OpenCode 2.2.5 (2026-11), a free gateway model at `low` effort, to check the wrapper rather than the model.

| Mode | Job | Tokens | Outcome |
|---|---|---|---|
| read-only | read a file, create a file, `touch`, `git status --short`, read `.env` | ~6.7k total | Read and `git status` worked; no edit tool was offered; `touch` and the `.env` read were denied; the model reported each denial and carried on |
| `--write`, resumed session | create a file, `touch`, write outside the repo, recall the earlier turn | — | The earlier turn was remembered, but the model assumed from that history it still could not edit and did not try. Tell it explicitly when a resumed session gains edit rights. |
| `--write`, new session | the same steps | — | The file was created; `touch` denied; the write outside the repository refused as an external directory |
| raw `opencode run --standalone` with the agent injected by hand | `touch`, read a file | — | Same enforcement. Without `--standalone`: "Agent not found", because the shared background service ignores injected config. |

## When outsourcing did not pay

- Tiny edits: the brief took longer to write than the edit.
- Lists that kept changing during the job: the later additions needed a second job anyway.
- Work that turned out to need a product decision. A good brief makes the agent stop and report, which costs a round trip. Keep such work in-house from the start.
