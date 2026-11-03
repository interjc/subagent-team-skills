import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, validateRunOptions, validateShellPattern, buildPermissions, buildAgentConfig, mergeConfigContent,
  flattenValues, describeConfig, applyConfig, createTracker, trackUpdate, finalReply, fullReply, permissionResponse,
  classify, buildResumeHint, isAuthError, AcpClient, READONLY_AGENT, WRITE_AGENT, READ_ONLY_SHELL, EXIT, UsageError, SetupError,
} from '../skills/cli-agent-delegation/scripts/opencode-acp-run.mjs';
import { SCRIPTS, makeTempDir, removeDir, makeFakeBin, runScript, readJson, waitUntilGone, waitForRecord, killLeftovers } from './helpers/fakes.mjs';

let tmp;
let repo;
let prompt;
let fakeOpencode;
const PROMPT_TEXT = 'List the TODOs in src/.\n';
const MODEL = 'opencode/deepseek-v4.1-flash-free';
const FAST = { OPENCODE_ACP_KILL_GRACE_MS: '1000', OPENCODE_ACP_CANCEL_GRACE_MS: '1000' };

before(() => {
  tmp = makeTempDir('opencode-acp-test-');
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  prompt = path.join(tmp, 'prompt.md');
  fs.writeFileSync(prompt, PROMPT_TEXT);
  fakeOpencode = makeFakeBin(tmp, 'opencode', 'fake-opencode.mjs');
});

after(() => removeDir(tmp));

function run(args, { mode = 'ok', env = {} } = {}) {
  const record = path.join(tmp, `record-${Math.random().toString(16).slice(2)}.json`);
  const r = runScript(SCRIPTS.opencodeAcpRun, args, {
    env: { OPENCODE_BIN: fakeOpencode, FAKE_MODE: mode, FAKE_RECORD: record, OPENCODE_CONFIG_CONTENT: undefined, ...FAST, ...env },
  });
  r.record = fs.existsSync(record) ? readJson(record) : null;
  return r;
}

const outDir = () => fs.mkdtempSync(path.join(tmp, 'out-'));
const baseArgs = (model = MODEL, effort = 'high') => ['run', '--repo', repo, '--prompt-file', prompt, '--model', model, '--effort', effort];
const sent = (record, method) => record.received.filter((m) => m.method === method);

