import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  UsageError, parseArgs, parseWhen, matchesWindow, mergeConfigs, resolveRole,
  reviewStatus, summarizeUsage, normalizeModelId, modelFamily, checkModels,
  readAvailable, validateConfig, extendsModel, pastBound,
} from '../skills/subagent-team/scripts/compute-config.mjs';
import { SCRIPTS, makeTempDir, removeDir, readJson, runScript } from './helpers/fakes.mjs';

const AT = '2026-11-26T12:00:00Z';

let tmp;
before(() => { tmp = fs.realpathSync(makeTempDir('compute-config-test-')); });
after(() => removeDir(tmp));

describe('compute-config: parseArgs', () => {
  test('help and unknown command', () => {
    assert.deepEqual(parseArgs([]), { help: true });
    assert.throws(() => parseArgs(['bogus']), UsageError);
  });

  test('config writes require explicit scope and usage commands default to global', () => {
    for (const args of [
      ['set', 'worker'], ['init'], ['route', 'bulk', 'worker'],
      ['schedule', 'remove', 'night'], ['reviewed'],
    ]) {
      assert.throws(() => parseArgs(args), { constructor: UsageError, message: /--scope/ });
    }
    assert.equal(parseArgs(['quota', 'worker', '--state', 'low']).scope, 'global');
    assert.equal(parseArgs(['record', 'worker', '--outcome', 'accepted']).scope, 'global');
  });

  test('validates resource id, quota state and usage outcome', () => {
    assert.throws(() => parseArgs(['set', '../worker', '--scope', 'global']), { constructor: UsageError, message: /resource id/ });
    assert.throws(() => parseArgs(['quota', 'worker', '--state', 'empty']), { constructor: UsageError, message: /--state/ });
    assert.throws(() => parseArgs(['record', 'worker', '--outcome', 'done']), { constructor: UsageError, message: /--outcome/ });
  });

  test('parses edit permission and clears a routing order with a dash', () => {
    assert.equal(parseArgs(['set', 'worker', '--scope', 'global', '--may-edit', 'yes']).mayEdit, true);
    assert.equal(parseArgs(['route', 'bulk', '-', '--scope', 'global']).order, null);
  });

  test('schedule add requires a window and a preference or avoidance list', () => {
    const args = ['schedule', 'add', 'night', '--scope', 'global'];
    assert.throws(() => parseArgs([...args, '--prefer', 'worker']), { constructor: UsageError, message: /--when/ });
    assert.throws(() => parseArgs([...args, '--when', 'sat,sun']), { constructor: UsageError, message: /--prefer or --avoid/ });
    assert.deepEqual(parseArgs([...args, '--when', 'sat,sun', '--prefer', 'worker']).prefer, ['worker']);
    assert.deepEqual(parseArgs([...args, '--when', 'sat,sun', '--avoid', 'worker']).avoid, ['worker']);
  });

  test('check-models requires an availability list', () => {
    assert.throws(() => parseArgs(['check-models']), { constructor: UsageError, message: /--available/ });
  });
});

