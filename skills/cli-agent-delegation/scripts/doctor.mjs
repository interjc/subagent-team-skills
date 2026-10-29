#!/usr/bin/env node
// doctor.mjs - read-only environment check for delegating work to Codex CLI
// and Google Antigravity CLI (agy). Never reads auth or credential files.
//
// Usage:
//   doctor.mjs [--json]
//
// Dependency-free (node: builtins only). Run with --help for details.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Hard minimum: below it, built-ins these scripts rely on (global fetch,
// process-group handling as tested) are missing or untested. Recommended: 24.
export const MIN_NODE_MAJOR = 18;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`doctor.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or use the fallback described in SKILL.md.');
  process.exit(1);
}

const PROBE_TIMEOUT_MS = 10_000;

export const USAGE = `doctor.mjs - check the environment for Codex CLI and agy delegation.

Usage:
  doctor.mjs [--json]

Checks (read-only; auth and credential files are never read):
  - Node.js version
  - Codex CLI: \`$CODEX_BIN --version\`, default model and reasoning effort from
    <CODEX_HOME or ~/.codex>/config.toml, model ids from models_cache.json
  - agy: \`$AGY_BIN --version\`, agy-staff Claude Code plugin in
    <CLAUDE_CONFIG_DIR or ~/.claude>/plugins/installed_plugins.json

Options:
  --json    Print one JSON object instead of human-readable lines.
  --help    Show this help.

Environment:
  CODEX_BIN (default codex), AGY_BIN (default agy), CODEX_HOME, CLAUDE_CONFIG_DIR, HOME.

Exit code: 0 (it is a report); 1 on usage errors.
`;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  return opts;
}

export function homeDir(env = process.env) {
  return env.HOME || os.homedir();
}

// ---------- pure parsers ----------

function unquote(v) {
  const t = v.trim();
  const m = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(t);
  if (m) return m[1] ?? m[2];
  return t.replace(/\s+#.*$/, '').trim();
}

// Reads top-level (before the first [table]) model / model_reasoning_effort.
export function parseCodexConfig(text) {
  const top = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    top.push(line);
  }
  const get = (key) => {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`);
    for (const line of top) {
      const m = re.exec(line);
      if (m) return unquote(m[1]) || null;
    }
    return null;
  };
  return { model: get('model'), reasoningEffort: get('model_reasoning_effort') };
}

// Collects string values of keys slug / id / model anywhere in the JSON.
export function extractModelIds(json) {
  const ids = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'slug' || k === 'id' || k === 'model') && typeof v === 'string' && v.trim()) ids.add(v.trim());
      else walk(v);
    }
  };
  walk(json);
  return [...ids];
}

// Finds the agy-staff entry in installed_plugins.json content (already parsed).
export function findAgyStaff(installed) {
  if (!installed || typeof installed !== 'object') return null;
  const maps = [installed];
  if (installed.plugins && typeof installed.plugins === 'object') maps.unshift(installed.plugins);
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (!key.includes('agy-staff')) continue;
      const entries = Array.isArray(value) ? value : [value];
      const withPath = entries.find((e) => e && typeof e === 'object' && typeof e.installPath === 'string');
      return { key, installPath: withPath ? withPath.installPath : null };
    }
  }
  return null;
}

// ---------- probes ----------

export function probeVersion(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    return { present: timedOut, version: null, error: timedOut ? 'version probe timed out' : r.error.message };
  }
  const out = `${r.stdout || ''}${r.stdout ? '' : r.stderr || ''}`.trim().split(/\r?\n/)[0] || null;
  if (r.status !== 0) return { present: true, version: out, error: `--version exited with code ${r.status}` };
  return { present: true, version: out, error: null };
}

function readJson(file) {
  try {
    return { exists: true, data: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, data: null, error: null };
    return { exists: true, data: null, error: `cannot parse ${file}: ${err.message}` };
  }
}

export function checkCodex(env = process.env) {
  const bin = env.CODEX_BIN || 'codex';
  const home = env.CODEX_HOME || path.join(homeDir(env), '.codex');
  const probe = probeVersion(bin);
  const configFile = path.join(home, 'config.toml');
  const cacheFile = path.join(home, 'models_cache.json');
  const codex = {
    bin, ...probe, home,
    configFile, configExists: false, defaultModel: null, defaultEffort: null,
    modelsCacheFile: cacheFile, modelsCacheExists: false, cachedModels: [],
    warnings: [],
  };
  try {
    const cfg = parseCodexConfig(fs.readFileSync(configFile, 'utf8'));
    codex.configExists = true;
    codex.defaultModel = cfg.model;
    codex.defaultEffort = cfg.reasoningEffort;
  } catch { /* missing or unreadable */ }
  if (codex.defaultEffort) {
    codex.warnings.push(`config.toml sets model_reasoning_effort = "${codex.defaultEffort}": codex-run.mjs always passes --effort explicitly; raw \`codex exec\` would inherit ${codex.defaultEffort}.`);
  }
  const cache = readJson(cacheFile);
  codex.modelsCacheExists = cache.exists;
  if (cache.data) codex.cachedModels = extractModelIds(cache.data);
  if (cache.error) codex.warnings.push(cache.error);
  return codex;
}

