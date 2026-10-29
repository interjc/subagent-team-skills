#!/usr/bin/env node
// model-roster.mjs - list the newest models of the major vendors (from
// OpenRouter's public model list) so abstract tiers (top/high/mid/low) can be
// mapped to concrete, current models.
//
// Usage:
//   model-roster.mjs [--vendors anthropic,openai,google,deepseek] [--since-days 365]
//                    [--limit 8] [--include-variants] [--file <models.json>] [--json]
//
// Dependency-free (node: builtins only). Run with --help for details.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Hard minimum: below it, built-ins these scripts rely on (global fetch,
// process-group handling as tested) are missing or untested. Recommended: 24.
export const MIN_NODE_MAJOR = 18;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`model-roster.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or use the fallback described in SKILL.md.');
  process.exit(1);
}

export const SOURCE_URL = 'https://openrouter.ai/api/v1/models';
export const DEFAULT_VENDORS = ['anthropic', 'openai', 'google', 'deepseek'];
const FETCH_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;

export const FOOTER = 'OpenRouter lists what OpenRouter serves; the ids your harness accepts may differ — confirm against the harness\'s own list.';

export const USAGE = `model-roster.mjs - newest models per vendor, from OpenRouter's public list.

Usage:
  model-roster.mjs [--vendors anthropic,openai,google,deepseek] [--since-days 365]
                   [--limit 8] [--include-variants] [--file <models.json>] [--json]

Options:
  --vendors <list>     Comma-separated vendor prefixes (default: ${DEFAULT_VENDORS.join(',')}).
  --since-days <n>     Only models OpenRouter listed in the last n days (default 365).
  --limit <n>          Models per vendor, newest first (default 8).
  --include-variants   Keep ids containing ":" (e.g. :free, :thinking).
  --file <path>        Read a saved ${SOURCE_URL} response instead of fetching.
  --json               Print one JSON object instead of tables.
  --help               Show this help.

Columns: listed = the date OpenRouter listed the model (its "created" field),
not necessarily the vendor's release date. Prices are USD per 1M tokens.

Exit codes: 0 ok; 1 usage error; 2 OpenRouter (or --file) could not be read.
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
      case '--json': opts.json = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument: ${arg}`);
    }
  }
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
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ source, fetchedAt: new Date().toISOString(), vendors }, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(vendors));
  }
  return 0;
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
