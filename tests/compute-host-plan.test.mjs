import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mergeConfigs } from '../skills/subagent-team/scripts/compute-config.mjs';
import { SCRIPTS, makeTempDir, removeDir, readJson, runScript } from './helpers/fakes.mjs';

const at = '2026-11-25T12:00:00Z';
function fixture(t, config, { git = true } = {}) {
  const dir = fs.realpathSync(makeTempDir('compute-host-test-'));
  t.after(() => removeDir(dir));
  const home = path.join(dir, 'home'), root = path.join(dir, 'repo');
  fs.mkdirSync(home); fs.mkdirSync(root);
  const env = { HOME: home, SUBAGENT_TEAM_HOME: home, GIT_CONFIG_NOSYSTEM: '1',
    T3CODE_THREAD_ID: undefined, T3CODE_CLI_PATH: undefined, CODEX_THREAD_ID: undefined, OPENCODE_SESSION_ID: undefined,
    OPENCODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, CLAUDECODE: undefined, AI_AGENT: undefined,
    CODEX_SANDBOX: undefined, CODEX_SANDBOX_NETWORK_DISABLED: undefined, GEMINI_CLI: undefined,
    CURSOR_AGENT: undefined, CURSOR_TRACE_ID: undefined };
  if (git) execFileSync('git', ['init', '-q'], { cwd: root, env: { ...process.env, HOME: home } });
  const plan = path.join(home, 'compute.json');
  if (config) fs.writeFileSync(plan, typeof config === 'string' ? config : JSON.stringify({ schema: 1, ...config }));
  const run = (args, status = 0) => {
    const r = runScript(SCRIPTS.computeConfig, [...args, '--root', root], { env, cwd: root });
    assert.equal(r.status, status, `${args.join(' ')}: ${r.stderr}`);
    return r.json;
  };
  const draft = (cfg) => { const file = path.join(dir, 'draft.json'); fs.writeFileSync(file, JSON.stringify(cfg)); return file; };
  return { dir, home, root, env, run, plan, draft };
}

