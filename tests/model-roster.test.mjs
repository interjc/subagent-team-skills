import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, selectModels, formatTable, formatReport, DEFAULT_VENDORS, FOOTER, UsageError,
} from '../skills/subagent-team/scripts/model-roster.mjs';
import { SCRIPTS, FIXTURES, makeTempDir, removeDir, runScript } from './helpers/fakes.mjs';

const FIXTURE = path.join(FIXTURES, 'openrouter-models.json');
const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const NOW = Date.UTC(2026, 9, 29); // the fixture's "created" values are relative to this
const defaults = () => parseArgs([]);
const ids = (list) => list.map((m) => m.id);

describe('model-roster: parseArgs', () => {
  test('defaults', () => {
    assert.deepEqual(parseArgs([]), {
      vendors: DEFAULT_VENDORS, sinceDays: 365, limit: 8, includeVariants: false, file: null, json: false, help: false,
    });
  });

  test('options', () => {
    const o = parseArgs(['--vendors', 'Anthropic, google,,anthropic', '--since-days=30', '--limit', '2', '--include-variants', '--file', 'x.json', '--json']);
    assert.deepEqual(o.vendors, ['anthropic', 'google']);
    assert.equal(o.sinceDays, 30);
    assert.equal(o.limit, 2);
    assert.equal(o.includeVariants, true);
    assert.equal(o.file, 'x.json');
    assert.equal(o.json, true);
  });

  test('usage errors', () => {
    assert.throws(() => parseArgs(['--limit', '0']), UsageError);
    assert.throws(() => parseArgs(['--since-days', 'abc']), UsageError);
    assert.throws(() => parseArgs(['--vendors']), UsageError);
    assert.throws(() => parseArgs(['--what']), UsageError);
    assert.throws(() => parseArgs(['--file', '--json']), /--file needs a value, got option --json/);
  });
});

