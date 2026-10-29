import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, validateModel, validateRunOptions, buildArgs, redactPrompt, parseAgyOutput,
  classify, isErrorStatus, isTimeoutStatus, buildContinueHint, parseDuration, MAX_PROMPT_BYTES, UsageError,
} from '../skills/cli-agent-delegation/scripts/agy-run.mjs';
import {
  SCRIPTS, makeTempDir, removeDir, makeFakeBin, runScript, readJson, isAlive, waitUntilGone,
} from './helpers/fakes.mjs';

let tmp;
let repo;
let prompt;
let fakeAgy;
const PROMPT_TEXT = 'List the TODOs in src/.\n';

before(() => {
  tmp = makeTempDir('agy-run-test-');
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  prompt = path.join(tmp, 'prompt.md');
  fs.writeFileSync(prompt, PROMPT_TEXT);
  fakeAgy = makeFakeBin(tmp, 'agy', 'fake-agy.mjs');
});

after(() => removeDir(tmp));

function run(args, { mode = 'ok', env = {} } = {}) {
  const record = path.join(tmp, `record-${Math.random().toString(16).slice(2)}.json`);
  const r = runScript(SCRIPTS.agyRun, args, {
    env: { AGY_BIN: fakeAgy, FAKE_MODE: mode, FAKE_RECORD: record, ...env },
  });
  r.record = fs.existsSync(record) ? readJson(record) : null;
  return r;
}

const outDir = () => fs.mkdtempSync(path.join(tmp, 'out-'));
const baseArgs = (model = 'gemini-3.8-flash-high') => ['run', '--repo', repo, '--prompt-file', prompt, '--model', model];

