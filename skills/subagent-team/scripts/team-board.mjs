#!/usr/bin/env node
// team-board.mjs - the project's durable team board under docs/agent-team/.
//
//   team-board.mjs init   [--root <dir>] [--dir <rel>] [--dry-run]
//   team-board.mjs new    --id <ID> --title <text> [--flow <preset|text>] [--holder <name>]
//                         [--parent <ID>] [--escalate-to <who>] [--no-index] [--root] [--dir] [--dry-run]
//   team-board.mjs status [--root <dir>] [--dir <rel>]
//
// The board is plain Markdown in the repository, so every agent and tool can
// read it: in-house subagents, external CLI agents, a later session, another
// harness. init writes the skeleton (never overwrites), new adds one task card
// and its index row, status summarises cards and open escalations and reports
// drift between the index, the cards and AGENTS.md. Dependency-free.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Hard minimum shared by every script in these skills. Recommended: 24.
export const MIN_NODE_MAJOR = 18;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`team-board.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or create the files by hand from references/team-board.md.');
  process.exit(1);
}

export const DEFAULT_DIR = 'docs/agent-team';
export const STATUSES = ['planned', 'in-progress', 'waiting-external', 'escalated', 'in-review', 'accepted', 'committed', 'cancelled'];
export const FLOWS = {
  solo: 'L1',
  direct: 'L1 → L3 → L1',
  outsource: 'L1 → L3 liaison → L4 → L3 review → L1',
  designed: 'L1 → L2 → L3 → L2 accept → L1',
  'designed+outsource': 'L1 → L2 → L3 + (L3 liaison → L4) → L2 accept → L1',
  consult: 'L1 → L2 expert → L1',
};
const ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,40}$/;

export const USAGE = `team-board.mjs - durable team board (task cards, flows, escalations) under ${DEFAULT_DIR}/.

Usage:
  team-board.mjs init   [--root <dir>] [--dir <rel>] [--dry-run]
  team-board.mjs new    --id <ID> --title <text> [--flow <preset|text>] [--holder <name>]
                        [--parent <ID>] [--escalate-to <who>] [--no-index] [--root <dir>] [--dir <rel>] [--dry-run]
  team-board.mjs status [--root <dir>] [--dir <rel>]

Options:
  --root <dir>         Project root (default: current directory).
  --dir <rel>          Board directory relative to the root (default: ${DEFAULT_DIR}).
  --id <ID>            Task id, e.g. T3 or T3.a (letters, digits, . _ -).
  --title <text>       One-line task title.
  --flow <preset>      ${Object.keys(FLOWS).join(' | ')}, or free text (default: direct).
  --holder <name>      The card's only writer (default: director).
  --parent <ID>        Parent task for a sub-task or external job.
  --escalate-to <who>  Where questions go first (default: L2 if the flow has L2, else L1).
  --no-index           Do not add a row to the board index.
  --dry-run            Print what would be written; write nothing.

init never overwrites existing files. It does not edit AGENTS.md: add the
"Team board:" line to the "## Subagent team" section yourself.

Output: one JSON object on stdout; hints on stderr.
Exit codes: 0 ok (warnings allowed); 1 usage error; 2 board not found; 3 card already exists;
4 file system error (for example the board path is a file).
`;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') return { help: true };
  if (!['init', 'new', 'status'].includes(command)) throw new UsageError(`unknown command: ${command}`);
  const opts = { command, root: process.cwd(), dir: DEFAULT_DIR, index: true, dryRun: false };
  const valued = { '--root': 'root', '--dir': 'dir', '--id': 'id', '--title': 'title', '--flow': 'flow', '--holder': 'holder', '--parent': 'parent', '--escalate-to': 'escalateTo' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-index') opts.index = false;
    else if (valued[a]) {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      opts[valued[a]] = v;
      i++;
    } else throw new UsageError(`unknown argument: ${a}`);
  }
  opts.root = path.resolve(opts.root);
  if (path.isAbsolute(opts.dir) || opts.dir.split(/[\\/]/).includes('..')) throw new UsageError('--dir must be a path inside the root');
  opts.dir = path.posix.normalize(opts.dir.replace(/\\/g, '/')).replace(/\/+$/, '');
  if (opts.dir === '.' || opts.dir === '') throw new UsageError('--dir must be a subdirectory, not the project root (the board would write into the project\'s own README.md)');
  if (command === 'new') {
    if (!opts.id || !ID_RE.test(opts.id)) throw new UsageError('--id is required: letters, digits, ".", "_" or "-", starting with a letter');
    if (/^readme$/i.test(opts.id)) throw new UsageError('--id README is reserved');
    if (!opts.title || !opts.title.trim()) throw new UsageError('--title is required');
    if (opts.parent && !ID_RE.test(opts.parent)) throw new UsageError('--parent must be a task id');
  }
  return opts;
}

const toPosix = (p) => p.split(path.sep).join('/');

// The policy file the board links back to: the one holding "## Subagent team"
// (AGENTS.md first), else whichever of AGENTS.md / CLAUDE.md exists, else AGENTS.md.
export function policyFile(root) {
  const names = ['AGENTS.md', 'CLAUDE.md'];
  for (const name of names) {
    try {
      if (/^##\s+Subagent team\b/m.test(fs.readFileSync(path.join(root, name), 'utf8'))) return name;
    } catch {
      // not there
    }
  }
  for (const name of names) if (fs.existsSync(path.join(root, name))) return name;
  return 'AGENTS.md';
}

export function expandFlow(flow) {
  const key = (flow || 'direct').trim();
  return FLOWS[key] ? `${key} (${FLOWS[key]})` : key;
}

export function indexTemplate(policyLink, policyName) {
  return `# Agent team board