describe('compute-config: time windows', () => {
  test('parseWhen reads hours, time zone, date and day lists in calendar order', () => {
    assert.deepEqual(parseWhen('mon-fri 22:00-08:00 tz=Asia/Shanghai until=2026-11-30'), {
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      hours: '22:00-08:00',
      tz: 'Asia/Shanghai',
      until: '2026-11-30',
    });
    assert.deepEqual(parseWhen('fri-mon').days, ['sun', 'mon', 'fri', 'sat']);
    assert.deepEqual(parseWhen('sat,sun').days, ['sun', 'sat']);
  });

  test('parseWhen rejects a bad token, an unknown zone and equal start and end', () => {
    for (const spec of ['next-week', 'tz=Mars/Olympus', '08:00-08:00']) {
      assert.throws(() => parseWhen(spec), UsageError, spec);
    }
  });

  test('matchesWindow checks normal and overnight hours with an exclusive end', () => {
    const daytime = { hours: '09:00-17:00', tz: 'UTC' };
    assert.equal(matchesWindow(daytime, new Date(AT)), true);
    assert.equal(matchesWindow(daytime, new Date('2026-11-26T17:00:00Z')), false);

    const overnight = { hours: '22:00-08:00', tz: 'Asia/Shanghai' };
    assert.equal(matchesWindow(overnight, new Date('2026-11-26T15:30:00Z')), true); // 23:30 local
    assert.equal(matchesWindow(overnight, new Date('2026-11-26T23:59:00Z')), true); // 07:59 local
    assert.equal(matchesWindow(overnight, new Date('2026-11-27T00:00:00Z')), false); // 08:00 local
  });

  test('matchesWindow uses the local weekday and includes the whole until date', () => {
    const friday = { days: ['fri'], tz: 'Asia/Shanghai' };
    assert.equal(matchesWindow(friday, new Date('2026-11-26T15:59:59Z')), false);
    assert.equal(matchesWindow(friday, new Date('2026-11-26T16:00:00Z')), true);

    const deadline = { until: '2026-11-30', tz: 'Asia/Shanghai' };
    assert.equal(matchesWindow(deadline, new Date('2026-11-30T15:59:59Z')), true);
    assert.equal(matchesWindow(deadline, new Date('2026-11-30T16:00:00Z')), false);
  });

  test('matchesWindow compares an ISO from bound as an instant', () => {
    const window = { from: '2026-11-26T20:00:00+08:00', tz: 'UTC' };
    assert.equal(matchesWindow(window, new Date('2026-11-26T11:59:59Z')), false);
    assert.equal(matchesWindow(window, new Date(AT)), true);
  });
});

test('mergeConfigs merges resource fields, replaces routing and schedules, and keeps newer quota', () => {
  const global = {
    resources: { worker: { team: 'codex', model: 'gpt-6.1-sol', mayEdit: true } },
    routing: { bulk: ['worker', 'backup'], review: ['backup'] },
    schedules: [{ id: 'night', prefer: ['worker'] }, { id: 'weekend', avoid: ['backup'] }],
    quota: {
      worker: { state: 'low', checked: '2026-11-26T10:00:00Z' },
      backup: { state: 'low', checked: '2026-11-26T09:00:00Z' },
    },
  };
  const project = {
    resources: { worker: { model: 'gpt-6.2-sol', mayEdit: false } },
    routing: { bulk: ['backup'] },
    schedules: [{ id: 'night', prefer: ['backup'] }],
    quota: {
      worker: { state: 'ok', checked: '2026-11-26T09:00:00Z' },
      backup: { state: 'ok', checked: '2026-11-26T10:00:00Z' },
    },
  };
  const merged = mergeConfigs(global, project);
  assert.deepEqual(merged.resources.worker, { team: 'codex', model: 'gpt-6.2-sol', mayEdit: false });
  assert.equal(merged.sources.worker, 'project+global');
  assert.deepEqual(merged.routing, { bulk: ['backup'], review: ['backup'] });
  assert.deepEqual(merged.schedules, [
    { id: 'night', prefer: ['backup'], scope: 'project' },
    { id: 'weekend', avoid: ['backup'], scope: 'global' },
  ]);
  assert.deepEqual(merged.quota, { worker: global.quota.worker, backup: project.quota.backup });
});

test('mergeConfigs compares quota checked timestamps with different UTC offsets as instants', () => {
  const g = { schema: 1, quota: { x: { state: 'low', checked: '2026-11-26T11:00:00Z' } } };
  const p = { schema: 1, quota: { x: { state: 'ok', checked: '2026-11-26T18:00:00+08:00' } } };
  assert.equal(mergeConfigs(g, p).quota.x.state, 'low', '11:00Z is later than 10:00Z');
  assert.equal(mergeConfigs(p, g).quota.x.state, 'low');
});

