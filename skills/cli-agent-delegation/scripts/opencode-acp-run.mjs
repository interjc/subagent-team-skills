#!/usr/bin/env node
// opencode-acp-run.mjs - run OpenCode as an external team through the Agent
// Client Protocol (`opencode acp`), with pinned model and effort, a permission
// set the wrapper controls, a timeout, and a machine-readable result.
//
// Usage:
//   opencode-acp-run.mjs run   --repo <abs dir> --prompt-file <file> --model <provider/model> --effort <level> [options]
//   opencode-acp-run.mjs probe --repo <abs dir> [--model <provider/model>]
//
// Dependency-free (node: builtins only). Run with --help for details.

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Hard minimum: below it, built-ins these scripts rely on (global fetch,
// process-group handling as tested) are missing or untested. Recommended: 24.
export const MIN_NODE_MAJOR = 18;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`opencode-acp-run.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or use the raw commands in SKILL.md, "Channels and fallbacks".');
  process.exit(1);
}

export const CLIENT_NAME = 'opencode-acp-run';
export const CLIENT_VERSION = '0.3.0';
export const PROTOCOL_VERSION = 1;
export const READONLY_AGENT = 'subagent-team-readonly';
export const WRITE_AGENT = 'subagent-team-write';
export const EXIT = { OK: 0, USAGE: 1, AGENT_ERROR: 2, SETUP: 3, TIMEOUT: 5 };
// Read-only inspection commands the injected agents may always run.
export const READ_ONLY_SHELL = ['git status *', 'git diff *', 'git log *', 'git show *', 'git blame *',
  'git ls-files *', 'ls *', 'pwd', 'wc *'];
const DEFAULT_TIMEOUT = '30m';
const MAX_TIMEOUT_SEC = 24 * 3600;
const KILL_GRACE_MS = 5000;
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const USAGE = `opencode-acp-run.mjs - run OpenCode headless through ACP (\`opencode acp\`).

Usage:
  opencode-acp-run.mjs run   --repo <abs dir> --prompt-file <file> --model <provider/model>
                             --effort <level|default> [--write] [--allow-shell <pattern>]...
                             [--allow-web] [--agent <id>] [--session <id>]
                             [--forbid-provider <id>]... [--timeout <dur>] [--out-dir <dir>]
                             [--dry-run]
  opencode-acp-run.mjs probe --repo <abs dir> [--model <provider/model>]

Commands:
  run     Start \`opencode acp\` in --repo, open (or resume) a session, select the agent,
          model and effort, send the prompt file as one prompt, and collect the reply.
  probe   Handshake only, no prompt and no model tokens: OpenCode and ACP versions, auth
          methods, models, agents, the effort levels of --model (or the default model),
          and whether the injected agents are visible. The probe session is deleted.

Options:
  --repo <dir>             Absolute path of the workspace (must exist). OpenCode loads that
                           directory's configuration (models, agents, AGENTS.md, MCP).
  --prompt-file <file>     The brief (non-empty). Sent as one ACP text block.
  --model <provider/model> REQUIRED for run, e.g. opencode/deepseek-v4.1-flash-free. Must be
                           one of the models OpenCode offers (see probe).
  --effort <level>         REQUIRED for run: one of the model's effort levels (see probe),
                           or "default". Models without levels accept only "default".
  --write                  Use the injected write agent: edits inside the workspace allowed.
                           Without it the injected read-only agent denies every edit.
  --allow-shell <pattern>  Extra shell commands the agent may run, as OpenCode permission
                           patterns (repeatable), e.g. './node_modules/.bin/tsc *'. By default
                           only read-only git, ls, pwd and wc are allowed; all else is denied.
  --allow-web              Allow web fetch and web search (denied by default).
  --agent <id>             Use this OpenCode agent instead of the injected ones. Its own
                           permissions apply; cannot be combined with --write, --allow-shell
                           or --allow-web.
  --session <id>           Resume an earlier session (session/resume) and send a follow-up.
  --forbid-provider <id>   Refuse models from this provider (repeatable), e.g. your in-house
                           vendor, so outsourced work does not route back to it.
  --timeout <dur>          e.g. 90s, 20m, 1h (default ${DEFAULT_TIMEOUT}, max 24h). On expiry the
                           wrapper sends session/cancel, waits briefly, then stops the process
                           group and every descendant.
  --out-dir <dir>          Where to write last.md, reply.md, events.jsonl, stderr.txt,
                           summary.json (default: <tmp>/opencode-acp-run/<YYYYMMDD-HHMMSS>-<hex>).
  --dry-run                Validate and print the plan (command, injected config) without running.
  --help                   Show this help.

Permissions (injected agents, passed through OPENCODE_CONFIG_CONTENT):
  deny everything; allow read, glob, grep; edit only with --write; shell only for the
  read-only list and --allow-shell patterns; deny .env reads, external directories,
  subagents and questions. A permission request that still reaches the wrapper is
  rejected, so a headless run never waits for approval; each one is listed in the summary.

Environment:
  OPENCODE_BIN             OpenCode executable (default: opencode).

Output:
  One JSON object on stdout (also saved as summary.json). Hints go to stderr.

Exit codes:
  0  the prompt finished (stopReason end_turn, or a length limit with a partial reply;
     "warning" is set when something needs a look)
  1  usage error
  2  the agent ended without a usable result (refusal, error, auth required, no reply)
  3  launch, protocol or setup failure (model, effort or agent not offered, ...)
  5  timed out (the session is resumable with --session)
  130/143  this wrapper was interrupted by SIGINT/SIGTERM
`;

export class UsageError extends Error {}
export class SetupError extends Error {}

// ---------- small helpers ----------

export function parseDuration(value) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i.exec(String(value ?? '').trim());
  if (!m) throw new UsageError(`invalid duration "${value}" (use e.g. 90s, 10m, 1h)`);
  const n = Number(m[1]) * { s: 1, m: 60, h: 3600 }[(m[2] || 's').toLowerCase()];
  if (!(n > 0)) throw new UsageError(`duration must be positive: "${value}"`);
  if (n > MAX_TIMEOUT_SEC) throw new UsageError(`duration "${value}" is too long (max 24h)`);
  return n;
}

export function timestampDirName(date = new Date(), hex = crypto.randomBytes(2).toString('hex')) {
  const p = (n) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const t = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${d}-${t}-${hex}`;
}

export function shellQuote(s) {
  const str = String(s);
  return /^[\w@%+=:,./-]+$/.test(str) ? str : `'${str.replace(/'/g, `'\\''`)}'`;
}