describe('opencode-acp-run: validation', () => {
  const v = (extra = []) => validateRunOptions(parseArgs([...baseArgs(), ...extra]));

  test('model and effort are required; model must be provider/model', () => {
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', prompt, '--effort', 'high'])), /--model is required/);
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', prompt, '--model', MODEL])), /--effort is required/);
    assert.throws(() => v(['--model', 'deepseek']), /provider\/model/);
    const r = run(['run', '--repo', repo, '--prompt-file', prompt, '--model', MODEL]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--effort is required/);
    assert.equal(r.record, null);
  });

  test('defaults: read-only injected agent, 30m timeout', () => {
    const cfg = v();
    assert.equal(cfg.agent, READONLY_AGENT);
    assert.equal(cfg.write, false);
    assert.equal(cfg.timeoutSec, 1800);
    assert.equal(v(['--write']).agent, WRITE_AGENT);
  });

  test('forbidden providers are refused', () => {
    assert.throws(() => v(['--model', 'anthropic/claude-haiku-5-5', '--forbid-provider', 'Anthropic']), /forbidden provider \(anthropic\)/);
    assert.equal(v(['--forbid-provider', 'anthropic']).model, MODEL);
  });

  test('--agent excludes the injected-permission options', () => {
    assert.throws(() => v(['--agent', 'review', '--write']), /own permissions/);
    assert.throws(() => v(['--agent', 'review', '--allow-shell', 'npm test']), /own permissions/);
    const cfg = v(['--agent', 'review']);
    assert.equal(cfg.agent, 'review');
    assert.equal(buildAgentConfig(cfg), null);
  });

  test('shell patterns', () => {
    assert.equal(validateShellPattern(' ./node_modules/.bin/tsc * '), './node_modules/.bin/tsc *');
    assert.throws(() => validateShellPattern('*'), /allow any command/);
    assert.throws(() => validateShellPattern('a\nb'), UsageError);
  });

  test('repo, prompt and timeout checks', () => {
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', 'repo', '--prompt-file', prompt, '--model', MODEL, '--effort', 'low'])), /absolute/);
    const empty = path.join(tmp, 'empty.md');
    fs.writeFileSync(empty, '  \n');
    assert.throws(() => validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', empty, '--model', MODEL, '--effort', 'low'])), /empty/);
    assert.throws(() => v(['--timeout', '25h']), /max 24h/);
    assert.throws(() => parseArgs(['run', '--model', '--dry-run']), /needs a value, got option --dry-run/);
    assert.throws(() => parseArgs(['run', '--nope']), UsageError);
  });

  test('--help documents exit codes and the permission set', () => {
    const r = runScript(SCRIPTS.opencodeAcpRun, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Exit codes:/);
    assert.match(r.stdout, /5 {2}timed out/);
    assert.match(r.stdout, /no prompt and no model tokens/);
  });
});

describe('opencode-acp-run: pure helpers', () => {
  test('permissions: deny all, then allow reads; edit only with --write; .env and external dirs denied last', () => {
    const ro = buildPermissions({});
    assert.deepEqual(ro[0], { action: '*', resource: '*', effect: 'deny' });
    assert.ok(!ro.some((r) => r.action === 'edit'));
    assert.ok(READ_ONLY_SHELL.every((c) => ro.some((r) => r.action === 'shell' && r.resource === c && r.effect === 'allow')));
    assert.ok(ro.some((r) => r.action === 'shell' && r.resource === 'git *--output*' && r.effect === 'deny'));
    assert.ok(!ro.some((r) => r.action === 'webfetch'));
    assert.deepEqual(ro.at(-1), { action: 'external_directory', resource: '*', effect: 'deny' });
    const envDeny = ro.findIndex((r) => r.action === 'read' && r.resource === '*.env');
    const readAllow = ro.findIndex((r) => r.action === 'read' && r.resource === '*');
    assert.ok(envDeny > readAllow, 'the .env deny must come after the broad read allow (last match wins)');
    const rw = buildPermissions({ write: true, allowShell: ['npm test *'], allowWeb: true });
    assert.ok(rw.some((r) => r.action === 'edit' && r.effect === 'allow'));
    assert.ok(rw.some((r) => r.action === 'shell' && r.resource === 'npm test *'));
    assert.ok(rw.some((r) => r.action === 'webfetch' && r.effect === 'allow'));
  });

  test('agent config and merging with an existing OPENCODE_CONFIG_CONTENT', () => {
    const cfg = { agent: READONLY_AGENT, customAgent: null, write: false, allowShell: [], allowWeb: false };
    const injected = buildAgentConfig(cfg);
    assert.equal(injected.agents[READONLY_AGENT].mode, 'primary');
    const merged = JSON.parse(mergeConfigContent('{"model":"x/y","agents":{"mine":{"mode":"subagent"}}}', injected));
    assert.equal(merged.model, 'x/y');
    assert.deepEqual(Object.keys(merged.agents).sort(), ['mine', READONLY_AGENT].sort());
    assert.throws(() => mergeConfigContent('{not json', injected), /not valid JSON/);
    assert.equal(mergeConfigContent(undefined, null), null);
  });

  test('flattenValues handles grouped options; describeConfig', () => {
    assert.deepEqual(flattenValues({ options: [{ group: 'a', options: [{ value: 'x' }] }, { group: 'b', options: [{ value: 'y' }] }] }), ['x', 'y']);
    const d = describeConfig([{ id: 'model', category: 'model', currentValue: 'm', options: [{ value: 'm' }] }]);
    assert.deepEqual(d.model, { id: 'model', current: 'm', values: ['m'] });
    assert.equal(d.effort, null);
  });

  test('applyConfig selects agent, model, effort in order and verifies', async () => {
    const calls = [];
    const state = { mode: 'build', model: 'a/b', effort: 'default' };
    const opts = () => [
      { id: 'model', category: 'model', currentValue: state.model, options: [{ value: 'a/b' }, { value: 'c/d' }] },
      { id: 'effort', category: 'thought_level', currentValue: state.effort, options: [{ value: 'low' }, { value: 'default' }] },
      { id: 'mode', category: 'mode', currentValue: state.mode, options: [{ value: 'build' }, { value: READONLY_AGENT }] },
    ];
    const client = { request: async (method, p) => { calls.push(p.configId); state[p.configId] = p.value; return { configOptions: opts() }; } };
    const r = await applyConfig(client, 's1', opts(), { agent: READONLY_AGENT, model: 'c/d', effort: 'low' });
    assert.deepEqual(calls, ['mode', 'model', 'effort']);
    assert.deepEqual(r.applied, { agent: READONLY_AGENT, model: 'c/d', effort: 'low' });
    await assert.rejects(applyConfig(client, 's1', opts(), { agent: READONLY_AGENT, model: 'z/z', effort: 'low' }), /not offered/);
    await assert.rejects(applyConfig(client, 's1', opts(), { agent: READONLY_AGENT, model: 'a/b', effort: 'max' }), (e) => e instanceof SetupError && /offered: low, default/.test(e.message));
    await assert.rejects(applyConfig(client, 's1', opts(), { agent: 'ghost', model: 'a/b', effort: 'low' }), /OPENCODE_CONFIG_CONTENT/);
  });

  test('applyConfig tries a dropped effort once more, then gives up', async () => {
    const opts = (effort) => [
      { id: 'model', category: 'model', currentValue: 'a/b', options: [{ value: 'a/b' }] },
      { id: 'effort', category: 'thought_level', currentValue: effort, options: [{ value: 'low' }, { value: 'default' }] },
      { id: 'mode', category: 'mode', currentValue: READONLY_AGENT, options: [{ value: READONLY_AGENT }] },
    ];
    const cfg = { agent: READONLY_AGENT, model: 'a/b', effort: 'low' };
    let sets = 0;
    const flaky = { request: async () => { sets += 1; return { configOptions: opts(sets === 1 ? 'default' : 'low') }; } };
    const r = await applyConfig(flaky, 's1', opts('default'), cfg);
    assert.equal(sets, 2);
    assert.equal(r.applied.effort, 'low');

    sets = 0;
    const stuck = { request: async () => { sets += 1; return { configOptions: opts('default') }; } };
    await assert.rejects(applyConfig(stuck, 's1', opts('default'), cfg), /effort is "default" after selecting "low"/);
    assert.equal(sets, 2);
  });

  test('tracker: segments split at tool calls, child updates ignored, retries and cost recorded', () => {
    const t = createTracker();
    trackUpdate(t, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Plan: ' } });
    trackUpdate(t, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'read it.' } });
    trackUpdate(t, { sessionUpdate: 'tool_call', toolCallId: 'c1' });
    trackUpdate(t, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed' });
    trackUpdate(t, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'child' }, _meta: { 'opencode/child-session': { id: 'x' } } });
    trackUpdate(t, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Final.' } });
    trackUpdate(t, { sessionUpdate: 'usage_update', used: 5, size: 10, cost: { amount: 0.5, currency: 'USD' } });
    trackUpdate(t, { sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': { attempt: 1, error: { type: 'x', message: 'busy' } } } });
    trackUpdate(t, { sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': null } });
    assert.equal(finalReply(t), 'Final.');
    assert.equal(fullReply(t), 'Plan: read it.\n\nFinal.');
    assert.equal(t.toolCalls, 1);
    assert.equal(t.failedToolCalls.size, 1);
    assert.equal(t.childUpdates, 1);
    assert.equal(t.retries, 1);
    assert.equal(t.lastRetryError.message, 'busy');
    assert.deepEqual(t.cost, { amount: 0.5, currency: 'USD' });
  });

  test('permission requests are rejected, or cancelled when no reject option exists', () => {
    const t = createTracker();
    const r = permissionResponse(t, { toolCall: { toolCallId: 'c', title: 'rm x', kind: 'execute' }, options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] });
    assert.deepEqual(r, { outcome: { outcome: 'selected', optionId: 'no' } });
    assert.deepEqual(permissionResponse(t, { options: [{ optionId: 'once', kind: 'allow_once' }] }), { outcome: { outcome: 'cancelled' } });
    assert.deepEqual(t.permissionRequests.map((p) => p.decision), ['rejected', 'cancelled']);
  });

  test('classify', () => {
    const base = { reply: 'r', sessionId: 's', timeoutSec: 60 };
    assert.equal(classify({ ...base, stopReason: 'end_turn' }).exitCode, EXIT.OK);
    assert.equal(classify({ ...base, reply: '', stopReason: 'end_turn' }).exitCode, EXIT.AGENT_ERROR);
    const partial = classify({ ...base, stopReason: 'max_tokens' });
    assert.equal(partial.exitCode, EXIT.OK);
    assert.equal(partial.partial, true);
    assert.match(partial.warning, /continue with --session s/);
    assert.equal(classify({ ...base, reply: '', stopReason: 'max_tokens' }).exitCode, EXIT.AGENT_ERROR);
    assert.equal(classify({ ...base, stopReason: 'refusal' }).exitCode, EXIT.AGENT_ERROR);
    const to = classify({ ...base, timedOut: true, stopReason: 'cancelled' });
    assert.equal(to.exitCode, EXIT.TIMEOUT);
    assert.equal(to.partial, true);
    const auth = classify({ ...base, promptError: Object.assign(new Error('session/prompt: Authentication required'), { code: -32000 }) });
    assert.equal(auth.exitCode, EXIT.AGENT_ERROR);
    assert.equal(auth.authRequired, true);
    assert.match(auth.error, /opencode auth login/);
    assert.equal(classify({ launchError: 'x' }).exitCode, EXIT.SETUP);
    assert.equal(classify({ setupError: 'x' }).exitCode, EXIT.SETUP);
    assert.equal(classify({ interrupted: 'SIGINT' }).exitCode, 130);
    const warn = classify({ ...base, stopReason: 'end_turn', permissionRequests: [{}], failedToolCalls: 2, setupWarnings: ['no effort'] });
    assert.match(warn.warning, /no effort.*permission request.*2 tool call/);
    assert.equal(isAuthError({ code: -32000 }), true);
    assert.equal(isAuthError({ code: -32603, message: 'boom' }), false);
  });

  test('resume hint carries the permission options', () => {
    const hint = buildResumeHint({ repo: '/r', model: 'a/b', effort: 'low', write: true, allowShell: ['npm test *'], allowWeb: false, forbidProvider: ['anthropic'], timeoutGiven: true, timeoutSec: 90 }, 'ses_1', '/s/run.mjs');
    assert.equal(hint, "node /s/run.mjs run --repo /r --session ses_1 --prompt-file <NEW_PROMPT> --model a/b --effort low --write --allow-shell 'npm test *' --forbid-provider anthropic --timeout 90s");
    assert.equal(buildResumeHint({}, null), null);
  });

  test('AcpClient: requests, errors, notifications, agent requests, noise', async () => {
    const out = [];
    const notes = [];
    const c = new AcpClient({
      send: (s) => out.push(JSON.parse(s)),
      onNotification: (m) => notes.push(m),
      onRequest: async (m) => { if (m === 'ping') return { pong: true }; throw Object.assign(new Error('nope'), { code: -32601 }); },
    });
    const p = c.request('initialize', {});
    c.handleLine(JSON.stringify({ jsonrpc: '2.0', id: out[0].id, result: { ok: 1 } }));
    assert.deepEqual(await p, { ok: 1 });
    const e = c.request('session/prompt', {});
    c.handleLine(JSON.stringify({ jsonrpc: '2.0', id: out[1].id, error: { code: -32000, message: 'Authentication required' } }));
    await assert.rejects(e, (err) => err.code === -32000 && err.rpc === true);
    c.handleLine('not json');
    assert.equal(c.nonJsonLines, 1);
    c.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {} }));
    assert.deepEqual(notes, ['session/update']);
    c.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }));
    c.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'fs/read_text_file' }));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(out.find((m) => m.id === 7).result, { pong: true });
    assert.equal(out.find((m) => m.id === 8).error.code, -32601);
    const t = c.request('slow', {}, 20);
    await assert.rejects(t, /no response within/);
    const closed = c.request('x', {});
    c.close(new Error('gone'));
    await assert.rejects(closed, /gone/);
  });
});