function resolve(config, role = 'bulk') {
  return resolveRole(mergeConfigs({ ...config, timezone: 'UTC' }, null), role, new Date(AT));
}

describe('compute-config: resolveRole', () => {
  test('explicit routing wins, otherwise matching roles follow declaration order', () => {
    const resources = { zebra: { roles: ['bulk'] }, reviewer: { roles: ['review'] }, alpha: { roles: ['bulk'] } };
    assert.deepEqual(resolve({ resources }).candidates.map(({ id }) => id), ['zebra', 'alpha']);
    const routed = resolve({ resources, routing: { bulk: ['alpha', 'zebra'] } });
    assert.deepEqual(routed.candidates.map(({ id }) => id), ['alpha', 'zebra']);
    assert.equal(routed.pick.id, 'alpha');
  });

  test('active schedule prefers and avoids resources while schedules for other roles are ignored', () => {
    const result = resolve({
      resources: { first: { roles: ['bulk'] }, avoided: { roles: ['bulk'] }, preferred: { roles: ['bulk'] } },
      schedules: [
        { id: 'daytime', when: { hours: '09:00-17:00' }, prefer: ['preferred'], avoid: ['avoided'], roles: ['bulk'] },
        { id: 'review-only', when: { hours: '09:00-17:00' }, prefer: ['first'], avoid: ['preferred'], roles: ['review'] },
      ],
    });
    assert.deepEqual(result.activeSchedules, ['daytime']);
    assert.deepEqual(result.candidates.map(({ id }) => id), ['preferred', 'first']);
    assert.equal(result.pick.via, 'schedule daytime');
    assert.match(result.excluded.find(({ id }) => id === 'avoided')?.reason ?? '', /daytime/);
  });

  test('fallbacks are breadth-first and deduplicated, with provenance and role flags', () => {
    const result = resolve({
      resources: {
        first: { roles: ['bulk'], fallback: ['a', 'shared', 'in-house:low'] },
        second: { roles: ['bulk'], fallback: ['b', 'shared', 'in-house:mid:high'] },
        a: { roles: ['review'], fallback: ['deep'] },
        shared: { roles: ['bulk'] },
        b: { roles: ['bulk'], fallback: ['deep', 'first'] },
        deep: { roles: ['bulk'] },
      },
      routing: { bulk: ['first', 'second'] },
    });
    assert.deepEqual(result.candidates.map(({ id }) => id), ['first', 'second', 'a', 'shared', 'b', 'deep']);
    assert.deepEqual(result.candidates.slice(2).map(({ via }) => via), [
      'fallback of first', 'fallback of first', 'fallback of second', 'fallback of a',
    ]);
    assert.ok(result.candidates[2].flags.some((flag) => /outside its roles/.test(flag)));
    assert.equal(result.inHouse, 'in-house:mid:high');
    assert.match(resolve({ resources: { reader: { roles: ['review'] } } }, 'review').inHouse, /senior review/);
  });

  test('excludes disabled and out-of-window resources and allows review-only resources for review', () => {
    const config = {
      resources: {
        disabled: { roles: ['bulk'], enabled: false },
        reader: { roles: ['bulk', 'review'], mayEdit: false },
        overnight: { roles: ['bulk'], windows: [{ hours: '22:00-08:00' }] },
        editor: { roles: ['bulk'], mayEdit: true },
      },
    };
    const bulk = resolve(config);
    assert.deepEqual(bulk.candidates.map(({ id }) => id), ['editor']);
    const reasons = Object.fromEntries(bulk.excluded.map(({ id, reason }) => [id, reason]));
    assert.match(reasons.disabled, /disabled/);
    assert.match(reasons.reader, /mayEdit/);
    assert.match(reasons.overnight, /outside its windows/);
    assert.equal(resolve(config, 'review').pick.id, 'reader');
  });

  test('quota excludes pending or unknown resets and flags low quota and passed resets', () => {
    const result = resolve({
      resources: {
        future: { roles: ['bulk'] }, past: { roles: ['bulk'] },
        unknown: { roles: ['bulk'] }, low: { roles: ['bulk'] },
      },
      quota: {
        future: { state: 'exhausted', resets: '2026-11-26T13:00:00Z' },
        past: { state: 'exhausted', resets: '2026-11-26T11:00:00Z' },
        unknown: { state: 'exhausted', resets: 'unknown' },
        low: { state: 'low' },
      },
    });
    assert.deepEqual(result.candidates.map(({ id }) => id), ['past', 'low']);
    assert.ok(result.candidates[0].flags.some((flag) => /probe/.test(flag)));
    assert.ok(result.candidates[1].flags.some((flag) => /low/.test(flag)));
    const reasons = Object.fromEntries(result.excluded.map(({ id, reason }) => [id, reason]));
    assert.match(reasons.future, /quota exhausted until/);
    assert.match(reasons.unknown, /ask the user/);
  });
});

