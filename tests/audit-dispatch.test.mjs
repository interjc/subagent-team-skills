import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs,
  parseAgentTranscript,
  parseExternalJobs,
  summarize,
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
  test('parseAgentTranscript handles single model, malformed line, and mixed models', () => {
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

  test('parseExternalJobs counts Bash and Agent dispatches for codex and agy', () => {
    const mainText = fs.readFileSync(MAIN_FIXTURE, 'utf8');
    assert.deepEqual(parseExternalJobs(mainText), { codex: 2, agy: 1 });
  });

  test('summarize sorts agents by id and tallies most-used model per agent', () => {
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
      { codex: 2, agy: 1 },
    );
    assert.deepEqual(summary.agents.map((a) => a.id), ['agent-a1', 'agent-a2']);
    assert.deepEqual(summary.totals, {
      'claude-opus-5.5': 1,
      'claude-sonnet-5.5': 1,
    });
    assert.deepEqual(summary.external, { codex: 2, agy: 1 });
  });
});

describe('audit-dispatch: CLI via child_process', () => {
  test('end-to-end run prints JSON on stdout and one line per agent on stderr', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--session-dir', FIXTURE_DIR], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.agents.length, 2);
    assert.equal(out.agents[0].id, 'agent-a1');
    assert.equal(out.agents[0].description, 'Senior reviewer for payment module');
    assert.equal(out.agents[1].id, 'agent-a2');
    assert.equal(out.agents[1].description, null);
    assert.deepEqual(out.totals, {
      'claude-opus-5.5': 1,
      'claude-sonnet-5.5': 1,
    });
    assert.deepEqual(out.external, { codex: 2, agy: 1 });
    const stderrLines = r.stderr.trim().split('\n');
    assert.equal(stderrLines.length, 2);
    assert.match(stderrLines[0], /^agent-a1 \(Senior reviewer for payment module\): 2 turn\(s\)/);
    assert.match(stderrLines[1], /^agent-a2: 3 turn\(s\)/);
  });

  test('exits 1 for missing subagents directory or usage error', () => {
    const missing = spawnSync(
      process.execPath,
      [SCRIPT, '--session-dir', path.join(HERE, 'fixtures', 'audit-dispatch', 'does-not-exist')],
      { encoding: 'utf8' },
    );
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing subagents directory/);

    const badArgs = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(badArgs.status, 1);
  });
});
