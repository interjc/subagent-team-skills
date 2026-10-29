import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, validateModel, validateRunOptions, buildArgs, redactPrompt, parseAgyOutput,
  classify, isErrorStatus, buildContinueHint, UsageError,
} from '../skills/cli-agent-delegation/scripts/agy-run.mjs';
import { SCRIPTS, makeTempDir, removeDir, makeFakeBin, runScript, readJson } from './helpers/fakes.mjs';

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

  test('--help exits 0 and documents exit codes', () => {
    const r = runScript(SCRIPTS.agyRun, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Exit codes:/);
    assert.match(r.stdout, /5 {2}timed out/);
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
    assert.equal(parseAgyOutput(''), null);
  });

  test('isErrorStatus', () => {
    assert.equal(isErrorStatus('SUCCESS'), false);
    assert.equal(isErrorStatus('COMPLETED'), false);
    assert.equal(isErrorStatus('ERROR'), true);
    assert.equal(isErrorStatus('FAILED'), true);
    assert.equal(isErrorStatus(undefined), false);
  });

  test('classify', () => {
    assert.equal(classify({ payload: { status: 'SUCCESS', response: 'r' }, agyExitCode: 0 }).exitCode, 0);
    const warn = classify({ payload: { status: 'ERROR', response: 'r', error: 'boom' }, agyExitCode: 1 });
    assert.equal(warn.exitCode, 0);
    assert.match(warn.warning, /boom/);
    assert.equal(classify({ payload: { status: 'ERROR', response: '', error: { message: 'm' } } }).exitCode, 2);
    assert.equal(classify({ payload: { status: 'ERROR', error: 'print timeout exceeded' } }).exitCode, 5);
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

  test('timeout reported by agy: exit 5', () => {
    const r = run([...baseArgs(), '--out-dir', outDir()], { mode: 'timeout-reported' });
    assert.equal(r.status, 5);
    assert.equal(r.json.timedOut, true);
    assert.match(r.stderr, /resumable with --conversation conv-123/);
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
