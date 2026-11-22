#!/usr/bin/env node
// model-roster.mjs - list the newest models of the major vendors (from
// OpenRouter's public model list: listing date, context, price) and, with
// --arena, their performance on LMArena's Code Arena (webdev) leaderboard, so
// abstract tiers (top/high/mid/low, external-fast/strong) can be mapped to
// concrete, current models. --save keeps the result in the global compute
// directory for compute-config.mjs check-models.
//
// Usage:
//   model-roster.mjs [--vendors anthropic,openai,google,deepseek] [--since-days 365]
//                    [--limit 8] [--include-variants] [--file <models.json>]
//                    [--arena] [--arena-file <rows.json>] [--save] [--json]
//
// Dependency-free (node: builtins only). Run with --help for details.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { globalDir, normalizeModelId, RANKING_FILE } from './compute-config.mjs';

// Hard minimum: below it, built-ins these scripts rely on (global fetch,
// process-group handling as tested) are missing or untested. Recommended: 24.
export const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`model-roster.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Use Node.js 22 or newer: a version the project pins or nvm already has (`nvm use <version>`), else install 24 with nvm (`nvm install 24 && nvm use 24`; native installers only without nvm), or use the fallback described in SKILL.md.');
  process.exit(1);
}

export const SOURCE_URL = 'https://openrouter.ai/api/v1/models';
export const DEFAULT_VENDORS = ['anthropic', 'openai', 'google', 'deepseek'];
// LMArena publishes its leaderboards as a Hugging Face dataset; the datasets
// server reads it without a key. "webdev" is the Code Arena leaderboard.
export const ARENA_URL = 'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=webdev&split=latest';
const ARENA_PAGE = 100;
const ARENA_MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

export const FOOTER = 'OpenRouter lists what OpenRouter serves; the ids your harness accepts may differ — confirm against the harness\'s own list.';

export const USAGE = `model-roster.mjs - newest models per vendor, from OpenRouter's public list.

Usage:
  model-roster.mjs [--vendors anthropic,openai,google,deepseek] [--since-days 365]
                   [--limit 8] [--include-variants] [--file <models.json>]
                   [--arena] [--arena-file <rows.json>] [--save] [--json]

Options:
  --vendors <list>     Comma-separated vendor prefixes (default: ${DEFAULT_VENDORS.join(',')}).
  --since-days <n>     Only models OpenRouter listed in the last n days (default 365).
  --limit <n>          Models per vendor, newest first (default 8).
  --include-variants   Keep ids containing ":" (e.g. :free, :thinking).
  --file <path>        Read a saved ${SOURCE_URL} response instead of fetching.
  --arena              Add performance: LMArena Code Arena (webdev) rank and score, no key needed.
  --arena-file <path>  Read saved datasets-server rows (one response, or an array of rows) instead.
  --arena-limit <n>    Ranked models to keep from the arena (default 30).
  --save               With --arena: also write the JSON result to the global compute directory
                       (${RANKING_FILE}), where compute-config.mjs check-models reads it.
  --json               Print one JSON object instead of tables.
  --help               Show this help.

Columns: listed = the date OpenRouter listed the model (its "created" field),
not necessarily the vendor's release date. Prices are USD per 1M tokens.
arena = Code Arena rank (overall category); arena names carry effort variants
such as "(High)" and are matched to OpenRouter ids by normalized name.

Exit codes: 0 ok; 1 usage error; 2 OpenRouter (or --file) could not be read;
3 the arena (or --arena-file) could not be read (the price list is still printed).
`;

export class UsageError extends Error {}

function positiveInt(name, v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${name} must be a positive integer, got "${v}"`);
  return n;
}

export function parseArgs(argv) {
  const opts = {
    vendors: [...DEFAULT_VENDORS], sinceDays: 365, limit: 8,
    includeVariants: false, file: null, json: false, help: false,
    arena: false, arenaFile: null, arenaLimit: 30, save: false,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      if (v.startsWith('--')) throw new UsageError(`${arg} needs a value, got option ${v}`);
      return v;
    };
    switch (arg) {
      case '--vendors': {
        const list = value().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!list.length) throw new UsageError('--vendors needs at least one vendor');
        opts.vendors = [...new Set(list)];
        break;
      }
      case '--since-days': opts.sinceDays = positiveInt(arg, value()); break;
      case '--limit': opts.limit = positiveInt(arg, value()); break;
      case '--include-variants': opts.includeVariants = true; break;
      case '--file': opts.file = value(); break;
      case '--arena': opts.arena = true; break;
      case '--arena-file': opts.arenaFile = value(); opts.arena = true; break;
      case '--arena-limit': opts.arenaLimit = positiveInt(arg, value()); break;
      case '--save': opts.save = true; break;
      case '--json': opts.json = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  if (opts.save && !opts.arena) throw new UsageError('--save needs --arena (a saved ranking without performance would replace a better one)');
  return opts;
}