test('reviewStatus is due without a review and becomes due at the configured cadence', () => {
  const at = new Date(AT);
  assert.equal(reviewStatus({}, at, 'UTC').due, true);
  assert.equal(reviewStatus({ lastReviewed: '2026-11-20', everyDays: 7 }, at, 'UTC').due, false);
  assert.equal(reviewStatus({ lastReviewed: '2026-11-19', everyDays: 7 }, at, 'UTC').due, true);
});

test('summarizeUsage counts jobs, outcomes and local hours within sinceDays', () => {
  const rows = [
    { resource: 'worker', at: '2026-11-24T11:59:59Z', outcome: 'accepted' },
    { resource: 'worker', at: '2026-11-24T12:00:00Z', outcome: 'rework' },
    { resource: 'worker', at: '2026-11-25T15:00:00Z', outcome: 'in-house' },
    { resource: 'worker', at: '2026-11-25T16:00:00Z', outcome: 'accepted' },
    { resource: 'worker', at: '2026-11-25T16:30:00Z', outcome: 'accepted' },
    { resource: 'worker', at: '2026-11-25T23:00:00Z', outcome: 'quota' },
    { resource: 'worker', at: '2026-11-26T00:00:00Z', outcome: 'failed' },
    { resource: 'backup', at: '2026-11-26T00:00:00Z', outcome: 'failed' },
  ];
  const usage = summarizeUsage(rows, { sinceDays: 2, now: new Date(AT), tz: 'Asia/Shanghai' });
  assert.equal(usage.entries, 7);
  assert.equal(usage.resources.worker.jobs, 6);
  assert.deepEqual(usage.resources.worker.outcomes, { rework: 1, 'in-house': 1, accepted: 2, quota: 1, failed: 1 });
  assert.deepEqual(usage.resources.worker.byHour, { '00': 2, '07': 1, '08': 1, '20': 1, '23': 1 });
  assert.equal(usage.resources.worker.firstPassRate, 0.5);
  assert.equal(usage.resources.backup.jobs, 1);
  assert.deepEqual(usage.resources.backup.outcomes, { failed: 1 });
  assert.equal(usage.resources.backup.firstPassRate, null);
});

test('summarizeUsage sets quality flags according to the last content outcomes', () => {
  const rows = Object.entries({
    repeated: ['rework', 'quota', 'rework', 'failed'],
    'taken-back': ['in-house', 'failed'],
    accepted: ['rework', 'quota', 'accepted', 'failed'],
  }).flatMap(([resource, outcomes]) => outcomes.map((outcome, i) => ({
    resource, outcome, at: `2026-11-26T0${i}:00:00Z`,
  })));
  const { resources } = summarizeUsage(rows, { now: new Date(AT), tz: 'UTC' });
  assert.match(resources.repeated.qualityFlag, /content failures/);
  assert.match(resources['taken-back'].qualityFlag, /in-house/);
  assert.equal(resources.accepted.qualityFlag, null);
});

