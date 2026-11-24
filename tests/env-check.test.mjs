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
let fakeAgyAcp;

before(() => {
  tmp = makeTempDir('env-check-test-');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fakeCodex = makeFakeBin(bin, 'codex', 'fake-codex.mjs');
  fakeAgy = makeFakeBin(bin, 'agy', 'fake-agy.mjs');
  fakeAgyAcp = makeFakeBin(bin, 'agy-acp', 'fake-agy-acp.mjs');
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
const noOthers = () => ({ OPENCODE_BIN: missing('opencode'), PI_BIN: missing('pi'), GROK_BIN: missing('grok') });

test('checkNode: error below the minimum, the user\'s version is ok at or above it', () => {
  const { MIN_NODE_MAJOR, RECOMMENDED_NODE_MAJOR, checkNode } = envCheck;
  assert.equal(MIN_NODE_MAJOR, 22);
  assert.equal(RECOMMENDED_NODE_MAJOR, 24);
  const low = checkNode('v16.20.2');
  assert.equal(low.status, 'error');
  assert.match(low.detail, /below the minimum 22/);
  assert.match(low.fix, /nvm install 24/);
  assert.match(low.fix, /consent/);
  assert.match(low.fix, /fallbacks in references\/environment-check\.md/);
  assert.equal(checkNode('v18.0.0').status, 'error');
  assert.equal(checkNode('v20.19.0').status, 'error');
  assert.equal(checkNode('v22.0.0').status, 'ok');
  assert.equal(checkNode('v22.22.0').status, 'ok');
  assert.equal(checkNode('v23.3.0').status, 'ok');
  assert.equal(checkNode('v24.1.0').status, 'ok');
  assert.equal(checkNode('v26.0.0').status, 'ok');
});

test('findPolicy detects the Subagent team section and its model policy', () => {
  const withPolicy = project('p1', { 'AGENTS.md': '# Rules\n\n## Subagent team\n- Model policy: hybrid\n' }, { git: false });
  assert.deepEqual(envCheck.findPolicy(withPolicy), { found: true, file: 'AGENTS.md', modelPolicy: 'hybrid', hostHarness: null, teamBoard: null, externalDelegation: null, externalRoute: null });
  const claudeOnly = project('p2', { 'CLAUDE.md': '## Subagent team\nsee docs\n' }, { git: false });
  assert.deepEqual(envCheck.findPolicy(claudeOnly), { found: true, file: 'CLAUDE.md', modelPolicy: null, hostHarness: null, teamBoard: null, externalDelegation: null, externalRoute: null });
  const full = project('p4', { 'AGENTS.md': '## Subagent team\n- Model policy: auto\n- Host harness: Claude Code   <!-- confirmed -->\n- Team board: docs/team/README.md + native task list\n' }, { git: false });
  const fp = envCheck.findPolicy(full);
  assert.equal(fp.hostHarness, 'Claude Code');
  assert.equal(fp.teamBoard, 'docs/team/README.md + native task list');
  const none = project('p3', { 'AGENTS.md': '## Something else\n' }, { git: false });
  assert.equal(envCheck.findPolicy(none).found, false);
});

test('runChecks: ready with optional tools present and a policy in the repo root', () => {
  const dir = project('ready', { 'AGENTS.md': '## Subagent team\n- Model policy: auto\n- Host harness: Claude Code\n- Team board: native\n- External delegation: roster   <!-- ask | roster | none -->\n' });
  fs.mkdirSync(path.join(dir, 'sub'));
  const r = envCheck.runChecks({ root: path.join(dir, 'sub') },
    { ...noOthers(), CODEX_BIN: fakeCodex, AGY_BIN: fakeAgyAcp, HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') }, 'v24.1.0');
  assert.equal(r.status, 'ready');
  assert.equal(fs.realpathSync(r.projectRoot), fs.realpathSync(dir), 'policy is looked up at the git top level');
  assert.equal(r.policy.modelPolicy, 'auto');
  assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [
    ['node', 'ok'], ['git', 'ok'], ['git-repo', 'ok'], ['host', 'info'], ['codex', 'ok'], ['agy', 'ok'], ['agy-staff', 'info'],
  ]);
  assert.equal(r.host.id, 'unknown');
  assert.equal(r.policy.externalDelegation, 'roster');
  assert.deepEqual(r.next, [
    'External delegation: roster (from the policy): use the roster as recorded and say so in one line; re-check only when the user asks.',
    'Compute plan: none yet: draft one (teams, model and effort per role, fallbacks, windows) and confirm it once, asking whether to keep it globally, for this project or for this session (references/compute-config.md).',
  ]);
  assert.equal(r.compute.globalFound, false);
  fs.mkdirSync(path.join(dir, '.agent-team'));
  fs.writeFileSync(path.join(dir, '.agent-team', 'compute.json'), '{"schema":1}\n');
  const r2 = envCheck.runChecks({ root: path.join(dir, 'sub') },
    { ...noOthers(), CODEX_BIN: fakeCodex, AGY_BIN: fakeAgyAcp, HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') }, 'v24.1.0');
  assert.equal(r2.compute.projectFound, true);
  assert.deepEqual(r2.next.slice(1), [
    'Compute plan found (project): run scripts/compute-config.mjs show and route by it; ask nothing about compute unless it reports a review is due (then notify and proceed).',
    'Environment ready and policy found: proceed.',
  ]);
  assert.match(envCheck.formatReport(r2), /Compute plan: .*\.agent-team/);
});

test('findCompute: SUBAGENT_TEAM_HOME, else a dedicated ~/.subagent-team', () => {
  const dir = project('compute-paths');
  assert.equal(envCheck.findCompute({ SUBAGENT_TEAM_HOME: path.join(tmp, 'sth') }, dir).global, path.join(tmp, 'sth', 'compute.json'));
  assert.equal(envCheck.findCompute({ HOME: tmp }, dir).global, path.join(tmp, '.subagent-team', 'compute.json'));
  assert.equal(envCheck.findCompute({ HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, 'xdg') }, dir).global, path.join(tmp, '.subagent-team', 'compute.json'), 'XDG is not used');
});

test('nvm: found through NVM_DIR or ~/.nvm, install hints are nvm-first and ask for consent', () => {
  const home = path.join(tmp, 'nvm-home');
  fs.mkdirSync(home, { recursive: true });
  const none = envCheck.findNvm({ HOME: home });
  assert.deepEqual(none, { found: false, dir: path.join(home, '.nvm'), versions: [] });
  const noNvmHint = envCheck.nodeInstallHint(none);
  assert.match(noNvmHint, /consent/);
  assert.match(noNvmHint, /install nvm/);
  assert.ok(noNvmHint.indexOf('nvm') < noNvmHint.indexOf('natively'), 'nvm comes before a native install');
  fs.mkdirSync(path.join(home, '.nvm'));
  fs.writeFileSync(path.join(home, '.nvm', 'nvm.sh'), '# fake\n');
  const found = envCheck.findNvm({ HOME: home });
  assert.equal(found.found, true);
  assert.match(envCheck.nodeInstallHint(found), /^With the user's consent: `nvm install 24 && nvm use 24`/);
  const custom = path.join(tmp, 'custom-nvm');
  fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, 'nvm.sh'), '# fake\n');
  assert.deepEqual(envCheck.findNvm({ HOME: home, NVM_DIR: custom }), { found: true, dir: custom, versions: [] });
  assert.deepEqual(envCheck.findNvm({ HOME: path.join(tmp, 'elsewhere'), NVM_DIR: path.join(tmp, 'nope') }).found, false);
  // checkNvm: info only when nvm exists but this Node.js is not nvm's.
  assert.deepEqual(envCheck.checkNvm(none, '/usr/local/bin/node'), []);
  assert.deepEqual(envCheck.checkNvm(found, path.join(found.dir, 'versions', 'node', 'v24.1.0', 'bin', 'node')), []);
  const shadow = envCheck.checkNvm(found, '/opt/homebrew/bin/node');
  assert.equal(shadow.length, 1);
  assert.equal(shadow[0].id, 'nvm');
  assert.equal(shadow[0].status, 'info');
  assert.match(shadow[0].fix, /nvm use 24/);
  assert.match(envCheck.checkNvm(found, '/opt/homebrew/bin/node', { major: 26 })[0].fix, /nvm use 26/);
  assert.deepEqual(envCheck.checkNvm(found, ''), []);
  // runChecks wires it in through opts.execPath.
  const dir = project('nvm-wired');
  const env = { CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), HOME: home, ...noOthers() };
  const r = envCheck.runChecks({ root: dir, execPath: '/opt/homebrew/bin/node' }, env, 'v24.1.0');
  assert.ok(r.checks.some((c) => c.id === 'nvm' && c.status === 'info'));
  const old = envCheck.runChecks({ root: dir }, env, 'v20.1.0');
  const nodeCheck = old.checks.find((c) => c.id === 'node');
  assert.equal(nodeCheck.status, 'error');
  assert.match(nodeCheck.fix, /nvm install 24/);
});

test('runChecks: asks which external teams to use unless the policy says roster or none', () => {
  const dir = project('ask', { 'AGENTS.md': '## Subagent team\n- Model policy: auto\n- Host harness: Codex\n- Team board: native\n' });
  const env = { ...noOthers(), CODEX_BIN: fakeCodex, AGY_BIN: missing('agy'), HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') };
  const r = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  assert.deepEqual(r.next, [
    'External teams available (codex): ask the user which may take work this session, pre-selecting the policy roster (references/environment-check.md, step 5). Policy "External delegation: roster" or "none" skips this question.',
    'Compute plan: none yet: draft one (teams, model and effort per role, fallbacks, windows) and confirm it once, asking whether to keep it globally, for this project or for this session (references/compute-config.md).',
  ]);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '## Subagent team\n- Model policy: auto\n- Host harness: Codex\n- Team board: native\n- External delegation: none\n');
  const r2 = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  assert.match(r2.next[0], /External delegation: none \(from the policy\): keep all work in-house/);
  const noTeams = envCheck.runChecks({ root: project('ask2', { 'AGENTS.md': '## Subagent team\n- Model policy: auto\n- Host harness: Codex\n- Team board: native\n' }) },
    { ...noOthers(), CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), HOME: tmp }, 'v24.1.0');
  assert.deepEqual(noTeams.next, ['Environment ready and policy found: proceed.']);
});

test('Codex plugin detection: official plugin ok, a fork warns', () => {
  const cfg = path.join(tmp, 'cfg-codex', 'plugins');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'installed_plugins.json'), '{"plugins":{"codex@openai-codex":[{}]}}');
  const env = { CLAUDE_CONFIG_DIR: path.dirname(cfg), CODEX_BIN: missing('c'), AGY_BIN: missing('a'), ...noOthers() };
  let r = envCheck.runChecks({ root: tmp }, env, 'v24.0.0');
  assert.equal(r.checks.find((c) => c.id === 'codex-plugin').status, 'ok');
  fs.writeFileSync(path.join(cfg, 'installed_plugins.json'), '{"plugins":{"codex@a-fork":[{}]}}');
  r = envCheck.runChecks({ root: tmp }, env, 'v24.0.0');
  const c = r.checks.find((x) => x.id === 'codex-plugin');
  assert.equal(c.status, 'warn');
  assert.match(c.fix, /danger-full-access/);
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
  const r = envCheck.runChecks({ root: dir }, { CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), HOME: tmp }, 'v22.1.0');
  assert.equal(r.status, 'ready-with-warnings');
  assert.deepEqual(r.checks.filter((c) => c.status === 'warn').map((c) => c.id).sort(), ['git-repo']);
});