function envMs(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// ---------- argument parsing ----------

const VALUE_OPTS = {
  '--repo': 'repo',
  '--prompt-file': 'promptFile',
  '--model': 'model',
  '--effort': 'effort',
  '--agent': 'agent',
  '--session': 'session',
  '--timeout': 'timeout',
  '--out-dir': 'outDir',
};
const LIST_OPTS = { '--allow-shell': 'allowShell', '--forbid-provider': 'forbidProvider' };
const FLAG_OPTS = {
  '--write': 'write',
  '--allow-web': 'allowWeb',
  '--dry-run': 'dryRun',
  '--help': 'help',
  '-h': 'help',
};

export function parseArgs(argv) {
  const opts = { positionals: [], allowShell: [], forbidProvider: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    if (FLAG_OPTS[arg]) {
      opts[FLAG_OPTS[arg]] = true;
    } else if (VALUE_OPTS[arg] || LIST_OPTS[arg]) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      if (v.startsWith('--')) throw new UsageError(`${arg} needs a value, got option ${v}`);
      if (LIST_OPTS[arg]) opts[LIST_OPTS[arg]].push(v);
      else opts[VALUE_OPTS[arg]] = v;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      opts.positionals.push(arg);
    }
  }
  opts.command = opts.positionals.shift();
  return opts;
}

export function validateShellPattern(p) {
  const s = String(p).trim();
  if (!s || /[\r\n]/.test(s)) throw new UsageError(`invalid --allow-shell pattern "${p}"`);
  if (/^\*+$/.test(s)) throw new UsageError('--allow-shell "*" would allow any command; list the commands the job needs instead');
  return s;
}

export function modelProvider(model) {
  return String(model).split('/')[0].toLowerCase();
}

function validateRepo(repo) {
  if (!repo) throw new UsageError('--repo is required');
  if (!path.isAbsolute(repo)) throw new UsageError(`--repo must be an absolute path: ${repo}`);
  let st;
  try { st = fs.statSync(repo); } catch { st = null; }
  if (!st || !st.isDirectory()) throw new UsageError(`--repo is not an existing directory: ${repo}`);
  return path.resolve(repo);
}

function validateModelFormat(model) {
  if (!/^[^/\s]+\/\S+$/.test(model)) throw new UsageError(`--model "${model}" must look like provider/model (see the probe command)`);
  return model;
}

export function validateRunOptions(opts, { now = new Date() } = {}) {
  if (opts.command !== 'run') throw new UsageError(`unknown command "${opts.command ?? ''}" (use run or probe)`);
  if (opts.positionals.length) throw new UsageError(`unexpected argument: ${opts.positionals[0]}`);
  const repo = validateRepo(opts.repo);
  if (!opts.promptFile) throw new UsageError('--prompt-file is required');
  const promptFile = path.resolve(opts.promptFile);
  let prompt;
  try { prompt = fs.readFileSync(promptFile, 'utf8'); } catch {
    throw new UsageError(`--prompt-file does not exist: ${opts.promptFile}`);
  }
  if (!prompt.trim()) throw new UsageError(`--prompt-file is empty: ${opts.promptFile}`);
  if (!opts.model) throw new UsageError('--model is required (provider/model; list them with the probe command)');
  const model = validateModelFormat(opts.model);
  const forbidden = opts.forbidProvider.map((p) => p.toLowerCase());
  if (forbidden.includes(modelProvider(model))) {
    throw new UsageError(`--model "${model}" is from a forbidden provider (${modelProvider(model)}): routing outsourced work back to your in-house vendor defeats the purpose; pick another vendor's model`);
  }
  if (!opts.effort) throw new UsageError('--effort is required (one of the model\'s levels from the probe command, or "default")');
  const effort = String(opts.effort).toLowerCase();
  if (opts.agent && (opts.write || opts.allowShell.length || opts.allowWeb)) {
    throw new UsageError('--agent uses that agent\'s own permissions; do not combine it with --write, --allow-shell or --allow-web');
  }
  const allowShell = opts.allowShell.map(validateShellPattern);
  const timeoutSec = parseDuration(opts.timeout ?? DEFAULT_TIMEOUT);
  const outDir = path.resolve(opts.outDir ?? path.join(os.tmpdir(), 'opencode-acp-run', timestampDirName(now)));
  const write = Boolean(opts.write);
  return {
    repo,
    promptFile,
    prompt,
    model,
    effort,
    write,
    allowShell,
    allowWeb: Boolean(opts.allowWeb),
    customAgent: opts.agent || null,
    agent: opts.agent || (write ? WRITE_AGENT : READONLY_AGENT),
    session: opts.session || null,
    forbidProvider: forbidden,
    timeoutSec,
    timeoutGiven: opts.timeout !== undefined,
    outDir,
    dryRun: Boolean(opts.dryRun),
  };
}