test('rev-1 reads are byte-preserving and start tracks live host, runtime and served evidence', (t) => {
  const legacy = '{ "schema": 1, "resources": {}, "privateExtension": 12 }\n';
  const { run, plan, root, env, dir } = fixture(t, legacy);
  assert.equal(run(['show']).rev, 1);
  assert.equal(fs.readFileSync(plan, 'utf8'), legacy);
  env.T3CODE_THREAD_ID = 'synthetic-thread-value';
  const start = (host, runtime, extra = []) => run(['start', '--host', host, '--runtime', runtime, '--at', at, ...extra]);
  const first = start('wrapper', 'inner');
  assert.equal(first.host.change, 'new');
  assert.equal(first.session.key, createHash('sha256').update('wrapper:synthetic-thread-value').digest('hex').slice(0, 16));
  assert.equal(first.session.generated, false);
  assert.equal(first.session.file, path.join(root, '.agent-team', 'compute-state.json'));
  assert.equal(fs.statSync(first.session.file).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(first.session.file, 'utf8'), /synthetic-thread-value/);
  assert.match(fs.readFileSync(path.join(root, '.git/info/exclude'), 'utf8'), /\/\.agent-team\//);
  assert.equal(fs.readFileSync(plan, 'utf8'), legacy);
  for (const host of ['wrapper', 'another']) run(['host', 'set', host, '--scope', 'project', '--scenario', 'harness']);
  const served = path.join(dir, 'served.txt');
  fs.writeFileSync(served, 'other\n model \nmodel\n');
  const same = start('wrapper', 'inner', ['--served', served]);
  assert.equal(same.host.change, 'same');
  assert.equal(same.needsInit, false);
  assert.equal(same.session.resumed, true);
  assert.equal(start('another', 'next', ['--served', served]).host.change, 'changed');
  fs.writeFileSync(served, 'model\nother\n\n');
  assert.equal(start('another', 'next', ['--served', served]).host.change, 'same');
  assert.equal(start('another', 'different', ['--served', served]).host.change, 'runtime-changed');
  fs.writeFileSync(served, 'new-model\n');
  const changed = start('another', 'different', ['--served', served]);
  assert.equal(changed.host.change, 'served-changed');
  assert.equal(changed.ask[0].id, 'host-served-changed');
});

test('state outside git, random keys, selective session promotion and carry-over', (t) => {
  const { run, home, plan } = fixture(t, { hosts: { local: {} } }, { git: false });
  const original = fs.readFileSync(plan, 'utf8');
  const first = run(['start', '--host', 'local', '--at', at]);
  assert.equal(first.host.change, 'same');
  assert.equal(first.host.previous, null);
  assert.equal(first.session.generated, true);
  assert.match(first.session.key, /^[0-9a-f]{12}$/);
  assert.equal(first.session.file, path.join(home, 'compute-state.json'));
  const session = ['--scope', 'session', '--session', 'one', '--at', at];
  run(['profile', 'use', 'frugal', '--scope', 'session'], 1);
  run(['profile', 'use', 'frugal', ...session]);
  run(['set', 'worker', '--effort', 'high', ...session]);
  run(['route', 'bulk', 'worker', ...session]);
  run(['schedule', 'add', 'day', '--when', 'mon-fri', '--prefer', 'worker', ...session]);
  const sessionPlan = run(['show', '--session', 'one']);
  assert.deepEqual(sessionPlan.profile, { active: 'frugal', base: 'frugal', source: 'session' });
  assert.equal(sessionPlan.resources.worker.scope, 'session');
  assert.deepEqual(sessionPlan.routing.bulk, ['worker']);
  assert.equal(sessionPlan.schedules[0].id, 'day');
  assert.equal(fs.readFileSync(plan, 'utf8'), original);
  run(['promote', '--session', 'one', '--scope', 'global', '--what', 'profile use frugal', '--at', at]);
  assert.deepEqual(run(['show']).profile, { active: 'frugal', base: 'frugal', source: 'global' });
  assert.deepEqual(run(['show']).resources, {});
  const after = run(['start', '--host', 'local', '--session', 'later', '--at', '2026-12-15T09:00Z']);
  assert.ok(after.ask.some((a) => a.id === 'unsaved-overrides'));
  const state = readJson(first.session.file);
  assert.equal(state.sessions.one, undefined);
  assert.equal(state.carryOver.length, 3);
  assert.ok(state.carryOver.every((n) => n.session === 'one' && n.what !== 'profile use frugal'));
  run(['promote', '--decline', '--session', 'one', '--all', '--at', '2026-12-15T09:01Z']);
  assert.deepEqual(readJson(first.session.file).carryOver, []);
});

test('preference review snoozes inclusively and confirms on keep', (t) => {
  const { run } = fixture(t, { timezone: 'UTC', review: { everyDays: 7, lastReviewed: '2026-11-25' } });
  const review = (...args) => run(['reviewed', '--scope', 'global', '--what', 'preferences', ...args]).review;
  const start = (day) => run(['start', '--at', day + 'T12:00Z']).review.preferences;
  assert.ok(start('2026-11-25').due);
  const later = review('--decision', 'later', '--at', at);
  assert.equal(later.preferences.lastConfirmed ?? null, null);
  assert.equal(later.preferences.lastAsked, '2026-11-25');
  assert.equal(later.preferences.snoozeUntil, '2026-11-28');
  assert.equal(start('2026-11-28').due, false);
  assert.equal(start('2026-11-29').due, true);
  const keep = review('--decision', 'keep', '--every-days', '2', '--at', '2026-11-29T12:00Z');
  assert.equal(keep.preferences.lastConfirmed, '2026-11-29');
  assert.equal(keep.preferences.snoozeUntil, null);
  assert.equal(keep.lastReviewed, '2026-11-25');
  assert.equal(start('2026-12-01').due, true);
});

const account = (billing) => ({ team: 'codex', vendor: 'openai', declared: '2026-11-24', billing });
const worker = { team: 'codex', model: 'worker-model', effort: 'high', roles: ['bulk'], tier: 'external-strong' };
const serves = { codex: { accounts: [{ account: 'first', instance: 'primary' }, { account: 'second', instance: 'backup' }],
  strategy: 'primary-backup', models: { 'worker-model': 'host-model' }, options: { effort: 'reasoning' } } };

test('host resolution expands declared accounts, enforces quota and home, and orders profile assignments', (t) => {
  const { run } = fixture(t, { accounts: { first: account('metered'), second: account('free') }, resources: { worker },
    hosts: { wrapper: { serves }, native: { kind: 'vendor-native', home: ['openai'] } } });
  const resolve = (host, ...args) => run(['resolve', '--role', 'bulk', '--host', host, '--at', at, ...args]);
  const balanced = resolve('wrapper').candidates;
  assert.deepEqual(balanced.map((r) => r.account), ['first', 'second']);
  assert.deepEqual(balanced.map((r) => r.instance), ['primary', 'backup']);
  assert.equal(balanced[0].hostModel, 'host-model');
  assert.equal(balanced[0].route, 'host-switch');
  assert.deepEqual(balanced[0].options, { reasoning: 'high' });
  assert.deepEqual(resolve('native').excluded, [{ id: 'worker', reason: 'home vendor on this host: dispatch in-house' }]);
  assert.equal(resolve('wrapper', '--profile', 'frugal').pick.account, 'second');
  assert.equal(resolve('wrapper', '--profile', 'performance').parallel, 'max');
  const balancedJobs = resolve('wrapper', '--profile', 'load-balance', '--count', '4');
  assert.deepEqual(balancedJobs.assignments.map((a) => a.account), ['first', 'second', 'first', 'second']);
  run(['account', 'quota', 'second', '--state', 'plenty']);
  assert.equal(resolve('wrapper', '--profile', 'load-balance').pick.account, 'second');
  run(['account', 'quota', 'first', '--state', 'ok', '--expires', '2026-11-26']);
  assert.equal(resolve('wrapper', '--profile', 'load-balance').pick.account, 'first');
  run(['account', 'quota', 'first', '--state', 'exhausted', '--resets', '2026-11-27']);
  const exhausted = resolve('wrapper');
  assert.equal(exhausted.pick.account, 'second');
  assert.equal(exhausted.excluded[0].reason, 'account first exhausted until 2026-11-27');
  run(['account', 'remove', 'second', '--scope', 'global']);
  assert.ok(resolve('wrapper').excluded.some((e) => e.reason === 'account second undeclared'));
});

test('project, host and session constraints cannot widen vendor access', (t) => {
  const { run, draft } = fixture(t, { constraints: { onlyVendors: ['openai', 'google'], denyVendors: ['other'] }, resources: { worker } });
  const apply = (cfg) => run(['plan', 'apply', '--scope', 'project', '--from', draft(cfg)]);
  apply({ constraints: { onlyVendors: ['openai', 'extra'], denyVendors: ['second'] }, hosts: { local: { constraints: { onlyVendors: ['extra'] } } } });
  assert.deepEqual(run(['show']).constraints, { onlyVendors: ['openai'], denyVendors: ['other', 'second'], inHouseOnly: false });
  const args = ['resolve', '--host', 'local', '--role', 'bulk'];
  assert.equal(run(args).excluded[0].reason, 'denied by constraint');
  apply({ constraints: { inHouseOnly: true } });
  assert.equal(run(args).excluded[0].reason, 'in-house only');
});

test('custom profiles, expiry prompts and usage metadata follow the effective plan', (t) => {
  const { run, draft, root } = fixture(t, { resources: { worker }, hosts: { local: { profile: 'performance' } } });
  run(['profile', 'define', 'night', '--extends', 'load-balance', '--parallelism', 'max', '--scope', 'global']);
  assert.deepEqual(run(['profile', 'list']).profiles.night, { name: 'night', base: 'load-balance', parallel: 'max' });
  run(['profile', 'use', 'night', '--scope', 'project']);
  assert.equal(run(['show']).profile.source, 'project');
  assert.equal(run(['show', '--host', 'local']).profile.source, 'host');
  run(['account', 'set', 'local-account', '--scope', 'project', '--vendor', 'test', '--team', 'local',
    '--billing', 'prepaid', '--expires', '2026-11-27', '--at', at]);
  assert.equal(run(['show']).accounts['local-account'].declared, '2026-11-25');
  run(['seat', 'set', 'lead', '--scope', 'global', '--team', 'local', '--vendor', 'test', '--model', 'lead-model', '--effort', 'high', '--tier', 'top']);
  const file = draft({ roles: { principal: ['lead'] } });
  run(['host', 'set', 'local', '--scope', 'project', '--from', file]);
  assert.equal(run(['host', 'show', 'local']).host.profile, 'performance');
  for (const session of ['one', 'two']) {
    run(['profile', 'use', 'night', '--until', '2026-11-24', '--scope', 'session', '--session', session, '--at', at]);
  }
  const started = run(['start', '--session', 'two', '--host', 'local', '--at', at]);
  assert.deepEqual(started.ask.map((a) => a.id), ['preferences-review', 'unsaved-overrides', 'repeat-override', 'account-expiry', 'profile-until-passed']);
  const session = ['--session', 'two', '--host', 'local'];
  const resolved = run(['resolve', '--role', 'principal', ...session]);
  assert.deepEqual(resolved.profile, { name: 'night', base: 'load-balance', source: 'session' });
  assert.equal(resolved.parallel, 'max');
  run(['set', 'worker', '--effort', 'low', '--scope', 'session', ...session, '--at', at]);
  const usage = run(['record', 'worker', '--outcome', 'accepted', '--scope', 'project', '--account', 'local-account', '--instance', 'primary', ...session]);
  assert.equal(usage.entry.effort, 'low');
  assert.deepEqual([usage.entry.host, usage.entry.session, usage.entry.account, usage.entry.instance], ['local', 'two', 'local-account', 'primary']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.agent-team', 'compute-usage.jsonl'), 'utf8')), usage.entry);
});

test('invalid paths, cyclic profiles and strict routing checks return actionable validation errors', (t) => {
  const { run, draft } = fixture(t, {});
  const invalid = { rev: 0, profile: { active: 'missing', until: 'bad' }, profiles: { a: { extends: 'b' }, b: { extends: 'a' } },
    accounts: { a: { declared: '2026-02-30', weight: -1 } }, accountQuota: { a: { state: 'ok', remaining: 105 } },
    constraints: { onlyVendors: 'vendor' }, seats: { x: { tier: 'strong' } }, hosts: { x: { scenario: 'invalid', serves: { t: { accounts: ['x'] } } } } };
  const report = run(['plan', 'check', '--from', draft(invalid)], 3);
  for (const path of ['rev', 'profile.active', 'profile.until', 'profiles.a.extends', 'accounts.a.declared', 'accounts.a.weight',
    'accountQuota.a.remaining', 'constraints.onlyVendors', 'seats.x.tier', 'hosts.x.scenario', 'hosts.x.serves.t.accounts']) {
    assert.ok(report.errors.some((e) => e.startsWith(path + ':')), path);
  }
  const errors = run(['plan', 'check', '--from', draft({ resources: { worker: { ...worker, account: 'missing' } },
    routing: { bulk: ['worker', 'absent'] }, hosts: { native: { home: ['openai'], routing: { bulk: ['worker'] }, roles: { principal: ['bad-seat'] } } } })], 3).errors;
  for (const expr of [/undeclared/, /unknown resource absent/, /unknown seat or resource bad-seat/, /home-vendor/]) assert.ok(errors.some((e) => expr.test(e)));
});

test('draft checks, keyed application, rendering and migration use real CLI entry points', (t) => {
  const { run, draft, plan, root, home } = fixture(t, { resources: { worker, untouched: { ...worker, vendor: 'google' } },
    routing: { 'in-house-runner': ['worker'] }, schedules: [{ id: 'keep', when: {} }] });
  const original = fs.readFileSync(plan, 'utf8');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '- Cost preference: economize\n');
  fs.writeFileSync(path.join(home, 'harness-local.md'), '# Local\n');
  const migration = run(['migrate', '--dry-run']);
  assert.deepEqual(migration, { ok: true, rev: { global: 1, project: null }, overlaysWithoutHost: ['local'],
    inHouseRoutingRoles: ['in-house-runner'], policyCostPreference: 'economize', legacyProfile: 'frugal' });
  assert.equal(fs.readFileSync(plan, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, '.agent-team')), false);
  run(['migrate'], 1);
  const bad = run(['plan', 'check', '--from', draft({ resources: { added: { model: 'unpinned' } } })], 3);
  assert.ok(bad.errors.some((e) => e.includes('resources.added.effort')));
  const file = draft({ resources: { worker: { effort: 'medium' } }, accounts: { first: account('free'), second: account('metered') },
    seats: { lead: { team: 'local', vendor: 'test', tier: 'high', model: 'lead-model', effort: 'high' } },
    hosts: { local: { serves, roles: { principal: ['lead', 'auto:low:low', 'worker'] } } }, schedules: [{ id: 'new', when: {} }] });
  assert.equal(run(['plan', 'check', '--from', file]).ok, true);
  const applied = run(['plan', 'apply', '--scope', 'global', '--from', file]);
  assert.ok(applied.changed.includes('accounts.first'));
  assert.equal(readJson(plan).rev, 2);
  assert.deepEqual(readJson(plan).resources.worker, { ...worker, effort: 'medium' });
  assert.ok(readJson(plan).resources.untouched);
  assert.deepEqual(readJson(plan).schedules.map((s) => s.id), ['keep', 'new']);
  assert.deepEqual(run(['plan', 'apply', '--scope', 'global', '--from', file]).changed, []);
  assert.equal(run(['show']).harnessOverlays[0].superseded, true);
  const [seat, auto] = run(['resolve', '--role', 'principal', '--host', 'local']).candidates;
  assert.equal(seat.route, 'in-house');
  assert.equal(seat.model, 'lead-model');
  assert.deepEqual(auto, { kind: 'auto', route: 'in-house', tier: 'low', effort: 'low' });
  assert.match(run(['plan', 'render', '--host', 'local']).markdown, /host-model · medium \| host-switch \| first → primary/);
});

