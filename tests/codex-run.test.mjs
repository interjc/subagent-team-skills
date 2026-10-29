import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, validateEffort, validateSandbox, validateRunOptions, buildExecArgs,
  buildResumeArgs, parseLog, parseDuration, buildResumeHint, timestampDirName, UsageError,
} from '../skills/cli-agent-delegation/scripts/codex-run.mjs';
import { SCRIPTS, FIXTURES, makeTempDir, removeDir, makeFakeBin, runScript, readJson } from './helpers/fakes.mjs';

const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

let tmp;
let repo;
let prompt;
let fakeCodex;

before(() => {
  tmp = makeTempDir('codex-run-test-');
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  prompt = path.join(tmp, 'prompt.md');
  fs.writeFileSync(prompt, 'Summarize the README.\n');
  fakeCodex = makeFakeBin(tmp, 'codex', 'fake-codex.mjs');
});

after(() => removeDir(tmp));

function run(args, { mode = 'ok', env = {} } = {}) {
  const record = path.join(tmp, `record-${Math.random().toString(16).slice(2)}.json`);
  const r = runScript(SCRIPTS.codexRun, args, {
    env: { CODEX_BIN: fakeCodex, FAKE_MODE: mode, FAKE_RECORD: record, ...env },
  });
  r.record = fs.existsSync(record) ? readJson(record) : null;
  return r;
}

function outDir() {
  return fs.mkdtempSync(path.join(tmp, 'out-'));
}

describe('codex-run: validation', () => {
  test('effort is required', () => {
    assert.throws(() => validateEffort(undefined), /--effort is required/);
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--effort is required/);
    assert.equal(r.record, null);
  });

  test('unknown effort is rejected', () => {
    assert.throws(() => validateEffort('turbo'), UsageError);
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'turbo']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown --effort/);
  });

  test('ultra is rejected with an explanation', () => {
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'ultra']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ultra lets Codex spawn its own sub-agents outside the orchestrator's control/);
  });

  test('all supported efforts are accepted', () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(validateEffort(e), e);
  });

  test('sandbox defaults to read-only; danger-full-access rejected', () => {
    assert.equal(validateSandbox(undefined), 'read-only');
    assert.equal(validateSandbox('workspace-write'), 'workspace-write');
    assert.throws(() => validateSandbox('danger-full-access'), /refused/);
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'low', '--sandbox', 'danger-full-access']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /danger-full-access is refused/);
  });

  test('relative repo rejected', () => {
    const r = run(['exec', '--repo', 'repo', '--prompt-file', prompt, '--effort', 'low']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /absolute/);
  });

  test('missing repo dir rejected', () => {
    const r = run(['exec', '--repo', path.join(tmp, 'nope'), '--prompt-file', prompt, '--effort', 'low']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not an existing directory/);
  });

  test('empty and missing prompt files rejected', () => {
    const empty = path.join(tmp, 'empty.md');
    fs.writeFileSync(empty, '  \n');
    let r = run(['exec', '--repo', repo, '--prompt-file', empty, '--effort', 'low']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /empty/);
    r = run(['exec', '--repo', repo, '--prompt-file', path.join(tmp, 'missing.md'), '--effort', 'low']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not exist/);
  });

  test('resume requires --session; unknown options rejected', () => {
    assert.throws(() => validateRunOptions(parseArgs(['resume', '--repo', repo, '--prompt-file', prompt, '--effort', 'low'])), /--session/);
    assert.throws(() => parseArgs(['exec', '--bogus']), /unknown option/);
  });

  test('--help exits 0 and missing command exits 1', () => {
    let r = runScript(SCRIPTS.codexRun, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    r = runScript(SCRIPTS.codexRun, []);
    assert.equal(r.status, 1);
  });

  test('parseDuration and timestamp dir name', () => {
    assert.equal(parseDuration('90s'), 90);
    assert.equal(parseDuration('10m'), 600);
    assert.equal(parseDuration('1h'), 3600);
    assert.equal(parseDuration('45'), 45);
    assert.throws(() => parseDuration('soon'), UsageError);
    assert.throws(() => parseDuration('0'), UsageError);
    assert.equal(timestampDirName(new Date(2026, 0, 2, 3, 4, 5), 'abcd'), '20260102-030405-abcd');
  });
});

