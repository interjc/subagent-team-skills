import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, validateRunOptions, validateProbeOptions, resolveModel, agentEnv, checkAgyVersion, compareVersions,
  parseVersion, describeSession, applyConfig, classify, isQuotaError, buildResumeHint, CREDENTIAL_ENV, READONLY_MODE,
  WRITE_MODE, CLIENT_NAME, EXIT, UsageError, SetupError,
} from '../skills/cli-agent-delegation/scripts/agy-acp-run.mjs';
import { ROOT, makeTempDir, removeDir, makeFakeBin, runScript, readJson, waitForRecord, killLeftovers } from './helpers/fakes.mjs';

const SCRIPT = path.join(ROOT, 'skills', 'cli-agent-delegation', 'scripts', 'agy-acp-run.mjs');
const FAST = { AGY_ACP_KILL_GRACE_MS: '1000', AGY_ACP_CANCEL_GRACE_MS: '1000' };

let tmp;
let repo;
let prompt;
let fakeAgy;

before(() => {
  tmp = fs.realpathSync(makeTempDir('agy-acp-test-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
  prompt = path.join(tmp, 'prompt.md');
  fs.writeFileSync(prompt, 'Summarise a.txt.\n');
  fakeAgy = makeFakeBin(tmp, 'agy', 'fake-agy-acp.mjs');
});

after(() => removeDir(tmp));

function run(args, { mode = 'ok', env = {} } = {}) {
  const record = path.join(tmp, `record-${Math.random().toString(16).slice(2)}.json`);
  const r = runScript(SCRIPT, args, { env: { AGY_BIN: fakeAgy, FAKE_MODE: mode, FAKE_RECORD: record, ...FAST, ...env } });
  r.record = fs.existsSync(record) ? readJson(record) : null;
  return r;
}

const base = (extra = []) => ['run', '--repo', repo, '--prompt-file', prompt, '--model', 'gemini-4-hydrogen', '--effort', 'low', '--out-dir', path.join(tmp, `out-${Math.random().toString(16).slice(2)}`), ...extra];
const v = (extra = []) => validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', prompt, '--model', 'gemini-4-hydrogen', '--effort', 'low', ...extra]));
const sentMethods = (rec) => rec.received.filter((m) => m.method).map((m) => m.method);

describe('agy-acp-run: validation', () => {
  test('defaults: read-only mode, 30m timeout, required model and effort', () => {
    const cfg = v();
    assert.equal(cfg.mode, READONLY_MODE);
    assert.equal(cfg.write, false);
    assert.equal(cfg.timeoutSec, 1800);
    assert.equal(v(['--write']).mode, WRITE_MODE);
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', prompt, '--effort', 'low'])), /--model is required/);
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', prompt, '--model', 'gemini-4-argon'])), /--effort is required/);
  });

  test('legacy ids with a level suffix are split; a conflicting --effort is refused', () => {
    assert.deepEqual(resolveModel('gemini-3.8-flash-high', null), { model: 'gemini-3.8-flash', effort: 'high', legacyModel: 'gemini-3.8-flash-high' });
    assert.deepEqual(resolveModel('gemini-4-argon', 'Medium'), { model: 'gemini-4-argon', effort: 'medium', legacyModel: null });
    assert.throws(() => resolveModel('gemini-3.8-flash-high', 'low'), /carries level "high"/);
  });

  test('Claude and GPT ids are refused unless --allow-any-model', () => {
    assert.throws(() => resolveModel('claude-sonnet-5-5', 'high'), /Claude\/GPT/);
    assert.throws(() => resolveModel('gpt-oss-120b-medium', null), /Claude\/GPT/);
    assert.equal(resolveModel('claude-sonnet-5-5', 'high', { allowAnyModel: true }).model, 'claude-sonnet-5-5');
  });

  test('repo must be absolute and existing; probe --session-check needs an empty directory', () => {
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', 'repo', '--prompt-file', prompt, '--model', 'gemini-4-argon', '--effort', 'low'])), /absolute/);
    assert.throws(() => validateProbeOptions(parseArgs(['probe', '--session-check', '--repo', repo])), /empty scratch directory/);
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    assert.equal(validateProbeOptions(parseArgs(['probe', '--session-check', '--repo', empty])).sessionCheck, true);
    assert.equal(validateProbeOptions(parseArgs(['probe'])).sessionCheck, false);
    assert.throws(() => v(['--session-check']), /belongs to the probe command/);
    assert.throws(() => parseArgs(['run', '--nope']), UsageError);
  });

  test('--help documents exit codes, compliance and the handshake-only probe', () => {
    const r = runScript(SCRIPT, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Exit codes:/);
    assert.match(r.stdout, /Compliance/);
    assert.match(r.stdout, /Handshake only by default/);
  });
});

describe('agy-acp-run: pure helpers', () => {
  test('ambient Google credentials are removed unless kept', () => {
    const { env, removed } = agentEnv({ PATH: '/bin', GEMINI_API_KEY: 'x', GOOGLE_CLOUD_PROJECT: 'p' });
    assert.deepEqual(removed, ['GEMINI_API_KEY', 'GOOGLE_CLOUD_PROJECT']);
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.PATH, '/bin');
    assert.deepEqual(agentEnv({ GEMINI_API_KEY: 'x' }, { keepCredentialEnv: true }).removed, []);
    assert.ok(CREDENTIAL_ENV.includes('GOOGLE_APPLICATION_CREDENTIALS'));
  });

  test('version gate: 1.5.0 minimum, 1.5.12 recommended', () => {
    assert.deepEqual(parseVersion('agy 1.5.14'), [1, 5, 14]);
    assert.ok(compareVersions([1, 5, 12], [1, 5, 2]) > 0);
    assert.match(checkAgyVersion('1.4.10').error, /older than 1\.5\.0/);
    assert.match(checkAgyVersion('1.5.3').warning, /1\.5\.12 or newer is recommended/);
    assert.deepEqual(checkAgyVersion('1.5.14'), { error: null, warning: null });
    assert.match(checkAgyVersion(null).warning, /no parsable version/);
  });

  test('describeSession reads modes, models and levels', () => {
    const d = describeSession({
      modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'accept-edits' }] },
      configOptions: [
        { id: 'model', category: 'model', currentValue: 'gemini-4-neon', options: [{ value: 'gemini-4-neon' }, { value: 'gemini-4-argon' }] },
        { id: 'thought_level', category: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }] },
      ],
    });
    assert.deepEqual(d.modes, ['default', 'accept-edits']);
    assert.deepEqual(d.models, ['gemini-4-neon', 'gemini-4-argon']);
    assert.equal(d.defaultEffort, 'high');
  });

  test('applyConfig refuses a missing write mode and an unoffered model', async () => {
    const session = {
      modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'plan' }] },
      configOptions: [{ id: 'model', category: 'model', currentValue: 'gemini-4-neon', options: [{ value: 'gemini-4-neon' }] }],
    };
    const client = { request: async () => ({}) };
    await assert.rejects(applyConfig(client, 's', session, { mode: WRITE_MODE, model: 'gemini-4-neon', effort: 'low' }), (e) => e instanceof SetupError && /no "accept-edits"/.test(e.message));
    await assert.rejects(applyConfig(client, 's', session, { mode: READONLY_MODE, model: 'gemini-4-argon', effort: 'low' }), /not offered/);
    await assert.rejects(applyConfig(client, 's', session, { mode: 'auto', model: 'gemini-4-neon', effort: 'low' }), /refused/);
  });

  test('classify: denied action, quota, auth and unfinished tool calls', () => {
    const denied = classify({ stopReason: 'end_turn', reply: '', permissionRequests: [{ kind: 'edit' }], sessionId: 's1' });
    assert.equal(denied.exitCode, EXIT.AGENT_ERROR);
    assert.equal(denied.deniedAction, true);
    assert.match(denied.error, /first denied action/);
    const quota = classify({ promptError: Object.assign(new Error('session/prompt: RESOURCE_EXHAUSTED: quota'), { code: -32603 }) });
    assert.equal(quota.quotaExhausted, true);
    assert.match(quota.error, /do not retry or switch accounts/);
    assert.ok(isQuotaError(new Error('429 Too Many Requests')));
    const auth = classify({ setupError: 'session/new failed: session/new: Authentication required' });
    assert.equal(auth.authRequired, true);
    assert.match(auth.error, /never handle the credentials/);
    const pending = classify({ stopReason: 'end_turn', reply: 'ok', unfinishedToolCalls: 1 });
    assert.equal(pending.exitCode, EXIT.OK);
    assert.match(pending.warning, /had not finished/);
  });

  test('resume hint keeps write and timeout', () => {
    const cfg = { ...v(['--write', '--timeout', '20m']) };
    const h = buildResumeHint(cfg, 'sess-1', '/x/agy-acp-run.mjs');
    assert.match(h, /--session sess-1 --prompt-file <NEW_PROMPT> --model gemini-4-hydrogen --effort low --write --timeout 1200s/);
    assert.equal(buildResumeHint(cfg, null), null);
  });
});