test('the first start uses the confirmed host even when the session already has overrides', (t) => {
  const { run } = fixture(t, { hosts: { confirmed: {} } });
  run(['profile', 'use', 'frugal', '--scope', 'session', '--session', 'same-key', '--at', at]);
  const start = run(['start', '--host', 'confirmed', '--session', 'same-key', '--at', at]);
  assert.equal(start.host.previous, null);
  assert.equal(start.host.change, 'same');
  assert.equal(start.session.resumed, true);
  assert.equal(start.profile.active, 'frugal');
});

test('keyed writes preserve declaration dates and reject malformed host patches before writing', (t) => {
  const { run, draft, plan, root } = fixture(t, { accounts: { first: account('free') }, hosts: { local: { serves } } });
  const projectPlan = path.join(root, '.agent-team', 'compute.json');
  fs.mkdirSync(path.dirname(projectPlan));
  fs.writeFileSync(projectPlan, JSON.stringify({ schema: 1, accounts: { first: { declared: '2026-11-25' } } }));
  run(['account', 'set', 'first', '--scope', 'global', '--team', 'codex', '--vendor', 'openai', '--billing', 'subscription']);
  assert.equal(readJson(plan).accounts.first.declared, '2026-11-24');
  assert.equal(run(['show']).accounts.first.declared, '2026-11-25');
  const before = fs.readFileSync(projectPlan);
  const bad = draft({ hosts: { local: { serves: [] } } });
  const check = run(['plan', 'check', '--from', bad], 3);
  assert.ok(check.errors.some((error) => error.startsWith('hosts.local.serves:')));
  run(['plan', 'apply', '--scope', 'project', '--from', bad], 3);
  assert.deepEqual(fs.readFileSync(projectPlan), before);
});

