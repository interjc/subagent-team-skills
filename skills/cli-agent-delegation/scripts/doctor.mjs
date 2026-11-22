#!/usr/bin/env node
// doctor.mjs - read-only environment check for delegating work to Codex CLI,
// Google Antigravity CLI (agy) and OpenCode (ACP). Never reads auth or
// credential files.
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
export const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`doctor.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Use Node.js 22 or newer: a version the project pins or nvm already has (`nvm use <version>`), else install 24 with nvm (`nvm install 24 && nvm use 24`; native installers only without nvm), or use the raw commands in SKILL.md, "Channels and fallbacks".');
  process.exit(1);
}

const PROBE_TIMEOUT_MS = 10_000;

export const USAGE = `doctor.mjs - check the environment for Codex CLI, agy and OpenCode delegation.

Usage:
  doctor.mjs [--json]

Checks (read-only; auth and credential files are never read):
  - Node.js version
  - Codex CLI: \`$CODEX_BIN --version\`, default model and reasoning effort from
    <CODEX_HOME or ~/.codex>/config.toml, model ids from models_cache.json, and the
    Codex plugin for Claude Code (codex@openai-codex) in installed_plugins.json
  - agy: \`$AGY_BIN --version\` against the ACP minimum (1.5.0) and the recommended
    release (1.5.12), whether \`agy acp\` (the official ACP server) exists, and the
    agy-staff Claude Code plugin and its version in
    <CLAUDE_CONFIG_DIR or ~/.claude>/plugins/installed_plugins.json
  - OpenCode: \`$OPENCODE_BIN --version\` and whether \`opencode acp\` exists

Options:
  --json           Print one JSON object instead of human-readable lines.
  --check-updates  Also ask GitHub for agy-staff's newest release tag (network,
                   \`git ls-remote\`); without it the doctor stays offline.
  --help           Show this help.

Upgrades: the report lists each needed install or upgrade with its exact commands
("upgrades"). The doctor never runs them; an agent runs them only after the user
agrees.

Environment:
  CODEX_BIN (default codex), AGY_BIN (default agy), OPENCODE_BIN (default opencode),
  CODEX_HOME, CLAUDE_CONFIG_DIR, HOME, AGY_STAFF_REPO_URL (default
  https://github.com/keli-wen/agy-staff, used by --check-updates).

Exit code: 0 (it is a report); 1 on usage errors.
`;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { json: false, help: false, checkUpdates: false };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--check-updates') opts.checkUpdates = true;
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

// Collects model ids: the first string slug / id / model of each object, anywhere
// in the JSON. An object that names a model is not searched further, so nested
// ids such as service_tiers[].id ("priority") are not mistaken for models.
// Entries with visibility "hide" (internal models) are skipped.
export function extractModelIds(json) {
  const ids = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const key = ['slug', 'id', 'model'].find((k) => typeof node[k] === 'string' && node[k].trim());
    if (key) {
      if (node.visibility !== 'hide') ids.add(node[key].trim());
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(json);
  return [...ids];
}

// Finds the first installed_plugins.json entry (already parsed) whose key
// matches `test`; returns { key, installPath } or null.
export function findPlugin(installed, test) {
  if (!installed || typeof installed !== 'object') return null;
  const maps = [installed];
  if (installed.plugins && typeof installed.plugins === 'object') maps.unshift(installed.plugins);
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (!test(key)) continue;
      const entries = Array.isArray(value) ? value : [value];
      const withPath = entries.find((e) => e && typeof e === 'object' && typeof e.installPath === 'string');
      const withVersion = entries.find((e) => e && typeof e === 'object' && typeof e.version === 'string');
      return { key, installPath: withPath ? withPath.installPath : null, version: withVersion ? withVersion.version : null };
    }
  }
  return null;
}

export function findAgyStaff(installed) {
  return findPlugin(installed, (key) => key.includes('agy-staff'));
}

// OpenAI's Codex plugin for Claude Code is `codex@openai-codex`; other
// `codex@<marketplace>` entries are forks with their own defaults.
export const OFFICIAL_CODEX_PLUGIN = 'codex@openai-codex';
export function findCodexPlugin(installed) {
  const found = findPlugin(installed, (key) => /^codex@/.test(key));
  return found ? { ...found, official: found.key === OFFICIAL_CODEX_PLUGIN } : null;
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
  const { file: pluginsFile, plugins } = claudePlugins(env);
  codex.plugin = { installed: false, key: null, official: false, installPath: null, companionExists: false, pluginsFile, error: plugins.error };
  const found = findCodexPlugin(plugins.data);
  if (found) {
    Object.assign(codex.plugin, { installed: true, key: found.key, official: found.official, installPath: found.installPath });
    codex.plugin.companionExists = Boolean(found.installPath
      && fs.existsSync(path.join(found.installPath, 'scripts', 'codex-companion.mjs')));
  }
  return codex;
}