describe('codex-run: argv builders', () => {
  test('exec argv', () => {
    assert.deepEqual(
      buildExecArgs({ model: 'gpt-6.1-sol', effort: 'high', sandbox: 'read-only', repo: '/r', outDir: '/o', json: false }),
      ['exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=high', '-s', 'read-only', '-C', '/r', '-o', '/o/last.md', '-'],
    );
    assert.deepEqual(
      buildExecArgs({ effort: 'low', sandbox: 'workspace-write', repo: '/r', outDir: '/o', json: true }),
      ['exec', '-c', 'model_reasoning_effort=low', '-s', 'workspace-write', '-C', '/r', '-o', '/o/last.md', '--json', '-'],
    );
  });

  test('resume argv has no -C/-s and passes sandbox via -c', () => {
    const args = buildResumeArgs({ model: 'm1', effort: 'medium', sandbox: 'workspace-write', session: 'S1', outDir: '/o', json: false });
    assert.deepEqual(args, ['exec', 'resume', '-m', 'm1', '-c', 'model_reasoning_effort=medium',
      '-c', 'sandbox_mode="workspace-write"', '-o', '/o/last.md', 'S1', '-']);
    assert.ok(!args.includes('-C') && !args.includes('-s'));
  });

  test('resume hint', () => {
    const hint = buildResumeHint({ repo: '/my repo', effort: 'high', model: 'm1', sandbox: 'workspace-write' }, 'S1', '/x/codex-run.mjs');
    assert.equal(hint, "node /x/codex-run.mjs resume --repo '/my repo' --session S1 --prompt-file <NEW_PROMPT> --effort high --model m1 --sandbox workspace-write");
    assert.equal(buildResumeHint({ repo: '/r', effort: 'low' }, null), null);
  });
});

describe('codex-run: log parsing', () => {
  test('real header', () => {
    const p = parseLog(fixture('codex-log-header.txt'));
    assert.equal(p.workdir, '/path/to/repo');
    assert.equal(p.model, 'gpt-6.1-sol');
    assert.equal(p.provider, 'openai');
    assert.equal(p.approval, 'never');
    assert.equal(p.sandbox, 'read-only');
    assert.equal(p.effortReported, 'medium');
    assert.equal(p.sessionId, '01a18757-565f-7be2-8317-c8463e263b5c');
    assert.equal(p.tokensUsed, null);
    assert.equal(p.execCount, 0);
  });

  test('tokens on the next line with thousands separators; exec count', () => {
    const p = parseLog(fixture('codex-log-tokens-nextline.txt'));
    assert.equal(p.tokensUsed, 88123);
    assert.equal(p.execCount, 2);
  });

  test('tokens inline', () => {
    assert.equal(parseLog(fixture('codex-log-tokens-inline.txt')).tokensUsed, 88123);
    assert.equal(parseLog('tokens used: 1,234\n').tokensUsed, 1234);
  });

  test('header-like lines after the header block are ignored', () => {
    const p = parseLog(`${fixture('codex-log-header.txt')}codex\nmodel: something-else\n`);
    assert.equal(p.model, 'gpt-6.1-sol');
  });

  test('JSONL events (best effort)', () => {
    const log = [
      '{"type":"thread.started","thread_id":"T-1"}',
      '{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20}}',
    ].join('\n');
    const p = parseLog(log);
    assert.equal(p.sessionId, 'T-1');
    assert.equal(p.tokensUsed, 120);
    assert.equal(p.execCount, 1);
  });

  test('summary subcommand', () => {
    const r = runScript(SCRIPTS.codexRun, ['summary', path.join(FIXTURES, 'codex-log-tokens-nextline.txt')]);
    assert.equal(r.status, 0);
    assert.equal(r.json.tokensUsed, 88123);
    assert.equal(r.json.sessionId, '01a18757-565f-7be2-8317-c8463e263b5c');
    assert.equal(runScript(SCRIPTS.codexRun, ['summary', path.join(tmp, 'nope.txt')]).status, 1);
  });
});