test('a seat and an external resource may share an id without mixing their fallback or account', (t) => {
  const { run } = fixture(t, { accounts: { first: account('free') },
    seats: { lead: { tier: 'high', model: 'seat-model', effort: 'high' } },
    resources: { lead: { ...worker, account: 'first', fallback: ['other'] }, other: worker },
    hosts: { local: { roles: { principal: ['lead'] } } } });
  const resolved = run(['resolve', '--role', 'principal', '--host', 'local']);
  assert.deepEqual(resolved.candidates.map((c) => [c.kind, c.id]), [['seat', 'lead']]);
  const row = run(['plan', 'render', '--host', 'local']).markdown.split('\n').find((r) => r.startsWith('| principal '));
  assert.match(row, /seat-model · high \| in-house \| — \|/);
  assert.doesNotMatch(row, /other/);
});

test('batch assignments respect weights, low quota caps and a resource account pin', (t) => {
  const { run } = fixture(t, { profile: { active: 'load-balance' },
    accounts: { first: account('free'), second: { ...account('metered'), weight: 3 } },
    resources: { worker }, hosts: { local: { serves } } });
  const args = ['resolve', '--role', 'bulk', '--host', 'local', '--count', '4'];
  assert.equal(run(args).assignments.filter((a) => a.account === 'second').length, 3);
  for (const id of ['first', 'second']) run(['account', 'quota', id, '--state', 'low']);
  assert.deepEqual(run(args).assignments.map((a) => a.account), ['second', 'first']);
  run(['set', 'worker', '--scope', 'global', '--account', 'first']);
  assert.deepEqual(run(args).assignments.map((a) => a.account), ['first']);
  run(['account', 'quota', 'first', '--state', 'exhausted']);
  assert.equal(run(args).excluded[0].reason, 'account first exhausted, reset unknown: ask the user once');
});

