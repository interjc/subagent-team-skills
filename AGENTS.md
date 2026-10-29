# Agent Guidelines for `subagent-team-skills`

Rules for AI agents and human contributors working on this repository.

## 1. Layout

```text
skills/<skill-name>/
├── SKILL.md          # required: YAML frontmatter (name, description, license, metadata.version) + body
├── references/       # optional: detail loaded on demand; link every file from SKILL.md
└── scripts/          # optional: dependency-free Node.js helpers (minimum 18, recommended 24)
agents/               # Claude Code subagent definitions shipped with the plugin
tests/                # node:test suites, offline only (fake binaries, fixtures)
scripts/              # repository tooling (check-skills.mjs)
.claude-plugin/       # Claude Code plugin + marketplace manifests
.codex-plugin/, .agents/plugins/   # Codex plugin + marketplace manifests
```

- `subagent-team` is the core skill. Other skills cover corner cases (outsourcing to CLI agents, handover) and must stand alone: no imports or relative links across skill directories, because `npx skills` can install one skill by itself. Refer to another skill by name.
- Each skill's `name` equals its directory name. The `description` is the trigger: say what the skill does **and** when to use it, a little pushy, at most 1024 characters, no angle brackets.
- Keep `SKILL.md` under 500 lines. Move detail into `references/` and link it.

## 2. Language

- Skill content (`SKILL.md`, `references/`, agent definitions, script output) is **English**.
- Human-facing docs are **bilingual**: `README.md` / `README_ZH.md`, each with the language switcher at the top. Write or refine the Chinese version first, confirm it, then sync the English. A change to one must land with its counterpart.

## 3. Tool neutrality

- Skill bodies use abstract roles and tiers (director / manager / staff; top / high / mid / low / external-fast / external-strong). Concrete model names appear only as dated examples ("as of 2026-10").
- Harness-specific mechanics go into `references/harness-*.md`. Mark anything not personally verified as *unverified*.
- Claude Code is the primary target, Codex secondary. Do not claim support for other agents beyond "installs via the Agent Skills format".

## 4. Privacy (this repository is public)

- Never commit: personal or absolute home paths, email addresses, internal hostnames or domains, private project or product names, task codes, commit hashes from private repositories, user quotes, credentials.
- Turn real-world cases into neutral examples ("a Next.js SaaS project", "a payment module").
- `npm run check` scans for paths, emails and token-like strings. Put private terms in an untracked `.privacy-denylist` (one per line) so the scan catches them without publishing them.

## 5. Scripts and tests

- Scripts: `#!/usr/bin/env node`, ESM, only `node:` built-ins, `--help`, a JSON result on stdout and hints on stderr, documented exit codes. Export pure functions and guard `main()` so tests can import them.
- Node.js has two constraints:
  - **Hard minimum (18)**: the lowest version on which every script and test actually passes. Every script starts with a `MIN_NODE_MAJOR` guard. Only raise it after measuring on the old version, and update every script, `package.json` `engines`, each scripted skill's `compatibility` field and the CI matrix together.
  - **Recommended (24)**: pinned in `.nvmrc` and in `RECOMMENDED_NODE_MAJOR` in `env-check.cjs` and `doctor.mjs`.
  - `npm run check` enforces that all of these agree.
- `skills/subagent-team/scripts/env-check.cjs` stays conservative CommonJS (no ESM, no optional chaining, no newer syntax), so it can still report "Node too old" on an old Node.
- Tests run offline with fake `codex` / `agy` binaries (`CODEX_BIN`, `AGY_BIN`) and temporary `HOME` directories. Never call real model APIs in the default suite.
- Before committing: `npm test` and `npm run check` must pass.

## 6. Versioning and release

- One version for everything: `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and every skill's `metadata.version`. `npm run check` enforces this.
- Bump the version for any user-visible change. Claude Code and Codex cache plugins per version.
- The reviewer agent bodies in `agents/` must equal the block in `skills/subagent-team/references/reviewer-prompt.md`. Edit the reference, then run `npm run sync:agents`.

## 7. Installation commands to recommend

```bash
npx skills add interjc/subagent-team-skills
claude plugin marketplace add interjc/subagent-team-skills && claude plugin install subagent-team@subagent-team-skills
codex plugin marketplace add https://github.com/interjc/subagent-team-skills && codex plugin add subagent-team@subagent-team-skills
```