test('normalizeModelId and modelFamily normalize model variants and split version numbers', () => {
  assert.equal(normalizeModelId('openai/gpt-6.2-sol'), 'gpt-6-2-sol');
  assert.equal(normalizeModelId('Claude Opus 5.5 (Max)'), 'claude-opus-5-5');
  assert.equal(normalizeModelId('gemini-4-argon-medium'), 'gemini-4-argon');
  assert.deepEqual(modelFamily('gpt-6.2-sol'), { family: 'gpt-sol', version: [6, 2] });
});

test('checkModels deduplicates ranking sources and finds newer available models', () => {
  const ranking = {
    fetchedAt: AT,
    vendors: { openai: [{ id: 'openai/gpt-7-sol' }] },
    arena: { models: [{ name: 'GPT-7 Sol (Max)', organization: 'openai', rank: 1 }] },
  };
  const config = mergeConfigs({ resources: { worker: { team: 'codex', model: 'gpt-6.1-sol' } } }, null);
  const codex = ['gpt-6.1-sol', 'gpt-6.2-sol'];
  const result = checkModels(config, ranking, { codex });
  assert.deepEqual(result.teams.codex.missing.map(({ normalized }) => normalized), ['gpt-7-sol']);
  assert.match(result.teams.codex.updateHint, /codex/i);
  assert.deepEqual(result.teams.codex.newer, [{ resource: 'worker', configured: 'gpt-6.1-sol', newer: 'gpt-6.2-sol' }]);
  assert.deepEqual(checkModels(config, ranking, { codex: [...codex, 'gpt-7-sol-high'] }).teams.codex.missing, []);
});

test('checkModels lists API variants of an offered model apart from missing models', () => {
  const ranking = { vendors: { openai: [{ id: 'openai/gpt-6.2-sol-pro' }, { id: 'openai/gpt-7-sol' }] } };
  const config = mergeConfigs({ resources: {} }, null);
  const { codex } = checkModels(config, ranking, { codex: ['gpt-6.2-sol'] }).teams;
  assert.deepEqual(codex.variants.map(({ normalized, variantOf }) => [normalized, variantOf]), [['gpt-6-2-sol-pro', 'gpt-6-2-sol']]);
  assert.deepEqual(codex.missing.map(({ normalized }) => normalized), ['gpt-7-sol']);
});

test('readAvailable reads text with comments and extra columns, and all JSON list forms', () => {
  const file = path.join(tmp, 'available');
  for (const contents of [
    '  # a comment\n\nmodel-a description\n  model-b extra columns\n',
    JSON.stringify(['model-a', 'model-b']),
    JSON.stringify([{ id: 'model-a' }, { id: 'model-b' }]),
    JSON.stringify({ models: [{ id: 'model-a' }, 'model-b'] }),
  ]) {
    fs.writeFileSync(file, contents);
    assert.deepEqual(readAvailable(file), ['model-a', 'model-b']);
  }
});

test('validateConfig reports an unsupported schema, bad tier and bad quota state', () => {
  const errors = validateConfig({ schema: 99, resources: { worker: { tier: 'fast' } }, quota: { worker: { state: 'empty' } } });
  assert.ok(errors.some((error) => /schema/.test(error)));
  assert.ok(errors.some((error) => /resource worker: tier/.test(error)));
  assert.ok(errors.some((error) => /quota worker: state/.test(error)));
});