test('pruning keeps the ten newest unanswered changes and can promote one after its session expires', (t) => {
  const { run, home, plan } = fixture(t, {}, { git: false });
  const file = path.join(home, 'compute-state.json');
  const notes = Array.from({ length: 12 }, (_, i) => {
    const when = new Date(Date.UTC(2026, 9, 1, i)).toISOString();
    return { at: when, what: `set worker --effort level-${i}`, saveAsked: null };
  });
  fs.writeFileSync(file, JSON.stringify({ schema: 1, lastHost: null, carryOver: [],
    sessions: { old: { startedAt: notes[0].at, touchedAt: notes.at(-1).at, patch: {}, notes } } }));
  run(['start', '--session', 'fresh', '--at', at]);
  assert.deepEqual(readJson(file).carryOver.map((n) => n.what), notes.slice(-10).map((n) => n.what));
  run(['promote', '--session', 'old', '--what', notes[4].what, '--scope', 'global', '--at', at]);
  assert.equal(readJson(plan).resources.worker.effort, 'level-4');
  assert.equal(readJson(file).carryOver.length, 9);
});

test('selective promotion replays the original settings, including quoted text and time windows', (t) => {
  const { run, home, plan } = fixture(t, { timezone: 'UTC' }, { git: false });
  const session = ['--scope', 'session', '--session', 'edits', '--at', at];
  const note = 'Use "small" batches\nthen review --effort with the user.';
  run(['set', 'worker', '--effort', 'high', '--windows', 'mon-fri 12:00-18:00; sun', '--note', note, '--may-edit', 'no', ...session]);
  run(['set', 'worker', '--effort', 'low', '--note=--later', ...session]);
  run(['schedule', 'add', 'day', '--when', 'mon-fri 12:00-18:00', '--prefer', 'worker', '--note', note, ...session]);
  run(['profile', 'use', 'frugal', '--until', '2026-11-28', ...session]);
  const state = readJson(path.join(home, 'compute-state.json')).sessions.edits;
  assert.deepEqual(Object.keys(state.notes[0]).sort(), ['at', 'saveAsked', 'what']);
  const replay = (i) => run(['promote', '--scope', 'global', '--session', 'edits', '--what', state.notes[i].what, '--at', '2026-12-01T12:00Z']);
  replay(0);
  assert.deepEqual(readJson(plan).resources.worker, { ...state.patch.resources.worker, effort: 'high', note });
  replay(2);
  assert.deepEqual(readJson(plan).schedules, state.patch.schedules);
  replay(3);
  assert.deepEqual(readJson(plan).profile, state.patch.profile);
  replay(1);
  assert.equal(readJson(plan).resources.worker.note, '--later');
  run(['promote', '--decline', '--session', 'edits', '--what', state.notes[1].what, '--at', at]);
  replay(1);
  assert.equal(readJson(path.join(home, 'compute-state.json')).sessions.edits.notes[1].saveAsked, 'global');
});

test('vendor filters keep auto and vendorless seats', (t) => {
  const seat = { tier: 'top', model: 'lead', effort: 'high' };
  const { run } = fixture(t, { constraints: { onlyVendors: ['openai'], inHouseOnly: true },
    seats: { internal: seat, allowed: { ...seat, vendor: 'openai' }, denied: { ...seat, vendor: 'other' } },
    hosts: { h: { roles: { principal: ['auto:top:high', 'internal', 'allowed', 'denied'] } } } });
  const result = run(['resolve', '--host', 'h', '--role', 'principal']);
  assert.deepEqual(result.candidates.map((c) => c.id ?? c.kind), ['auto', 'internal', 'allowed']);
  assert.deepEqual(result.excluded, [{ id: 'denied', reason: 'denied by constraint' }]);
});