export function validateProbeOptions(opts) {
  if (opts.positionals.length) throw new UsageError(`unexpected argument: ${opts.positionals[0]}`);
  return { repo: validateRepo(opts.repo), model: opts.model ? validateModelFormat(opts.model) : null };
}

// ---------- injected OpenCode configuration ----------

export function buildPermissions({ write = false, allowShell = [], allowWeb = false } = {}) {
  const rules = [
    { action: '*', resource: '*', effect: 'deny' },
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'glob', resource: '*', effect: 'allow' },
    { action: 'grep', resource: '*', effect: 'allow' },
  ];
  if (write) rules.push({ action: 'edit', resource: '*', effect: 'allow' });
  for (const cmd of [...READ_ONLY_SHELL, ...allowShell]) rules.push({ action: 'shell', resource: cmd, effect: 'allow' });
  rules.push({ action: 'shell', resource: 'git *--output*', effect: 'deny' });
  if (allowWeb) {
    rules.push({ action: 'webfetch', resource: '*', effect: 'allow' }, { action: 'websearch', resource: '*', effect: 'allow' });
  }
  rules.push(
    { action: 'read', resource: '*.env', effect: 'deny' },
    { action: 'read', resource: '*.env.*', effect: 'deny' },
    { action: 'read', resource: '*.env.example', effect: 'allow' },
    { action: 'external_directory', resource: '*', effect: 'deny' },
  );
  return rules;
}

export function buildAgentConfig(cfg) {
  if (cfg.customAgent) return null;
  const description = cfg.write
    ? 'subagent-team delegate: edits inside the workspace, allow-listed shell only'
    : 'subagent-team delegate: read-only, allow-listed shell only';
  return {
    agents: {
      [cfg.agent]: {
        description,
        mode: 'primary',
        permissions: buildPermissions(cfg),
      },
    },
  };
}

// Merges the injected agents into an existing OPENCODE_CONFIG_CONTENT value.
export function mergeConfigContent(existing, injected) {
  if (!injected) return existing ?? null;
  let base = {};
  if (existing && existing.trim()) {
    try { base = JSON.parse(existing); } catch {
      throw new UsageError('OPENCODE_CONFIG_CONTENT is set but is not valid JSON; unset it or fix it');
    }
    if (!base || typeof base !== 'object' || Array.isArray(base)) throw new UsageError('OPENCODE_CONFIG_CONTENT must be a JSON object');
  }
  return JSON.stringify({ ...base, agents: { ...(base.agents || {}), ...injected.agents } });
}

// ---------- ACP config options ----------

export function flattenValues(option) {
  const out = [];
  for (const o of option?.options || []) {
    if (o && Array.isArray(o.options)) out.push(...o.options.map((x) => x.value));
    else if (o) out.push(o.value);
  }
  return out.filter((v) => typeof v === 'string');
}

export function findOption(configOptions, id, category) {
  const list = Array.isArray(configOptions) ? configOptions : [];
  return list.find((o) => o.id === id) || list.find((o) => o.category === category) || null;
}

export function describeConfig(configOptions) {
  const pick = (id, cat) => {
    const o = findOption(configOptions, id, cat);
    return o ? { id: o.id, current: o.currentValue ?? null, values: flattenValues(o) } : null;
  };
  return { model: pick('model', 'model'), effort: pick('effort', 'thought_level'), agent: pick('mode', 'mode') };
}

function preview(values, n = 12) {
  return values.length > n ? `${values.slice(0, n).join(', ')}, ... (${values.length} in total)` : values.join(', ');
}