export function checkAgy(env = process.env) {
  const bin = env.AGY_BIN || 'agy';
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), '.claude');
  const pluginsFile = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  const agy = {
    bin, ...probeVersion(bin),
    agyStaff: { installed: false, key: null, installPath: null, companionExists: false, pluginsFile, error: null },
  };
  const plugins = readJson(pluginsFile);
  if (plugins.error) agy.agyStaff.error = plugins.error;
  const found = findAgyStaff(plugins.data);
  if (found) {
    agy.agyStaff.installed = true;
    agy.agyStaff.key = found.key;
    agy.agyStaff.installPath = found.installPath;
    agy.agyStaff.companionExists = Boolean(found.installPath
      && fs.existsSync(path.join(found.installPath, 'companion', 'agy-companion.mjs')));
  }
  return agy;
}

export const RECOMMENDED_NODE_MAJOR = 24;

export function recommend({ codex, agy, nodeVersion = process.version }) {
  const recs = [];
  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  if (major < RECOMMENDED_NODE_MAJOR) {
    recs.push(`Node.js ${nodeVersion} meets the minimum (${MIN_NODE_MAJOR}); ${RECOMMENDED_NODE_MAJOR} is recommended (e.g. \`nvm install ${RECOMMENDED_NODE_MAJOR}\`).`);
  }
  if (!codex.present) recs.push(`Codex CLI not found (${codex.bin}): install it (npm install -g @openai/codex) or set CODEX_BIN.`);
  else if (codex.error) recs.push(`Codex CLI found but \`${codex.bin} --version\` failed: ${codex.error}.`);
  if (codex.defaultEffort) recs.push(`Codex default effort is "${codex.defaultEffort}": always delegate through codex-run.mjs (it passes --effort explicitly).`);
  if (codex.present && !codex.defaultModel) recs.push('No default model in Codex config.toml: pass --model to codex-run.mjs to make runs reproducible.');
  if (!agy.present) recs.push(`agy not found (${agy.bin}): install Google Antigravity CLI or set AGY_BIN.`);
  else if (agy.error) recs.push(`agy found but \`${agy.bin} --version\` failed: ${agy.error}.`);
  const s = agy.agyStaff;
  if (!s.installed) {
    recs.push('agy-staff plugin not found: use agy-run.mjs, or install it: claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff');
  } else if (!s.companionExists) {
    recs.push(`agy-staff plugin is registered (${s.key}) but companion/agy-companion.mjs was not found${s.installPath ? ` under ${s.installPath}` : ''}: reinstall it (claude plugin install agy@agy-staff) or use agy-run.mjs.`);
  } else {
    recs.push('agy-staff plugin installed: prefer it for agy work; agy-run.mjs remains a fallback.');
  }
  return recs;
}

export function runChecks(env = process.env) {
  const codex = checkCodex(env);
  const agy = checkAgy(env);
  return {
    node: process.version,
    minNode: MIN_NODE_MAJOR,
    recommendedNode: RECOMMENDED_NODE_MAJOR,
    codex,
    agy,
    recommendations: recommend({ codex, agy }),
  };
}

export function formatReport(r) {
  const yn = (b) => (b ? 'yes' : 'no');
  const c = r.codex;
  const a = r.agy;
  const lines = [
    `node: ${r.node}`,
    '',
    `codex: ${c.present ? `found (${c.version ?? 'unknown version'})` : 'not found'} [${c.bin}]`,
    `  home: ${c.home}`,
    `  config.toml: ${c.configExists ? c.configFile : 'not found'}`,
    `  default model: ${c.defaultModel ?? '(not set)'}`,
    `  default reasoning effort: ${c.defaultEffort ?? '(not set)'}`,
    `  models_cache.json: ${c.modelsCacheExists ? `${c.cachedModels.length} model id(s)` : 'not found'}`,
  ];
  if (c.cachedModels.length) lines.push(`    ${c.cachedModels.join(', ')}`);
  for (const w of c.warnings) lines.push(`  warning: ${w}`);
  lines.push(
    '',
    `agy: ${a.present ? `found (${a.version ?? 'unknown version'})` : 'not found'} [${a.bin}]`,
    `  agy-staff plugin: ${a.agyStaff.installed ? `installed (${a.agyStaff.key})` : 'not found'}`,
  );
  if (a.agyStaff.installed) {
    lines.push(`  install path: ${a.agyStaff.installPath ?? '(unknown)'}`);
    lines.push(`  companion/agy-companion.mjs present: ${yn(a.agyStaff.companionExists)}`);
  }
  if (a.agyStaff.error) lines.push(`  warning: ${a.agyStaff.error}`);
  lines.push('', 'Recommendations:');
  for (const rec of r.recommendations) lines.push(`  - ${rec}`);
  return `${lines.join('\n')}\n`;
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`doctor: ${err.message}\nRun with --help for usage.\n`);
      return 1;
    }
    throw err;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const report = runChecks(process.env);
  process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
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
  process.exitCode = main();
}
