import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, makeTempDir, removeDir, runScript } from './helpers/fakes.mjs';
import {
  parseArgs, UsageError, expandFlow, insertIndexRow, parseCard, parseIndex, cardTemplate, policyFile,
  setCardStatus, setIndexStatus, lessonsWarnings,
} from '../skills/subagent-team/scripts/team-board.mjs';

const SCRIPT = path.join(ROOT, 'skills', 'subagent-team', 'scripts', 'team-board.mjs');

let tmp;
before(() => { tmp = makeTempDir('team-board-test-'); });
after(() => removeDir(tmp));

function project(name, files = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('parseArgs validates commands, ids and the board directory', () => {
  assert.deepEqual(parseArgs([]), { help: true });
  assert.throws(() => parseArgs(['bogus']), UsageError);
  assert.throws(() => parseArgs(['new', '--title', 'x']), /--id is required/);
  assert.throws(() => parseArgs(['new', '--id', '../x', '--title', 'x']), /--id is required/);
  assert.throws(() => parseArgs(['new', '--id', 'T1']), /--title is required/);
  assert.throws(() => parseArgs(['status', '--dir', '../elsewhere']), /inside the root/);
  assert.throws(() => parseArgs(['status', '--root']), /needs a value/);
  assert.throws(() => parseArgs(['init', '--dir', '.']), /not the project root/);
  assert.throws(() => parseArgs(['init', '--dir', 'docs/..']), /inside the root/);
  assert.throws(() => parseArgs(['new', '--id', 'readme', '--title', 'x']), /reserved/);
  assert.equal(parseArgs(['status', '--dir', './docs/agent-team/']).dir, 'docs/agent-team');
  const o = parseArgs(['new', '--id', 'T3.a', '--title', 'Translate', '--flow', 'outsource', '--no-index', '--dry-run']);
  assert.equal(o.id, 'T3.a');
  assert.equal(o.index, false);
  assert.equal(o.dryRun, true);
});

test('expandFlow expands presets and keeps free text', () => {
  assert.match(expandFlow('outsource'), /^outsource \(L1 → L3 liaison → L4/);
  assert.match(expandFlow(undefined), /^direct \(/);
  assert.equal(expandFlow('L1 → L2 → L1'), 'L1 → L2 → L1');
});

test('cardTemplate escalates to L2 only when the flow has L2', () => {
  assert.match(cardTemplate({ id: 'T1', title: 't', flow: 'designed', date: '2026-10-31' }), /- Escalate to: L2/);
  assert.match(cardTemplate({ id: 'T1', title: 't', flow: 'outsource', date: '2026-10-31' }), /- Escalate to: L1/);
  assert.match(cardTemplate({ id: 'T1', title: 't', escalateTo: 'liaison', date: '2026-10-31' }), /- Escalate to: liaison/);
});

test('insertIndexRow appends under the Tasks table and refuses without one', () => {
  const text = '# B\n\n## Tasks\n\n| Task | S |\n|---|---|\n| [T1](tasks/T1.md) | planned |\n\n## Files\n';
  const out = insertIndexRow(text, '| [T2](tasks/T2.md) | planned |');
  assert.match(out, /\| \[T1\]\(tasks\/T1\.md\) \| planned \|\n\| \[T2\]\(tasks\/T2\.md\) \| planned \|\n\n## Files/);
  assert.equal(insertIndexRow('# B\n## Tasks\n\n## Files\n| x |\n', '| r |'), null);
  assert.equal(insertIndexRow('# B\n', '| r |'), null);
});

test('parseCard reads header fields and open questions, ignoring comments', () => {
  const card = parseCard([
    '# T3.a: Translate keys',
    '',
    '- Status: waiting-external',
    '- Holder: liaison-agy',
    '- Escalate to: L2',
    '',
    '## Questions',
    '<!-- - [open] Q0 (to: L2): template -->',
    '- [open] Q1 (2026-10-31, from: agy job, to: L2): which plural form?',
    '- [answered 2026-10-31 by liaison] Q2: path? → locales/',
    '- [open] Q3 (2026-10-31, to: human): ship French now?',
    '## Result',
    '- [open] not a question',
  ].join('\n'));
  assert.equal(card.id, 'T3.a');
  assert.equal(card.title, 'Translate keys');
  assert.equal(card.status, 'waiting-external');
  assert.equal(card.holder, 'liaison-agy');
  assert.deepEqual(card.openQuestions.map((q) => q.to), ['L2', 'human']);
});

test('parseIndex reads task rows and their last cell as status', () => {
  const rows = parseIndex('| Task | Title | Status |\n|---|---|---|\n| [T1](tasks/T1.md) | a \\| b | in-review |\n');
  assert.deepEqual(rows, [{ id: 'T1', file: 'tasks/T1.md', status: 'in-review' }]);
});

test('policyFile prefers the file with the policy section, then AGENTS.md, then CLAUDE.md', () => {
  assert.equal(policyFile(project('pf1', { 'CLAUDE.md': '' })), 'CLAUDE.md');
  assert.equal(policyFile(project('pf2', { 'CLAUDE.md': '', 'AGENTS.md': '' })), 'AGENTS.md');
  assert.equal(policyFile(project('pf3')), 'AGENTS.md');
  assert.equal(policyFile(project('pf4', { 'AGENTS.md': '# Rules\n', 'CLAUDE.md': '## Subagent team\n' })), 'CLAUDE.md');
});

test('parseCard handles CRLF line endings', () => {
  const card = parseCard('# T1: x\r\n\r\n- Status: planned\r\n- Holder: director\r\n\r\n## Questions\r\n- [open] Q1 (to: L1): y\r\n');
  assert.equal(card.status, 'planned');
  assert.equal(card.holder, 'director');
  assert.equal(card.openQuestions.length, 1);
});

test('CLI: init, new and status work together and report drift', () => {
  const dir = project('flow', { 'AGENTS.md': '# Rules\n\n## Subagent team\n- Model policy: auto\n' });
  const init = runScript(SCRIPT, ['init', '--root', dir]);
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual(init.json.created.sort(), ['docs/agent-team/README.md', 'docs/agent-team/decisions.md', 'docs/agent-team/lessons.md', 'docs/agent-team/progress.md']);
  assert.equal(init.json.policyLinked, false);
  assert.match(init.stderr, /- Team board: docs\/agent-team\/README\.md/);
  assert.match(read(dir, 'docs/agent-team/README.md'), /\[AGENTS\.md\]\(\.\.\/\.\.\/AGENTS\.md\)/);

  fs.writeFileSync(path.join(dir, 'docs/agent-team/lessons.md'), 'mine\n');
  const again = runScript(SCRIPT, ['init', '--root', dir]);
  assert.equal(again.json.created.length, 0);
  assert.equal(read(dir, 'docs/agent-team/lessons.md'), 'mine\n', 'init never overwrites');

  const created = runScript(SCRIPT, ['new', '--root', dir, '--id', 'T1', '--title', 'Settings | page', '--flow', 'designed', '--holder', 'lead-T1']);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.json.indexed, true);
  assert.match(read(dir, 'docs/agent-team/README.md'), /\| \[T1\]\(tasks\/T1\.md\) \| Settings \\\| page \| designed \| lead-T1 \| planned \|/);
  assert.equal(runScript(SCRIPT, ['new', '--root', dir, '--id', 'T1', '--title', 'again']).status, 3);
  runScript(SCRIPT, ['new', '--root', dir, '--id', 'T1.a', '--title', 'Translate', '--flow', 'outsource', '--parent', 'T1', '--no-index']);

  const card = path.join(dir, 'docs/agent-team/tasks/T1.md');
  fs.writeFileSync(card, read(card)
    .replace('- Status: planned', '- Status: escalated')
    .replace('## Result', '- [open] Q1 (2026-10-31, from: implementer, to: human): keep the old URL?\n\n## Result'));

  const st = runScript(SCRIPT, ['status', '--root', dir]);
  assert.equal(st.status, 0, st.stderr);
  assert.equal(st.json.counts.tasks, 2);
  assert.equal(st.json.counts.openQuestions, 1);
  assert.equal(st.json.counts.forHuman, 1);
  assert.equal(st.json.openQuestions[0].task, 'T1');
  const w = st.json.warnings.join('\n');
  assert.match(w, /tasks\/T1\.md: README\.md says "planned", card says "escalated"/);
  assert.match(w, /tasks\/T1\.a\.md: not listed in README\.md/);
  assert.match(w, /AGENTS\.md does not mention docs\/agent-team/);

  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '- Team board: docs/agent-team/README.md\n');
  const st2 = runScript(SCRIPT, ['status', '--root', dir]);
  assert.ok(!st2.json.warnings.some((x) => /does not mention/.test(x)));

  const sub = path.join(dir, 'docs/agent-team/tasks/T1.a.md');
  fs.writeFileSync(sub, read(sub).replace(/^- Holder: .*\n/m, '').replace('- Status: planned', '- Status: done-ish'));
  fs.appendFileSync(path.join(dir, 'docs/agent-team/README.md'), '| [T9](tasks/T9.md) | ghost | direct | director | planned |\n');
  const w3 = runScript(SCRIPT, ['status', '--root', dir]).json.warnings.join('\n');
  assert.match(w3, /tasks\/T1\.a\.md: no "Holder:" line/);
  assert.match(w3, /tasks\/T1\.a\.md: unknown status "done-ish"/);
  assert.match(w3, /README\.md lists tasks\/T9\.md, which does not exist/);
});

test('CLI: new --dry-run writes nothing; file system errors exit 4 with JSON', () => {
  const dir = project('dry', { 'AGENTS.md': '## Subagent team\n' });
  runScript(SCRIPT, ['init', '--root', dir]);
  const before = read(dir, 'docs/agent-team/README.md');
  const dry = runScript(SCRIPT, ['new', '--root', dir, '--id', 'T1', '--title', 'x', '--dry-run']);
  assert.equal(dry.status, 0);
  assert.equal(dry.json.indexed, true);
  assert.equal(fs.existsSync(path.join(dir, 'docs/agent-team/tasks/T1.md')), false);
  assert.equal(read(dir, 'docs/agent-team/README.md'), before);
  const bad = project('bad', { docs: 'a file, not a directory' });
  const r = runScript(SCRIPT, ['init', '--root', bad]);
  assert.equal(r.status, 4);
  assert.equal(r.json.ok, false);
});

test('CLI: missing board, dry runs, custom dir and usage errors', () => {
  const dir = project('misc', { 'CLAUDE.md': '## Subagent team\n' });
  assert.equal(runScript(SCRIPT, ['status', '--root', dir]).status, 2);
  assert.equal(runScript(SCRIPT, ['new', '--root', dir, '--id', 'T1', '--title', 'x']).status, 2);
  const dry = runScript(SCRIPT, ['init', '--root', dir, '--dir', 'docs/team', '--dry-run']);
  assert.equal(dry.status, 0);
  assert.equal(dry.json.created.length, 4);
  assert.equal(fs.existsSync(path.join(dir, 'docs')), false, 'dry run writes nothing');
  runScript(SCRIPT, ['init', '--root', dir, '--dir', 'docs/team']);
  assert.match(read(dir, 'docs/team/README.md'), /\[CLAUDE\.md\]\(\.\.\/\.\.\/CLAUDE\.md\)/);
  assert.equal(runScript(SCRIPT, ['frobnicate']).status, 1);
  assert.equal(runScript(SCRIPT, ['--help']).status, 0);
});

function cleanBoard(name) {
  const dir = project(name, { 'AGENTS.md': '## Subagent team\n- Team board: docs/agent-team/README.md\n' });
  assert.equal(runScript(SCRIPT, ['init', '--root', dir]).status, 0);
  assert.equal(runScript(SCRIPT, ['new', '--root', dir, '--id', 'T1', '--title', 'Test | card']).status, 0);
  return dir;
}

test('CLI: status --strict fails on warnings, passes clean boards, and is status-only', () => {
  const dir = cleanBoard('strict');
  const clean = runScript(SCRIPT, ['status', '--root', dir, '--strict']);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.json.ok, true);
  assert.equal(clean.json.strict, true);
  assert.deepEqual(clean.json.warnings, []);
  const card = path.join(dir, 'docs/agent-team/tasks/T1.md');
  fs.writeFileSync(card, read(card).replace('- Status: planned', '- Status: done'));
  const strict = runScript(SCRIPT, ['status', '--root', dir, '--strict']);
  assert.equal(strict.status, 5, strict.stderr);
  assert.equal(strict.json.ok, false);
  assert.equal(strict.json.strict, true);
  assert.ok(strict.json.warnings.includes('tasks/T1.md: status "done" is ambiguous: use "accepted" (checks and review passed) or "committed" (in git); push and deploy state go in progress.md'));
  const normal = runScript(SCRIPT, ['status', '--root', dir]);
  assert.equal(normal.status, 0);
  assert.equal(normal.json.ok, true);
  assert.equal(Object.hasOwn(normal.json, 'strict'), false);
  for (const command of ['init', 'new', 'set']) {
    const result = runScript(SCRIPT, [command, '--strict', '--root', dir]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--strict is only valid for status/);
  }
});

test('setCardStatus preserves comments, limits header edits, and logs before the next section or EOF', () => {
  const text = '# T1: x\n<!-- - Status: hidden -->\n- Status: done <!-- keep -->\n- Status: second\n\n## Log\n\n- earlier\n\n## Result\n- Status: untouched\n';
  const out = setCardStatus(text, 'accepted', '2026-11-06');
  assert.equal(out.from, 'done');
  assert.equal(out.changed, true);
  assert.equal(out.logged, true);
  assert.equal(out.text, text.replace('done <!-- keep -->', 'accepted <!-- keep -->').replace('- earlier\n', '- earlier\n- 2026-11-06 status: done → accepted\n'));
  assert.equal(setCardStatus('# T1\n## Result\n- Status: done\n', 'accepted', '2026-11-06'), null);
  const eof = setCardStatus('- Status: planned\r\n## Log\r\n- earlier\r\n', 'committed', '2026-11-06');
  assert.equal(eof.text, '- Status: committed\r\n## Log\r\n- earlier\r\n- 2026-11-06 status: planned → committed\r\n');
  assert.equal(setCardStatus('- Status: planned\n', 'accepted', '2026-11-06').logged, false);
});

test('setIndexStatus changes only the matching row last cell and ignores commented rows', () => {
  const row = '| [alias](tasks/T1.md) | title \\| extra | director | planned |';
  const text = `<!--\n${row}\n-->\n${row}\n| [T2](tasks/T2.md) | planned |\n`;
  assert.equal(setIndexStatus(text, 'T1', 'accepted'), `<!--\n${row}\n-->\n${row.replace('planned', 'accepted')}\n| [T2](tasks/T2.md) | planned |\n`);
  assert.equal(setIndexStatus(text, 'T3', 'accepted'), null);
});

test('CLI: set updates card, index and log; dry-run and unchanged status write nothing', () => {
  const dir = cleanBoard('set');
  const card = path.join(dir, 'docs/agent-team/tasks/T1.md');
  const index = path.join(dir, 'docs/agent-team/README.md');
  fs.writeFileSync(card, read(card).replace('- Status: planned', '- Status: planned <!-- retain -->'));
  const beforeCard = read(card);
  const beforeIndex = read(index);
  const args = ['set', '--root', dir, '--id', 'T1', '--status', 'accepted'];
  const dry = runScript(SCRIPT, [...args, '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(dry.json, { ok: true, command: 'set', dryRun: true, card: 'docs/agent-team/tasks/T1.md', from: 'planned', to: 'accepted', changed: true, cardUpdated: true, indexUpdated: true, logged: true, warnings: [] });
  assert.equal(read(card), beforeCard);
  assert.equal(read(index), beforeIndex);
  const updated = runScript(SCRIPT, args);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(updated.json.indexUpdated, true);
  assert.equal(read(index), beforeIndex.replace('| planned |', '| accepted |'));
  const date = new Date().toISOString().slice(0, 10);
  assert.equal(read(card), beforeCard.replace('- Status: planned', '- Status: accepted').replace('\n\n## Questions', `\n- ${date} status: planned → accepted\n\n## Questions`));
  const stats = [fs.statSync(card).mtimeMs, fs.statSync(index).mtimeMs];
  const unchanged = runScript(SCRIPT, args);
  assert.equal(unchanged.status, 0);
  assert.equal(unchanged.json.changed, false);
  assert.equal(unchanged.json.logged, false);
  assert.equal(unchanged.json.indexUpdated, false);
  assert.deepEqual([fs.statSync(card).mtimeMs, fs.statSync(index).mtimeMs], stats);
  // A stale index row is repaired even when the card already has the status.
  fs.writeFileSync(index, read(index).replace('| accepted |', '| planned |'));
  const cardBefore = read(card);
  const repaired = runScript(SCRIPT, args);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(repaired.json.changed, true);
  assert.equal(repaired.json.cardUpdated, false);
  assert.equal(repaired.json.indexUpdated, true);
  assert.equal(repaired.json.logged, false);
  assert.equal(read(index), beforeIndex.replace('| planned |', '| accepted |'));
  assert.equal(read(card), cardBefore);
});

test('CLI: set validates arguments and reports missing board, card, header and index row', () => {
  const dir = project('set-errors');
  const args = ['set', '--root', dir, '--id', 'T1', '--status', 'accepted'];
  assert.equal(runScript(SCRIPT, args).status, 2);
  for (const invalid of [[], ['--id', 'T1'], ['--id', '../bad', '--status', 'accepted'], ['--id', 'README', '--status', 'accepted'], ['--id', 'T1', '--status', 'done']]) {
    assert.equal(runScript(SCRIPT, ['set', '--root', dir, ...invalid]).status, 1);
  }
  const unknown = runScript(SCRIPT, ['set', '--id', 'T1', '--status', 'done']);
  assert.match(unknown.stderr, /planned, in-progress, waiting-external, escalated, in-review, accepted, committed, cancelled/);
  runScript(SCRIPT, ['init', '--root', dir]);
  const missing = runScript(SCRIPT, args);
  assert.equal(missing.status, 6);
  assert.equal(missing.json.error, 'tasks/T1.md does not exist; create it with new');
  const card = path.join(dir, 'docs/agent-team/tasks/T1.md');
  fs.writeFileSync(card, '# T1: x\n## Result\n- Status: planned\n');
  const noHeader = runScript(SCRIPT, args);
  assert.equal(noHeader.status, 6);
  assert.equal(noHeader.json.error, 'tasks/T1.md has no Status line');
  fs.writeFileSync(card, '- Status: planned\n');
  const unindexed = runScript(SCRIPT, args);
  assert.equal(unindexed.status, 0);
  assert.equal(unindexed.json.indexUpdated, false);
  assert.equal(unindexed.json.logged, false);
  assert.deepEqual(unindexed.json.warnings, ['README.md has no row for tasks/T1.md; add it by hand']);
  assert.equal(read(card), '- Status: accepted\n');
});

test('lessonsWarnings checks promotion destinations across tables and ignores comments and placeholders', () => {
  const text = '| Date | Source | Lesson | pRoMoTeD tO |\n|---|---|---|---|\n' +
    '| 2026-11-01 | x | x | agent MEMORY |\n' +
    '| 2026-11-02 | x | x | [AGENTS.md](../../AGENTS.md) |\n' +
    '| 2026-10-31 | user: "<verbatim words>" | <what changes in the process> | AGENTS.md, `## Subagent team` |\n' +
    '| 2026-11-03 | x | x | plain text |\n' +
    '<!-- | hidden | x | x | memory | -->\n\n' +
    '| Date | Promoted to |\n|---|---|\n' +
    ['','—','-','n/a','CLAUDE.md','[rule](rules.md)'].map((value) => `| fine | ${value} |\n`).join('') +
    '| remote | [rule]( https://example.org/rules) |\n';
  assert.deepEqual(lessonsWarnings(text), [
    'lessons.md row 2026-11-01: promoted to local agent memory; rules live in the repository (write the rule into AGENTS.md and link it)',
    'lessons.md row 2026-11-03: "Promoted to" has no link to a file in the repository',
    'lessons.md row remote: "Promoted to" has no link to a file in the repository',
  ]);
});

test('CLI: status includes lessons promotion warnings in strict failure', () => {
  const dir = cleanBoard('lessons');
  fs.appendFileSync(path.join(dir, 'docs/agent-team/lessons.md'), '| 2026-11-06 | review | rule | local memory |\n');
  const result = runScript(SCRIPT, ['status', '--root', dir, '--strict']);
  assert.equal(result.status, 5);
  assert.equal(result.json.warnings.length, 1);
  assert.match(result.json.warnings[0], /lessons\.md row 2026-11-06: promoted to local agent memory/);
});
