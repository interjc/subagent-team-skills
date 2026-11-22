import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseArgs, selectModels, selectArena, joinArena, formatTable, formatReport, DEFAULT_VENDORS, FOOTER, UsageError,
} from '../skills/subagent-team/scripts/model-roster.mjs';
import { SCRIPTS, FIXTURES, makeTempDir, removeDir, readJson, runScript } from './helpers/fakes.mjs';

const FIXTURE = path.join(FIXTURES, 'openrouter-models.json');
const ARENA_FIXTURE = path.join(FIXTURES, 'arena-webdev-rows.json');
const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const arenaPage = readJson(ARENA_FIXTURE);
const NOW = Date.UTC(2026, 9, 29); // the fixture's "created" values are relative to this
const defaults = () => parseArgs([]);
const ids = (list) => list.map((m) => m.id);

describe('model-roster: parseArgs', () => {
  test('defaults', () => {
    assert.deepEqual(parseArgs([]), {
      vendors: DEFAULT_VENDORS, sinceDays: 365, limit: 8, includeVariants: false, file: null, json: false, help: false,
      arena: false, arenaFile: null, arenaLimit: 30, save: false,
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

  test('arena file enables Arena, with a positive limit and optional save', () => {
    const o = parseArgs(['--arena-file', 'x.json', '--arena-limit', '2', '--save']);
    assert.equal(o.arena, true);
    assert.equal(o.arenaFile, 'x.json');
    assert.equal(o.arenaLimit, 2);
    assert.equal(o.save, true);
    assert.throws(() => parseArgs(['--arena-limit', '0']), UsageError);
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

describe('model-roster: Arena', () => {
  test('selectArena keeps overall rows and the best-rated variant, ordered by rating', () => {
    const selected = selectArena(arenaPage); // Fixture ranks 3 and 4 differ from the rating order.
    assert.deepEqual(selected.map(({ name, rating }) => [name, rating]), [
      ['Claude Opus 5.5 (Max)', 1820.5],
      ['GPT-6.1', 1785.1],
      ['Gemini 3.8 Pro', 1760.3],
      ['Claude Opus 6', 1730.4],
    ]);
    assert.equal(selected[0].base, 'claude-opus-5-5');
    assert.equal(selected[0].variant, 'Max');
  });

  test('selectArena accepts multiple pages and applies the limit after combining them', () => {
    const pages = [
      { ...arenaPage, rows: arenaPage.rows.slice(0, 2) },
      { ...arenaPage, rows: arenaPage.rows.slice(2) },
    ];
    assert.deepEqual(selectArena(pages), selectArena(arenaPage));
    assert.deepEqual(selectArena([...pages].reverse()), selectArena(arenaPage));
    for (const input of [arenaPage, pages]) {
      assert.deepEqual(selectArena(input, 2).map(({ name }) => name), ['Claude Opus 5.5 (Max)', 'GPT-6.1']);
    }
  });

  test('selectArena excludes a row without a category', () => {
    const rows = [{ model_name: 'Uncategorized model', rating: 1800 }, { model_name: 'Kept (High)', rating: 1700, category: 'overall', rank: 2 }];
    assert.deepEqual(selectArena(rows).map((m) => m.name), ['Kept (High)']);
  });

  test('selectArena compares ratings before rounding them to one decimal', () => {
    const rows = [
      { model_name: 'Close Model (High)', rating: 1820.51, category: 'overall', rank: 2 },
      { model_name: 'Close Model (Max)', rating: 1820.54, category: 'overall', rank: 1 },
    ];
    const [m] = selectArena(rows);
    assert.equal(m.variant, 'Max');
    assert.equal(m.rating, 1820.5);
    assert.equal('rawRating' in m, false);
  });

  test('joinArena adds rank and rating to OpenRouter models and pricing to Arena entries', () => {
    const vendors = selectModels(data, defaults(), NOW);
    const joined = joinArena(vendors, selectArena(arenaPage));
    const opus = vendors.anthropic.find(({ id }) => id === 'anthropic/claude-opus-5.5');
    assert.equal(opus.arenaRank, 1);
    assert.equal(opus.arenaRating, 1820.5);
    const sonnet = vendors.anthropic.find(({ id }) => id === 'anthropic/claude-sonnet-5');
    assert.equal(sonnet.arenaRank, null);
    assert.equal(sonnet.arenaRating, null);
    assert.deepEqual(joined.map(({ openrouterId, inputPerMTok, outputPerMTok }) => [openrouterId, inputPerMTok, outputPerMTok]), [
      ['anthropic/claude-opus-5.5', 15, 75],
      ['openai/gpt-6.1', 1.25, 10],
      ['google/gemini-3.8-pro', 2.5, 15],
      [null, null, null],
    ]);
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
  let tmp;
  before(() => { tmp = makeTempDir('roster-test-'); });
  after(() => removeDir(tmp));

  function runRoster(args) {
    const home = path.join(tmp, 'home');
    return runScript(SCRIPTS.modelRoster, args, { env: { SUBAGENT_TEAM_HOME: home, HOME: home } });
  }

  // --since-days is large so the run does not depend on today's date.
  test('--file --json end to end', () => {
    const r = runRoster(['--file', FIXTURE, '--since-days', '100000', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.source, `file:${FIXTURE}`);
    assert.ok(!Number.isNaN(Date.parse(r.json.fetchedAt)));
    assert.deepEqual(Object.keys(r.json.vendors), DEFAULT_VENDORS);
    assert.equal(r.json.vendors.anthropic[0].id, 'anthropic/claude-opus-5.5');
    assert.ok(ids(r.json.vendors.anthropic).includes('anthropic/claude-3-opus'));
  });

  test('--file human output', () => {
    const r = runRoster(['--file', FIXTURE, '--since-days', '100000', '--vendors', 'google', '--limit', '2']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== google ==/);
    assert.match(r.stdout, /google\/gemini-3\.8-pro\s+\d{4}-\d{2}-\d{2}\s+2000000\s+2\.50\s+15\.00/);
    assert.doesNotMatch(r.stdout, /gemma/);
    assert.match(r.stdout, /OpenRouter lists what OpenRouter serves/);
  });

  test('--arena-file --json --save returns Arena models and writes the same ranking to the temporary home', () => {
    const r = runRoster(['--file', FIXTURE, '--since-days', '100000', '--arena-file', ARENA_FIXTURE, '--json', '--save']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.arena.source, `file:${ARENA_FIXTURE}`);
    assert.equal(r.json.arena.models.length, 4);
    assert.equal(r.json.arena.models[0].openrouterId, 'anthropic/claude-opus-5.5');
    assert.deepEqual(readJson(path.join(tmp, 'home', 'model-ranking.json')), r.json);
  });

  test('missing --arena-file exits 3 and still prints OpenRouter prices', () => {
    const r = runRoster(['--file', FIXTURE, '--since-days', '100000', '--arena-file', path.join(tmp, 'missing-arena.json')]);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /cannot read the arena leaderboard/);
    assert.match(r.stdout, /anthropic\/claude-opus-5\.5[^\n]*\b15\.00\s+75\.00/);
  });

  test('unreadable --file exits 2 with fallback pointers', () => {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{oops');
    const r = runRoster(['--file', bad]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /https:\/\/platform\.claude\.com\/docs\/en\/about-claude\/models\/overview/);
    assert.doesNotMatch(r.stderr, /docs\.anthropic\.com/);
    assert.match(r.stderr, /what your harness actually exposes/);
  });

  test('--help and usage errors', () => {
    const help = runRoster(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /listed = the date OpenRouter listed the model/);
    assert.equal(runRoster(['--limit', 'x']).status, 1);
  });
});

describe('model-roster: review regressions', () => {
  test('--save needs --arena; a bare array of row wrappers is read', () => {
    assert.throws(() => parseArgs(['--save']), /--save needs --arena/);
    const wrapped = [{ row_idx: 0, row: { model_name: 'Wrapped (High)', rating: 1700, category: 'overall', rank: 1 }, truncated_cells: [] }];
    assert.deepEqual(selectArena(wrapped).map((m) => m.name), ['Wrapped (High)']);
  });

  test('a failed arena read keeps the saved ranking', () => {
    const home = makeTempDir('roster-save-');
    try {
      const env = { SUBAGENT_TEAM_HOME: home };
      const ok = runScript(SCRIPTS.modelRoster, ['--file', path.join(FIXTURES, 'openrouter-models.json'), '--arena-file', path.join(FIXTURES, 'arena-webdev-rows.json'), '--save', '--json'], { env });
      assert.equal(ok.status, 0);
      const bad = runScript(SCRIPTS.modelRoster, ['--file', path.join(FIXTURES, 'openrouter-models.json'), '--arena-file', path.join(home, 'missing.json'), '--save', '--json'], { env });
      assert.equal(bad.status, 3);
      assert.match(bad.stderr, /not saved/);
      assert.ok(readJson(path.join(home, 'model-ranking.json')).arena.models.length > 0);
    } finally {
      removeDir(home);
    }
  });
});
