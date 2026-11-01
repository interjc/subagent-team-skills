import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs,
  parseAgentTranscript,
  parseExternalJobs,
  summarize,
  formatAgentStderr,
  UsageError,
} from '../skills/subagent-team/scripts/audit-dispatch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'skills', 'subagent-team', 'scripts', 'audit-dispatch.mjs');
const FIXTURE_DIR = path.join(HERE, 'fixtures', 'audit-dispatch', 'session-sample');
const MAIN_FIXTURE = path.join(HERE, 'fixtures', 'audit-dispatch', 'session-sample.jsonl');

describe('audit-dispatch: parseArgs', () => {
  test('parses --session-dir and --main', () => {
    assert.deepEqual(parseArgs(['--session-dir', '/tmp/s1']), {
      sessionDir: '/tmp/s1',
      main: null,
      help: false,
    });
    assert.deepEqual(parseArgs(['--session-dir=/tmp/s1', '--main', '/tmp/main.jsonl']), {
      sessionDir: '/tmp/s1',
      main: '/tmp/main.jsonl',
      help: false,
    });
    assert.equal(parseArgs(['--help']).help, true);
  });

  test('throws UsageError on missing or unknown args', () => {
    assert.throws(() => parseArgs([]), UsageError);
    assert.throws(() => parseArgs(['--session-dir']), UsageError);
    assert.throws(() => parseArgs(['--unknown']), UsageError);
  });
});

describe('audit-dispatch: pure functions', () => {
  test('parseAgentTranscript dedupes shared message.id, counts missing id as its own turn, and handles mixed models', () => {
    const a1Text = fs.readFileSync(path.join(FIXTURE_DIR, 'subagents', 'agent-a1.jsonl'), 'utf8');
    const a1 = parseAgentTranscript(a1Text);
    assert.deepEqual(a1, {
      turns: 2,
      models: [
        { model: 'claude-opus-5.5', requestedModel: 'opus', effort: 'high', turns: 2 },
      ],
    });

    const a2Text = fs.readFileSync(path.join(FIXTURE_DIR, 'subagents', 'agent-a2.jsonl'), 'utf8');
    const a2 = parseAgentTranscript(a2Text);
    assert.deepEqual(a2, {
      turns: 3,
      models: [
        { model: 'claude-sonnet-5.5', requestedModel: 'sonnet', effort: 'medium', turns: 2 },
        { model: 'claude-haiku-5.5', requestedModel: null, effort: null, turns: 1 },
      ],
    });
  });

  test('parseExternalJobs separates bash and agentPrompt and ignores text items or non-exec codex commands', () => {
    const textOnly = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-5.5',
        content: [{ type: 'text', text: 'Do not run codex exec here.' }],
      },
    });
    assert.deepEqual(parseExternalJobs(textOnly), {
      codex: { bash: 0, agentPrompt: 0 },
      agy: { bash: 0, agentPrompt: 0 },
      opencode: { bash: 0, agentPrompt: 0 },
    });

    const codexNoExec = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-5.5',
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'codex --version' } }],
      },
    });
    assert.deepEqual(parseExternalJobs(codexNoExec), {
      codex: { bash: 0, agentPrompt: 0 },
      agy: { bash: 0, agentPrompt: 0 },
      opencode: { bash: 0, agentPrompt: 0 },
    });

    const mainText = fs.readFileSync(MAIN_FIXTURE, 'utf8');
    assert.deepEqual(parseExternalJobs(mainText), {
      codex: { bash: 1, agentPrompt: 1 },
      agy: { bash: 2, agentPrompt: 0 },
      opencode: { bash: 0, agentPrompt: 0 },
    });
  });

  test('summarize sorts agents by id, tallies most-used model, and reports dispatchAttempts', () => {
    const summary = summarize(
      [
        {
          id: 'agent-a2',
          description: null,
          turns: 3,
          models: [
            { model: 'claude-sonnet-5.5', requestedModel: 'sonnet', effort: 'medium', turns: 2 },
            { model: 'claude-haiku-5.5', requestedModel: null, effort: null, turns: 1 },
          ],
        },
        {
          id: 'agent-a1',
          description: 'Senior reviewer for payment module',
          turns: 2,
          models: [
            { model: 'claude-opus-5.5', requestedModel: 'opus', effort: 'high', turns: 2 },
          ],
        },
      ],
      { codex: { bash: 1, agentPrompt: 1 }, agy: { bash: 2, agentPrompt: 0 } },
    );
    assert.deepEqual(summary.agents.map((a) => a.id), ['agent-a1', 'agent-a2']);
    assert.deepEqual(summary.totals, {
      'claude-opus-5.5': 1,
      'claude-sonnet-5.5': 1,
    });
    assert.deepEqual(summary.dispatchAttempts, {
      codex: { bash: 1, agentPrompt: 1 },
      agy: { bash: 2, agentPrompt: 0 },
      opencode: { bash: 0, agentPrompt: 0 },
    });
  });

  test('stderr formatting strips control characters including newlines and caps at 120 chars', () => {
    const longDesc = `Line one\nLine two\t${'x'.repeat(150)}`;
    const line = formatAgentStderr({
      id: 'agent-a1',
      description: longDesc,
      turns: 1,
      models: [{ model: 'claude-opus-5.5\nmalicious', requestedModel: 'opus\r', effort: 'high\u0007', turns: 1 }],
    });
    assert.equal(line.includes('\n'), false);
    assert.equal(line.includes('\r'), false);
    assert.equal(line.includes('\t'), false);
    assert.equal(line.includes('\u0007'), false);
    assert.match(line, /^agent-a1 \(Line one Line two /);
    const descMatch = line.match(/^agent-a1 \(([^)]+)\):/);
    assert.ok(descMatch);
    assert.equal(descMatch[1].length, 120);
  });
});