// Selects agent, then model, then effort (each can change the options after it),
// and verifies the result. Throws SetupError with an actionable message.
export async function applyConfig(client, sessionId, configOptions, cfg) {
  let opts = configOptions;
  const warnings = [];
  const set = async (option, value) => {
    const r = await client.request('session/set_config_option', { sessionId, configId: option.id, value });
    if (Array.isArray(r?.configOptions)) opts = r.configOptions;
  };
  let mode = findOption(opts, 'mode', 'mode');
  if (!mode) throw new SetupError('OpenCode offered no agent (mode) option; cannot select the agent');
  if (!flattenValues(mode).includes(cfg.agent)) {
    const why = cfg.customAgent ? '' : ' OpenCode did not pick up the injected agent from OPENCODE_CONFIG_CONTENT (check the OpenCode version with the probe command).';
    throw new SetupError(`agent "${cfg.agent}" is not offered (offered: ${preview(flattenValues(mode))}).${why}`);
  }
  if (mode.currentValue !== cfg.agent) await set(mode, cfg.agent);
  let model = findOption(opts, 'model', 'model');
  if (!model) throw new SetupError('OpenCode offered no model option');
  if (!flattenValues(model).includes(cfg.model)) {
    throw new SetupError(`model "${cfg.model}" is not offered in this directory (offered: ${preview(flattenValues(model))}). Run the probe command for the full list.`);
  }
  if (model.currentValue !== cfg.model) await set(model, cfg.model);
  let effort = findOption(opts, 'effort', 'thought_level');
  if (effort) {
    if (!flattenValues(effort).includes(cfg.effort)) {
      throw new SetupError(`effort "${cfg.effort}" is not offered for ${cfg.model} (offered: ${flattenValues(effort).join(', ')})`);
    }
    if (effort.currentValue !== cfg.effort) await set(effort, cfg.effort);
  } else if (cfg.effort !== 'default') {
    warnings.push(`${cfg.model} offers no effort levels; --effort ${cfg.effort} was not applied`);
  }
  mode = findOption(opts, 'mode', 'mode');
  model = findOption(opts, 'model', 'model');
  effort = findOption(opts, 'effort', 'thought_level');
  const applied = { agent: mode?.currentValue ?? null, model: model?.currentValue ?? null, effort: effort?.currentValue ?? null };
  if (applied.agent !== cfg.agent) throw new SetupError(`agent is "${applied.agent}" after selecting "${cfg.agent}"`);
  if (applied.model !== cfg.model) throw new SetupError(`model is "${applied.model}" after selecting "${cfg.model}"`);
  if (effort && applied.effort !== cfg.effort) throw new SetupError(`effort is "${applied.effort}" after selecting "${cfg.effort}"`);
  return { configOptions: opts, applied, warnings };
}

// ---------- JSON-RPC over stdio ----------

export class AcpClient {
  constructor({ send, log = () => {}, onNotification = () => {}, onRequest = async () => { throw rpcError(-32601, 'Method not found'); } }) {
    this.send = send;
    this.log = log;
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.nextId = 1;
    this.pending = new Map();
    this.closedError = null;
    this.nonJsonLines = 0;
  }

  write(msg) {
    this.log('out', msg);
    try { this.send(`${JSON.stringify(msg)}\n`); } catch { /* the reader reports the exit */ }
  }

  request(method, params, timeoutMs = 0) {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Object.assign(new Error(`${method}: no response within ${Math.round(timeoutMs / 1000)}s`), { code: 'ETIMEDOUT' }));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    if (!this.closedError) this.write({ jsonrpc: '2.0', method, params });
  }

  handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      this.nonJsonLines++;
      this.log('noise', line.slice(0, 2000));
      return;
    }
    this.log('in', msg);
    if (!msg || typeof msg !== 'object') return;
    if (msg.method && msg.id !== undefined && msg.id !== null) {
      Promise.resolve()
        .then(() => this.onRequest(msg.method, msg.params))
        .then((result) => this.write({ jsonrpc: '2.0', id: msg.id, result: result ?? null }))
        .catch((err) => this.write({ jsonrpc: '2.0', id: msg.id, error: { code: Number.isInteger(err?.code) ? err.code : -32603, message: err?.message || 'error' } }));
      return;
    }
    if (msg.method) {
      try { this.onNotification(msg.method, msg.params); } catch { /* keep reading */ }
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      const e = new Error(`${entry.method}: ${msg.error.message || 'error'}`);
      e.code = msg.error.code;
      e.data = msg.error.data;
      e.rpc = true;
      entry.reject(e);
    } else {
      entry.resolve(msg.result);
    }
  }

  close(err) {
    this.closedError = err;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function isAuthError(err) {
  if (!err) return false;
  return err.code === -32000 || /auth[_ -]?required|authenticat/i.test(String(err.message || ''));
}

// ---------- session update tracking ----------

export function createTracker() {
  return {
    segments: [''],
    boundary: false,
    toolCalls: 0,
    failedToolCalls: new Set(),
    childUpdates: 0,
    permissionRequests: [],
    usage: null,
    cost: null,
    contextUsed: null,
    contextSize: null,
    retries: 0,
    lastRetryError: null,
  };
}

export function trackUpdate(t, update) {
  if (!update || typeof update !== 'object') return;
  if (update._meta && update._meta['opencode/child-session']) {
    t.childUpdates++;
    if (update.sessionUpdate === 'tool_call_update' && update.status === 'failed') t.failedToolCalls.add(update.toolCallId);
    return;
  }
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const c = update.content;
      if (c && c.type === 'text' && typeof c.text === 'string') {
        if (t.boundary) { t.segments.push(''); t.boundary = false; }
        t.segments[t.segments.length - 1] += c.text;
      }
      break;
    }
    case 'tool_call':
      t.toolCalls++;
      t.boundary = true;
      if (update.status === 'failed') t.failedToolCalls.add(update.toolCallId);
      break;
    case 'tool_call_update':
      if (update.status === 'failed') t.failedToolCalls.add(update.toolCallId);
      break;
    case 'usage_update':
      if (typeof update.used === 'number') t.contextUsed = update.used;
      if (typeof update.size === 'number') t.contextSize = update.size;
      if (update.cost && typeof update.cost.amount === 'number') t.cost = update.cost;
      break;
    case 'session_info_update': {
      const retry = update._meta && update._meta['opencode/retry'];
      if (retry) {
        t.retries++;
        t.lastRetryError = retry.error ? { type: retry.error.type ?? null, message: retry.error.message ?? null, status: retry.error.status ?? null } : null;
      }
      break;
    }
    default:
      break;
  }
}