describe('codex-run: running the fake codex', () => {
  test('exec: argv, stdin passthrough, cwd and result files', () => {
    const out = outDir();
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'high', '--model', 'gpt-6.1-sol', '--out-dir', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.record.argv, ['exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=high',
      '-s', 'read-only', '-C', repo, '-o', path.join(out, 'last.md'), '-']);
    assert.equal(r.record.cwd, fs.realpathSync(repo));
    assert.equal(r.record.stdin, 'Summarize the README.\n');
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.exitCode, 0);
    assert.equal(j.timedOut, false);
    assert.equal(j.mode, 'exec');
    assert.equal(j.sessionId, '01a18757-565f-7be2-8317-c8463e263b5c');
    assert.equal(j.model, 'gpt-6.1-sol');
    assert.equal(j.effortRequested, 'high');
    assert.equal(j.effortReported, 'high');
    assert.equal(j.effortMismatch, false);
    assert.equal(j.sandbox, 'read-only');
    assert.equal(j.approval, 'never');
    assert.equal(j.tokensUsed, 4321);
    assert.equal(j.outDir, out);
    assert.equal(j.lastMessageBytes, Buffer.byteLength('Hi from fake codex.\n'));
    assert.match(j.resumeHint, /resume --repo .* --session 01a18757-565f-7be2-8317-c8463e263b5c --prompt-file <NEW_PROMPT> --effort high --model gpt-6.1-sol/);
    assert.deepEqual(readJson(path.join(out, 'summary.json')), j);
    assert.match(fs.readFileSync(path.join(out, 'log.txt'), 'utf8'), /OpenAI Codex v0\.165\.0/);
    assert.doesNotMatch(r.stderr, /no --model/);
  });

  test('exec without --model warns; inline token format', () => {
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'low', '--out-dir', outDir()],
      { env: { FAKE_TOKENS: 'inline' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /no --model given; Codex will use its configured default model/);
    assert.ok(!r.record.argv.includes('-m'));
    assert.equal(r.json.tokensUsed, 4321);
    assert.equal(r.json.model, 'gpt-6.1-sol'); // reported by the log header
  });

  test('default out-dir is created under tmp', () => {
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'low', '--model', 'm']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.json.outDir, /codex-run[/\\]\d{8}-\d{6}-[0-9a-f]{4}$/);
    assert.ok(fs.existsSync(path.join(r.json.outDir, 'summary.json')));
    removeDir(r.json.outDir);
    try { fs.rmdirSync(path.dirname(r.json.outDir)); } catch { /* not empty: other runs live there */ }
  });

  test('resume: argv, cwd = repo, sandbox via -c', () => {
    const out = outDir();
    const r = run(['resume', '--repo', repo, '--session', 'SESSION-9', '--prompt-file', prompt,
      '--effort', 'medium', '--sandbox', 'workspace-write', '--model', 'm1', '--out-dir', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.record.argv, ['exec', 'resume', '-m', 'm1', '-c', 'model_reasoning_effort=medium',
      '-c', 'sandbox_mode="workspace-write"', '-o', path.join(out, 'last.md'), 'SESSION-9', '-']);
    assert.equal(r.record.cwd, fs.realpathSync(repo));
    assert.equal(r.record.stdin, 'Summarize the README.\n');
    assert.equal(r.json.mode, 'resume');
    assert.equal(r.json.sandbox, 'workspace-write');
  });

  test('effort mismatch is reported and warned', () => {
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'medium', '--model', 'm', '--out-dir', outDir()],
      { mode: 'effort-mismatch' });
    assert.equal(r.status, 0);
    assert.equal(r.json.effortReported, 'high');
    assert.equal(r.json.effortMismatch, true);
    assert.match(r.stderr, /requested effort "medium" but codex reported "high"/);
  });

  test('codex failure exit code is propagated', () => {
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'low', '--model', 'm', '--out-dir', outDir()],
      { mode: 'fail' });
    assert.equal(r.status, 3);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.exitCode, 3);
    assert.equal(r.json.lastMessageBytes, 0);
  });

  test('timeout kills a hanging codex and exits 124', () => {
    const started = Date.now();
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'low', '--model', 'm',
      '--timeout', '1s', '--out-dir', outDir()], { mode: 'hang' });
    assert.equal(r.status, 124, r.stderr);
    assert.equal(r.json.timedOut, true);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.exitCode, 124);
    assert.equal(r.json.sessionId, '01a18757-565f-7be2-8317-c8463e263b5c');
    assert.ok(Date.now() - started < 15_000);
  });

  test('missing binary: exit 1 with error', () => {
    const r = runScript(SCRIPTS.codexRun, ['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'low', '--model', 'm', '--out-dir', outDir()],
      { env: { CODEX_BIN: path.join(tmp, 'no-such-codex') } });
    assert.equal(r.status, 1);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /failed to launch/);
  });

  test('dry-run spawns nothing and creates no out-dir', () => {
    const out = path.join(tmp, 'dry-out');
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--effort', 'xhigh', '--out-dir', out, '--json', '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.record, null);
    assert.equal(fs.existsSync(out), false);
    assert.deepEqual(r.json, {
      bin: fakeCodex,
      args: ['exec', '-c', 'model_reasoning_effort=xhigh', '-s', 'read-only', '-C', repo, '-o', path.join(out, 'last.md'), '--json', '-'],
      cwd: repo,
      stdinFile: prompt,
      outDir: out,
    });
  });

  test('dry-run still validates', () => {
    const r = run(['exec', '--repo', repo, '--prompt-file', prompt, '--dry-run']);
    assert.equal(r.status, 1);
    assert.equal(r.record, null);
  });
});
