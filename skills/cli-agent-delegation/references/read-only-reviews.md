# Read-only second opinions

The review route in [SKILL.md](../SKILL.md), "Gate: should this be outsourced at all?", allows an authorized external reviewer to read sensitive code without outsourcing its implementation. A review need not be bulk or low-risk code; it needs a bounded question, read-only permissions and evidence the in-house team can check.

## Dispatch

- Use a model from another vendor, not merely another CLI serving the author's model family. Sensitive reviews need an external-strong model at high effort; routine scope can use medium. Verify the available model through its channel, not a dated example.
- Keep the in-house senior review for money, auth, schema and irreversible-data work: high or top tier at high effort, on a model other than the author's. Run both reviews on the same revision or scoped working-tree fingerprint, in parallel when possible, and withhold each review's conclusions from the other until both return.
- Select an enforceable read-only channel ([codex.md](codex.md), [opencode-acp.md](opencode-acp.md), or an admitted team from [acp-agents.md](acp-agents.md)). No edit lease, fixes, installs, services or database mutations. Do not weaken permissions when a check is refused.
- Give the liaison a terminal condition: collect the review and check its scope, or escalate with job state and ids. Dispatch alone is not delivery ([liaison-and-hosts.md](liaison-and-hosts.md)).

## Brief

```markdown
Goal: <behaviour and invariants this review must assess>
Repository and revision: <workspace, commit or scoped working-tree fingerprint>
Read scope: <paths, dependencies needed to understand them, requirements>
Read-only: do not modify, revert, stage, stash or clean anything.
Checks: <permitted commands, expected results, where each can run>
Focus: <relevant failure paths; omit irrelevant ones>
Return each finding with location, trigger, evidence and impact.
Distinguish reproduced failures, source-backed defects and unverified suspicions.
Report checks not run and why; if none found, list scope and limitations.
```

For risky code, useful focus questions include lost results after charging, duplicate charges on retries, cross-user access, constraints that need a table rebuild, and reads outside a transaction that decide writes inside one. Choose from the actual change. For generated tests, ask whether expected values follow requirements and whether the tests would detect the claimed defect.

## Close findings in-house

1. The liaison collects the report and runs mechanical checks; it does not decide whether the code is correct. Required commands blocked externally run where authorized in-house, or remain explicitly pending.
2. The fixer reproduces each actionable failure or verifies decisive source evidence before editing. Record confirmed, rebutted or unresolved with evidence. An unresolved suspicion is not a confirmed defect; a reviewer vote is not evidence either.
3. Fix confirmed defects through the in-house implementation flow, then re-review changed paths and affected invariants. Budget two review-and-fix rounds for risky work regardless of implementer tier; stop earlier when confirmed blockers are closed and gates pass. An unresolved finding with material correctness impact blocks acceptance: escalate to an in-house expert rather than looping on the same failed fix. This allowance does not change the two-failed-round limit for outsourced editing jobs.
4. In-house acceptance reconciles findings and verification gaps. If the authorized roster cannot provide another-vendor review, the fallback is one independent in-house senior review with the missing external opinion recorded; stricter project review gates still apply. Do not silently expand authorization.

The measured basis and its limits: [field-data.md](field-data.md). Channels and fallbacks remain in [SKILL.md](../SKILL.md).
