import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, parseCodexConfig, extractModelIds, findAgyStaff, UsageError,
} from '../skills/cli-agent-delegation/scripts/doctor.mjs';
import { SCRIPTS, makeTempDir, removeDir, makeFakeBin, runScript } from './helpers/fakes.mjs';

let tmp;
let fakeCodex;
let fakeAgy;

before(() => {
  tmp = makeTempDir('doctor-test-');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fakeCodex = makeFakeBin(bin, 'codex', 'fake-codex.mjs');
  fakeAgy = makeFakeBin(bin, 'agy', 'fake-agy.mjs');
});

after(() => removeDir(tmp));

function newHome(name) {
  const home = path.join(tmp, name);
  fs.mkdirSync(home, { recursive: true });
  return home;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

function doctor(home, args = ['--json'], env = {}) {
  return runScript(SCRIPTS.doctor, args, {
    env: { HOME: home, CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: undefined, CODEX_BIN: fakeCodex, AGY_BIN: fakeAgy, ...env },
  });
}

const CONFIG_TOML = `# my codex config
model = "gpt-6.1-sol"
model_reasoning_effort = "high"  # thinks hard
approval_policy = "never"

[profiles.fast]
model = "gpt-6.1-mini"
model_reasoning_effort = "low"
`;

const MODELS_CACHE = {
  fetched_at: '2026-10-01T00:00:00Z',
  models: [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
      service_tiers: [{ id: 'priority' }], visibility: 'list' },
    { slug: 'gpt-6.1-mini' },
    { slug: 'internal-review', visibility: 'hide', service_tiers: [{ id: 'priority' }] },
    { id: 'gpt-6.1-sol' },
    { meta: { model: 'codex-max-2' } },
  ],
};

describe('doctor: pure helpers', () => {
  test('parseArgs', () => {
    assert.deepEqual(parseArgs([]), { json: false, help: false });
    assert.deepEqual(parseArgs(['--json']), { json: true, help: false });
    assert.throws(() => parseArgs(['--verbose']), UsageError);
  });

  test('parseCodexConfig reads only top-level keys', () => {
    assert.deepEqual(parseCodexConfig(CONFIG_TOML), { model: 'gpt-6.1-sol', reasoningEffort: 'high' });
    assert.deepEqual(parseCodexConfig('[profiles.x]\nmodel_reasoning_effort = "low"\n'), { model: null, reasoningEffort: null });
    assert.deepEqual(parseCodexConfig("model = 'o5'\n"), { model: 'o5', reasoningEffort: null });
    assert.deepEqual(parseCodexConfig(''), { model: null, reasoningEffort: null });
  });

  test('extractModelIds collects model ids, skips nested ids and hidden models, dedupes', () => {
    assert.deepEqual(extractModelIds(MODELS_CACHE), ['gpt-6.1-sol', 'gpt-6.1-mini', 'codex-max-2']);
    assert.deepEqual(extractModelIds(null), []);
  });

  test('findAgyStaff handles array and object shapes', () => {
    assert.deepEqual(
      findAgyStaff({ version: 2, plugins: { 'agy@agy-staff': [{ scope: 'user', installPath: '/p/agy' }] } }),
      { key: 'agy@agy-staff', installPath: '/p/agy' },
    );
    assert.deepEqual(findAgyStaff({ 'agy@agy-staff': { installPath: '/q' } }), { key: 'agy@agy-staff', installPath: '/q' });
    assert.deepEqual(findAgyStaff({ 'agy@agy-staff': [{}] }), { key: 'agy@agy-staff', installPath: null });
    assert.equal(findAgyStaff({ plugins: { 'other@market': [] } }), null);
    assert.equal(findAgyStaff(null), null);
  });
});