Live and durable state of agent work in this project: which task follows which flow, who holds it, what waits for whom. Rules and the team policy live in [${policyName}](${policyLink}) (section \`## Subagent team\`); this directory links to them and never restates them.

The director (L1) maintains this file. Each card under \`tasks/\` has exactly one writer at a time: its holder.

## Reading order (take-over)

1. This file: tasks and their holders
2. [progress.md](progress.md): status snapshot, completed log, next-up queue, open questions for the human
3. [decisions.md](decisions.md) and [lessons.md](lessons.md) for the area you will touch
4. The cards of the tasks you take over; open escalations: \`team-board.mjs status\`

## Tasks

| Task | Title | Flow | Holder | Status |
|---|---|---|---|---|

## Files

- [progress.md](progress.md): status snapshot, completed log, next-up queue, user decisions, open questions, pitfalls
- [decisions.md](decisions.md): numbered decisions; never rewritten, only marked overturned
- [lessons.md](lessons.md): user adjustments and lessons learned; rules promoted from here live in [${policyName}](${policyLink})
- \`tasks/<ID>.md\`: one card per task or external job (flow, holder, lease, log, questions, result)
`;
}

export const PROGRESS_TEMPLATE = `# Progress

Back to the [board](README.md). Dates are absolute (YYYY-MM-DD). Acceptance numbers are written once, in the completed log.

## Status snapshot

<!-- newest first: one entry per recently accepted, committed or in-flight task -->

## Completed log

| Task | Spec / decision | Commit | Changes and verification |
|---|---|---|---|

## Next-up queue

## User decisions

<!-- numbered summary; the full record is in decisions.md -->

## Open questions

<!-- questions only the human can answer; never delete, mark answered -->

## Pitfalls

| Location | What it is | Why it is this way | Guidance |
|---|---|---|---|
`;

export const DECISIONS_TEMPLATE = `# Decisions

Back to the [board](README.md). Append new decisions at the end. Never rewrite one: when it is overturned, add an "Overturned (YYYY-MM-DD)" note under its heading.

<!--
### D-01: <title> (<YYYY-MM-DD>)
- Decision: <...>
- Decided by: <user / director / L2 expert>; user's words: "<verbatim quote>"
- Motivation and evidence: <...>
- Rejected options: <...>
- Overturn if: <...>
- Status: <planned | landed in <commit>>
-->
`;

export const LESSONS_TEMPLATE = `# Lessons and user adjustments

Back to the [board](README.md). Newest first. Record a row when the user corrects the process, an escalation reveals a gap in a brief, an outsourced job fails, or a trap costs time. When a row becomes a project-wide rule, write the rule once in AGENTS.md and fill "Promoted to" with a link; do not restate it here.

| Date | Source | Lesson or adjustment | Promoted to |
|---|---|---|---|
`;