function perMTok(price) {
  if (price === undefined || price === null || price === '') return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null; // OpenRouter uses -1 for "varies"
  return Math.round(n * 1e6 * 10_000) / 10_000;
}

function listedDate(created) {
  if (typeof created !== 'number' || !Number.isFinite(created)) return null;
  return new Date(created * 1000).toISOString().slice(0, 10);
}

// data: the OpenRouter response ({ data: [...] }) or the array itself.
export function selectModels(data, opts, nowMs = Date.now()) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  const vendors = opts.vendors ?? DEFAULT_VENDORS;
  const sinceDays = opts.sinceDays ?? 365;
  const limit = opts.limit ?? 8;
  const cutoffSec = (nowMs - sinceDays * DAY_MS) / 1000;
  const out = {};
  for (const vendor of vendors) {
    const prefix = `${vendor}/`;
    out[vendor] = list
      .filter((m) => m && typeof m.id === 'string' && m.id.toLowerCase().startsWith(prefix))
      .filter((m) => opts.includeVariants || !m.id.includes(':'))
      .filter((m) => typeof m.created !== 'number' || m.created >= cutoffSec)
      .sort((a, b) => (typeof b.created === 'number' ? b.created : -Infinity)
        - (typeof a.created === 'number' ? a.created : -Infinity))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        name: m.name ?? null,
        listed: listedDate(m.created),
        contextLength: m.context_length ?? null,
        inputPerMTok: perMTok(m.pricing?.prompt),
        outputPerMTok: perMTok(m.pricing?.completion),
      }));
  }
  return out;
}

// rows: datasets-server responses ({ rows: [{ row }] }), or plain row objects.
// Keeps the overall category, the best-ranked variant per normalized name.
export function selectArena(pages, limit = 30) {
  const rows = [];
  for (const page of Array.isArray(pages) ? pages : [pages]) {
    if (Array.isArray(page?.rows)) rows.push(...page.rows.map((r) => r.row ?? r));
    else if (page?.row && typeof page.row === 'object') rows.push(page.row);
    else if (page && typeof page === 'object' && page.model_name) rows.push(page);
  }
  const best = new Map();
  for (const r of rows) {
    if (!r || typeof r.model_name !== 'string') continue;
    if (r.category !== 'overall') continue;
    const base = normalizeModelId(r.model_name);
    const variant = (r.model_name.match(/\(([^)]+)\)/) || [])[1] ?? null;
    const entry = {
      name: r.model_name, base, variant, organization: (r.organization ?? '').toLowerCase() || null,
      rank: Number.isFinite(r.rank) ? r.rank : null, rawRating: typeof r.rating === 'number' ? r.rating : null,
      votes: r.vote_count ?? null, published: r.leaderboard_publish_date ?? null,
    };
    const prev = best.get(base);
    if (!prev || (entry.rawRating ?? -Infinity) > (prev.rawRating ?? -Infinity)) best.set(base, entry);
  }
  return [...best.values()]
    .sort((a, b) => (b.rawRating ?? -Infinity) - (a.rawRating ?? -Infinity))
    .slice(0, limit)
    .map(({ rawRating, ...m }) => ({ ...m, rating: rawRating === null ? null : Math.round(rawRating * 10) / 10 }));
}

// Adds arena rank and score to OpenRouter models, and prices to arena models.
export function joinArena(vendors, arena) {
  const byBase = new Map(arena.map((m) => [m.base, m]));
  const priced = new Map();
  for (const models of Object.values(vendors)) {
    for (const m of models) {
      const hit = byBase.get(normalizeModelId(m.id));
      m.arenaRank = hit?.rank ?? null;
      m.arenaRating = hit?.rating ?? null;
      priced.set(normalizeModelId(m.id), m);
    }
  }
  return arena.map((a) => {
    const p = priced.get(a.base);
    return { ...a, openrouterId: p?.id ?? null, inputPerMTok: p?.inputPerMTok ?? null, outputPerMTok: p?.outputPerMTok ?? null };
  });
}