test('host home checks apply to explicit host routes', (t) => {
  const { run, draft } = fixture(t, { resources: { worker }, routing: { bulk: ['worker'] } });
  const file = draft({ hosts: { h: { home: ['openai'] } } });
  run(['plan', 'apply', '--scope', 'project', '--from', file]);
  run(['plan', 'check', '--from', file]);
  for (const key of ['routing', 'roles']) {
    const file = draft({ hosts: { h: { [key]: { bulk: ['worker'] } } } });
    const report = run(['plan', 'check', '--from', file], 3);
    assert.ok(report.errors.some((e) => e.includes('home-vendor')));
    const applied = run(['plan', 'apply', '--scope', 'project', '--from', file]);
    assert.ok(applied.warnings.some((e) => e.includes('home-vendor')));
  }
});

test('partial apply warns about untouched legacy rows', (t) => {
  const { run, draft, plan } = fixture(t, { resources: { 'old.row': { model: 'legacy' } }, routing: { review: ['absent'] } });
  const apply = (cfg, status = 0) => run(['plan', 'apply', '--scope', 'global', '--from', draft(cfg)], status);
  const result = apply({ resources: { old: worker } });
  assert.ok(result.warnings.some((e) => e.includes('resources.old.row.effort')));
  assert.ok(result.warnings.some((e) => e.includes('routing.review: unknown resource absent')));
  const bytes = fs.readFileSync(plan);
  for (const cfg of [{ resources: { 'old.row': { note: 'updated' } } }, { routing: { review: ['absent'] } },
    { resources: { old: { account: 'missing' } } }, { hosts: { h: { roles: { principal: ['missing'] } } } }]) {
    apply(cfg, 3);
    assert.deepEqual(fs.readFileSync(plan), bytes);
  }
  assert.ok(run(['plan', 'check', '--from', draft({})], 3).errors.some((e) => e.includes('resources.old.row.effort')));
});

test('disjoint allowlists remain visible in JSON', (t) => {
  const { run } = fixture(t, { hosts: { h: { constraints: { onlyVendors: ['other'] } } },
    resources: { worker }, constraints: { onlyVendors: ['openai'] } });
  for (const args of [['show'], ['start'], ['resolve', '--role', 'bulk']]) {
    const result = run([...args, '--host', 'h']);
    assert.equal(result.constraints.noVendorsAllowed, true);
    assert.deepEqual(result.constraints.onlyVendors, []);
    if (result.say) assert.ok(result.say.some((s) => /no vendors/i.test(s)));
    if (result.excluded) assert.equal(result.excluded[0].reason, 'denied by constraint');
  }
});

test('answered overrides stop repeat prompts', (t) => {
  const { run } = fixture(t, { hosts: { h: {} } });
  const prompts = () => run(['start', '--host', 'h', '--session', 'observer', '--at', at]).ask.map((q) => q.id);
  for (const key of ['one', 'two']) run(['profile', 'use', 'frugal', '--scope', 'session', '--session', key, '--at', at]);
  assert.ok(prompts().includes('repeat-override'));
  run(['promote', '--all', '--decline', '--session', 'one', '--at', at]);
  assert.ok(!prompts().includes('repeat-override'));
  run(['promote', '--all', '--scope', 'project', '--session', 'two', '--at', at]);
  assert.ok(!prompts().includes('unsaved-overrides'));
});

test('repeat prompts count pending carry-over from older state files', (t) => {
  const { run } = fixture(t, { hosts: { h: {} } });
  run(['profile', 'use', 'frugal', '--scope', 'session', '--session', 'current', '--at', at]);
  const start = () => run(['start', '--host', 'h', '--session', 'current', '--at', at]);
  const file = start().session.file;
  const state = readJson(file);
  state.carryOver = [{ at, session: 'earlier', what: 'profile use frugal', saveAsked: 'session' }];
  fs.writeFileSync(file, JSON.stringify(state));
  assert.ok(!start().ask.some((q) => ['repeat-override', 'unsaved-overrides'].includes(q.id)));
  delete state.carryOver[0].saveAsked;
  fs.writeFileSync(file, JSON.stringify(state));
  assert.ok(start().ask.some((q) => q.id === 'repeat-override'));
});

test('empty served accounts explain the exclusion', (t) => {
  const { run } = fixture(t, { resources: { worker }, hosts: { h: { serves: { codex: { accounts: [] } } } } });
  const result = run(['resolve', '--host', 'h', '--role', 'bulk']);
  assert.deepEqual(result.excluded, [{ id: 'worker', reason: 'no account served for team codex on this host' }]);
});

test('pre-start overrides leave host unobserved', (t) => {
  const { run, env } = fixture(t, { hosts: { h: {} } });
  env.T3CODE_THREAD_ID = 'synthetic';
  const prior = run(['start', '--host', 'h', '--session', 'prior']);
  run(['profile', 'use', 'frugal', '--scope', 'session', '--session', 'fresh']);
  const observed = readJson(prior.session.file).sessions.fresh.host;
  const current = run(['start', '--host', 'h', '--session', 'fresh']);
  assert.deepEqual([observed, current.host.change], [null, 'same']);
});

test('initial setup skips preference review', (t) => {
  const { run } = fixture(t, {});
  const result = run(['start']);
  assert.equal(result.needsInit, true);
  assert.ok(!result.ask.some((q) => q.id === 'preferences-review'));
});