export function cardTemplate({ id, title, flow, holder, parent, escalateTo, date }) {
  const expanded = expandFlow(flow);
  const target = escalateTo || (/\bL2\b/.test(expanded) ? 'L2' : 'L1');
  return `# ${id}: ${title}

- Status: planned
- Flow: ${expanded}
- Holder: ${holder || 'director'}
- Parent: ${parent || 'none'}
- Team / model / effort: <in-house tier or external team, model, effort>
- Lease: <files this task may edit>
- Brief: <path to the brief>
- Job: <agent id, external job id or conversation id, once dispatched>
- Escalate to: ${target}

Board: [README](../README.md). Only the holder edits this card; others send the holder a message.

## Acceptance

- <command> → <expected result>

## Log

- ${date} created

## Questions

<!-- - [open] Q1 (YYYY-MM-DD, from: <who>, to: L2): <question>; options: <A / B>; meanwhile: <...> -->
<!-- - [answered YYYY-MM-DD by L2] Q1: <question> → <answer> -->

## Result

<!-- verdict, changed files, gate numbers; then a row in ../progress.md "Completed log" -->
`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function initBoard({ root, dir, dryRun }) {
  const boardDir = path.join(root, dir);
  const policy = policyFile(root);
  const policyLink = toPosix(path.relative(boardDir, path.join(root, policy)));
  const files = {
    'README.md': indexTemplate(policyLink, policy),
    'progress.md': PROGRESS_TEMPLATE,
    'decisions.md': DECISIONS_TEMPLATE,
    'lessons.md': LESSONS_TEMPLATE,
  };
  const created = [];
  const kept = [];
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(boardDir, name);
    const rel = toPosix(path.relative(root, file));
    if (fs.existsSync(file)) {
      kept.push(rel);
      continue;
    }
    created.push(rel);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  if (!dryRun) fs.mkdirSync(path.join(boardDir, 'tasks'), { recursive: true });
  const pointer = `- Team board: ${toPosix(dir)}/README.md`;
  const linked = policyMentionsBoard(root, policy, dir);
  return { ok: true, command: 'init', dryRun, dir: toPosix(dir), created, kept, policyFile: policy, policyLinked: linked, pointer };
}

function policyMentionsBoard(root, policy, dir) {
  try {
    return fs.readFileSync(path.join(root, policy), 'utf8').includes(toPosix(dir));
  } catch {
    return false;
  }
}

// Inserts a row after the last table line under "## Tasks"; returns null if there is no such table.
export function insertIndexRow(text, row) {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => /^##\s+Tasks\s*$/.test(l));
  if (head < 0) return null;
  let i = head + 1;
  while (i < lines.length && !lines[i].startsWith('|')) {
    if (/^#{1,6}\s/.test(lines[i])) return null;
    i++;
  }
  if (i >= lines.length) return null;
  while (i < lines.length && lines[i].startsWith('|')) i++;
  lines.splice(i, 0, row);
  return lines.join('\n');
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function newCard(opts) {
  const boardDir = path.join(opts.root, opts.dir);
  const indexFile = path.join(boardDir, 'README.md');
  if (!fs.existsSync(indexFile)) return { exit: 2, result: { ok: false, error: `no board at ${toPosix(opts.dir)}; run init first` } };
  const cardRel = `tasks/${opts.id}.md`;
  const cardFile = path.join(boardDir, cardRel);
  if (fs.existsSync(cardFile)) return { exit: 3, result: { ok: false, error: `${toPosix(path.join(opts.dir, cardRel))} already exists; edit it instead` } };
  const text = cardTemplate({ ...opts, date: today() });
  const warnings = [];
  let indexed = false;
  let indexText = null;
  if (opts.index) {
    const flowName = FLOWS[(opts.flow || 'direct').trim()] ? (opts.flow || 'direct').trim() : 'custom';
    const row = `| [${opts.id}](${cardRel}) | ${cell(opts.title)} | ${flowName} | ${cell(opts.holder || 'director')} | planned |`;
    indexText = insertIndexRow(fs.readFileSync(indexFile, 'utf8'), row);
    if (indexText === null) warnings.push('README.md has no "## Tasks" table; add the row by hand');
    else indexed = true;
  }
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(cardFile), { recursive: true });
    fs.writeFileSync(cardFile, text);
    if (indexed) fs.writeFileSync(indexFile, indexText);
  }
  return { exit: 0, result: { ok: true, command: 'new', dryRun: opts.dryRun, card: toPosix(path.join(opts.dir, cardRel)), indexed, warnings } };
}

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

export function parseCard(text) {
  const clean = stripComments(text.replace(/\r\n/g, '\n'));
  const lines = clean.split('\n');
  const title = lines.find((l) => /^# /.test(l)) || '';
  const tm = title.match(/^#\s+([^:]+):\s*(.*)$/);
  const firstSection = lines.findIndex((l) => /^## /.test(l));
  const header = firstSection < 0 ? lines : lines.slice(0, firstSection);
  const field = (name) => {
    const re = new RegExp(`^-\\s*${name}:\\s*(.*)$`, 'i');
    const line = header.find((l) => re.test(l));
    return line ? line.match(re)[1].trim() : null;
  };
  const questions = [];
  let inQuestions = false;
  for (const l of lines) {
    if (/^## /.test(l)) inQuestions = /^##\s+Questions\s*$/i.test(l);
    else if (inQuestions) {
      const m = l.match(/^\s*-\s*\[open\]\s*(.*)$/i);
      if (m) {
        const to = m[1].match(/\bto:\s*([^,;)]+)/i);
        questions.push({ text: m[1].trim(), to: to ? to[1].trim() : null });
      }
    }
  }
  return {
    id: tm ? tm[1].trim() : null,
    title: tm ? tm[2].trim() : title.replace(/^#\s+/, '').trim(),
    status: field('Status'),
    flow: field('Flow'),
    holder: field('Holder'),
    parent: field('Parent'),
    escalateTo: field('Escalate to'),
    openQuestions: questions,
  };
}

export function parseIndex(text) {
  const rows = [];
  for (const l of stripComments(text).split('\n')) {
    const m = l.match(/^\|\s*\[([^\]]+)\]\((tasks\/[^)\s]+)\)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[3].split(/(?<!\\)\|/).map((c) => c.trim());
    rows.push({ id: m[1].trim(), file: m[2], status: cells[cells.length - 1] || null });
  }
  return rows;
}

export function boardStatus({ root, dir }) {
  const boardDir = path.join(root, dir);
  const indexFile = path.join(boardDir, 'README.md');
  if (!fs.existsSync(indexFile)) return { exit: 2, result: { ok: false, error: `no board at ${toPosix(dir)}; run init first` } };
  const warnings = [];
  const indexText = fs.readFileSync(indexFile, 'utf8');
  const index = parseIndex(indexText);
  const tasksDir = path.join(boardDir, 'tasks');
  const cardFiles = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort() : [];
  const tasks = [];
  for (const f of cardFiles) {
    const card = parseCard(fs.readFileSync(path.join(tasksDir, f), 'utf8'));
    const rel = `tasks/${f}`;
    const id = card.id || f.replace(/\.md$/, '');
    if (card.id && card.id !== f.replace(/\.md$/, '')) warnings.push(`${rel}: heading id "${card.id}" differs from the file name`);
    if (!card.status) warnings.push(`${rel}: no "Status:" line`);
    else if (!STATUSES.includes(card.status)) warnings.push(`${rel}: unknown status "${card.status}" (use ${STATUSES.join(', ')})`);
    if (!card.holder) warnings.push(`${rel}: no "Holder:" line (every card needs exactly one writer)`);
    const row = index.find((r) => r.file === rel);
    if (!row) warnings.push(`${rel}: not listed in README.md "## Tasks"`);
    else if (card.status && row.status !== card.status) warnings.push(`${rel}: README.md says "${row.status}", card says "${card.status}"`);
    tasks.push({ ...card, id, file: toPosix(path.join(dir, rel)) });
  }
  for (const r of index) if (!cardFiles.includes(r.file.replace(/^tasks\//, ''))) warnings.push(`README.md lists ${r.file}, which does not exist`);
  const policy = policyFile(root);
  if (!fs.existsSync(path.join(root, policy))) warnings.push(`${policy} does not exist: create it with a "## Subagent team" section that links to the board`);
  else if (!policyMentionsBoard(root, policy, dir)) warnings.push(`${policy} does not mention ${toPosix(dir)}: add "- Team board: ${toPosix(dir)}/README.md" to its "## Subagent team" section`);
  if (!/\]\([^)]*(AGENTS|CLAUDE)\.md\)/.test(indexText)) warnings.push(`README.md does not link back to ${policy}`);
  const openQuestions = tasks.flatMap((t) => t.openQuestions.map((q) => ({ task: t.id, ...q })));
  const byStatus = {};
  for (const t of tasks) byStatus[t.status || 'unknown'] = (byStatus[t.status || 'unknown'] || 0) + 1;
  const active = tasks.filter((t) => !['committed', 'cancelled'].includes(t.status)).map((t) => t.id);
  return {
    exit: 0,
    result: {
      ok: true, command: 'status', dir: toPosix(dir), policyFile: policy,
      counts: { tasks: tasks.length, active: active.length, openQuestions: openQuestions.length, forHuman: openQuestions.filter((q) => /human|user/i.test(q.to || '')).length, byStatus },
      openQuestions, tasks, warnings,
    },
  };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`team-board.mjs: ${err.message}\nRun with --help for usage.`);
    return 1;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  let out;
  try {
    if (opts.command === 'init') {
      const result = initBoard(opts);
      if (!result.policyLinked) console.error(`hint: add this line to the "## Subagent team" section of ${result.policyFile}:\n  ${result.pointer}`);
      out = { exit: 0, result };
    } else if (opts.command === 'new') out = newCard(opts);
    else out = boardStatus(opts);
  } catch (err) {
    if (!err || !err.code) throw err;
    out = { exit: 4, result: { ok: false, error: `${err.code}: ${err.message}` } };
  }
  for (const w of out.result.warnings || []) console.error(`warning: ${w}`);
  if (out.result.error) console.error(`team-board.mjs: ${out.result.error}`);
  process.stdout.write(`${JSON.stringify(out.result, null, 2)}\n`);
  return out.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