describe('model-roster: selectModels', () => {
  test('default selection: vendor prefix, no variants, within a year, newest first', () => {
    const v = selectModels(data, defaults(), NOW);
    assert.deepEqual(Object.keys(v), DEFAULT_VENDORS);
    assert.deepEqual(ids(v.anthropic), ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5', 'anthropic/claude-haiku-5']);
    // missing `created` is kept and sorted last
    assert.deepEqual(ids(v.openai), ['openai/gpt-6.1', 'openai/gpt-6.1-mini', 'openai/o9-legacy']);
    assert.deepEqual(ids(v.google), ['google/gemini-3.8-pro', 'google/gemini-3.8-flash', 'google/gemma-5-27b']);
    assert.deepEqual(ids(v.deepseek), ['deepseek/deepseek-v4', 'deepseek/deepseek-r2']);
  });

  test('model fields', () => {
    const v = selectModels(data, defaults(), NOW);
    assert.deepEqual(v.anthropic[0], {
      id: 'anthropic/claude-opus-5.5',
      name: 'Anthropic: Claude Opus 5.5',
      listed: '2026-10-09',
      contextLength: 1000000,
      inputPerMTok: 15,
      outputPerMTok: 75,
    });
    assert.equal(v.openai[0].inputPerMTok, 1.25);
    const legacy = v.openai.find((m) => m.id === 'openai/o9-legacy');
    assert.equal(legacy.listed, null);
    assert.equal(legacy.inputPerMTok, null);
    const gemma = v.google.find((m) => m.id === 'google/gemma-5-27b');
    assert.equal(gemma.inputPerMTok, null); // "-1" means variable pricing
  });

  test('variants included on request', () => {
    const v = selectModels(data, { ...defaults(), includeVariants: true }, NOW);
    assert.equal(v.anthropic[0].id, 'anthropic/claude-opus-5.5:thinking');
    assert.ok(ids(v.openai).includes('openai/gpt-oss-200b:free'));
  });

  test('since-days and limit', () => {
    const v = selectModels(data, { ...defaults(), sinceDays: 30, limit: 1 }, NOW);
    assert.deepEqual(ids(v.anthropic), ['anthropic/claude-opus-5.5']);
    assert.deepEqual(ids(v.openai), ['openai/gpt-6.1']);
    assert.deepEqual(ids(selectModels(data, { ...defaults(), sinceDays: 30 }, NOW).deepseek), []);
    assert.ok(ids(selectModels(data, { ...defaults(), sinceDays: 1000 }, NOW).anthropic).includes('anthropic/claude-3-opus'));
  });

  test('custom vendors and bare arrays', () => {
    const v = selectModels(data.data, { ...defaults(), vendors: ['meta-llama'] }, NOW);
    assert.deepEqual(Object.keys(v), ['meta-llama']);
    assert.deepEqual(ids(v['meta-llama']), ['meta-llama/llama-5-405b']);
    assert.deepEqual(selectModels({}, defaults(), NOW).anthropic, []);
  });
});

describe('model-roster: formatting', () => {
  test('formatTable aligns columns with 2-decimal prices and ? for unknowns', () => {
    const table = formatTable([
      { id: 'anthropic/claude-opus-5.5', listed: '2026-10-09', contextLength: 1000000, inputPerMTok: 15, outputPerMTok: 75 },
      { id: 'x/y', listed: null, contextLength: null, inputPerMTok: null, outputPerMTok: 0.1234 },
    ]);
    assert.equal(table, [
      'id                         listed      context  $/1M in  $/1M out',
      '-------------------------  ----------  -------  -------  --------',
      'anthropic/claude-opus-5.5  2026-10-09  1000000    15.00     75.00',
      'x/y                        ?                 ?        ?      0.12',
    ].join('\n'));
  });

  test('formatReport has a section per vendor and the footer', () => {
    const text = formatReport({ anthropic: selectModels(data, defaults(), NOW).anthropic, mistralai: [] });
    assert.match(text, /^== anthropic ==$/m);
    assert.match(text, /^== mistralai ==\n\(no matching models\)$/m);
    assert.ok(text.trimEnd().endsWith(FOOTER));
  });
});

describe('model-roster: CLI', () => {
  // --since-days is large so the run does not depend on today's date.
  test('--file --json end to end', () => {
    const r = runScript(SCRIPTS.modelRoster, ['--file', FIXTURE, '--since-days', '100000', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.source, `file:${FIXTURE}`);
    assert.ok(!Number.isNaN(Date.parse(r.json.fetchedAt)));
    assert.deepEqual(Object.keys(r.json.vendors), DEFAULT_VENDORS);
    assert.equal(r.json.vendors.anthropic[0].id, 'anthropic/claude-opus-5.5');
    assert.ok(ids(r.json.vendors.anthropic).includes('anthropic/claude-3-opus'));
  });

  test('--file human output', () => {
    const r = runScript(SCRIPTS.modelRoster, ['--file', FIXTURE, '--since-days', '100000', '--vendors', 'google', '--limit', '2']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== google ==/);
    assert.match(r.stdout, /google\/gemini-3\.8-pro\s+\d{4}-\d{2}-\d{2}\s+2000000\s+2\.50\s+15\.00/);
    assert.doesNotMatch(r.stdout, /gemma/);
    assert.match(r.stdout, /OpenRouter lists what OpenRouter serves/);
  });

  test('unreadable --file exits 2 with fallback pointers', () => {
    const tmp = makeTempDir('roster-test-');
    try {
      const bad = path.join(tmp, 'bad.json');
      fs.writeFileSync(bad, '{oops');
      const r = runScript(SCRIPTS.modelRoster, ['--file', bad]);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /https:\/\/platform\.claude\.com\/docs\/en\/about-claude\/models\/overview/);
      assert.doesNotMatch(r.stderr, /docs\.anthropic\.com/);
      assert.match(r.stderr, /what your harness actually exposes/);
    } finally {
      removeDir(tmp);
    }
  });

  test('--help and usage errors', () => {
    const help = runScript(SCRIPTS.modelRoster, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /listed = the date OpenRouter listed the model/);
    assert.equal(runScript(SCRIPTS.modelRoster, ['--limit', 'x']).status, 1);
  });
});