describe('doctor: end to end', () => {
  test('fully configured home (array-shaped plugins file)', () => {
    const home = newHome('full');
    write(path.join(home, '.codex', 'config.toml'), CONFIG_TOML);
    write(path.join(home, '.codex', 'models_cache.json'), MODELS_CACHE);
    write(path.join(home, '.codex', 'auth.json'), '{"secret":"DO-NOT-READ"}');
    const installPath = path.join(home, '.claude', 'plugins', 'cache', 'agy-staff', 'agy', '1.0.0');
    write(path.join(installPath, 'companion', 'agy-companion.mjs'), '// companion\n');
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      { version: 2, plugins: { 'agy@agy-staff': [{ scope: 'user', installPath, version: '1.0.0' }] } });

    const r = doctor(home);
    assert.equal(r.status, 0, r.stderr);
    const j = r.json;
    assert.equal(j.node, process.version);
    assert.equal(j.codex.present, true);
    assert.equal(j.codex.version, 'codex-cli 0.165.0');
    assert.equal(j.codex.home, path.join(home, '.codex'));
    assert.equal(j.codex.defaultModel, 'gpt-6.1-sol');
    assert.equal(j.codex.defaultEffort, 'high');
    assert.deepEqual(j.codex.cachedModels, ['gpt-6.1-sol', 'gpt-6.1-mini', 'codex-max-2']);
    assert.ok(j.codex.warnings.some((w) => /raw `codex exec` would inherit high/.test(w)));
    assert.equal(j.agy.present, true);
    assert.equal(j.agy.version, 'agy 1.4.2');
    assert.equal(j.agy.agyStaff.installed, true);
    assert.equal(j.agy.agyStaff.key, 'agy@agy-staff');
    assert.equal(j.agy.agyStaff.installPath, installPath);
    assert.equal(j.agy.agyStaff.companionExists, true);
    assert.ok(Array.isArray(j.recommendations));
    assert.ok(j.recommendations.some((x) => /agy-staff plugin installed/.test(x)));
    assert.doesNotMatch(r.stdout, /DO-NOT-READ/);
  });

  test('object-shaped plugins entry without companion; CODEX_HOME and CLAUDE_CONFIG_DIR honored', () => {
    const home = newHome('alt');
    const codexHome = path.join(tmp, 'alt-codex');
    const claudeDir = path.join(tmp, 'alt-claude');
    write(path.join(codexHome, 'config.toml'), 'model = "gpt-6.1-mini"\n');
    write(path.join(claudeDir, 'plugins', 'installed_plugins.json'),
      { 'agy@agy-staff': { installPath: path.join(tmp, 'missing-install') } });
    const r = doctor(home, ['--json'], { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeDir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.codex.home, codexHome);
    assert.equal(r.json.codex.defaultModel, 'gpt-6.1-mini');
    assert.equal(r.json.codex.defaultEffort, null);
    assert.deepEqual(r.json.codex.warnings, []);
    assert.equal(r.json.agy.agyStaff.installed, true);
    assert.equal(r.json.agy.agyStaff.companionExists, false);
    assert.ok(r.json.recommendations.some((x) => /reinstall/.test(x)));
  });

  test('nothing installed', () => {
    const home = newHome('empty');
    const r = doctor(home, ['--json'], { CODEX_BIN: path.join(tmp, 'no-codex'), AGY_BIN: path.join(tmp, 'no-agy') });
    assert.equal(r.status, 0, r.stderr);
    const j = r.json;
    assert.equal(j.codex.present, false);
    assert.equal(j.codex.version, null);
    assert.equal(j.codex.configExists, false);
    assert.deepEqual(j.codex.cachedModels, []);
    assert.equal(j.agy.present, false);
    assert.equal(j.agy.agyStaff.installed, false);
    assert.ok(j.recommendations.some((x) => /Codex CLI not found/.test(x)));
    assert.ok(j.recommendations.some((x) => /agy not found/.test(x)));
    assert.ok(j.recommendations.some((x) => x.includes(
      'agy-staff plugin not found: use agy-run.mjs, or install it: claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff')));
  });

  test('malformed files are handled gracefully', () => {
    const home = newHome('broken');
    write(path.join(home, '.codex', 'models_cache.json'), '{not json');
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), '[[[');
    const r = doctor(home);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.codex.modelsCacheExists, true);
    assert.deepEqual(r.json.codex.cachedModels, []);
    assert.ok(r.json.codex.warnings.some((w) => /cannot parse/.test(w)));
    assert.equal(r.json.agy.agyStaff.installed, false);
    assert.match(r.json.agy.agyStaff.error, /cannot parse/);
  });

  test('human-readable output with recommendations', () => {
    const home = newHome('human');
    write(path.join(home, '.codex', 'config.toml'), CONFIG_TOML);
    const r = doctor(home, []);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^node: v\d+/m);
    assert.match(r.stdout, /codex: found \(codex-cli 0\.165\.0\)/);
    assert.match(r.stdout, /default reasoning effort: high/);
    assert.match(r.stdout, /Recommendations:\n {2}- /);
  });

  test('--help and usage error', () => {
    assert.equal(runScript(SCRIPTS.doctor, ['--help']).status, 0);
    const r = runScript(SCRIPTS.doctor, ['--bogus']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown argument/);
  });
});