describe('audit-dispatch: CLI via child_process', () => {
  test('--help exits 0 and stdout contains Usage', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/);
    assert.match(r.stdout, /Dispatch attempts come from the main transcript only/);
  });

  test('end-to-end run prints JSON on stdout and one line per agent on stderr', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--session-dir', FIXTURE_DIR], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.agents.length, 2);
    assert.equal(out.agents[0].id, 'agent-a1');
    assert.equal(out.agents[0].description, 'Senior reviewer for payment module');
    assert.equal(out.agents[0].turns, 2);
    assert.equal(out.agents[1].id, 'agent-a2');
    assert.equal(out.agents[1].description, null);
    assert.deepEqual(out.totals, {
      'claude-opus-5.5': 1,
      'claude-sonnet-5.5': 1,
    });
    assert.deepEqual(out.dispatchAttempts, {
      codex: { bash: 1, agentPrompt: 1 },
      agy: { bash: 2, agentPrompt: 0 },
      opencode: { bash: 0, agentPrompt: 0 },
    });
    const stderrLines = r.stderr.trim().split('\n');
    assert.equal(stderrLines.length, 2);
    assert.match(stderrLines[0], /^agent-a1 \(Senior reviewer for payment module\): 2 turn\(s\)/);
    assert.match(stderrLines[1], /^agent-a2: 3 turn\(s\)/);
  });

  test('exits 1 for missing subagents directory, missing --main file, or usage error', () => {
    const missing = spawnSync(
      process.execPath,
      [SCRIPT, '--session-dir', path.join(HERE, 'fixtures', 'audit-dispatch', 'does-not-exist')],
      { encoding: 'utf8' },
    );
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing subagents directory/);

    const missingMain = spawnSync(
      process.execPath,
      [SCRIPT, '--session-dir', FIXTURE_DIR, '--main', path.join(HERE, 'fixtures', 'audit-dispatch', 'no-such-main.jsonl')],
      { encoding: 'utf8' },
    );
    assert.equal(missingMain.status, 1);
    assert.match(missingMain.stderr, /cannot read no-such-main\.jsonl/);
    assert.doesNotMatch(missingMain.stderr, /\bat\s/);

    const badArgs = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(badArgs.status, 1);
  });

  test('an agent-x.jsonl that is a directory exits 1 with no stack in stderr', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-dispatch-io-'));
    try {
      const subDir = path.join(tmp, 'subagents', 'agent-x.jsonl');
      fs.mkdirSync(subDir, { recursive: true });
      const r = spawnSync(process.execPath, [SCRIPT, '--session-dir', tmp], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), 'cannot read agent-x.jsonl');
      assert.doesNotMatch(r.stderr, /\bat\s/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('parseExternalJobs counts OpenCode jobs and the Codex plugin runtime', () => {
  const bash = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  const text = [
    bash('node scripts/opencode-acp-run.mjs run --repo /w --prompt-file /s/j.md --model a/b --effort low'),
    bash('node scripts/opencode-acp-run.mjs probe --repo /w'),
    bash('cd /w && opencode run --standalone --agent x "$(cat /s/j.md)"'),
    bash('node "/p/codex/scripts/codex-companion.mjs" task --background --write --model m --effort low --prompt-file /s/j.md'),
    bash('node "/p/codex/scripts/codex-companion.mjs" status task-1 --wait'),
  ].join('\n');
  assert.deepEqual(parseExternalJobs(text), {
    codex: { bash: 1, agentPrompt: 0 },
    agy: { bash: 0, agentPrompt: 0 },
    opencode: { bash: 2, agentPrompt: 0 },
  });
});