describe('agy-run: validation', () => {
  test('model is required and needs an effort suffix', () => {
    assert.throws(() => validateModel(undefined), /--model is required/);
    assert.throws(() => validateModel('gemini-3.8-flash'), /gemini-3\.8-flash-high/);
    for (const m of ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-4-argon-high']) assert.equal(validateModel(m), m);
    const r = run(baseArgs('gemini-3.8-flash'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /e\.g\. gemini-3\.8-flash-high/);
    assert.match(r.stderr, /agy models/);
    assert.equal(r.record, null);
  });

  test('claude/gpt models refused unless --allow-any-model', () => {
    assert.throws(() => validateModel('claude-sonnet-5-high'), /defeats the purpose/);
    assert.throws(() => validateModel('GPT-oss-120b-medium'), /defeats the purpose/);
    assert.equal(validateModel('claude-sonnet-5-high', { allowAnyModel: true }), 'claude-sonnet-5-high');
    let r = run([...baseArgs('claude-sonnet-5-high'), '--out-dir', outDir()]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /in-house model family defeats the purpose; use your harness's own subagents instead/);
    r = run([...baseArgs('claude-sonnet-5-high'), '--allow-any-model', '--out-dir', outDir()]);
    assert.equal(r.status, 0, r.stderr);
  });

  test('repo and prompt checks', () => {
    let r = run(['run', '--repo', 'repo', '--prompt-file', prompt, '--model', 'gemini-3.8-flash-high']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /absolute/);
    const empty = path.join(tmp, 'empty.md');
    fs.writeFileSync(empty, '\n');
    r = run(['run', '--repo', repo, '--prompt-file', empty, '--model', 'gemini-3.8-flash-high']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /empty/);
  });

  test('parseArgs and options', () => {
    const o = parseArgs(['run', '--write', '--timeout=90s', '--conversation', 'c1']);
    assert.equal(o.command, 'run');
    assert.equal(o.write, true);
    assert.equal(o.timeout, '90s');
    assert.equal(o.conversation, 'c1');
    assert.throws(() => parseArgs(['run', '--nope']), UsageError);
    assert.throws(() => validateRunOptions(parseArgs([...baseArgs(), '--timeout', 'later'])), /invalid duration/);
  });

  test('a value-taking option does not swallow the next flag', () => {
    assert.throws(() => parseArgs(['run', '--model', '--dry-run']), /--model needs a value, got option --dry-run/);
    const r = run(['run', '--repo', repo, '--prompt-file', prompt, '--model', '--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--model needs a value/);
    assert.equal(r.record, null);
  });

  test('--timeout is capped at 24h', () => {
    assert.equal(parseDuration('24h'), 86400);
    assert.throws(() => parseDuration('25h'), /max 24h/);
    const r = run([...baseArgs(), '--timeout', '1000h', '--out-dir', outDir()]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /too long \(max 24h\)/);
    assert.equal(r.record, null);
  });

  test('prompt files over 100 KB are refused before spawning', () => {
    const big = path.join(tmp, 'big.md');
    fs.writeFileSync(big, 'x'.repeat(MAX_PROMPT_BYTES + 1));
    const r = run(['run', '--repo', repo, '--prompt-file', big, '--model', 'gemini-3.8-flash-high', '--out-dir', outDir()]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Keep the brief short and point agy at a spec file inside the repo, e\.g\. "Read docs\/tasks\/job-spec\.md and follow it\."/);
    assert.equal(r.record, null);
    const ok = path.join(tmp, 'just-fits.md');
    fs.writeFileSync(ok, 'x'.repeat(MAX_PROMPT_BYTES));
    assert.equal(validateRunOptions(parseArgs(['run', '--repo', repo, '--prompt-file', ok, '--model', 'g-high'])).prompt.length, MAX_PROMPT_BYTES);
  });

  test('--help exits 0 and documents exit codes', () => {
    const r = runScript(SCRIPTS.agyRun, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Exit codes:/);
    assert.match(r.stdout, /5 {2}timed out/);
    assert.match(r.stdout, /at most 100 KB/);
    assert.match(r.stdout, /without --write, agy runs\s+with its default permission prompts; in headless mode,\s+actions that need approval are not performed/);
    assert.doesNotMatch(r.stdout, /read-only-ish/);
  });
});

describe('agy-run: pure helpers', () => {
  test('buildArgs maps --write and --timeout', () => {
    const cfg = { prompt: 'P', model: 'g-high', timeoutSec: 600, repo: '/r', conversation: null, write: false };
    assert.deepEqual(buildArgs(cfg),
      ['-p', 'P', '--model', 'g-high', '--output-format', 'json', '--print-timeout', '600s', '--add-dir', '/r']);
    assert.deepEqual(buildArgs({ ...cfg, write: true, conversation: 'c9', timeoutSec: 90 }),
      ['-p', 'P', '--model', 'g-high', '--output-format', 'json', '--print-timeout', '90s', '--add-dir', '/r',
        '--conversation', 'c9', '--dangerously-skip-permissions']);
  });

  test('redactPrompt', () => {
    assert.deepEqual(redactPrompt(['-p', 'hello', '--model', 'x'], '/f.md', 'hello'),
      ['-p', '<prompt from /f.md (5 chars)>', '--model', 'x']);
  });

  test('parseAgyOutput handles clean JSON, leading noise and garbage', () => {
    assert.deepEqual(parseAgyOutput('{"status":"SUCCESS","response":"x"}\n'), { status: 'SUCCESS', response: 'x' });
    assert.deepEqual(parseAgyOutput('Loading {workspace}...\n{"status":"SUCCESS","response":"y"}\n'), { status: 'SUCCESS', response: 'y' });
    assert.deepEqual(parseAgyOutput('noise {"status":"SUCCESS"}'), { status: 'SUCCESS' });
    assert.equal(parseAgyOutput('not json'), null);
    assert.equal(parseAgyOutput('{"status": "SUCCESS", "response": "unterminated'), null);
    assert.equal(parseAgyOutput(''), null);
  });

  test('parseAgyOutput: pretty-printed JSON followed by a trailing line', () => {
    const payload = { status: 'SUCCESS', response: 'ok', usage: { input_tokens: 1 } };
    assert.deepEqual(parseAgyOutput(`${JSON.stringify(payload, null, 2)}\nDone in 3s.\n`), payload);
  });

  test('parseAgyOutput: an unbalanced { in the leading noise', () => {
    const payload = { status: 'SUCCESS', response: 'ok' };
    assert.deepEqual(parseAgyOutput(`warn: template {name missing\n${JSON.stringify(payload)}\n`), payload);
    assert.deepEqual(parseAgyOutput(`[debug] say "{" to start\n${JSON.stringify(payload, null, 2)}`), payload);
  });

  test('parseAgyOutput: braces and escaped quotes inside strings', () => {
    const payload = { status: 'SUCCESS', response: 'use `if (x) { y(); }` and "}" or \\"{\\"', conversation_id: 'c' };
    assert.deepEqual(parseAgyOutput(`noise\n${JSON.stringify(payload)}\ntrailer }`), payload);
  });

  test('parseAgyOutput prefers the payload-looking object, else the last one', () => {
    const text = '{"level":"info","msg":"starting"}\n{"status":"SUCCESS","response":"r"}\n{"level":"info","msg":"bye"}\n';
    assert.deepEqual(parseAgyOutput(text), { status: 'SUCCESS', response: 'r' });
    assert.deepEqual(parseAgyOutput('{"a":1}\n{"b":2}'), { b: 2 });
  });

  test('isErrorStatus', () => {
    assert.equal(isErrorStatus('SUCCESS'), false);
    assert.equal(isErrorStatus('COMPLETED'), false);
    assert.equal(isErrorStatus('ERROR'), true);
    assert.equal(isErrorStatus('FAILED'), true);
    assert.equal(isErrorStatus(undefined), false);
  });

  test('isTimeoutStatus looks only at status values', () => {
    for (const st of ['TIMEOUT', 'TIMED_OUT', 'timed out', 'DEADLINE_EXCEEDED']) assert.equal(isTimeoutStatus(st), true, st);
    for (const st of ['ERROR', 'SUCCESS', undefined, null]) assert.equal(isTimeoutStatus(st), false, String(st));
  });

  test('classify', () => {
    assert.equal(classify({ payload: { status: 'SUCCESS', response: 'r' }, agyExitCode: 0 }).exitCode, 0);
    const warn = classify({ payload: { status: 'ERROR', response: 'r', error: 'boom' }, agyExitCode: 1 });
    assert.equal(warn.exitCode, 0);
    assert.match(warn.warning, /boom/);
    assert.equal(classify({ payload: { status: 'ERROR', response: '', error: { message: 'm' } } }).exitCode, 2);
    // free error text mentioning a timeout is an ordinary agy error, not a resumable timeout
    const errText = classify({ payload: { status: 'ERROR', error: 'upstream connection timeout' } });
    assert.equal(errText.exitCode, 2);
    assert.equal(errText.timedOut, false);
    const ts = classify({ payload: { status: 'TIMEOUT', response: '' } });
    assert.equal(ts.exitCode, 5);
    assert.equal(ts.timedOut, true);
    const partial = classify({ payload: { status: 'TIMEOUT', response: 'half', conversation_id: 'c5' } });
    assert.equal(partial.exitCode, 0);
    assert.equal(partial.partial, true);
    assert.match(partial.warning, /agy hit its time limit; the response may be incomplete; continue with --conversation c5/);
    assert.equal(classify({ interrupted: 'SIGINT', payload: null }).exitCode, 130);
    assert.equal(classify({ interrupted: 'SIGTERM', payload: null }).exitCode, 143);
    assert.equal(classify({ payload: null, agyExitCode: 0 }).exitCode, 3);
    assert.equal(classify({ launchError: 'x' }).exitCode, 3);
    assert.equal(classify({ payload: null, killedByTimeout: true }).exitCode, 5);
  });

  test('continue hint', () => {
    const hint = buildContinueHint({ repo: '/r', model: 'g-high', write: true, timeoutGiven: false }, 'c1', '/s/agy-run.mjs');
    assert.equal(hint, 'node /s/agy-run.mjs run --repo /r --prompt-file <NEW_PROMPT> --model g-high --conversation c1 --write');
    assert.equal(buildContinueHint({ repo: '/r', model: 'g-high' }, null), null);
  });
});

describe('agy-run: running the fake agy', () => {
  test('success: argv, cwd and output files', () => {
    const out = outDir();
    const r = run([...baseArgs(), '--out-dir', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.record.argv, ['-p', PROMPT_TEXT, '--model', 'gemini-3.8-flash-high', '--output-format', 'json',
      '--print-timeout', '600s', '--add-dir', repo]);
    assert.equal(r.record.cwd, fs.realpathSync(repo));
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.exitCode, 0);
    assert.equal(j.status, 'SUCCESS');
    assert.equal(j.timedOut, false);
    assert.equal(j.conversationId, 'conv-123');
    assert.equal(j.model, 'gemini-3.8-flash-high');
    assert.equal(j.durationSeconds, 3.5);
    assert.equal(j.numTurns, 2);
    assert.deepEqual(j.usage, { input_tokens: 100, output_tokens: 20 });
    assert.equal(j.warning, null);
    assert.equal(j.error, null);
    assert.match(j.continueHint, /--conversation conv-123/);
    assert.equal(fs.readFileSync(j.lastMessageFile, 'utf8'), 'Done: all good.');
    assert.equal(readJson(path.join(out, 'result.json')).status, 'SUCCESS');
    assert.ok(fs.existsSync(path.join(out, 'stderr.txt')));
    assert.deepEqual(readJson(path.join(out, 'summary.json')), j);
    assert.doesNotMatch(r.stderr, /dangerously/);
  });

  test('--write adds --dangerously-skip-permissions and prints a note', () => {
    const r = run([...baseArgs(), '--write', '--timeout', '2m', '--conversation', 'conv-1', '--out-dir', outDir()]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.record.argv.includes('--dangerously-skip-permissions'));
    assert.deepEqual(r.record.argv.slice(-5), ['--add-dir', repo, '--conversation', 'conv-1', '--dangerously-skip-permissions']);
    assert.ok(r.record.argv.includes('120s'));
    assert.match(r.stderr, /may edit files and run commands/);
    assert.match(r.json.continueHint, /--write --timeout 120s$/);
  });

  test('leading noise before JSON is tolerated', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'noise-before-json' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(fs.readFileSync(r.json.lastMessageFile, 'utf8'), 'After noise.');
  });

  test('error with response: exit 0 with warning', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'error-with-response' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.status, 'ERROR');
    assert.match(r.json.warning, /tool call failed/);
    assert.match(r.stderr, /warning/);
    assert.equal(fs.readFileSync(r.json.lastMessageFile, 'utf8'), 'Partial answer.');
  });

  test('error without response: exit 2', () => {
    const out = outDir();
    const r = run([...baseArgs(), '--out-dir', out], { mode: 'error-no-response' });
    assert.equal(r.status, 2);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.exitCode, 2);
    assert.equal(r.json.agyExitCode, 1);
    assert.equal(r.json.error, 'quota exceeded');
    assert.match(fs.readFileSync(path.join(out, 'stderr.txt'), 'utf8'), /quota exceeded/);
  });

  test('pretty-printed JSON with noise and a trailing line', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'pretty-json-trailing' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(r.json.lastMessageFile, 'utf8'), 'Pretty {braces} and "quotes" inside.');
  });

  test('timeout status without response: exit 5', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'timeout-status' });
    assert.equal(r.status, 5);
    assert.equal(r.json.timedOut, true);
    assert.equal(r.json.partial, false);
    assert.match(r.stderr, /resumable with --conversation conv-123/);
  });

  test('timeout status with response: exit 0, partial, warning', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'timeout-partial' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.partial, true);
    assert.equal(r.json.timedOut, true);
    assert.match(r.stderr, /agy hit its time limit; the response may be incomplete; continue with --conversation conv-123/);
    assert.equal(fs.readFileSync(r.json.lastMessageFile, 'utf8'), 'Half done: steps 1-3.');
  });

  test('error text mentioning a timeout is an agy error: exit 2', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'error-timeout-text' });
    assert.equal(r.status, 2);
    assert.equal(r.json.timedOut, false);
    assert.equal(r.json.error, 'upstream connection timeout');
  });

  test('unparseable output: exit 3, raw stdout saved', () => {
    const out = outDir();
    const r = run([...baseArgs(), '--out-dir', out], { mode: 'unparseable' });
    assert.equal(r.status, 3);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /could not parse/);
    assert.equal(fs.readFileSync(path.join(out, 'result.json'), 'utf8'), 'this is not json at all\n');
  });

  test('missing binary: exit 3', () => {
    const r = runScript(SCRIPTS.agyRun, [...baseArgs(), '--out-dir', outDir()], { env: { AGY_BIN: path.join(tmp, 'no-agy') } });
    assert.equal(r.status, 3);
    assert.match(r.json.error, /failed to launch/);
  });

  test('outer timeout kills a hanging agy: exit 5', () => {
    const started = Date.now();
    const r = run([...baseArgs(), '--timeout', '1s', '--conversation', 'conv-7', '--out-dir', outDir()],
      { mode: 'hang', env: { AGY_RUN_GRACE_SECONDS: '0' } });
    assert.equal(r.status, 5, r.stderr);
    assert.equal(r.json.timedOut, true);
    assert.equal(r.json.conversationId, 'conv-7');
    assert.match(r.stderr, /resumable with --conversation conv-7/);
    assert.ok(Date.now() - started < 15_000);
    assert.ok(waitUntilGone(r.record.pid), 'fake agy should be gone');
  });

  test('timeout kills the whole process group, even a grandchild holding stdout', () => {
    const started = Date.now();
    const r = run([...baseArgs(), '--timeout', '1s', '--out-dir', outDir()],
      { mode: 'grandchild-hang', env: { AGY_RUN_GRACE_SECONDS: '0' } });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 5, r.stderr);
    assert.equal(r.json.timedOut, true);
    assert.ok(elapsed < 1000 + 5000 + 4000, `took ${elapsed}ms`);
    assert.ok(Number.isInteger(r.record.grandchildPid));
    assert.ok(waitUntilGone(r.record.grandchildPid), 'grandchild sleep should be gone');
    assert.ok(waitUntilGone(r.record.pid), 'fake agy should be gone');
  });

  test('SIGTERM is escalated to SIGKILL for an agy that ignores it', () => {
    const started = Date.now();
    const r = run([...baseArgs(), '--timeout', '1s', '--out-dir', outDir()],
      { mode: 'ignore-term', env: { AGY_RUN_GRACE_SECONDS: '0' } });
    const elapsed = Date.now() - started;
    assert.equal(r.status, 5, r.stderr);
    assert.ok(elapsed >= 1000 + 4500, `SIGKILL came too early: ${elapsed}ms`);
    assert.ok(elapsed < 1000 + 5000 + 4000, `took ${elapsed}ms`);
    assert.ok(waitUntilGone(r.record.pid), 'fake agy should be gone');
  });

  test('a grandchild left behind after a normal exit does not block the wrapper', () => {
    // fake: prints a payload, leaves `sleep 30` holding stdout, and exits.
    const script = path.join(tmp, 'agy-leaves-child.mjs');
    fs.writeFileSync(script, `#!${process.execPath}
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const gc = spawn('sleep', ['30'], { stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ pid: process.pid, grandchildPid: gc.pid }));
process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: 'done', conversation_id: 'c' }) + '\\n');
process.exit(0);
`);
    fs.chmodSync(script, 0o755);
    const started = Date.now();
    const r = run([...baseArgs(), '--out-dir', outDir()], { env: { AGY_BIN: script } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Date.now() - started < 5000, 'wrapper should not wait for the grandchild');
    assert.ok(waitUntilGone(r.record.grandchildPid), 'leftover grandchild should be cleaned up');
  });

  test('SIGINT to the wrapper is forwarded to agy; exit 130', async () => {
    const { spawn } = await import('node:child_process');
    const record = path.join(tmp, 'record-sigint.json');
    const child = spawn(process.execPath, [SCRIPTS.agyRun, ...baseArgs(), '--out-dir', outDir()], {
      env: { ...process.env, AGY_BIN: fakeAgy, FAKE_MODE: 'grandchild-hang', FAKE_RECORD: record },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const deadline = Date.now() + 5000;
    while (!(fs.existsSync(record) && readJson(record).grandchildPid) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 50));
    }
    const rec = readJson(record);
    child.kill('SIGINT');
    const code = await new Promise((res) => child.on('close', res));
    assert.equal(code, 130);
    assert.equal(JSON.parse(stdout).exitCode, 130);
    assert.ok(waitUntilGone(rec.pid), 'fake agy should be gone');
    assert.ok(waitUntilGone(rec.grandchildPid), 'grandchild should be gone');
  });


  test('dry-run redacts the prompt and spawns nothing', () => {
    const out = path.join(tmp, 'dry');
    const r = run([...baseArgs(), '--out-dir', out, '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.record, null);
    assert.equal(fs.existsSync(out), false);
    assert.deepEqual(r.json, {
      bin: fakeAgy,
      args: ['-p', `<prompt from ${prompt} (${PROMPT_TEXT.length} chars)>`, '--model', 'gemini-3.8-flash-high',
        '--output-format', 'json', '--print-timeout', '600s', '--add-dir', repo],
      cwd: repo,
      outDir: out,
    });
  });

  test('models passthrough', () => {
    const r = run(['models']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /gemini-3\.8-flash-high/);
  });
});