export function formatArena(arena) {
  const header = ['arena', 'model', 'score', '$/1M in', '$/1M out'];
  const rows = arena.map((m) => [m.rank != null ? String(m.rank) : '?', m.name, m.rating != null ? m.rating.toFixed(0) : '?', money(m.inputPerMTok), money(m.outputPerMTok)]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const right = [true, false, true, true, true];
  const fmt = (r) => r.map((c, i) => (right[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
  return [fmt(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmt)].join('\n');
}

function money(v) {
  return typeof v === 'number' ? v.toFixed(2) : '?';
}

// One vendor's models -> aligned text table.
export function formatTable(models) {
  const header = ['id', 'listed', 'context', '$/1M in', '$/1M out'];
  const rows = models.map((m) => [
    m.id,
    m.listed ?? '?',
    m.contextLength != null ? String(m.contextLength) : '?',
    money(m.inputPerMTok),
    money(m.outputPerMTok),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const right = [false, false, true, true, true];
  const fmt = (r) => r.map((c, i) => (right[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
  return [fmt(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmt)].join('\n');
}

export function formatReport(vendors) {
  const parts = [];
  for (const [vendor, models] of Object.entries(vendors)) {
    parts.push(`== ${vendor} ==`);
    parts.push(models.length ? formatTable(models) : '(no matching models)');
    parts.push('');
  }
  parts.push(FOOTER);
  return `${parts.join('\n')}\n`;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchArena() {
  const pages = [];
  for (let i = 0; i < ARENA_MAX_PAGES; i++) {
    let page;
    try {
      page = await fetchJson(`${ARENA_URL}&offset=${i * ARENA_PAGE}&length=${ARENA_PAGE}`);
    } catch (err) {
      if (!pages.length) throw err;
      process.stderr.write(`model-roster: arena page ${i + 1} failed (${errText(err)}); using the first ${pages.length}.\n`);
      break;
    }
    pages.push(page);
    const total = Number(page?.num_rows_total);
    if (!Array.isArray(page?.rows) || !page.rows.length || !Number.isFinite(total) || (i + 1) * ARENA_PAGE >= total) break;
  }
  return pages;
}

function errText(err) {
  return err.name === 'AbortError' ? 'timed out' : [err.message, err.cause?.code || err.cause?.message].filter(Boolean).join(': ');
}

async function fetchModels() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SOURCE_URL, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const FALLBACK_HINT = `Fall back to the vendors' official model pages:
  https://platform.claude.com/docs/en/about-claude/models/overview
  https://platform.openai.com/docs/models
  https://ai.google.dev/gemini-api/docs/models
and to what your harness actually exposes.`;

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`model-roster: ${err.message}\nRun with --help for usage.\n`);
      return 1;
    }
    throw err;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  let data;
  let source;
  if (opts.file) {
    source = `file:${path.resolve(opts.file)}`;
    try {
      data = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
    } catch (err) {
      process.stderr.write(`model-roster: cannot read ${opts.file}: ${err.message}\n${FALLBACK_HINT}\n`);
      return 2;
    }
  } else {
    source = SOURCE_URL;
    try {
      data = await fetchModels();
    } catch (err) {
      process.stderr.write(`model-roster: cannot reach OpenRouter (${err.name === 'AbortError' ? 'timed out' : [err.message, err.cause?.code || err.cause?.message].filter(Boolean).join(': ')}).\n${FALLBACK_HINT}\n`);
      return 2;
    }
  }
  const vendors = selectModels(data, opts, Date.now());
  const result = { source, fetchedAt: new Date().toISOString(), vendors };
  let code = 0;
  if (opts.arena) {
    let pages = null;
    let arenaSource;
    try {
      if (opts.arenaFile) {
        arenaSource = `file:${path.resolve(opts.arenaFile)}`;
        pages = JSON.parse(fs.readFileSync(opts.arenaFile, 'utf8'));
      } else {
        arenaSource = ARENA_URL;
        pages = await fetchArena();
      }
    } catch (err) {
      process.stderr.write(`model-roster: cannot read the arena leaderboard (${errText(err)}); prices only. Look up a current coding leaderboard by web search instead (LMArena Code Arena, SWE-bench, Artificial Analysis).\n`);
      code = 3;
    }
    if (pages) {
      const arena = joinArena(vendors, selectArena(pages, opts.arenaLimit));
      result.arena = { source: arenaSource, published: arena[0]?.published ?? null, models: arena };
    }
  }
  if (opts.save && !result.arena) {
    process.stderr.write('model-roster: not saved: the arena could not be read, and the saved ranking is kept as it was.\n');
  } else if (opts.save) {
    const file = path.join(globalDir(), RANKING_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`);
      fs.renameSync(tmp, file);
      process.stderr.write(`model-roster: saved to ${file}\n`);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      process.stderr.write(`model-roster: cannot save ${file}: ${err.message}\n`);
    }
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    let text = formatReport(vendors);
    if (result.arena) text += `\n== Code Arena (LMArena webdev, published ${result.arena.published ?? '?'}) ==\n${formatArena(result.arena.models)}\n`;
    process.stdout.write(text);
  }
  return code;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; });
}