test('Node.js version precedence: project pin, then running, then nvm, then recommended', () => {
  const { findNodePin, nodeTarget, checkNodePin } = envCheck;
  const nvmDir = path.join(tmp, 'nvm-versions');
  for (const v of ['v20.10.0', 'v22.16.0', 'v23.11.1', 'v23.2.0']) fs.mkdirSync(path.join(nvmDir, 'versions', 'node', v), { recursive: true });
  fs.writeFileSync(path.join(nvmDir, 'nvm.sh'), '# fake\n');
  const nvm = envCheck.findNvm({ NVM_DIR: nvmDir });
  assert.deepEqual(nvm.versions, ['v23.11.1', 'v23.2.0', 'v22.16.0', 'v20.10.0']);
  const pin = (name, files) => findNodePin(project(name, files, { git: false }));
  assert.equal(pin('pin-none', {}), null);
  assert.deepEqual(pin('pin-nvmrc', { '.nvmrc': 'v23.4.0\n' }), { file: '.nvmrc', value: 'v23.4.0', major: 23 });
  assert.deepEqual(pin('pin-nodever', { '.node-version': '22\n' }), { file: '.node-version', value: '22', major: 22 });
  assert.deepEqual(pin('pin-volta', { 'package.json': '{"volta":{"node":"26.1.0"}}' }), { file: 'package.json volta.node', value: '26.1.0', major: 26 });
  assert.deepEqual(pin('pin-lts', { '.nvmrc': 'lts/*\n' }), { file: '.nvmrc', value: 'lts/*', major: null });
  // A pin of 22 or newer wins, even over a newer running Node.js.
  assert.deepEqual(nodeTarget('v26.0.0', { file: '.nvmrc', value: '23', major: 23 }, nvm), { major: 23, source: 'project (.nvmrc)', installed: true });
  // Otherwise the running version, if it meets the minimum.
  assert.deepEqual(nodeTarget('v22.3.0', null, nvm), { major: 22, source: 'running', installed: true });
  assert.deepEqual(nodeTarget('v25.0.0', { file: '.nvmrc', value: '18', major: 18 }, nvm), { major: 25, source: 'running', installed: false });
  // Then the newest version nvm already has; then the recommended version.
  assert.deepEqual(nodeTarget('v20.1.0', null, nvm), { major: 23, source: 'nvm', installed: true });
  assert.deepEqual(nodeTarget('v20.1.0', null, { found: false, dir: 'x', versions: [] }), { major: 24, source: 'recommended', installed: false });
  // Hints: nvm use when already installed, install only otherwise.
  const err = envCheck.checkNode('v20.1.0', nvm, null);
  assert.equal(err.status, 'error');
  assert.match(err.fix, /^`nvm use 23` \(already installed/);
  assert.match(envCheck.checkNode('v20.1.0', nvm, { file: '.nvmrc', value: '26', major: 26 }).fix, /consent: `nvm install 26 && nvm use 26`/);
  // Pin notices are information only.
  assert.deepEqual(checkNodePin('v23.1.0', { file: '.nvmrc', value: '23', major: 23 }, nvm), []);
  const differ = checkNodePin('v26.0.0', { file: '.nvmrc', value: '24', major: 24 }, nvm);
  assert.equal(differ[0].status, 'info');
  assert.match(differ[0].fix, /nvm use 24` after `nvm install 24`/);
  const low = checkNodePin('v26.0.0', { file: '.nvmrc', value: '18', major: 18 }, nvm);
  assert.equal(low[0].status, 'info');
  assert.match(low[0].fix, /Keep the project's pin; .*nvm exec 26/);
  assert.deepEqual(checkNodePin('v26.0.0', { file: '.nvmrc', value: 'lts/*', major: null }, nvm), []);
  // runChecks reports the pin and the target, and never warns about a supported version.
  const dir = project('pin-run', { '.nvmrc': '23\n' });
  const r = envCheck.runChecks({ root: dir }, { CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), NVM_DIR: nvmDir, HOME: tmp, ...noOthers() }, 'v22.1.0');
  assert.equal(r.nodePin.major, 23);
  assert.deepEqual(r.nodeTarget, { major: 23, source: 'project (.nvmrc)', installed: true });
  assert.equal(r.checks.find((c) => c.id === 'node').status, 'ok');
  assert.equal(r.checks.find((c) => c.id === 'node-pin').status, 'info');
});

test('detectHost reads harness environment variables as hints', () => {
  const cc = envCheck.detectHost({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
  assert.equal(cc.id, 'claude-code');
  assert.equal(cc.verified, true);
  assert.deepEqual(cc.evidence, ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);
  const codex = envCheck.detectHost({ CODEX_SANDBOX: 'seatbelt' });
  assert.equal(codex.id, 'codex');
  assert.equal(codex.verified, false);
  assert.equal(envCheck.detectHost({ AI_AGENT: 'someagent_1_2' }).name, 'someagent');
  assert.equal(envCheck.detectHost({}).id, 'unknown');
  const both = envCheck.detectHost({ CLAUDECODE: '1', OPENCODE: '1' });
  assert.deepEqual(both.candidates, ['opencode']);
  assert.equal(cc.kind, 'vendor-native');
  assert.equal(cc.route, 'acp-liaison');
  assert.equal(envCheck.detectHost({ OPENCODE: '1' }).route, 'host-switch');
  // A nested shell with hosts of different kinds leaves the route to the user.
  assert.equal(both.route, null);
  assert.equal(envCheck.detectHost({}).route, null);
});

test('detectHost: a wrapper host (T3 Code) wins over the provider runtime it runs', () => {
  const t3 = envCheck.detectHost({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 't3-code', T3CODE_THREAD_ID: 'x', AI_AGENT: 'claude-code_2' });
  assert.equal(t3.id, 't3-code');
  assert.equal(t3.kind, 'multi-vendor');
  assert.equal(t3.route, 'host-switch');
  assert.equal(t3.runtime, 'claude-code');
  assert.deepEqual(t3.candidates, []);
  assert.deepEqual(t3.evidence, ['T3CODE_THREAD_ID', 'CLAUDE_CODE_ENTRYPOINT=t3-code']);
  // The entrypoint value alone is enough; another value is plain Claude Code.
  assert.equal(envCheck.detectHost({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 't3-code' }).id, 't3-code');
  assert.equal(envCheck.detectHost({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }).id, 'claude-code');
  // A Codex provider inside T3 Code.
  const codex = envCheck.detectHost({ T3CODE_CLI_PATH: '/x', CODEX_THREAD_ID: 'y' });
  assert.equal(codex.id, 't3-code');
  assert.equal(codex.runtime, 'codex');
  assert.equal(envCheck.detectHost({ T3CODE_THREAD_ID: 'x' }).runtime, null);
});

test('externalRoute: policy line, recorded host kind or name, then detection', () => {
  const unknown = envCheck.detectHost({});
  const native = envCheck.detectHost({ CLAUDECODE: '1' });
  const route = (policy, host = unknown) => envCheck.externalRoute({ hostHarness: null, externalRoute: null, ...policy }, host);
  assert.equal(route({ externalRoute: 'in-house' }, native), 'in-house');
  assert.equal(route({ externalRoute: 'auto', hostHarness: 'T3 Code' }), 'host-switch');
  assert.equal(route({ hostHarness: 'Claude Code, vendor-native (confirmed 2026-11-24)' }), 'acp-liaison');
  assert.equal(route({ hostHarness: 'MyHarness, multi-vendor' }), 'host-switch');
  assert.equal(route({ hostHarness: 'agy' }), 'acp-liaison');
  assert.equal(route({ hostHarness: 'Codex' }), 'acp-liaison');
  assert.equal(route({ hostHarness: 'Claude Code; OpenCode' }), null);
  assert.equal(route({ hostHarness: 'Claude Code; OpenCode' }, native), 'acp-liaison');
  assert.equal(route({}), null);
});

test('runChecks: asks for the external route when the host kind is unclear', () => {
  const dir = project('route', { 'AGENTS.md': '## Subagent team\n- Model policy: auto\n- Host harness: SomeGUI\n- Team board: native\n- External delegation: roster\n' });
  const env = { ...noOthers(), CODEX_BIN: fakeCodex, AGY_BIN: missing('agy'), HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') };
  const r = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  assert.match(r.next[0], /External route unclear .*host switch, ACP \+ liaison or in-house only/);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '## Subagent team\n- Model policy: auto\n- Host harness: T3 Code (multi-vendor)\n- Team board: native\n- External delegation: roster\n');
  const r2 = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  assert.match(r2.next[0], /External route: host switch/);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '## Subagent team\n- Model policy: auto\n- Host harness: SomeGUI\n- Team board: native\n- External delegation: none\n');
  const r3 = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  assert.ok(!r3.next.some((n) => /External route/.test(n)));
});

test('runChecks: other agent CLIs, MCP servers, board and policy hints', () => {
  const dir = project('others', {
    'AGENTS.md': '## Subagent team\n- Model policy: auto\n',
    '.mcp.json': '{"mcpServers":{"codex":{},"docs":{}}}',
  });
  const env = { CODEX_BIN: missing('codex'), AGY_BIN: missing('agy'), OPENCODE_BIN: fakeAgy, PI_BIN: missing('pi'), GROK_BIN: missing('grok'), HOME: tmp, CLAUDECODE: '1' };
  const r = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(byId.opencode.status, 'ok');
  assert.match(byId.opencode.detail, /confirm it is the agent you mean/);
  assert.match(byId.opencode.detail, /Reachable through ACP/);
  assert.equal(byId.pi, undefined, 'absent optional agents are not listed');
  assert.match(byId.mcp.detail, /codex, docs/);
  assert.match(byId.host.detail, /Claude Code \(CLAUDECODE\)/);
  assert.equal(r.board.found, false);
  assert.ok(r.next.some((n) => /no "Host harness:" line: confirm the host \(detected: Claude Code\)/.test(n)));
  assert.ok(r.next.some((n) => /No team board yet/.test(n)));
  fs.mkdirSync(path.join(dir, 'docs', 'agent-team'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'agent-team', 'README.md'), '# board\n');
  const r2 = envCheck.runChecks({ root: dir }, env, 'v24.1.0');
  assert.deepEqual(r2.board, { found: true, path: 'docs/agent-team/README.md' });
  assert.ok(!r2.next.some((n) => /No team board yet/.test(n)));
  assert.match(envCheck.formatReport(r2), /Team board: docs\/agent-team\/README\.md/);
  fs.mkdirSync(path.join(dir, 'docs', 'team'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'team', 'README.md'), '# board\n');
  assert.equal(envCheck.findBoard(dir, { teamBoard: '[board](docs/team/README.md) + native' }).path, 'docs/team/README.md');
  assert.equal(envCheck.findBoard(dir, { teamBoard: '`docs/team`' }).path, 'docs/team/README.md');
  assert.equal(envCheck.findBoard(dir, { teamBoard: 'native' }).path, 'docs/agent-team/README.md');
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
  assert.equal(json.json.minNode, 22);
  const blocked = runScript(SCRIPT, ['--root', dir, '--json'], { env: { ...env, GIT_BIN: missing('git') } });
  assert.equal(blocked.status, 2);
  assert.equal(blocked.json.status, 'blocked');
  assert.equal(runScript(SCRIPT, ['--root'], { env }).status, 1);
  assert.equal(runScript(SCRIPT, ['--bogus'], { env }).status, 1);
  const help = runScript(SCRIPT, ['--help'], { env });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Node\.js >= 22/);
  assert.match(help.stdout, /nvm/);
});

test('doctor recommends the recommended Node version only below it', () => {
  const base = { codex: { present: true, bin: 'codex', defaultModel: 'm' }, agy: { present: true, bin: 'agy', agyStaff: { installed: true, companionExists: true } } };
  assert.ok(recommend({ ...base, nodeVersion: 'v20.1.0' }).some((r) => /below the minimum 22/.test(r) && /nvm install 24/.test(r)));
  for (const v of ['v22.1.0', 'v23.0.0', 'v24.1.0', 'v26.0.0']) {
    assert.ok(!recommend({ ...base, nodeVersion: v }).some((r) => /Node\.js/.test(r)), `no Node.js advice on ${v}: the user's version is used`);
  }
});

test('runChecks: an agy without ACP is a warning with the update as fix; 1.5.x below 1.5.12 is ok with a note', () => {
  const dir = project('agy-old');
  const r = envCheck.runChecks({ root: dir }, { ...noOthers(), CODEX_BIN: fakeCodex, AGY_BIN: fakeAgy, HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') }, 'v24.1.0');
  const agy = r.checks.find((c) => c.id === 'agy');
  assert.equal(agy.status, 'warn');
  assert.match(agy.detail, /has no official ACP server/);
  assert.match(agy.fix, /agy update/);
  process.env.FAKE_AGY_VERSION = '1.5.3';
  let mid;
  try {
    mid = envCheck.runChecks({ root: dir }, { ...noOthers(), CODEX_BIN: fakeCodex, AGY_BIN: fakeAgyAcp, HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') }, 'v24.1.0');
  } finally {
    delete process.env.FAKE_AGY_VERSION;
  }
  const a2 = mid.checks.find((c) => c.id === 'agy');
  assert.equal(a2.status, 'ok');
  assert.match(a2.detail, /1\.5\.12 or newer recommended/);
});
