import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, parseCodexConfig, extractModelIds, findAgyStaff, findCodexPlugin, latestTag, parseSemver, compareSemver, planUpgrades, UsageError,
} from '../skills/cli-agent-delegation/scripts/doctor.mjs';
import { SCRIPTS, makeTempDir, removeDir, makeFakeBin, runScript } from './helpers/fakes.mjs';

let tmp;
let fakeCodex;
let fakeAgy;
let fakeOpencode;

before(() => {
  tmp = makeTempDir('doctor-test-');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fakeCodex = makeFakeBin(bin, 'codex', 'fake-codex.mjs');
  fakeAgy = makeFakeBin(bin, 'agy', 'fake-agy.mjs');
  fakeOpencode = makeFakeBin(bin, 'opencode', 'fake-opencode.mjs');
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
    env: { HOME: home, CODEX_HOME: undefined, CLAUDE_CONFIG_DIR: undefined, CODEX_BIN: fakeCodex, AGY_BIN: fakeAgy, OPENCODE_BIN: fakeOpencode, FAKE_NO_ACP: undefined, ...env },
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
    assert.deepEqual(parseArgs([]), { json: false, help: false, checkUpdates: false });
    assert.deepEqual(parseArgs(['--json']), { json: true, help: false, checkUpdates: false });
    assert.equal(parseArgs(['--check-updates']).checkUpdates, true);
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
      { key: 'agy@agy-staff', installPath: '/p/agy', version: null },
    );
    assert.deepEqual(findAgyStaff({ 'agy@agy-staff': { installPath: '/q' } }), { key: 'agy@agy-staff', installPath: '/q', version: null });
    assert.deepEqual(findAgyStaff({ 'agy@agy-staff': [{}] }), { key: 'agy@agy-staff', installPath: null, version: null });
    assert.equal(findAgyStaff({ plugins: { 'other@market': [] } }), null);
    assert.equal(findAgyStaff(null), null);
  });

  test('findCodexPlugin tells the official plugin from forks', () => {
    assert.deepEqual(findCodexPlugin({ plugins: { 'codex@openai-codex': [{ installPath: '/p/codex' }] } }),
      { key: 'codex@openai-codex', installPath: '/p/codex', version: null, official: true });
    assert.equal(findCodexPlugin({ plugins: { 'codex@some-fork': [{}] } }).official, false);
    assert.equal(findCodexPlugin({ plugins: { 'agy@agy-staff': [{}], 'codexish@x': [{}] } }), null);
  });
});

