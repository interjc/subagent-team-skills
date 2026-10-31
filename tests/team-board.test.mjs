import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, makeTempDir, removeDir, runScript } from './helpers/fakes.mjs';
import {
  parseArgs, UsageError, expandFlow, insertIndexRow, parseCard, parseIndex, cardTemplate, policyFile,
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

test('policyFile prefers AGENTS.md, then CLAUDE.md', () => {
  assert.equal(policyFile(project('pf1', { 'CLAUDE.md': '' })), 'CLAUDE.md');
  assert.equal(policyFile(project('pf2', { 'CLAUDE.md': '', 'AGENTS.md': '' })), 'AGENTS.md');
  assert.equal(policyFile(project('pf3')), 'AGENTS.md');
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