describe('opencode-acp-run: running the fake opencode', () => {
  test('success: handshake order, injected agent, output files', () => {
    const out = outDir();
    const r = run([...baseArgs(), '--out-dir', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.record.argv, ['acp']);
    assert.equal(r.record.cwd, fs.realpathSync(repo));
    const injected = JSON.parse(r.record.configContent);
    assert.deepEqual(Object.keys(injected.agents), [READONLY_AGENT]);
    const methods = r.record.received.filter((m) => m.method).map((m) => m.method);
    assert.deepEqual(methods, ['initialize', 'session/new', 'session/set_config_option', 'session/set_config_option',
      'session/set_config_option', 'session/prompt', 'session/close']);
    assert.deepEqual(sent(r.record, 'session/set_config_option').map((m) => [m.params.configId, m.params.value]),
      [['mode', READONLY_AGENT], ['model', MODEL], ['effort', 'high']]);
    const init = sent(r.record, 'initialize')[0].params;
    assert.equal(init.protocolVersion, 1);
    assert.deepEqual(init.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
    assert.equal(sent(r.record, 'session/new')[0].params.cwd, repo);
    assert.deepEqual(sent(r.record, 'session/prompt')[0].params.prompt, [{ type: 'text', text: PROMPT_TEXT }]);
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.stopReason, 'end_turn');
    assert.equal(j.sessionId, 'ses_fake1');
    assert.equal(j.opencodeVersion, '2.2.5');
    assert.equal(j.agent, READONLY_AGENT);
    assert.equal(j.model, MODEL);
    assert.equal(j.effort, 'high');
    assert.equal(j.toolCalls, 1);
    assert.equal(j.failedToolCalls, 0);
    assert.deepEqual(j.usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150 });
    assert.deepEqual(j.cost, { amount: 0.012, currency: 'USD' });
    assert.equal(j.warning, null);
    assert.equal(fs.readFileSync(j.lastMessageFile, 'utf8'), 'Done: all good.');
    assert.equal(fs.readFileSync(j.replyFile, 'utf8'), 'Looking at the code.\n\nDone: all good.');
    assert.ok(fs.readFileSync(j.eventsFile, 'utf8').includes('"dir":"in"'));
    assert.deepEqual(readJson(path.join(out, 'summary.json')), j);
    assert.match(j.resumeHint, /--session ses_fake1/);
    assert.ok(waitUntilGone(r.record.pid), 'fake opencode should be gone');
  });

  test('--write injects the write agent; an existing OPENCODE_CONFIG_CONTENT is kept', () => {
    const r = run([...baseArgs(), '--write', '--allow-shell', 'npm test *', '--out-dir', outDir()], { env: { OPENCODE_CONFIG_CONTENT: '{"model":"x/y"}' } });
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(r.record.configContent);
    assert.equal(cfg.model, 'x/y');
    const rules = cfg.agents[WRITE_AGENT].permissions;
    assert.ok(rules.some((x) => x.action === 'edit' && x.effect === 'allow'));
    assert.ok(rules.some((x) => x.action === 'shell' && x.resource === 'npm test *'));
    assert.equal(r.json.agent, WRITE_AGENT);
    assert.match(r.stderr, /--write lets the agent edit files/);
  });

  test('resume uses session/resume with the same cwd', () => {
    const r = run([...baseArgs(), '--session', 'ses_old', '--out-dir', outDir()]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sent(r.record, 'session/new').length, 0);
    assert.deepEqual(sent(r.record, 'session/resume')[0].params, { sessionId: 'ses_old', cwd: repo, mcpServers: [] });
    assert.equal(r.json.sessionId, 'ses_old');
    const bad = run([...baseArgs(), '--session', 'ses_gone', '--out-dir', outDir()], { mode: 'resume-fails' });
    assert.equal(bad.status, EXIT.SETUP);
    assert.match(bad.json.error, /session\/resume failed: .*not found/);
  });

  test('a permission request is rejected and reported', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'permission' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.record.permissionReply, { outcome: { outcome: 'selected', optionId: 'reject' } });
    assert.deepEqual(r.json.permissionRequests, [{ toolCallId: 'call_1', title: 'rm -rf build', kind: 'execute', decision: 'rejected' }]);
    assert.match(r.json.warning, /1 permission request\(s\) were rejected/);
  });

  test('failed tool calls, child-session updates and retries produce warnings, not failures', () => {
    let r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'failed-tool' });
    assert.equal(r.status, 0);
    assert.equal(r.json.failedToolCalls, 1);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'child' });
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(r.json.lastMessageFile, 'utf8'), 'Parent reply.');
    assert.equal(r.json.childSessionUpdates, 2);
    assert.equal(r.json.failedToolCalls, 1);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'retry' });
    assert.equal(r.status, 0);
    assert.equal(r.json.retries, 1);
    assert.match(r.json.warning, /Rate limit exceeded/);
  });

  test('grouped model options are accepted', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'grouped' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.model, MODEL);
  });

  test('setup failures: model, effort, injected agent, sticky model', () => {
    let r = run([...baseArgs('google/gemini-x'), '--out-dir', outDir()]);
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /model "google\/gemini-x" is not offered/);
    assert.equal(sent(r.record, 'session/prompt').length, 0);
    r = run([...baseArgs(MODEL, 'medium'), '--out-dir', outDir()]);
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /effort "medium" is not offered .*low, high, max, default/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'no-injected-agent' });
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /did not pick up the injected agent/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'sticky-model' });
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /model is "openai\/gpt-6\.1-terra" after selecting/);
  });

  test('a model without effort levels: "default" is fine, anything else warns', () => {
    let r = run([...baseArgs(MODEL, 'default'), '--out-dir', outDir()], { mode: 'no-effort' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.effort, null);
    assert.equal(r.json.warning, null);
    r = run([...baseArgs(MODEL, 'high'), '--out-dir', outDir()], { mode: 'no-effort' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.json.warning, /offers no effort levels; --effort high was not applied/);
  });

  test('agent errors: auth required, refusal, empty reply, max tokens', () => {
    let r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'auth-required' });
    assert.equal(r.status, EXIT.AGENT_ERROR);
    assert.equal(r.json.authRequired, true);
    assert.match(r.stderr, /opencode auth login/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'refusal' });
    assert.equal(r.status, EXIT.AGENT_ERROR);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'empty-reply' });
    assert.equal(r.status, EXIT.AGENT_ERROR);
    assert.match(r.json.error, /without a reply/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'max-tokens' });
    assert.equal(r.status, 0);
    assert.equal(r.json.partial, true);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'max-tokens-empty' });
    assert.equal(r.status, EXIT.AGENT_ERROR);
  });

  test('launch and protocol failures: exit 3', () => {
    let r = runScript(SCRIPTS.opencodeAcpRun, [...baseArgs(), '--out-dir', outDir()], { env: { OPENCODE_BIN: path.join(tmp, 'no-opencode') } });
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /failed to launch/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'garbage' });
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /initialize failed/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'crash' });
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /exited .*provider exploded/);
    r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'init-hang', env: { OPENCODE_ACP_HANDSHAKE_MS: '300' } });
    assert.equal(r.status, EXIT.SETUP);
    assert.match(r.json.error, /initialize: no response/);
    assert.ok(waitUntilGone(r.record.pid), 'fake opencode should be gone');
  });

  test('timeout: session/cancel first; a cooperative agent ends with cancelled', () => {
    const started = Date.now();
    const r = run([...baseArgs(), '--timeout', '1s', '--out-dir', outDir()], { mode: 'hang' });
    assert.equal(r.status, EXIT.TIMEOUT, r.stderr);
    assert.equal(r.json.timedOut, true);
    assert.equal(r.json.stopReason, 'cancelled');
    assert.equal(r.json.partial, true);
    assert.equal(sent(r.record, 'session/cancel').length, 1);
    assert.match(r.stderr, /resumable with --session ses_fake1/);
    assert.ok(Date.now() - started < 10_000);
    assert.ok(waitUntilGone(r.record.pid));
  });

  test('timeout: an agent that ignores cancel and SIGTERM is killed with its descendants', () => {
    let r = run([...baseArgs(), '--timeout', '1s', '--out-dir', outDir()], { mode: 'ignore-term' });
    assert.equal(r.status, EXIT.TIMEOUT, r.stderr);
    assert.ok(waitUntilGone(r.record.pid), 'fake opencode should be gone');
    r = run([...baseArgs(), '--timeout', '1s', '--out-dir', outDir()], { mode: 'grandchild-hang' });
    assert.equal(r.status, EXIT.TIMEOUT, r.stderr);
    assert.ok(Number.isInteger(r.record.grandchildPid));
    assert.ok(waitUntilGone(r.record.grandchildPid), 'grandchild should be gone');
    assert.ok(waitUntilGone(r.record.pid), 'fake opencode should be gone');
  });

  test('SIGINT to the wrapper cancels and stops opencode; exit 130', async () => {
    const { spawn } = await import('node:child_process');
    const record = path.join(tmp, 'record-sigint.json');
    const child = spawn(process.execPath, [SCRIPTS.opencodeAcpRun, ...baseArgs(), '--out-dir', outDir()], {
      env: { ...process.env, OPENCODE_BIN: fakeOpencode, FAKE_MODE: 'hang-hard', FAKE_RECORD: record, ...FAST },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    try {
      const rec = await waitForRecord(record, (r) => r.received.some((m) => m.method === 'session/prompt'));
      child.kill('SIGINT');
      const code = await new Promise((res) => child.on('close', res));
      assert.equal(code, 130);
      assert.equal(JSON.parse(stdout).exitCode, 130);
      assert.ok(readJson(record).received.some((m) => m.method === 'session/cancel'));
      assert.ok(waitUntilGone(rec.pid), 'fake opencode should be gone');
    } finally {
      killLeftovers(child, record);
    }
  });

  test('dry-run prints the plan and spawns nothing', () => {
    const out = path.join(tmp, 'dry');
    const r = run([...baseArgs(), '--write', '--out-dir', out, '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.record, null);
    assert.equal(fs.existsSync(out), false);
    assert.deepEqual(r.json.args, ['acp']);
    assert.ok(r.json.injectedConfig.agents[WRITE_AGENT]);
    assert.match(r.json.steps.join(' | '), /set agent subagent-team-write \| set model .* \| set effort high/);
  });

  test('probe: handshake facts, model efforts, session deleted, no prompt sent', () => {
    const r = run(['probe', '--repo', repo, '--model', MODEL]);
    assert.equal(r.status, 0, r.stderr);
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.opencodeVersion, '2.2.5');
    assert.deepEqual(j.authMethods, ['opencode-login']);
    assert.ok(j.models.includes(MODEL));
    assert.equal(j.defaultModel, 'openai/gpt-6.1-terra');
    assert.ok(j.agents.includes(READONLY_AGENT));
    assert.equal(j.injectedAgentsVisible, true);
    assert.deepEqual(j.effort, { model: MODEL, values: ['low', 'high', 'max', 'default'], current: 'default' });
    assert.equal(sent(r.record, 'session/prompt').length, 0);
    assert.equal(sent(r.record, 'session/delete').length, 1);
    const hidden = run(['probe', '--repo', repo], { mode: 'no-injected-agent' });
    assert.equal(hidden.status, 0);
    assert.equal(hidden.json.injectedAgentsVisible, false);
    assert.match(hidden.stderr, /cannot enforce its permission set/);
    const missing = runScript(SCRIPTS.opencodeAcpRun, ['probe', '--repo', repo], { env: { OPENCODE_BIN: path.join(tmp, 'no-opencode') } });
    assert.equal(missing.status, EXIT.SETUP);
    assert.match(missing.json.error, /failed to launch/);
  });
});