test('promotion requires one selector', (t) => {
  const { run, plan } = fixture(t, { hosts: { h: {} } });
  run(['profile', 'use', 'frugal', '--scope', 'session', '--session', 's']);
  const bytes = fs.readFileSync(plan);
  for (const target of [['--scope', 'global'], ['--decline']]) {
    for (const selection of [[], ['--all', '--what', 'profile use frugal']]) {
      run(['promote', '--session', 's', ...target, ...selection], 1);
    }
  }
  assert.deepEqual(fs.readFileSync(plan), bytes);
});

test('explicit host reports detected evidence separately', (t) => {
  const { run, env } = fixture(t, { hosts: { chosen: {} } });
  env.T3CODE_THREAD_ID = 'synthetic';
  const result = run(['start', '--host', 'chosen']);
  assert.equal(result.host.id, 'chosen');
  assert.deepEqual(result.host.evidence, []);
  assert.deepEqual(result.host.detected, { id: 't3-code', evidence: ['T3CODE_THREAD_ID'] });
});

test('batches use in-role accounts before outside-role fallbacks', (t) => {
  const { run } = fixture(t, { resources: { worker: { ...worker, fallback: ['backup'] },
    backup: { ...worker, team: 'alternate', roles: ['review'] } }, hosts: { h: { serves } },
    accounts: { first: account('free'), second: account('free') } });
  const batch = () => run(['resolve', '--role', 'bulk', '--host', 'h', '--profile', 'load-balance', '--count', '4']).assignments;
  assert.deepEqual(batch().map((a) => a.account), ['first', 'second', 'first', 'second']);
  run(['set', 'worker', '--enabled', 'no', '--scope', 'global']);
  assert.deepEqual(batch().map((a) => a.id), Array(4).fill('backup'));
});

test('pick keeps in-role candidates ahead of cheaper or fresher fallbacks', (t) => {
  const { run } = fixture(t, { resources: { worker: { ...worker, fallback: ['backup'] },
    backup: { ...worker, team: 'alternate', roles: ['review'], cost: 'free' } }, hosts: { h: { serves } },
    accounts: { first: account('subscription'), second: account('subscription') } });
  const pick = (profile) => run(['resolve', '--role', 'bulk', '--host', 'h', '--profile', profile]).pick.id;
  assert.equal(pick('frugal'), 'worker');
  for (const id of ['first', 'second']) run(['account', 'quota', id, '--state', 'low']);
  const lb = run(['resolve', '--role', 'bulk', '--host', 'h', '--profile', 'load-balance', '--count', '1']);
  assert.equal(lb.pick.id, 'worker');
  assert.equal(lb.assignments[0].id, lb.pick.id);
});

test('preferences merge by latest date and project interval', (t) => {
  const { run, draft } = fixture(t, { hosts: { h: {} }, review: { preferences: { lastConfirmed: '2026-11-24',
    lastAsked: '2026-11-22', snoozeUntil: '2026-11-27', everyDays: 30 } } });
  const file = draft({ review: { preferences: { lastConfirmed: '2026-10-24', lastAsked: '2026-11-25', snoozeUntil: null, everyDays: 7 } } });
  run(['plan', 'apply', '--from', file, '--scope', 'project']);
  const result = run(['start', '--at', at]).review.preferences;
  assert.deepEqual(result, { lastConfirmed: '2026-11-24', snoozeUntil: '2026-11-27', everyDays: 7, due: false });
});

test('session vendor denials narrow effective routing', (t) => {
  const { run } = fixture(t, { constraints: { denyVendors: ['alpha'] },
    resources: { a: { ...worker, vendor: 'alpha' }, b: { ...worker, vendor: 'bravo' }, c: { ...worker, vendor: 'charlie' } } });
  const { file } = run(['start', '--session', 's']).session;
  const state = readJson(file);
  state.sessions.s.patch.constraints = { denyVendors: ['bravo'] };
  fs.writeFileSync(file, JSON.stringify(state));
  const result = run(['resolve', '--session', 's', '--role', 'bulk']);
  assert.deepEqual(result.constraints.denyVendors, ['alpha', 'bravo']);
  assert.deepEqual(result.excluded, ['a', 'b'].map((id) => ({ id, reason: 'denied by constraint' })));
  assert.deepEqual(result.candidates.map((c) => c.id), ['c']);
});

test('performance preserves route and account order', (t) => {
  const { run } = fixture(t, { accounts: { first: account('free'), second: account('free') }, resources: { a: worker, b: worker },
    hosts: { h: { serves, routing: { bulk: ['b', 'a'] } } } });
  const result = run(['resolve', '--host', 'h', '--role', 'bulk', '--profile', 'performance']);
  assert.deepEqual(result.candidates.map((c) => [c.id, c.account]), [
    ['b', 'first'], ['b', 'second'], ['a', 'first'], ['a', 'second']]);
});