export function finalReply(t) {
  for (let i = t.segments.length - 1; i >= 0; i--) if (t.segments[i].trim()) return t.segments[i];
  return '';
}

export function fullReply(t) {
  return t.segments.filter((s) => s.trim()).join('\n\n');
}

export function permissionResponse(t, params) {
  const options = Array.isArray(params?.options) ? params.options : [];
  const reject = options.find((o) => o.kind === 'reject_once') || options.find((o) => o.optionId === 'reject')
    || options.find((o) => /^reject/.test(String(o.kind || '')));
  t.permissionRequests.push({
    toolCallId: params?.toolCall?.toolCallId ?? null,
    title: params?.toolCall?.title ?? null,
    kind: params?.toolCall?.kind ?? null,
    decision: reject ? 'rejected' : 'cancelled',
  });
  return reject ? { outcome: { outcome: 'selected', optionId: reject.optionId } } : { outcome: { outcome: 'cancelled' } };
}

// ---------- classification ----------

export function classify(s) {
  const reply = s.reply || '';
  const hasReply = Boolean(reply.trim());
  const warnings = [...(s.setupWarnings || [])];
  const base = { ok: false, partial: false, warning: null, error: null, authRequired: false };
  const done = (exitCode, extra = {}) => {
    const out = { ...base, exitCode, ok: exitCode === EXIT.OK, ...extra };
    if (warnings.length && !out.warning) out.warning = warnings.join('; ');
    return out;
  };
  if (s.launchError) return done(EXIT.SETUP, { error: s.launchError });
  if (s.interrupted) return done(SIGNAL_EXIT[s.interrupted] ?? 1, { error: `interrupted by ${s.interrupted}; opencode was stopped` });
  if (s.setupError) return done(EXIT.SETUP, { error: s.setupError });
  if (s.timedOut) {
    return done(EXIT.TIMEOUT, { partial: hasReply, error: `timed out after ${s.timeoutSec}s${s.stopReason ? ` (stopReason ${s.stopReason})` : '; opencode was stopped'}` });
  }
  if (s.promptError) {
    const auth = isAuthError(s.promptError);
    return done(EXIT.AGENT_ERROR, {
      authRequired: auth,
      error: auth ? `${s.promptError.message} - sign in with \`opencode auth login\` (or \`opencode acp --login\`), then retry` : s.promptError.message,
    });
  }
  if (s.exitedEarly) return done(EXIT.SETUP, { error: s.exitedEarly });
  if (s.lastRetryError) warnings.push(`OpenCode retried a failing model call ${s.retries} time(s); last error: ${s.lastRetryError.message ?? s.lastRetryError.type}`);
  if (s.permissionRequests?.length) warnings.push(`${s.permissionRequests.length} permission request(s) were rejected; the reply may describe work that was not done`);
  if (s.failedToolCalls) warnings.push(`${s.failedToolCalls} tool call(s) failed (denied or errored)`);
  switch (s.stopReason) {
    case 'end_turn':
      if (!hasReply) return done(EXIT.AGENT_ERROR, { error: 'the agent ended its turn without a reply' });
      return done(EXIT.OK);
    case 'max_tokens':
    case 'max_turn_requests':
      if (hasReply) {
        warnings.unshift(`stopped at a limit (${s.stopReason}); the reply may be incomplete; continue with --session ${s.sessionId}`);
        return done(EXIT.OK, { partial: true });
      }
      return done(EXIT.AGENT_ERROR, { error: `stopped at a limit (${s.stopReason}) without a reply` });
    case 'refusal':
      return done(EXIT.AGENT_ERROR, { error: 'the model refused the prompt' });
    case 'cancelled':
      return done(EXIT.AGENT_ERROR, { error: 'the prompt was cancelled by the agent' });
    default:
      return done(EXIT.AGENT_ERROR, { error: `unexpected stopReason ${JSON.stringify(s.stopReason ?? null)}` });
  }
}

export function buildResumeHint(cfg, sessionId, scriptPath = SCRIPT_PATH) {
  if (!sessionId) return null;
  const parts = ['node', scriptPath, 'run', '--repo', cfg.repo, '--session', sessionId,
    '--prompt-file', '<NEW_PROMPT>', '--model', cfg.model, '--effort', cfg.effort];
  if (cfg.customAgent) parts.push('--agent', cfg.customAgent);
  if (cfg.write) parts.push('--write');
  for (const p of cfg.allowShell || []) parts.push('--allow-shell', p);
  if (cfg.allowWeb) parts.push('--allow-web');
  for (const p of cfg.forbidProvider || []) parts.push('--forbid-provider', p);
  if (cfg.timeoutGiven) parts.push('--timeout', `${cfg.timeoutSec}s`);
  return parts.map((p) => (p === '<NEW_PROMPT>' ? p : shellQuote(p))).join(' ');
}

// ---------- process handling ----------

// Pids of every live descendant of `pid`, from `ps` (POSIX); [] if ps fails.
export function descendantPids(pid) {
  let out;
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return []; }
  const children = new Map();
  for (const line of out.split('\n')) {
    const [c, p] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(c) || !Number.isInteger(p)) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(c);
  }
  const found = [];
  const queue = [pid];
  while (queue.length) {
    for (const c of children.get(queue.shift()) || []) { found.push(c); queue.push(c); }
  }
  return found;
}