describe('doctor: versions and upgrades', () => {
  test('latestTag picks the highest release tag', () => {
    assert.equal(latestTag('a\trefs/tags/v0.9.1\nb\trefs/tags/v0.10.0\nc\trefs/tags/v0.9.12\nd\trefs/tags/v1.0.0-rc\n'), '0.10.0');
    assert.equal(latestTag(''), null);
    assert.deepEqual(parseSemver('agy 1.5.14'), [1, 5, 14]);
    assert.ok(compareSemver([1, 5, 12], [1, 5, 9]) > 0);
  });

  test('planUpgrades only proposes, and every entry needs consent', () => {
    const none = planUpgrades({ agy: { present: false, agyStaff: { installed: false } } });
    assert.deepEqual(none, []);
    const old = planUpgrades({ agy: { present: true, semver: '1.4.9', acp: false, acpMinOk: false, recommendedOk: false, agyStaff: { installed: true, companionExists: true, updateAvailable: false } } });
    assert.equal(old.length, 1);
    assert.match(old[0].reason, /no official ACP server/);
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
    const codexPluginPath = path.join(home, '.claude', 'plugins', 'cache', 'openai-codex', 'codex', '1.0.6');
    write(path.join(codexPluginPath, 'scripts', 'codex-companion.mjs'), '// companion\n');
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      { version: 2, plugins: { 'agy@agy-staff': [{ scope: 'user', installPath, version: '1.0.0' }],
        'codex@openai-codex': [{ scope: 'user', installPath: codexPluginPath, version: '1.0.6' }] } });

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
    assert.equal(j.agy.agyStaff.version, '1.0.0');
    assert.equal(j.agy.acp, false);
    assert.equal(j.agy.acpMinOk, false);
    assert.ok(j.recommendations.some((x) => /^RISK: agy 1\.4\.2 has no official ACP server/.test(x) && /offer to run `agy update`/.test(x)));
    assert.ok(j.recommendations.some((x) => /agy-staff plugin installed \(1\.0\.0\): borrow its personas/.test(x) && /dispatch through agy-acp-run\.mjs/.test(x)));
    assert.deepEqual(j.upgrades.map((u) => [u.target, u.commands]), [['agy', ['agy update', 'agy --version']]]);
    assert.ok(j.upgrades.every((u) => u.needsConsent));
    assert.deepEqual({ ...j.codex.plugin, pluginsFile: undefined, error: undefined },
      { installed: true, key: 'codex@openai-codex', official: true, installPath: codexPluginPath, companionExists: true, pluginsFile: undefined, error: undefined });
    assert.ok(j.recommendations.some((x) => /Codex plugin installed: use \/codex:review/.test(x)));
    assert.equal(j.opencode.present, true);
    assert.equal(j.opencode.version, 'opencode v2.2.5');
    assert.equal(j.opencode.acp, true);
    assert.ok(j.recommendations.some((x) => /OpenCode ACP available: run `node scripts\/opencode-acp-run\.mjs probe/.test(x)));
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
    const r = doctor(home, ['--json'], { CODEX_BIN: path.join(tmp, 'no-codex'), AGY_BIN: path.join(tmp, 'no-agy'), OPENCODE_BIN: path.join(tmp, 'no-opencode') });
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
    assert.equal(j.opencode.present, false);
    assert.ok(j.recommendations.some((x) => /OpenCode not found/.test(x)));
    assert.equal(j.codex.plugin.installed, false);
    assert.ok(j.recommendations.some((x) => /agy not found .*with the user's consent/.test(x)));
    assert.deepEqual(j.upgrades, []);
  });

  test('a Codex plugin fork and an OpenCode without acp get warnings', () => {
    const home = newHome('fork');
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), { plugins: { 'codex@some-fork': [{ installPath: '/nowhere' }] } });
    const r = doctor(home, ['--json'], { FAKE_NO_ACP: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.codex.plugin.official, false);
    assert.ok(r.json.recommendations.some((x) => /is not OpenAI's codex@openai-codex: check its sandbox default/.test(x)));
    assert.equal(r.json.opencode.acp, false);
    assert.ok(r.json.recommendations.some((x) => /`opencode acp` is not available/.test(x)));
    const human = doctor(home, [], { FAKE_NO_ACP: '1' });
    assert.match(human.stdout, /opencode: found \(opencode v2\.2\.5\)/);
    assert.match(human.stdout, /acp subcommand: no/);
    assert.match(human.stdout, /Codex plugin \(Claude Code\): installed \(codex@some-fork, not the official plugin\)/);
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

  test('agy with ACP: readiness, recommended release, agy-staff missing', () => {
    const home = newHome('acp');
    const acpAgy = makeFakeBin(path.join(tmp, 'bin'), 'agy-acp', 'fake-agy-acp.mjs');
    const r = doctor(home, ['--json'], { AGY_BIN: acpAgy });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.agy.semver, '1.5.14');
    assert.equal(r.json.agy.acp, true);
    assert.equal(r.json.agy.recommendedOk, true);
    assert.ok(r.json.recommendations.some((x) => /agy ACP available: dispatch agy jobs with agy-acp-run\.mjs/.test(x)));
    assert.deepEqual(r.json.upgrades.map((u) => u.target), ['agy-staff']);
    assert.deepEqual(r.json.upgrades[0].commands, ['claude plugin marketplace add keli-wen/agy-staff', 'claude plugin install agy@agy-staff']);
    const older = doctor(home, ['--json'], { AGY_BIN: acpAgy, FAKE_AGY_VERSION: '1.5.3' });
    assert.equal(older.json.agy.recommendedOk, false);
    assert.ok(older.json.recommendations.some((x) => /below the recommended 1\.5\.12: offer `agy update`/.test(x)));
    assert.equal(older.json.upgrades[0].target, 'agy');
    const human = doctor(home, [], { AGY_BIN: acpAgy });
    assert.match(human.stdout, /acp subcommand \(official ACP server\): yes/);
    assert.match(human.stdout, /Upgrades to offer \(run only after the user agrees\):/);
  });

  test('--check-updates compares agy-staff with the newest release tag', () => {
    const home = newHome('updates');
    const installPath = path.join(home, 'agy-staff');
    write(path.join(installPath, 'companion', 'agy-companion.mjs'), '// companion\n');
    write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      { plugins: { 'agy@agy-staff': [{ installPath, version: '0.9.1' }] } });
    const remote = path.join(tmp, 'agy-staff-remote');
    const git = (...a) => spawnSync('git', a, { cwd: remote, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
    fs.mkdirSync(remote);
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'x');
    for (const t of ['v0.9.1', 'v0.9.3', 'v0.10.0-rc', 'v0.9.2']) git('tag', t);
    const acpAgy = makeFakeBin(path.join(tmp, 'bin'), 'agy-acp2', 'fake-agy-acp.mjs');
    const r = doctor(home, ['--json', '--check-updates'], { AGY_BIN: acpAgy, AGY_STAFF_REPO_URL: remote });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.agy.agyStaff.latest, '0.9.3');
    assert.equal(r.json.agy.agyStaff.updateAvailable, true);
    assert.ok(r.json.recommendations.some((x) => /agy-staff 0\.9\.1 is older than 0\.9\.3: offer to upgrade it/.test(x)));
    assert.deepEqual(r.json.upgrades.map((u) => u.commands), [['claude plugin marketplace update agy-staff', 'claude plugin update agy@agy-staff']]);
    const offline = doctor(home, ['--json'], { AGY_BIN: acpAgy, AGY_STAFF_REPO_URL: remote });
    assert.equal(offline.json.agy.agyStaff.latest, null);
    assert.equal(offline.json.agy.agyStaff.updateAvailable, null);
  });

  test('--help and usage error', () => {
    assert.equal(runScript(SCRIPTS.doctor, ['--help']).status, 0);
    const r = runScript(SCRIPTS.doctor, ['--bogus']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown argument/);
  });
});