function claudePlugins(env) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), '.claude');
  const file = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  return { file, plugins: readJson(file) };
}

export function checkOpencode(env = process.env) {
  const bin = env.OPENCODE_BIN || 'opencode';
  const opencode = { bin, ...probeVersion(bin), acp: false, acpError: null };
  if (!opencode.present) return opencode;
  const r = spawnSync(bin, ['acp', '--help'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (r.error) opencode.acpError = r.error.message;
  else if (r.status !== 0) opencode.acpError = `\`${bin} acp --help\` exited with code ${r.status}`;
  else opencode.acp = true;
  return opencode;
}

// `agy acp` (the official ACP server) shipped in 1.5.0; T3 Code recommends 1.5.12 or newer.
export const AGY_ACP_MIN = [1, 5, 0];
export const AGY_RECOMMENDED = [1, 5, 12];
export const AGY_STAFF_REPO_URL = 'https://github.com/keli-wen/agy-staff';

export function parseSemver(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

// Newest vX.Y.Z tag from `git ls-remote --tags --refs` output, or null.
export function latestTag(lsRemoteOutput) {
  let best = null;
  for (const line of String(lsRemoteOutput || '').split('\n')) {
    const m = /refs\/tags\/v?(\d+\.\d+\.\d+)$/.exec(line.trim());
    if (!m) continue;
    const v = parseSemver(m[1]);
    if (!best || compareSemver(v, best) > 0) best = v;
  }
  return best ? best.join('.') : null;
}

export function checkAgyStaffLatest(env = process.env) {
  const url = env.AGY_STAFF_REPO_URL || AGY_STAFF_REPO_URL;
  const r = spawnSync('git', ['ls-remote', '--tags', '--refs', url], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS * 3 });
  if (r.error || r.status !== 0) return { latest: null, error: r.error ? r.error.message : `git ls-remote exited with code ${r.status}` };
  const latest = latestTag(r.stdout);
  return { latest, error: latest ? null : 'no release tags found' };
}

export function checkAgy(env = process.env, { checkUpdates = false } = {}) {
  const bin = env.AGY_BIN || 'agy';
  const { file: pluginsFile, plugins } = claudePlugins(env);
  const agy = {
    bin, ...probeVersion(bin),
    semver: null, acp: false, acpError: null, acpMinOk: null, recommendedOk: null,
    agyStaff: { installed: false, key: null, version: null, latest: null, latestError: null, updateAvailable: null, installPath: null, companionExists: false, pluginsFile, error: null },
  };
  if (agy.present) {
    const v = parseSemver(agy.version);
    agy.semver = v ? v.join('.') : null;
    agy.acpMinOk = v ? compareSemver(v, AGY_ACP_MIN) >= 0 : null;
    agy.recommendedOk = v ? compareSemver(v, AGY_RECOMMENDED) >= 0 : null;
    const r = spawnSync(bin, ['acp', '--help'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
    const help = `${r.stdout || ''}${r.stderr || ''}`;
    if (r.error) agy.acpError = r.error.message;
    else if (r.status !== 0) agy.acpError = `\`${bin} acp --help\` exited with code ${r.status}`;
    else if (!/Agent Client Protocol/i.test(help)) agy.acpError = `\`${bin} acp --help\` does not describe an ACP server`;
    else agy.acp = true;
  }
  if (plugins.error) agy.agyStaff.error = plugins.error;
  const found = findAgyStaff(plugins.data);
  if (found) {
    agy.agyStaff.installed = true;
    agy.agyStaff.key = found.key;
    agy.agyStaff.version = found.version;
    agy.agyStaff.installPath = found.installPath;
    agy.agyStaff.companionExists = Boolean(found.installPath
      && fs.existsSync(path.join(found.installPath, 'companion', 'agy-companion.mjs')));
  }
  if (checkUpdates) {
    const { latest, error } = checkAgyStaffLatest(env);
    agy.agyStaff.latest = latest;
    agy.agyStaff.latestError = error;
    const have = parseSemver(agy.agyStaff.version);
    const want = parseSemver(latest);
    if (agy.agyStaff.installed && have && want) agy.agyStaff.updateAvailable = compareSemver(want, have) > 0;
  }
  return agy;
}

// Installs and upgrades the user may want, each with exact commands. Nothing
// here runs them: an agent runs them only after the user agrees.
export function planUpgrades({ agy }) {
  const out = [];
  if (agy.present && (agy.acpMinOk === false || !agy.acp)) {
    out.push({ target: 'agy', reason: `agy ${agy.semver ?? agy.version ?? '(unknown)'} has no official ACP server (\`agy acp\`, 1.5.0+); without it agy jobs fall back to print mode`, commands: ['agy update', 'agy --version'], needsConsent: true });
  } else if (agy.present && agy.recommendedOk === false) {
    out.push({ target: 'agy', reason: `agy ${agy.semver} is older than the recommended ${AGY_RECOMMENDED.join('.')}`, commands: ['agy update', 'agy --version'], needsConsent: true });
  }
  const s = agy.agyStaff;
  if (agy.present && !s.installed) {
    out.push({ target: 'agy-staff', reason: 'agy-staff (personas and job discipline for agy) is not installed in Claude Code', commands: ['claude plugin marketplace add keli-wen/agy-staff', 'claude plugin install agy@agy-staff'], needsConsent: true, restart: 'Claude Code' });
  } else if (s.installed && (s.updateAvailable || !s.companionExists)) {
    out.push({ target: 'agy-staff', reason: s.updateAvailable ? `agy-staff ${s.version} is older than ${s.latest}` : 'agy-staff is registered but its companion is missing', commands: ['claude plugin marketplace update agy-staff', 'claude plugin update agy@agy-staff'], needsConsent: true, restart: 'Claude Code' });
  }
  return out;
}

export const RECOMMENDED_NODE_MAJOR = 24;

export function recommend({ codex, agy, opencode = null, nodeVersion = process.version }) {
  const recs = [];
  // The scripts refuse Node.js below the minimum; at or above it, the user's version is used as it is.
  if (Number(String(nodeVersion).replace(/^v/, '').split('.')[0]) < MIN_NODE_MAJOR) {
    recs.push(`Node.js ${nodeVersion} is below the minimum ${MIN_NODE_MAJOR}: with the user's consent, install the project's pinned version if it is ${MIN_NODE_MAJOR} or newer, else ${RECOMMENDED_NODE_MAJOR}, through nvm (\`nvm install ${RECOMMENDED_NODE_MAJOR} && nvm use ${RECOMMENDED_NODE_MAJOR}\`; a native install only without nvm).`);
  }
  if (!codex.present) recs.push(`Codex CLI not found (${codex.bin}): install it (npm install -g @openai/codex) or set CODEX_BIN.`);
  else if (codex.error) recs.push(`Codex CLI found but \`${codex.bin} --version\` failed: ${codex.error}.`);
  if (codex.defaultEffort) recs.push(`Codex default effort is "${codex.defaultEffort}": always pass the effort explicitly (codex-run.mjs requires it; with the Codex plugin, pass --effort on every task).`);
  if (codex.present && !codex.defaultModel) recs.push('No default model in Codex config.toml: pass --model to codex-run.mjs to make runs reproducible.');
  const cp = codex.plugin;
  if (cp && cp.installed && !cp.official) {
    recs.push(`Codex plugin "${cp.key}" is not OpenAI's ${OFFICIAL_CODEX_PLUGIN}: check its sandbox default before using it (some forks run danger-full-access); codex-run.mjs remains the safe channel.`);
  } else if (cp && cp.installed && !cp.companionExists) {
    recs.push(`Codex plugin is registered (${cp.key}) but scripts/codex-companion.mjs was not found${cp.installPath ? ` under ${cp.installPath}` : ''}: reinstall it or use codex-run.mjs.`);
  } else if (cp && cp.installed) {
    recs.push('Codex plugin installed: use /codex:review or /codex:adversarial-review for read-only second opinions; codex-run.mjs stays the channel for outsourced jobs (explicit effort, timeout, resume by session id).');
  } else if (codex.present) {
    recs.push(`Codex plugin for Claude Code not found (optional, adds review commands): claude plugin marketplace add openai/codex-plugin-cc && claude plugin install ${OFFICIAL_CODEX_PLUGIN}`);
  }
  if (opencode) {
    if (!opencode.present) recs.push(`OpenCode not found (${opencode.bin}): optional external team; install from https://opencode.ai, sign in with \`opencode auth login\`, or set OPENCODE_BIN.`);
    else if (!opencode.acp) recs.push(`OpenCode found but \`opencode acp\` is not available (${opencode.acpError}): upgrade OpenCode (\`opencode upgrade\`) to use opencode-acp-run.mjs.`);
    else recs.push('OpenCode ACP available: run `node scripts/opencode-acp-run.mjs probe --repo <abs repo>` to list its models and effort levels (no tokens spent).');
  }
  if (!agy.present) recs.push(`agy not found (${agy.bin}): install Google Antigravity CLI (https://antigravity.google/docs/cli/install) with the user's consent, or set AGY_BIN.`);
  else if (agy.error) recs.push(`agy found but \`${agy.bin} --version\` failed: ${agy.error}.`);
  else if (agy.acp) {
    recs.push(`agy ACP available: dispatch agy jobs with agy-acp-run.mjs (official \`agy acp\`); check with \`node scripts/agy-acp-run.mjs probe\` (handshake only).${agy.recommendedOk === false ? ` agy ${agy.semver} is below the recommended ${AGY_RECOMMENDED.join('.')}: offer \`agy update\`.` : ''}`);
  } else {
    recs.push(`RISK: agy ${agy.semver ?? agy.version ?? ''} has no official ACP server (${agy.acpError ?? 'older than 1.5.0'}). Tell the user that jobs would run in print mode, where --write skips every permission check, and offer to run \`agy update\` for them; until then agy-run.mjs only, with the risk stated in the dispatch line.`);
  }
  const s = agy.agyStaff;
  const staffRole = 'borrow its personas (implementer, reviewer, researcher prompts) and its one-wait-per-job discipline, but dispatch through agy-acp-run.mjs: its own companion runs agy in print mode, not ACP';
  if (!s.installed) {
    recs.push(`agy-staff plugin not found: offer to install it (claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff); then ${staffRole}.`);
  } else if (!s.companionExists) {
    recs.push(`agy-staff plugin is registered (${s.key}) but companion/agy-companion.mjs was not found${s.installPath ? ` under ${s.installPath}` : ''}: offer to reinstall it (claude plugin install agy@agy-staff).`);
  } else if (s.updateAvailable) {
    recs.push(`agy-staff ${s.version} is older than ${s.latest}: offer to upgrade it (claude plugin marketplace update agy-staff && claude plugin update agy@agy-staff, then restart Claude Code).`);
  } else {
    recs.push(`agy-staff plugin installed${s.version ? ` (${s.version})` : ''}: ${staffRole}.`);
  }
  return recs;
}

export function runChecks(env = process.env, { checkUpdates = false } = {}) {
  const codex = checkCodex(env);
  const agy = checkAgy(env, { checkUpdates });
  const opencode = checkOpencode(env);
  return {
    node: process.version,
    minNode: MIN_NODE_MAJOR,
    recommendedNode: RECOMMENDED_NODE_MAJOR,
    codex,
    agy,
    opencode,
    recommendations: recommend({ codex, agy, opencode }),
    upgrades: planUpgrades({ agy }),
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
  if (c.plugin) {
    lines.push(`  Codex plugin (Claude Code): ${c.plugin.installed ? `installed (${c.plugin.key}${c.plugin.official ? '' : ', not the official plugin'})` : 'not found'}`);
    if (c.plugin.installed) lines.push(`  scripts/codex-companion.mjs present: ${yn(c.plugin.companionExists)}`);
  }
  lines.push(
    '',
    `agy: ${a.present ? `found (${a.version ?? 'unknown version'})` : 'not found'} [${a.bin}]`,
  );
  if (a.present) lines.push(`  acp subcommand (official ACP server): ${a.acp ? 'yes' : `no${a.acpError ? ` (${a.acpError})` : ''}`}`);
  lines.push(`  agy-staff plugin: ${a.agyStaff.installed ? `installed (${a.agyStaff.key}${a.agyStaff.version ? ` ${a.agyStaff.version}` : ''})` : 'not found in Claude Code'}`);
  if (a.agyStaff.latest || a.agyStaff.latestError) lines.push(`  agy-staff latest release: ${a.agyStaff.latest ?? `unknown (${a.agyStaff.latestError})`}`);
  if (a.agyStaff.installed) {
    lines.push(`  install path: ${a.agyStaff.installPath ?? '(unknown)'}`);
    lines.push(`  companion/agy-companion.mjs present: ${yn(a.agyStaff.companionExists)}`);
  }
  if (a.agyStaff.error) lines.push(`  warning: ${a.agyStaff.error}`);
  const o = r.opencode;
  if (o) {
    lines.push('', `opencode: ${o.present ? `found (${o.version ?? 'unknown version'})` : 'not found'} [${o.bin}]`);
    if (o.present) lines.push(`  acp subcommand: ${o.acp ? 'yes' : `no${o.acpError ? ` (${o.acpError})` : ''}`}`);
  }
  lines.push('', 'Recommendations:');
  for (const rec of r.recommendations) lines.push(`  - ${rec}`);
  if (r.upgrades && r.upgrades.length) {
    lines.push('', 'Upgrades to offer (run only after the user agrees):');
    for (const u of r.upgrades) lines.push(`  - ${u.target}: ${u.reason}`, ...u.commands.map((c) => `      ${c}`), ...(u.restart ? [`      (then restart ${u.restart})`] : []));
  }
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
  const report = runChecks(process.env, { checkUpdates: opts.checkUpdates });
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
