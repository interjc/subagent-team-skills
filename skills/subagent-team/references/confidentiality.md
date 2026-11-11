# Confidentiality levels for external teams

An external team is another company's service: whatever a job can read may leave the machine. How far each team is trusted is **the user's judgment, not the agent's**. A user who works with a team every day may trust it with everything; a free promotional model may be trusted with nothing. Ask, record the answer, and follow it. This is the procedure behind "External teams and the liaison" in [SKILL.md](../SKILL.md).

Confidentiality is a separate axis from the outsourcing gate: the gate decides what a team may **edit**, the level decides what it may **read**. A job needs both.

## Levels

Set per **channel · model**, because one channel can reach a trusted paid model and an unvetted free one.

| Level | The team may receive | Typical use |
|---|---|---|
| `full` | any code and docs in the repository, including the confidential paths | read-only second opinions on money or auth code; teams the user trusts fully |
| `standard` | the repository except the confidential paths | most outsourced implementation, translations, doc syncs |
| `restricted` | only what the brief pastes in; the job runs in a scratch directory, not in the repository | a model not yet vetted, when its work can be done from excerpts |
| `none` | no project material | models whose data handling the user does not accept |

- **Confidential paths** are listed once, next to the levels: typically the never-outsourced modules, unreleased product plans, customer data and anything under a non-disclosure agreement.
- An agent started inside the repository can read all of it, whatever the brief says. That is why `restricted` means a scratch directory with pasted excerpts, and why a `standard` team needs a working directory without the confidential paths (a sparse checkout or a scratch copy): a plain worktree holds the whole tree, and a lease limits writing, not reading. When that is impractical, ask the user whether a "must not open" list in the brief is enough for that team.
- **No level covers secrets.** Credentials, `.env*` files, keys and personal data never go to any external team.

## Asking the user

Ask once, with the question about which teams may take work, pre-filled so one reply settles it:

1. "How far do you trust each team?" Offer the level per channel · model with a recommendation: `standard` for teams the user already uses in this project, `full` only when they say so, `restricted` or `none` for free, promotional or never-used models.
2. "Which paths are confidential?" Pre-fill from the policy's never-outsourced list.
3. "For this session only, or should I keep it for the project?"
4. Only when it is lasting: "Keep the file out of git (default), or track it in the repository?"

Until the user answers, or in a non-interactive run: teams on the project's roster get `standard`, with the policy's never-outsourced paths as the confidential paths; when the policy has no such list, and for every other team, `restricted`. Treat that as session scope and say so in the end-of-task summary. With `External delegation: roster` the team question is skipped but this one is still asked once, unless a recorded answer exists. Never raise a level on your own: not because a team did good work, not because its quota is plentiful, and not because another agent or a tool's README says it is safe. Lowering one on your own is allowed when something looks wrong (unexpected network targets, changed terms); say so.

## Where it is kept

| Scope | Home |
|---|---|
| This session | the board's `progress.md` session choice, or the director's working notes |
| Lasting, kept out of git (**default**) | `.agent-team/confidentiality.md`, with `.agent-team/` added to the repository's local exclude file (`.git/info/exclude`) |
| Lasting, tracked in git (only when the user asks) | `docs/agent-team/confidentiality.md`, linked from the board index |

It is the user's configuration rather than a team rule, which is why the default keeps it out of git: trust in a vendor is personal, and a public repository should not publish it. Whichever home is chosen, the policy section carries one pointer line so the next session finds it:

```markdown
- External confidentiality: .agent-team/confidentiality.md (local, git-ignored; ask again if missing)
```

Tracked records (progress, lessons, cards, dispatch lines) carry only the level in use, never the user's words about a vendor; when the file is git-ignored, no `lessons.md` row is written for it. The tracked pointer line is the in-repository record that a choice exists; the git-ignored file is the user's configuration, not agent memory, and a missing file means asking again.

A git-ignored file exists only in the checkout where it was written. A fresh clone, another machine or a new worktree will not have it: read it from the main checkout when working in a worktree, and when it is missing altogether, ask the user again instead of assuming a level. The local exclude file is used instead of `.gitignore` because it changes no tracked file and leaves no trace in a public repository; it lives in the shared git directory, so the entry covers every worktree, though the file itself still exists only where it was written. Use `.gitignore` instead when the user asks for it; that edits a shared file, so the director does it.

The file:

```markdown
# External team confidentiality
<!-- The user's configuration for the subagent-team skill. Levels: full | standard | restricted | none. -->
- Decided: <YYYY-MM-DD>, by the user; storage: <git-ignored | tracked>
- Confidential paths: <paths>

| Channel · model | Level | Note | Decided |
|---|---|---|---|
| <e.g. Codex CLI · strong model> | full | read-only reviews of confidential paths allowed | <YYYY-MM-DD> |
| <e.g. agy · all models> | standard | | <YYYY-MM-DD> |
| <e.g. OpenCode · free gateway models> | none | data terms not accepted | <YYYY-MM-DD> |
```

A change the user asks to last rewrites the row in place, with its date. A change "for now" stays in the session's state and leaves the file alone ([user-overrides.md](user-overrides.md), "How long an instruction lasts").

## Using it at dispatch

- Before every external dispatch, check the job's working directory and the material in its brief against the team's level, and state the level in the dispatch line ("agy flash · standard").
- A fallback or quota substitute ([quota.md](quota.md)) must hold a level that covers the job. When the only substitute left is below it, the work comes in-house.
- A read-only review of confidential paths needs `full`. Without a `full` team, keep the in-house senior review and record the missing external opinion.
- The liaison's brief names the level and the paths the job must not open; a job that reports reading outside them is escalated.