function runGit(repo, env, args) {
  const result = spawnSync('git', args, { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
}

function cliFixture(name) {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const env = { SUBAGENT_TEAM_HOME: home, HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, env, ['init', '-q']);
  const run = (args, root = repo) => runScript(SCRIPTS.computeConfig, [...args, '--root', root], { cwd: root, env });
  return { repo, home, env, run };
}

describe('compute-config: CLI', () => {
  test('show reports that initialization is needed for an empty repo', () => {
    const { run } = cliFixture('show');
    const result = run(['show']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.needsInit, true);
  });

  test('global init refuses an existing config and --force replaces it', () => {
    const { run, home } = cliFixture('init');
    const args = ['init', '--scope', 'global'];
    const file = path.join(home, 'compute.json');
    const init = run(args);
    assert.equal(init.status, 0, init.stderr);
    assert.equal(init.json.file, file);
    assert.equal(run(args).status, 6);
    const set = run(['set', 'worker', '--scope', 'global', '--team', 'codex']);
    assert.equal(set.status, 0, set.stderr);
    assert.deepEqual(readJson(file).resources, { worker: { team: 'codex' } });
    const force = run([...args, '--force']);
    assert.equal(force.status, 0, force.stderr);
    assert.deepEqual(readJson(file).resources, {});
  });

  test('project set writes the config and adds one exclude entry across repeated writes', () => {
    const { run, repo } = cliFixture('project-set');
    const args = ['set', 'worker', '--scope', 'project', '--team', 'codex', '--roles', 'bulk'];
    const file = path.join(repo, '.agent-team', 'compute.json');
    const exclude = path.join(repo, '.git', 'info', 'exclude');
    for (let i = 0; i < 2; i++) {
      const result = run(args);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.json.file, file);
      assert.deepEqual(readJson(file).resources.worker, { team: 'codex', roles: ['bulk'] });
      assert.equal(fs.readFileSync(exclude, 'utf8').split('\n').filter((line) => line === '/.agent-team/').length, 1);
    }
  });

  test('paths in a git worktree reports the main checkout project directory', () => {
    const { run, repo, env } = cliFixture('worktree');
    runGit(repo, env, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-qm', 'init']);
    runGit(repo, env, ['worktree', 'add', '-q', '../wt']);
    const result = run(['paths'], path.join(path.dirname(repo), 'wt'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.project, path.join(repo, '.agent-team'));
  });

  test('quota defaults to global and excludes a resource with an unknown reset', () => {
    const { run, home } = cliFixture('quota');
    const set = run(['set', 'worker', '--scope', 'project', '--roles', 'bulk']);
    assert.equal(set.status, 0, set.stderr);
    const beforeQuota = run(['resolve', '--role', 'bulk', '--at', AT]);
    assert.equal(beforeQuota.status, 0, beforeQuota.stderr);
    assert.equal(beforeQuota.json.pick.id, 'worker');

    const quota = run(['quota', 'worker', '--state', 'exhausted']);
    assert.equal(quota.status, 0, quota.stderr);
    const entry = readJson(path.join(home, 'compute.json')).quota.worker;
    assert.equal(entry.state, 'exhausted');
    assert.equal(entry.resets, 'unknown');

    const resolved = run(['resolve', '--role', 'bulk', '--at', AT]);
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.deepEqual(resolved.json.candidates, []);
    assert.match(resolved.json.excluded.find(({ id }) => id === 'worker')?.reason ?? '', /reset unknown/);
  });

  test('record appends JSON lines and usage counts the recorded outcomes', () => {
    const { run, home } = cliFixture('usage');
    const set = run(['set', 'worker', '--scope', 'global', '--model', 'gpt-6.2-sol', '--roles', 'bulk']);
    assert.equal(set.status, 0, set.stderr);
    const recorded = [];
    for (const outcome of ['accepted', 'rework']) {
      const result = run(['record', 'worker', '--outcome', outcome]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.json.entry.resource, 'worker');
      assert.equal(result.json.entry.outcome, outcome);
      recorded.push(result.json.entry);
    }
    const lines = fs.readFileSync(path.join(home, 'compute-usage.jsonl'), 'utf8').trimEnd().split('\n');
    assert.deepEqual(lines.map((line) => JSON.parse(line)), recorded);

    const usage = run(['usage']);
    assert.equal(usage.status, 0, usage.stderr);
    assert.equal(usage.json.entries, 2);
    assert.equal(usage.json.resources.worker.jobs, 2);
    assert.deepEqual(usage.json.resources.worker.outcomes, { accepted: 1, rework: 1 });
  });

  test('reports missing config, unknown resource and corrupt config with their exit codes', () => {
    const { run, home } = cliFixture('errors');
    assert.equal(run(['resolve', '--role', 'bulk']).status, 2);
    const init = run(['init', '--scope', 'global']);
    assert.equal(init.status, 0, init.stderr);
    assert.equal(run(['remove', 'unknown', '--scope', 'global']).status, 5);
    fs.writeFileSync(path.join(home, 'compute.json'), '{broken');
    const show = run(['show']);
    assert.equal(show.status, 3, show.stderr);
    assert.match(show.json.error, /compute\.json.*not valid JSON/);
  });

  test('check-models warns about missing rankings and still reports newer models', () => {
    const { run, repo } = cliFixture('check-models');
    const set = run(['set', 'worker', '--scope', 'global', '--team', 'codex', '--model', 'gpt-6.1-sol']);
    assert.equal(set.status, 0, set.stderr);
    fs.writeFileSync(path.join(repo, 'available.txt'), 'gpt-6.1-sol\ngpt-6.2-sol\n');
    const result = run(['check-models', '--available', 'codex=available.txt']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.json.warning, /no ranking/);
    assert.deepEqual(result.json.teams.codex.newer, [{ resource: 'worker', configured: 'gpt-6.1-sol', newer: 'gpt-6.2-sol' }]);
  });
});

describe('compute-config: review regressions', () => {
  test('an avoided resource does not come back through another resource\'s fallback', () => {
    const r = resolve({
      resources: { a: { roles: ['bulk'] }, b: { roles: ['bulk'], fallback: ['a'] } },
      routing: { bulk: ['b'] },
      schedules: [{ id: 's1', when: { hours: '09:00-18:00', tz: 'UTC' }, avoid: ['a'] }],
    });
    assert.deepEqual(r.candidates.map(({ id }) => id), ['b']);
    assert.deepEqual(r.excluded, [{ id: 'a', reason: 'avoided by schedule s1' }]);
  });

  test('days of an overnight window are the days it starts on', () => {
    const w = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], hours: '22:00-08:00', tz: 'UTC' };
    assert.equal(matchesWindow(w, new Date('2026-11-27T23:00:00Z'), 'UTC'), true, 'Friday 23:00');
    assert.equal(matchesWindow(w, new Date('2026-11-28T03:00:00Z'), 'UTC'), true, 'Friday night, Saturday 03:00');
    assert.equal(matchesWindow(w, new Date('2026-11-30T03:00:00Z'), 'UTC'), false, 'Sunday night, Monday 03:00');
    assert.equal(matchesWindow(w, new Date('2026-11-24T03:00:00Z'), 'UTC'), true, 'Monday night');
  });

  test('times need an offset; a date alone is a local day in the plan\'s zone', () => {
    assert.throws(() => parseArgs(['resolve', '--role', 'bulk', '--at', '2026-11-23T00:00']), /offset/);
    assert.throws(() => parseArgs(['resolve', '--role', 'bulk', '--at', '2026-11-23']), /offset/);
    assert.throws(() => parseWhen('until=2026-11-23T00:00'), /offset/);
    assert.equal(parseArgs(['quota', 'x', '--state', 'exhausted', '--resets', '2026-11-30']).resets, '2026-11-30');
    const at = new Date('2026-11-29T17:00:00Z'); // 01:00 on the 30th in Shanghai
    assert.equal(pastBound('2026-11-30', at, 'Asia/Shanghai', 'start'), true);
    assert.equal(pastBound('2026-11-30', at, 'UTC', 'start'), false);
    assert.equal(pastBound('2026-11-29', at, 'UTC', 'end'), false);
    assert.equal(pastBound('2026-11-28', at, 'UTC', 'end'), true);
    assert.throws(() => parseArgs(['reviewed', '--scope', 'global', '--every-days', '0']), /positive/);
  });

  test('the newest review date wins across scopes', () => {
    const eff = mergeConfigs({ schema: 1, review: { lastReviewed: '2026-11-22', everyDays: 7 } }, { schema: 1, review: { lastReviewed: '2026-01-01', everyDays: 3 } });
    assert.deepEqual(eff.review, { lastReviewed: '2026-11-22', everyDays: 3 });
    assert.equal(reviewStatus({ lastReviewed: 'not a date' }).due, true);
  });

  test('model ids: v-prefixed versions, snapshot dates, variants versus versions', () => {
    assert.deepEqual(modelFamily('deepseek-v4.1-flash'), { family: 'deepseek-flash', version: [4, 1] });
    assert.deepEqual(modelFamily('deepseek-v5-flash'), { family: 'deepseek-flash', version: [5] });
    assert.deepEqual(modelFamily('gpt-5-2025-08-07'), { family: 'gpt', version: [5] });
    assert.equal(normalizeModelId('claude-opus-4-1-20250805-thinking-16k'), 'claude-opus-4-1');
    assert.equal(extendsModel('gpt-6-2-sol-pro', 'gpt-6-2-sol'), true);
    assert.equal(extendsModel('gpt-6-2', 'gpt-6'), false);
    const eff = mergeConfigs({ resources: { d: { team: 'opencode', model: 'deepseek/deepseek-v4.1-flash' }, g: { team: 'codex', model: 'gpt-5.2' } } }, null);
    const out = checkModels(eff, { vendors: { openai: [{ id: 'openai/gpt-6.2' }] } }, { opencode: ['deepseek/deepseek-v5-flash'], codex: ['gpt-5-2025-08-07', 'gpt-6'] });
    assert.deepEqual(out.teams.opencode.newer, [{ resource: 'd', configured: 'deepseek/deepseek-v4.1-flash', newer: 'deepseek/deepseek-v5-flash' }]);
    assert.deepEqual(out.teams.codex.newer, [{ resource: 'g', configured: 'gpt-5.2', newer: 'gpt-6' }]);
    assert.deepEqual(out.teams.codex.missing.map(({ normalized }) => normalized), ['gpt-6-2']);
    assert.deepEqual(out.teams.codex.variants, []);
  });

  test('validation catches null quota entries and bad schedules; quota needs a known resource', () => {
    assert.match(validateConfig({ schema: 1, quota: { x: null } }).join(';'), /quota x must be an object/);
    assert.match(validateConfig({ schema: 1, schedules: [{ id: 's', when: { tz: 'Mars/Base' }, prefer: 'a' }] }).join(';'), /unknown time zone.*prefer must be a list/);
    const { run, home } = cliFixture('review-regressions');
    assert.equal(run(['quota', 'nosuch', '--state', 'low']).status, 5);
    assert.equal(run(['set', 'a', '--scope', 'global', '--model', 'm', '--effort', 'high', '--roles', 'bulk']).status, 0);
    assert.equal(run(['quota', 'a', '--state', 'low']).status, 0);
    fs.writeFileSync(path.join(home, 'compute.json'), JSON.stringify({ schema: 1, resources: {}, quota: { x: null } }));
    assert.equal(run(['show']).status, 3);
  });

  test('quota or record alone does not count as an initialized plan', () => {
    const { run } = cliFixture('no-plan');
    assert.equal(run(['record', 'x', '--outcome', 'accepted']).status, 0);
    assert.equal(run(['show']).json.needsInit, true);
    assert.equal(run(['resolve', '--role', 'bulk']).status, 2);
  });
});
