# Field report: four weeks of delegation in one project (2026-10 to 2026-11)

This report reviews every delegation in one real project run with the `subagent-team` and `cli-agent-delegation` skills: each in-house subagent and each external CLI job. It compares how fast and how well each external team, model and effort level did. Model names are dated examples, valid as of 2026-11.

## 1. The project and the data

- **Project**: a monorepo with two Expo mobile apps, a web front end and about eight Cloudflare Workers services. The four weeks covered an SDK upgrade, an internal-auth consolidation, a prepaid credit system with holds and settlement, an AI gateway in front of several model providers, anti-abuse limits and a mobile UI redesign. Billing, auth and migrations stayed in-house by project policy.
- **Host**: Claude Code. The director (L1) was Claude Opus 5.5 at high effort.
- **Sources**: 7 main-session transcripts and their subagent transcripts, from 2026-10-08 to 2026-11-03. Plus the job records of the agy-staff plugin, which also cover 16 earlier agy jobs from 2026-10-03 and 2026-10-04 with no transcript.
- **Volume**:
  - 194 in-house subagents.
  - 60 external jobs in 74 runs: 41 on OpenCode, 12 on Codex CLI, 7 on agy.
  - Plus those 16 earlier agy jobs.
  - The director sent 108 follow-up messages to subagents.

### Method

- **Time**: wall clock from a subagent's first to last transcript entry. External runs: dispatch to result, or to the completion notification for background runs.
- **Tokens**: summed per message after removing duplicates. A transcript can write one message on several lines, each repeating the usage, so counting lines inflates tokens about tenfold.
- **Quality labels**: two Claude Sonnet 5.5 subagents at high effort labelled every subagent and every job. They read final reports, briefs, follow-up chains and later reviews of the same unit. Labels they inferred rather than read are counted, but the totals below say where inference dominates.
- **Caveats**:
  - No randomized comparison: tiers were assigned by risk, so harder work went to stronger models.
  - Rework says as much about the task as about the model.
  - Effort was unset (harness default) for 15 early subagents.

## 2. Headline findings

1. **External reviews were the best value of all external work.** Codex `gpt-6.1-sol` at high effort ran 7 read-only reviews of money and auth code. All 7 were rated "high": they found real P1 defects that fed fix rounds, for example a charge for an answer never returned, a double charge and a cross-user read through an internal bearer token. The fixers reproduced each claim before fixing it. The same model through OpenCode did 5 reviews: 3 high, 1 some, 1 unknown.
2. **In-house senior review caught what implementers missed, at almost no false-positive cost.** 21 of 72 in-house reviews returned blocking findings, and implementers confirmed nearly all of them. Only one finding was rebutted with evidence. The best catches were schema constraints that SQLite cannot add later without a table rebuild, missing usage rows on a billing path, and a deploy script that could reach production.
3. **Rework follows task risk, not model tier.** Implementers needed rework after review in 67% of known cases for both Opus 5.5 (20/30) and Sonnet 5.5 (12/18). Opus took the money, auth and schema units; Sonnet the specified ones. The most reworked unit, a ledger store, needed three rounds and about 12 hours of wall time.
4. **Low-tier liaisons are reliable relays.** Haiku 5.5 at low effort ran 49 liaisons: 42 clean, 3 with gaps, 2 stopped correctly and asked, 2 failed. Both failures returned right after dispatch without waiting for the job. Median cost was 3.5k output tokens.
5. **OpenCode with Claude models implemented well, but the in-house layer did the verifying.** 31 implementation jobs: 23 accepted first pass, 5 after rework, 1 partially used, 1 failed at startup. At least 12 jobs reported that the external agent's shell was refused, so the liaison ran every acceptance command. The external agent produced the diff; the in-house layer verified it.
6. **xhigh effort bought little.** Opus 5.5 xhigh through OpenCode took a median 19 minutes and $3.67–$11.47 per work package. Every package that started was accepted, yet the senior review still found should-fix items in each one it covered. Sonnet 5.5 at medium did small specified edits in a median of about 1 minute for $0.16–$1.38.
7. **External failures were environmental, not model errors.** No external job edited outside its lease. The failures, all taken up by the next rung:
   - A runner that reset the requested effort to default (twice).
   - A sandbox that refused a scratch fixture.
   - Two Codex resumes that hit their timeout (exit 124).