test('start reports observed wrapper, session host changes and notices', (t) => {
  const { run, env, home } = fixture(t, { hosts: { 't3-code': { serves: {} }, alternate: {} } });
  const start = (...args) => run(['start', '--at', at, ...args]);
  assert.equal(start('--session', 'undetected').host.change, 'unknown');
  env.T3CODE_THREAD_ID = 'synthetic';
  env.CLAUDECODE = '1';
  fs.writeFileSync(path.join(home, 'harness-t3-code.md'), 'fixture');
  const wrapper = start('--session', 'wrapper');
  assert.equal(wrapper.host.id, 't3-code');
  assert.equal(wrapper.host.runtime, 'claude-code');
  assert.equal(wrapper.host.plan, 'present');
  assert.ok(wrapper.say.some((s) => s.includes('Host t3-code (changed)')));
  assert.ok(wrapper.say.some((s) => s.includes('Model review is due')));
  assert.ok(wrapper.say.some((s) => s.includes('ranking is stale')));
  assert.ok(wrapper.say.some((s) => s.includes('supersedes harness-t3-code.md')));
  start('--session', 'moved', '--host', 'alternate');
  start('--session', 'wrapper');
  const moved = start('--session', 'moved');
  assert.equal(moved.host.previous.id, 't3-code');
  assert.equal(moved.host.change, 'changed');
  assert.ok(start('--session', 'moved').say.some((s) => s.includes('Host t3-code (same)')));
  assert.ok(start('--session', 'moved', '--runtime', 'other').say.some((s) => s.includes('Host t3-code (runtime-changed)')));
});

test('show reads host-only plans without rewriting session state', (t) => {
  const host = { name: 'Local', scenario: 'harness', route: 'host-switch' };
  const { run } = fixture(t, { hosts: { h: host } });
  const { file } = run(['start', '--session', 's', '--host', 'h']).session;
  fs.utimesSync(file, 1000, 1000);
  const before = fs.statSync(file), bytes = fs.readFileSync(file);
  const result = run(['show', '--session', 's', '--host', 'h']);
  assert.equal(result.needsInit, false);
  assert.deepEqual(result.effectiveHost, host);
  const after = fs.statSync(file);
  assert.deepEqual([after.ino, after.mtimeMs, fs.readFileSync(file)], [before.ino, before.mtimeMs, bytes]);
});

test('scope merges keep host teams, newest quota instants and newest preference dates', () => {
  const global = { hosts: { h: { name: 'Original', home: ['v'], roles: { principal: ['a'] }, serves: { a: { strategy: 'fixed' }, b: { strategy: 'spread' } } } },
    accountQuota: { a: { state: 'low', checked: '2026-11-25T08:00:00Z' }, b: { state: 'ok', checked: '2026-11-24T08:00:00Z' } },
    review: { preferences: { lastConfirmed: '2026-11-25', lastAsked: '2026-11-26', snoozeUntil: null } } };
  const project = { hosts: { h: { name: 'Project', roles: { runner: ['b'] }, serves: { a: { strategy: 'spread' } } } },
    accountQuota: { a: { state: 'ok', checked: '2026-11-25T09:00:00+03:00' }, b: { state: 'low', checked: '2026-11-25T07:00:00Z' } },
    review: { preferences: { lastConfirmed: null, lastAsked: '2026-11-24', snoozeUntil: '2026-11-30', everyDays: 4 } } };
  const eff = mergeConfigs(global, project);
  assert.deepEqual(eff.hosts.h, { name: 'Project', home: ['v'], roles: { runner: ['b'] }, serves: { a: { strategy: 'spread' }, b: { strategy: 'spread' } } });
  assert.deepEqual(eff.accountQuota, { a: global.accountQuota.a, b: project.accountQuota.b });
  assert.deepEqual(eff.review.preferences, { lastConfirmed: '2026-11-25', lastAsked: '2026-11-26', snoozeUntil: '2026-11-30', everyDays: 4 });
});

test('plan validation names invalid resource fields and built-in profile names', (t) => {
  const { run, draft } = fixture(t, {});
  const report = run(['plan', 'check', '--from', draft({ resources: { worker: { ...worker, cost: 'rare', account: 5 } },
    profiles: { balanced: { extends: 'frugal' } } })], 3);
  for (const key of ['resources.worker.cost', 'resources.worker.account', 'profiles.balanced']) {
    assert.ok(report.errors.some((e) => e.startsWith(key + ':')), key);
  }
});

test('session writes require a key and ordinary writes stamp rev two', (t) => {
  const { run, plan, root } = fixture(t, {});
  for (const cmd of [['set', 'worker', '--effort', 'high'], ['route', 'bulk', 'worker'],
    ['schedule', 'add', 'day', '--when', 'mon', '--prefer', 'worker']]) {
    run([...cmd, '--scope', 'session'], 1);
  }
  assert.equal(fs.existsSync(path.join(root, '.agent-team', 'compute-state.json')), false);
  run(['set', 'worker', '--effort', 'high', '--scope', 'global']);
  assert.equal(readJson(plan).rev, 2);
});

test('strict plan check warns on missing in-house fallback and shared review vendor', (t) => {
  const { run, draft } = fixture(t, {});
  const result = run(['plan', 'check', '--from', draft({ resources: { edit: worker, reviewer: { ...worker, roles: ['review'] } } })]);
  assert.ok(result.warnings.some((e) => e.includes('resources.edit.fallback never reaches an in-house: entry')));
  assert.ok(result.warnings.some((e) => e.includes('review and edit candidates all share vendor openai')));
});