// Signals the child's process group and every descendant (POSIX), or just the
// child (Windows). `known` remembers descendants across calls, because they are
// reparented once the child dies.
export function signalTree(child, sig, known = new Set()) {
  if (!child || child.pid === undefined) return;
  if (process.platform === 'win32') {
    try { child.kill(sig); } catch { /* already gone */ }
    return;
  }
  if (child.exitCode === null && child.signalCode === null) {
    for (const pid of descendantPids(child.pid)) known.add(pid);
  }
  try { process.kill(-child.pid, sig); } catch { /* already gone */ }
  for (const pid of known) {
    try { process.kill(pid, sig); } catch { /* already gone */ }
  }
}

function waitForExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

// Starts `opencode acp` in its own process group and wires an AcpClient to it.
export function startAgent({ bin, cwd, env, outDir, onNotification, onRequest }) {
  const started = Date.now();
  const eventsFd = outDir ? fs.openSync(path.join(outDir, 'events.jsonl'), 'w') : null;
  const stderrFd = outDir ? fs.openSync(path.join(outDir, 'stderr.txt'), 'w') : null;
  let stderrTail = '';
  const log = (dir, msg) => {
    if (eventsFd === null) return;
    try { fs.writeSync(eventsFd, `${JSON.stringify({ t: Date.now() - started, dir, msg })}\n`); } catch { /* ignore */ }
  };
  const conn = { child: null, client: null, known: new Set(), exit: null, launchError: null, stderrTail: () => stderrTail };
  let child;
  try {
    child = spawn(bin, ['acp'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  } catch (err) {
    conn.launchError = `failed to launch ${bin}: ${err.message}`;
    return conn;
  }
  conn.child = child;
  const client = new AcpClient({ send: (s) => child.stdin.write(s), log, onNotification, onRequest });
  conn.client = client;
  child.stdin.on('error', () => { /* reported through exit */ });
  let buf = '';
  child.stdout.setEncoding('utf8').on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      client.handleLine(line);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (d) => {
    stderrTail = (stderrTail + d).slice(-4000);
    if (stderrFd !== null) { try { fs.writeSync(stderrFd, d); } catch { /* ignore */ } }
  });
  child.on('error', (err) => {
    conn.launchError = `failed to launch ${bin}: ${err.message}`;
    client.close(new Error(conn.launchError));
  });
  child.on('exit', (code, signal) => {
    conn.exit = { code, signal };
    if (buf.trim()) client.handleLine(buf);
    client.close(new Error(`opencode acp exited (${signal ? `signal ${signal}` : `code ${code}`})${stderrTail.trim() ? `: ${stderrTail.trim().split('\n').slice(-3).join(' | ')}` : ''}`));
  });
  conn.closeFiles = () => {
    for (const fd of [eventsFd, stderrFd]) if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  };
  return conn;
}

// Ends the agent: close stdin, wait, then SIGTERM and SIGKILL the whole tree.
export async function stopAgent(conn, { graceMs = KILL_GRACE_MS, force = false } = {}) {
  const { child } = conn;
  if (!child) return;
  if (!force) {
    try { child.stdin.end(); } catch { /* ignore */ }
    if (await waitForExit(child, graceMs)) { signalTree(child, 'SIGTERM', conn.known); return; }
  }
  signalTree(child, 'SIGTERM', conn.known);
  if (await waitForExit(child, graceMs)) { signalTree(child, 'SIGKILL', conn.known); return; }
  signalTree(child, 'SIGKILL', conn.known);
  await waitForExit(child, 1000);
}

function initializeParams() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  };
}

// ---------- run ----------