## 3. In-house subagents

Outcomes: D delivered, G delivered with gaps or a needed follow-up, F failed. "Rework" counts implementers whose work a later review sent back. "Blockers" is blocking findings over reviews.

| Role | Model | Effort | n | D / G / F | Median min | Median output tokens | Rework | Blockers |
|---|---|---|---|---|---|---|---|---|
| Liaison | Haiku 5.5 | low | 49 | 42 / 3 / 2 (+2 escalated) | 7 | 3.5k | | |
| Implementer | Opus 5.5 | high | 31 | 24 / 7 / 0 | 36 | 127k | 20/30 | |
| Implementer | Sonnet 5.5 | medium | 13 | 12 / 1 / 0 | 8 | 18k | 7/11 | |
| Implementer | Sonnet 5.5 | high | 4 | 3 / 1 / 0 | 5 | 36k | 3/4 | |
| Reviewer | Fable 5.1 | high | 47 | 43 / 3 / 1 | 8 | 35k | | 17 / 47 |
| Reviewer | Opus 5.5 | medium | 5 | 5 / 0 / 0 | 6 | 34k | | 6 / 5 |
| Reviewer | Opus 5.5 | high, xhigh, unset | 5 | 5 / 0 / 0 | 22–55 | 24–157k | | 7 / 5 |
| Reviewer | Sonnet 5.5 | high | 11 | 11 / 0 / 0 | 3 | 19k | | 7 / 11 |
| Reviewer | Sonnet 5.5 | medium | 3 | 3 / 0 / 0 | 2 | 9k | | 0 / 3 |
| Researcher | Sonnet 5.5 | high | 11 | 11 / 0 / 0 | 2 | 19k | | |
| Designer | Opus 5.5 | high | 4 | 3 / 1 / 0 | 21 | 127k | | |
| Expert | Fable 5.1 | high | 1 | 1 / 0 / 0 | 7 | 30k | | |

Totals and notes:

- **Tokens**: 9.6M output tokens and 750M cache tokens, 90% of them cache reads. Opus 5.5 used 64% of all output tokens, mostly as implementer.
- **Reviewer verdicts by model**:
  - Fable: 9 of 47 reviews found blockers, 23 approved with changes, 14 approved.
  - Opus: 7 of 10 found blockers.
  - Sonnet: 5 of 15 found blockers.
  - These rates are not a quality ranking. Fable reviewed Opus-written money and auth code. Opus and Sonnet reviewed mostly Sonnet-written and early work.
- **Cost outliers**: one designer ran 314 minutes with 1,170 tool calls and 10 follow-ups, because the design kept growing in scope. The ledger-store implementer ran 12 hours over three review rounds.
- **Stops**: the director stopped 4 subagents, two reviews and two implementers. One stopped review had left only a stub report.

## 4. External jobs

Outcomes: AF accepted first pass, AR accepted after rework. Minutes are the median per job. Costs are what the CLI reported, where it did.

