import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { ROOT, makeTempDir, removeDir, makeFakeBin, runScript } from './helpers/fakes.mjs';
import { recommend } from '../skills/cli-agent-delegation/scripts/doctor.mjs';

const require = createRequire(import.meta.url);
const SCRIPT = path.join(ROOT, 'skills', 'subagent-team', 'scripts', 'env-check.cjs');
const envCheck = require(SCRIPT);

let tmp;
let fakeCodex;
let fakeAgy;

before(() => {
  tmp = makeTempDir('env-check-test-');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fakeCodex = makeFakeBin(bin, 'codex', 'fake-codex.mjs');
  fakeAgy = makeFakeBin(bin, 'agy', 'fake-agy.mjs');
});

after(() => removeDir(tmp));

function project(name, files = {}, { git = true } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  if (git) execFileSync('git', ['init', '-q', dir]);
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

const missing = (name) => path.join(tmp, 'nope', name);

test('checkNode: error below the minimum, warning below recommended, ok at recommended', () => {
  const { MIN_NODE_MAJOR, RECOMMENDED_NODE_MAJOR, checkNode } = envCheck;
  assert.equal(MIN_NODE_MAJOR, 18);
  assert.equal(RECOMMENDED_NODE_MAJOR, 24);
  const low = checkNode('v16.20.2');
  assert.equal(low.status, 'error');
  assert.match(low.detail, /below the minimum 18/);
  assert.match(low.fix, /nvm install 24/);
  assert.match(low.fix, /fallbacks in SKILL\.md/);
  assert.equal(checkNode('v18.0.0').status, 'warn');
  assert.equal(checkNode('v22.22.0').status, 'warn');
  assert.equal(checkNode('v24.1.0').status, 'ok');
  assert.equal(checkNode('v26.0.0').status, 'ok');
});

test('findPolicy detects the Subagent team section and its model policy', () => {
  const withPolicy = project('p1', { 'AGENTS.md': '# Rules\n\n## Subagent team\n- Model policy: hybrid\n' }, { git: false });
  assert.deepEqual(envCheck.findPolicy(withPolicy), { found: true, file: 'AGENTS.md', modelPolicy: 'hybrid' });
  const claudeOnly = project('p2', { 'CLAUDE.md': '## Subagent team\nsee docs\n' }, { git: false });
  assert.deepEqual(envCheck.findPolicy(claudeOnly), { found: true, file: 'CLAUDE.md', modelPolicy: null });
  const none = project('p3', { 'AGENTS.md': '## Something else\n' }, { git: false });
  assert.equal(envCheck.findPolicy(none).found, false);
});

test('runChecks: ready with optional tools present and a policy in the repo root', () => {
  const dir = project('ready', { 'AGENTS.md': '## Subagent team\n- Model policy: auto\n' });
  fs.mkdirSync(path.join(dir, 'sub'));
  const r = envCheck.runChecks({ root: path.join(dir, 'sub') },
    { CODEX_BIN: fakeCodex, AGY_BIN: fakeAgy, HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') }, 'v24.1.0');
  assert.equal(r.status, 'ready');
  assert.equal(fs.realpathSync(r.projectRoot), fs.realpathSync(dir), 'policy is looked up at the git top level');
  assert.equal(r.policy.modelPolicy, 'auto');
  assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [
    ['node', 'ok'], ['git', 'ok'], ['git-repo', 'ok'], ['codex', 'ok'], ['agy', 'ok'], ['agy-staff', 'info'],
  ]);
  assert.deepEqual(r.next, ['Environment ready and policy found: proceed.']);
});

test('runChecks: blocked when git is missing; missing optional CLIs are only info', () => {
  const dir = project('blocked', {}, { git: false });
  const r = envCheck.runChecks({ root: dir },
    { GIT_BIN: missing('git'), CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), HOME: tmp }, 'v24.1.0');
  assert.equal(r.status, 'blocked');
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(byId.git.status, 'error');
  assert.equal(byId.codex.status, 'info');
  assert.equal(byId.agy.status, 'info');
  assert.match(r.next[0], /install only with their consent/);
  assert.match(r.next[1], /first-use setup/);
});

test('runChecks: warns outside a git repository and on a non-recommended Node', () => {
  const dir = project('nogit', {}, { git: false });
  const r = envCheck.runChecks({ root: dir }, { CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), HOME: tmp }, 'v20.1.0');
  assert.equal(r.status, 'ready-with-warnings');
  assert.deepEqual(r.checks.filter((c) => c.status === 'warn').map((c) => c.id).sort(), ['git-repo', 'node']);
});

test('agy-staff plugin detection reads the Claude config dir', () => {
  const cfg = path.join(tmp, 'cfg-staff', 'plugins');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'installed_plugins.json'), '{"plugins":{"agy@agy-staff":[{}]}}');
  const r = envCheck.runChecks({ root: tmp }, { CLAUDE_CONFIG_DIR: path.dirname(cfg), CODEX_BIN: missing('c'), AGY_BIN: missing('a') }, 'v24.0.0');
  assert.equal(r.checks.find((c) => c.id === 'agy-staff').status, 'ok');
});

test('CLI: report, --json, exit codes and usage errors', () => {
  const dir = project('cli', { 'AGENTS.md': '## Subagent team\n- Model policy: fixed\n' });
  const env = { CODEX_BIN: fakeCodex, AGY_BIN: fakeAgy, HOME: tmp };
  const report = runScript(SCRIPT, ['--root', dir], { env });
  assert.equal(report.status, 0);
  assert.match(report.stdout, /Environment health check/);
  assert.match(report.stdout, /Model policy: fixed/);
  const json = runScript(SCRIPT, ['--root', dir, '--json'], { env });
  assert.equal(json.status, 0);
  assert.equal(json.json.policy.modelPolicy, 'fixed');
  assert.equal(json.json.minNode, 18);
  const blocked = runScript(SCRIPT, ['--root', dir, '--json'], { env: { ...env, GIT_BIN: missing('git') } });
  assert.equal(blocked.status, 2);
  assert.equal(blocked.json.status, 'blocked');
  assert.equal(runScript(SCRIPT, ['--root'], { env }).status, 1);
  assert.equal(runScript(SCRIPT, ['--bogus'], { env }).status, 1);
  const help = runScript(SCRIPT, ['--help'], { env });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Node\.js >= 18/);
});

test('doctor recommends the recommended Node version only below it', () => {
  const base = { codex: { present: true, bin: 'codex', defaultModel: 'm' }, agy: { present: true, bin: 'agy', agyStaff: { installed: true, companionExists: true } } };
  assert.ok(recommend({ ...base, nodeVersion: 'v22.1.0' }).some((r) => /24 is recommended/.test(r)));
  assert.ok(!recommend({ ...base, nodeVersion: 'v24.1.0' }).some((r) => /recommended \(e\.g/.test(r)));
});