export async function runJob(cfg, { bin, env }) {
  const handshakeMs = envMs('OPENCODE_ACP_HANDSHAKE_MS', 60_000);
  const cancelGraceMs = envMs('OPENCODE_ACP_CANCEL_GRACE_MS', 10_000);
  const killGraceMs = envMs('OPENCODE_ACP_KILL_GRACE_MS', KILL_GRACE_MS);
  const t = createTracker();
  const s = { timeoutSec: cfg.timeoutSec, sessionId: cfg.session, setupWarnings: [] };
  let sessionId = cfg.session;
  const conn = startAgent({
    bin, cwd: cfg.repo, env, outDir: cfg.outDir,
    onNotification: (method, params) => {
      if (method === 'session/update' && (!sessionId || params?.sessionId === sessionId)) trackUpdate(t, params.update);
    },
    onRequest: async (method, params) => {
      if (method === 'session/request_permission') return permissionResponse(t, params);
      if (method === 'elicitation/create') return { action: 'decline' };
      throw rpcError(-32601, `Method not found: ${method}`);
    },
  });
  if (conn.launchError && !conn.child) return { ...s, launchError: conn.launchError, tracker: t };
  const { client } = conn;
  let timer = null;
  const killTimers = [];
  // SIGTERM to the tree after `delayMs`, SIGKILL `killGraceMs` later.
  const escalate = (delayMs) => {
    killTimers.push(setTimeout(() => signalTree(conn.child, 'SIGTERM', conn.known), delayMs));
    killTimers.push(setTimeout(() => signalTree(conn.child, 'SIGKILL', conn.known), delayMs + killGraceMs));
  };
  const onSignal = (sig) => {
    if (s.interrupted) return;
    s.interrupted = sig;
    if (sessionId) client.notify('session/cancel', { sessionId });
    escalate(Math.min(1000, killGraceMs));
  };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    let init;
    try {
      init = await client.request('initialize', initializeParams(), handshakeMs);
    } catch (err) {
      s.setupError = conn.launchError || `ACP initialize failed: ${err.message}`;
      return await finishRun();
    }
    s.agentInfo = init?.agentInfo ?? null;
    s.protocolVersion = init?.protocolVersion ?? null;
    if (s.protocolVersion !== PROTOCOL_VERSION) s.setupWarnings.push(`agent speaks ACP protocol version ${s.protocolVersion}, this client ${PROTOCOL_VERSION}`);
    let session;
    try {
      session = cfg.session
        ? await client.request('session/resume', { sessionId: cfg.session, cwd: cfg.repo, mcpServers: [] }, handshakeMs)
        : await client.request('session/new', { cwd: cfg.repo, mcpServers: [] }, handshakeMs);
    } catch (err) {
      s.setupError = `${cfg.session ? 'session/resume' : 'session/new'} failed: ${err.message}`;
      return await finishRun();
    }
    sessionId = cfg.session || session?.sessionId || null;
    s.sessionId = sessionId;
    if (!sessionId) { s.setupError = 'session/new returned no sessionId'; return await finishRun(); }
    try {
      const r = await applyConfig({ request: (m, p) => client.request(m, p, handshakeMs) }, sessionId, session?.configOptions, cfg);
      s.applied = r.applied;
      s.setupWarnings.push(...r.warnings);
    } catch (err) {
      s.setupError = err instanceof SetupError ? err.message : `selecting agent, model and effort failed: ${err.message}`;
      return await finishRun();
    }
    timer = setTimeout(() => {
      s.timedOut = true;
      client.notify('session/cancel', { sessionId });
      escalate(cancelGraceMs);
    }, cfg.timeoutSec * 1000);
    try {
      const res = await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: cfg.prompt }] });
      s.stopReason = res?.stopReason ?? null;
      s.usage = res?.usage ?? null;
    } catch (err) {
      if (!s.timedOut && !s.interrupted) {
        if (err.rpc) s.promptError = err;
        else s.exitedEarly = err.message;
      }
    }
    return await finishRun();
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }

  async function finishRun() {
    clearTimeout(timer);
    if (sessionId && !conn.exit && !s.interrupted) {
      try { await client.request('session/close', { sessionId }, 5000); } catch { /* best effort */ }
    }
    await stopAgent(conn, { graceMs: killGraceMs, force: Boolean(s.timedOut || s.interrupted) });
    killTimers.forEach(clearTimeout);
    conn.closeFiles?.();
    return { ...s, launchError: s.launchError || (conn.launchError && !s.agentInfo ? conn.launchError : null), tracker: t, nonJsonLines: client.nonJsonLines };
  }
}

export function buildSummary(cfg, run, c) {
  const t = run.tracker;
  return {
    ok: c.ok,
    exitCode: c.exitCode,
    stopReason: run.stopReason ?? null,
    timedOut: Boolean(run.timedOut),
    partial: c.partial,
    sessionId: run.sessionId ?? null,
    opencodeVersion: run.agentInfo?.version ?? null,
    protocolVersion: run.protocolVersion ?? null,
    agent: run.applied?.agent ?? cfg.agent,
    model: run.applied?.model ?? cfg.model,
    effort: run.applied ? run.applied.effort : cfg.effort,
    write: cfg.write,
    allowShell: cfg.allowShell,
    toolCalls: t.toolCalls,
    failedToolCalls: t.failedToolCalls.size,
    childSessionUpdates: t.childUpdates,
    permissionRequests: t.permissionRequests,
    usage: run.usage ?? null,
    cost: t.cost,
    retries: t.retries,
    lastRetryError: t.lastRetryError,
    authRequired: c.authRequired,
    warning: c.warning,
    error: c.error,
    outDir: cfg.outDir,
    lastMessageFile: path.join(cfg.outDir, 'last.md'),
    replyFile: path.join(cfg.outDir, 'reply.md'),
    eventsFile: path.join(cfg.outDir, 'events.jsonl'),
    resumeHint: buildResumeHint(cfg, run.sessionId),
  };
}

// ---------- probe ----------