| Team | Model | Effort | Kind | Jobs | AF / AR / other | Median min | Notes |
|---|---|---|---|---|---|---|---|
| Codex CLI | gpt-6.1-sol | high | review | 7 | 7 / 0 / 0 | 8 | All rated high value; ~166k tokens per run; 2 resumes hit the timeout and were retried |
| Codex CLI | gpt-6.1-sol | high | implement | 1 | 0 / 1 / 0 | 8 | |
| Codex CLI | gpt-6.1-sol | medium | review | 1 | 1 / 0 / 0 | 2 | |
| Codex CLI | gpt-6.1-terra | high | review | 2 | 2 / 0 / 0 | 1 | Short checks |
| Codex CLI | gpt-6.1-terra | medium | implement | 1 | 0 / 1 / 0 | 7 | |
| OpenCode | claude-sonnet-5-5 | medium | implement | 11 | 8 / 1 / 2 unknown | 1 | Small specified edits, $0.16–$1.38 |
| OpenCode | claude-sonnet-5-5 | high | implement | 7 | 4 / 3 / 0 | 5 | $0.49–$4.98 |
| OpenCode | claude-sonnet-5-5 | high | review | 2 | 1 / 0 / 1 unknown | 6 | Found only low and medium issues |
| OpenCode | claude-sonnet-5-5 | xhigh | implement | 2 | 1 / 0 / 1 partial | 12 | $2.81; the partial job lost a fixture to the sandbox |
| OpenCode | claude-opus-5-5 | high | implement | 4 | 3 / 1 / 0 | 8 | $0.05–$3.25 |
| OpenCode | claude-opus-5-5 | xhigh | implement | 7 | 6 / 0 / 1 failed | 19 | $3.67–$11.47; the failure was a runner refusal at startup |
| OpenCode | gpt-6.1-sol | high | review | 5 | 5 / 0 / 0 | 5 | 3 high value, 1 some, 1 unknown |
| agy | gemini-3.8-flash | medium | implement | 3 | 2 / 1 / 0 | 7 | SDK upgrade and docs; an in-house review flagged one fix, which agy redid |
| agy | gemini-4-argon | medium | implement | 2 | 1 / 1 / 0 | 6 | A large table-test file passed its checks but was never reviewed in-house |
| agy | gemini-4-argon | high | implement | 1 | 1 / 0 / 0 | 10 | A UI layout change from a written spec, accepted without rework |

Also:

- **Probes**: 4 capability probes (grok-4.7, gpt-6.1-sol low, a model loop, gemini flash low) cost seconds each and are left out of the outcome counts.
- **Earlier agy jobs**: the 16 jobs from 2026-10-03 and 10-04, plus the 3 above, all ran on gemini-3.8-flash (high, medium or low). 6 of the 19 were continuations of an earlier job. Their run times were 0.6 to 45 minutes, median about 4. Every job reported done, every one with warnings. Acceptance of the 16 earlier jobs was not recorded.

Totals: 42 accepted first pass, 9 after rework, 1 partially used, 1 failed, 3 unknown, 4 probes. No external result had to be thrown away and redone in-house.

## 5. What worked and what did not

**Worked**

- **A frozen spec plus objective acceptance plus a liaison.** Every external implementation job that started from a written spec with runnable acceptance commands was accepted. The UI change above went from spec to accepted diff in 12 minutes.
- **Another vendor reviewing money and auth code read-only.** It found defects the in-house reviews had not yet found. The reviewer's claims were treated as data: the fixer reproduced each before changing code.
- **Haiku at low effort for liaisons, Sonnet at medium or high for specified edits and research, Opus at high for risky implementation, the top tier for senior review.** The tier split held up.

**Did not**

- **Liaisons that returned before the job finished.** Two liaisons came back with nothing to report. The fix is in the liaison brief: wait for the job with a bounded wait, and never report while it runs.
- **Runner settings that silently changed.** An OpenCode effort selection fell back to default twice. The wrapper now retries the selection once and reports when it still fails.
- **Sandboxed external agents that could not run acceptance.** The cost moved to the liaison. Plan for it: say in the brief where acceptance runs, and do not count an external "tests pass" as evidence.
- **Effort above high on implementation.** It roughly tripled time and cost without removing review findings.
- **Unreviewed external output.** One large generated test file passed its checks but no in-house review read it. Acceptance commands prove it runs, not that it tests the right thing.

## 6. Recommendations

1. **Send read-only reviews of risky code to another vendor's strong model at high effort**, in addition to the in-house senior review. In this project that was the best quality per minute of all external work.
2. **Keep implementation effort at medium or high.** Use xhigh only when a design question remains, and then it belongs to an L2 expert, not an external implementer.
3. **Give small, fully specified edits to a mid-tier external model at medium effort.** Most took about a minute and a few cents to a dollar.
4. **Budget rework by risk.** Money, auth and schema units needed review rounds whatever the model. Plan two rounds for them and do not read rework as a model failure.
5. **Use a low-tier liaison for every external job**, with a brief that requires a bounded wait for the result and a check against the lease.
6. **Review external output that only passed its own acceptance**, especially generated tests: running is not the same as testing the right thing.