describe('agy-acp-run: running the fake agy acp', () => {
  test('read-only job: honest client name, default mode kept, model and level pinned, reply collected', () => {
    const r = run(base(), { env: { GEMINI_API_KEY: 'ambient' } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.channel, 'acp');
    assert.equal(r.json.mode, 'default');
    assert.equal(r.json.model, 'gemini-4-hydrogen');
    assert.equal(r.json.effort, 'low');
    assert.equal(r.json.agyVersion, '1.5.14');
    assert.deepEqual(r.json.credentialEnvRemoved, ['GEMINI_API_KEY']);
    assert.deepEqual(r.record.credentialEnv, []);
    assert.deepEqual(r.record.argv, ['acp']);
    assert.equal(fs.readFileSync(r.json.lastMessageFile, 'utf8'), 'Done: all good.');
    const init = r.record.received.find((m) => m.method === 'initialize');
    assert.equal(init.params.clientInfo.name, CLIENT_NAME);
    assert.deepEqual(init.params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
    const methods = sentMethods(r.record);
    assert.ok(methods.includes('session/close'));
    assert.ok(!r.record.received.some((m) => m.method === 'session/set_config_option' && m.params.configId === 'mode'));
    assert.equal(r.record.promptState.mode, 'default');
  });

  test('--write selects accept-edits through the mode option', () => {
    const r = run(base(['--write']));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.mode, 'accept-edits');
    assert.equal(r.record.promptState.mode, 'accept-edits');
    assert.ok(r.record.received.some((m) => m.method === 'session/set_config_option' && m.params.configId === 'mode' && m.params.value === 'accept-edits'));
  });

  test('a legacy suffixed id is split; an id that only looks suffixed is used whole', () => {
    const legacy = run(['run', '--repo', repo, '--prompt-file', prompt, '--model', 'gemini-3.8-flash-medium', '--out-dir', path.join(tmp, 'out-legacy')]);
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal(legacy.json.model, 'gemini-3.8-flash');
    assert.equal(legacy.json.effort, 'medium');
    const whole = run(['run', '--repo', repo, '--prompt-file', prompt, '--model', 'gpt-oss-120b-medium', '--allow-any-model', '--out-dir', path.join(tmp, 'out-whole')]);
    assert.equal(whole.status, 0, whole.stderr);
    assert.equal(whole.json.model, 'gpt-oss-120b-medium');
  });

  test('a rejected permission ends the turn: deny is sent, exit 2 with deniedAction', () => {
    const r = run(base(), { mode: 'edit-denied' });
    assert.equal(r.status, 2);
    assert.equal(r.json.deniedAction, true);
    assert.deepEqual(r.record.permissionReply, { outcome: { outcome: 'selected', optionId: 'deny' } });
    assert.equal(r.json.permissionRequests[0].kind, 'edit');
  });

  test('quota and auth failures are reported as such', () => {
    const q = run(base(), { mode: 'quota' });
    assert.equal(q.status, 2);
    assert.equal(q.json.quotaExhausted, true);
    const a = run(base(), { mode: 'auth-required' });
    assert.equal(a.status, 2);
    assert.equal(a.json.authRequired, true);
    assert.match(a.json.error, /agy acp --login/);
  });

  test('setup failures: old agy, missing write mode, level that does not stick', () => {
    const old = run(base(), { env: { FAKE_AGY_VERSION: '1.4.10' } });
    assert.equal(old.status, 3);
    assert.match(old.json.error, /older than 1\.5\.0/);
    assert.ok(!sentMethods(old.record).includes('session/new'));
    const noWrite = run(base(['--write']), { mode: 'no-accept-edits' });
    assert.equal(noWrite.status, 3);
    assert.match(noWrite.json.error, /no "accept-edits" session mode/);
    const sticky = run(base(), { mode: 'sticky-level' });
    assert.equal(sticky.status, 3);
    assert.match(sticky.json.error, /thinking level is "high"/);
    const recommended = run(base(), { env: { FAKE_AGY_VERSION: '1.5.3' } });
    assert.equal(recommended.status, 0);
    assert.match(recommended.json.warning, /recommended/);
  });

  test('resume ignores replayed history; no-resume agents are refused', () => {
    const r = run(base(['--session', 'sess-9']), { mode: 'replay' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.sessionId, 'sess-9');
    assert.ok(!fs.readFileSync(r.json.replyFile, 'utf8').includes('OLD REPLY'));
    assert.ok(sentMethods(r.record).includes('session/resume'));
    const n = run(base(['--session', 'sess-9']), { mode: 'no-resume' });
    assert.equal(n.status, 3);
    assert.match(n.json.error, /does not offer session\/resume/);
  });

  test('an unfinished tool call at the end of the turn is flagged', () => {
    const r = run(base(), { mode: 'pending-tool' });
    assert.equal(r.status, 0);
    assert.equal(r.json.unfinishedToolCalls, 1);
    assert.match(r.json.warning, /had not finished/);
  });

  test('timeout cancels the prompt and exits 5', async () => {
    const record = path.join(tmp, 'record-timeout.json');
    const child = spawn(process.execPath, [SCRIPT, ...base(['--timeout', '1s'])], {
      env: { ...process.env, AGY_BIN: fakeAgy, FAKE_MODE: 'hang', FAKE_RECORD: record, ...FAST },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    try {
      const code = await new Promise((resolve) => child.on('exit', resolve));
      assert.equal(code, 5);
      const j = JSON.parse(out);
      assert.equal(j.timedOut, true);
      assert.match(j.resumeHint, /--session sess-1/);
      const rec = await waitForRecord(record, (x) => x.received.some((m) => m.method === 'session/cancel'));
      assert.ok(rec);
    } finally {
      killLeftovers(child, record);
    }
  });

  test('probe: handshake only by default; --session-check lists modes and models and closes the session', () => {
    const p = run(['probe']);
    assert.equal(p.status, 0, p.stderr);
    assert.equal(p.json.sessionChecked, false);
    assert.equal(p.json.agyVersion, '1.5.14');
    assert.deepEqual(sentMethods(p.record), ['initialize']);
    const empty = path.join(tmp, 'probe-empty');
    fs.mkdirSync(empty);
    const s = run(['probe', '--session-check', '--repo', empty]);
    assert.equal(s.status, 0, s.stderr);
    assert.deepEqual(s.json.modes, ['default', 'accept-edits', 'auto', 'plan']);
    assert.equal(s.json.readOnlyMode, 'default');
    assert.equal(s.json.writeMode, 'accept-edits');
    assert.ok(s.json.models.includes('gemini-4-argon'));
    assert.match(s.json.warnings.join(' '), /claude-sonnet-5-5/);
    assert.ok(sentMethods(s.record).includes('session/close'));
    assert.ok(!sentMethods(s.record).includes('session/prompt'));
  });

  test('dry-run spawns nothing', () => {
    const r = run(base(['--dry-run']));
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.args, ['acp']);
    assert.equal(r.json.permissionRequests, 'rejected');
    assert.equal(r.record, null);
  });
});