export async function probeAgent(cfg, { bin, env }) {
  const handshakeMs = envMs('OPENCODE_ACP_HANDSHAKE_MS', 60_000);
  const out = {
    ok: false, exitCode: EXIT.SETUP, repo: cfg.repo, opencodeVersion: null, protocolVersion: null,
    authMethods: [], loadSession: null, sessionCapabilities: [], models: [], defaultModel: null,
    agents: [], defaultAgent: null, effort: null, injectedAgentsVisible: null, warnings: [], error: null,
  };
  const conn = startAgent({ bin, cwd: cfg.repo, env, outDir: null });
  if (!conn.child) { out.error = conn.launchError; return out; }
  const { client } = conn;
  let sessionId = null;
  try {
    const init = await client.request('initialize', initializeParams(), handshakeMs);
    out.opencodeVersion = init?.agentInfo?.version ?? null;
    out.protocolVersion = init?.protocolVersion ?? null;
    out.authMethods = (init?.authMethods || []).map((m) => m.id);
    out.loadSession = init?.agentCapabilities?.loadSession ?? null;
    out.sessionCapabilities = Object.keys(init?.agentCapabilities?.sessionCapabilities || {});
    const session = await client.request('session/new', { cwd: cfg.repo, mcpServers: [] }, handshakeMs);
    sessionId = session?.sessionId ?? null;
    let opts = session?.configOptions;
    let d = describeConfig(opts);
    out.models = d.model?.values ?? [];
    out.defaultModel = d.model?.current ?? null;
    out.agents = d.agent?.values ?? [];
    out.defaultAgent = d.agent?.current ?? null;
    out.injectedAgentsVisible = out.agents.includes(READONLY_AGENT);
    if (!out.injectedAgentsVisible) out.warnings.push('the injected read-only agent is not offered: OPENCODE_CONFIG_CONTENT was not applied, so `run` cannot enforce its permission set (use --agent with an agent you configured)');
    if (cfg.model) {
      if (!out.models.includes(cfg.model)) {
        out.warnings.push(`model ${cfg.model} is not offered in this directory`);
      } else if (d.model.current !== cfg.model) {
        const r = await client.request('session/set_config_option', { sessionId, configId: d.model.id, value: cfg.model }, handshakeMs);
        if (Array.isArray(r?.configOptions)) opts = r.configOptions;
        d = describeConfig(opts);
      }
    }
    out.effort = d.effort ? { model: d.model?.current ?? null, values: d.effort.values, current: d.effort.current } : { model: d.model?.current ?? null, values: [], current: null };
    out.ok = true;
    out.exitCode = EXIT.OK;
  } catch (err) {
    out.error = conn.launchError || err.message;
  } finally {
    if (sessionId && !conn.exit) {
      try { await client.request('session/delete', { sessionId }, 5000); } catch { /* best effort */ }
    }
    await stopAgent(conn, { graceMs: envMs('OPENCODE_ACP_KILL_GRACE_MS', KILL_GRACE_MS) });
  }
  return out;
}

// ---------- main ----------

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function hint(msg) {
  process.stderr.write(`opencode-acp-run: ${msg}\n`);
}

function agentEnv(cfg) {
  const env = { ...process.env };
  const merged = mergeConfigContent(process.env.OPENCODE_CONFIG_CONTENT, buildAgentConfig(cfg));
  if (merged) env.OPENCODE_CONFIG_CONTENT = merged;
  return env;
}

async function runMode(opts) {
  const cfg = validateRunOptions(opts);
  const bin = process.env.OPENCODE_BIN || 'opencode';
  const env = agentEnv(cfg);
  if (cfg.dryRun) {
    printJson({
      bin, args: ['acp'], cwd: cfg.repo, outDir: cfg.outDir,
      injectedConfig: buildAgentConfig(cfg),
      steps: ['initialize', cfg.session ? `session/resume ${cfg.session}` : 'session/new',
        `set agent ${cfg.agent}`, `set model ${cfg.model}`, `set effort ${cfg.effort}`,
        `session/prompt <${cfg.promptFile} (${cfg.prompt.length} chars)>`, 'session/close'],
      timeoutSec: cfg.timeoutSec,
    });
    return EXIT.OK;
  }
  if (cfg.customAgent) hint(`note: --agent ${cfg.customAgent} uses that agent's own permissions; the wrapper still rejects any permission request.`);
  if (cfg.write) hint('note: --write lets the agent edit files in the workspace; shell stays limited to the allow-list.');
  fs.mkdirSync(cfg.outDir, { recursive: true });
  hint(`running opencode acp (model=${cfg.model}, effort=${cfg.effort}, agent=${cfg.agent}, timeout=${cfg.timeoutSec}s); output: ${cfg.outDir}`);
  const run = await runJob(cfg, { bin, env });
  const t = run.tracker;
  const reply = finalReply(t);
  const c = classify({
    ...run, reply,
    permissionRequests: t.permissionRequests,
    failedToolCalls: t.failedToolCalls.size,
    retries: t.retries,
    lastRetryError: t.lastRetryError,
  });
  fs.writeFileSync(path.join(cfg.outDir, 'last.md'), reply);
  fs.writeFileSync(path.join(cfg.outDir, 'reply.md'), fullReply(t));
  const summary = buildSummary(cfg, run, c);
  fs.writeFileSync(path.join(cfg.outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (summary.warning) hint(`warning: ${summary.warning}`);
  if (summary.timedOut) hint(`timed out.${summary.sessionId ? ` Session ${summary.sessionId} is resumable with --session ${summary.sessionId}.` : ''}`);
  else if (summary.error && !summary.ok) hint(`error: ${summary.error}`);
  printJson(summary);
  return summary.exitCode;
}

async function probeMode(opts) {
  const cfg = validateProbeOptions(opts);
  const bin = process.env.OPENCODE_BIN || 'opencode';
  const env = agentEnv({ agent: READONLY_AGENT, customAgent: null, write: false, allowShell: [], allowWeb: false });
  const out = await probeAgent(cfg, { bin, env });
  for (const w of out.warnings) hint(`warning: ${w}`);
  if (out.error) hint(`error: ${out.error}`);
  printJson(out);
  return out.exitCode;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (!opts.command) throw new UsageError('missing command (run or probe)');
    if (opts.command === 'probe') return await probeMode(opts);
    return await runMode(opts);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`opencode-acp-run: ${err.message}\nRun with --help for usage.\n`);
      return EXIT.USAGE;
    }
    throw err;
  }
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
