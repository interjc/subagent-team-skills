#!/usr/bin/env node
// agy-acp-run.mjs - run Google Antigravity (agy) as an external team through its
// official Agent Client Protocol server (`agy acp`), with pinned model and
// thinking level, a session mode the agent enforces itself, every permission
// request rejected, a timeout, and a machine-readable result.
//
// Usage:
//   agy-acp-run.mjs run   --repo <abs dir> --prompt-file <file> --model <id> --effort <level> [options]
//   agy-acp-run.mjs probe [--session-check --repo <empty abs dir>]
//
// Dependency-free (node: builtins only). Run with --help for details.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SetupError, UsageError, createTracker, envMs, finalReply, findOption, flattenValues, fullReply, isAuthError,
  isMainModule, parseDuration, permissionResponse, rpcError, shellQuote, signalTree, startAgent, stopAgent,
  timestampDirName, trackUpdate, KILL_GRACE_MS,
} from './acp-core.mjs';

export { SetupError, UsageError };

// Hard minimum: below it, built-ins these scripts rely on (global fetch,
// process-group handling as tested) are missing or untested. Recommended: 24.
export const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`agy-acp-run.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Use Node.js 22 or newer: a version the project pins or nvm already has (`nvm use <version>`), else install 24 with nvm (`nvm install 24 && nvm use 24`; native installers only without nvm), or use the raw commands in SKILL.md, "Channels and fallbacks".');
  process.exit(1);
}

// The client names itself truthfully. Never claim to be an allow-listed editor.
export const CLIENT_NAME = 'agy-acp-run';
export const CLIENT_VERSION = '0.5.0';
export const PROTOCOL_VERSION = 1;
// `agy acp` shipped in 1.5.0; 1.5.12 is the oldest release T3 Code recommends.
export const MIN_AGY = [1, 5, 0];
export const RECOMMENDED_AGY = [1, 5, 12];
export const READONLY_MODE = 'default';
export const WRITE_MODE = 'accept-edits';
// Modes this wrapper never selects: they approve commands or everything.
export const REFUSED_MODES = ['auto', 'yolo', 'auto_edit'];
export const EFFORT_SUFFIX = /^(.+)-(minimal|low|medium|high|xhigh|max)$/;
// Ambient Google credentials an agy process would otherwise pick up silently,
// billing another account or project than the one the user signed in with.
export const CREDENTIAL_ENV = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_CLOUD_QUOTA_PROJECT', 'GOOGLE_GENAI_USE_VERTEXAI'];
export const EXIT = { OK: 0, USAGE: 1, AGENT_ERROR: 2, SETUP: 3, TIMEOUT: 5 };
const QUOTA_RE = /quota|resource[_ ]exhausted|rate[ _-]?limit|usage limit|subscription_required|\b429\b/i;
const DEFAULT_TIMEOUT = '30m';
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const USAGE = `agy-acp-run.mjs - run Google Antigravity (agy) headless through its official ACP server (\`agy acp\`).

Usage:
  agy-acp-run.mjs run   --repo <abs dir> --prompt-file <file> --model <id> --effort <level>
                        [--write] [--session <id>] [--timeout <dur>] [--out-dir <dir>]
                        [--allow-any-model] [--keep-credential-env] [--dry-run]
  agy-acp-run.mjs probe [--session-check --repo <empty abs dir>] [--keep-credential-env]

Commands:
  run     Start \`agy acp\` in --repo, open (or resume) a session, select the session mode,
          model and thinking level, send the prompt file as one prompt, collect the reply.
  probe   Handshake only by default (initialize: version, auth methods, capabilities); it
          opens no session, so no hooks, MCP servers or sign-in can start. With
          --session-check it also opens one session in --repo, which must be an empty
          directory, lists modes, models and thinking levels, and closes it. No prompt is
          sent either way, so no model quota is spent.

Options:
  --repo <dir>             Absolute path of the workspace (must exist).
  --prompt-file <file>     The brief (non-empty). Sent as one ACP text block.
  --model <id>             REQUIRED for run, e.g. gemini-4-hydrogen or gemini-4-argon (see probe
                           --session-check). A legacy id with a level suffix such as
                           gemini-3.8-flash-high is split into model and thinking level.
  --effort <level>         REQUIRED for run (unless --model carries the suffix): one of the
                           thinking levels agy offers for the model (low, medium, high, xhigh).
  --write                  Session mode "${WRITE_MODE}": agy itself approves file edits inside
                           the workspace. Without it the mode is "${READONLY_MODE}", where agy asks
                           before every edit and command, and the wrapper rejects every request.
                           Commands stay rejected in both modes; the liaison runs the checks.
  --session <id>           Resume an earlier session (session/resume) and send a follow-up.
  --timeout <dur>          e.g. 90s, 20m, 1h (default ${DEFAULT_TIMEOUT}, max 24h). On expiry the wrapper
                           sends session/cancel, waits briefly, then stops the process group.
  --out-dir <dir>          Where to write last.md, reply.md, events.jsonl, stderr.txt,
                           summary.json (default: <tmp>/agy-acp-run/<YYYYMMDD-HHMMSS>-<hex>).
  --allow-any-model        Allow Claude or GPT model ids (agy offers them to some plans). They
                           route outsourced work back to an in-house vendor; never a second opinion.
  --keep-credential-env    Keep ambient Google credential variables (${CREDENTIAL_ENV.slice(0, 2).join(', ')}, ...).
                           By default they are removed, so agy uses the sign-in the user made.
  --dry-run                Validate and print the plan without running.
  --help                   Show this help.

Compliance (see references/compliance.md):
  Official \`agy acp\` only; the client name is "${CLIENT_NAME}"; no --dangerously-skip-permissions,
  no "auto" mode; sign-in is the user's (\`agy\` once interactively, or \`agy acp --login\`).

Environment:
  AGY_BIN                  agy executable (default: agy).

Output:
  One JSON object on stdout (also saved as summary.json). Hints go to stderr.

Exit codes:
  0  the prompt finished (stopReason end_turn, or a length limit with a partial reply;
     "warning" is set when something needs a look)
  1  usage error
  2  the agent ended without a usable result (refusal, error, auth or quota, no reply)
  3  launch, protocol or setup failure (agy too old, model, level or mode not offered, ...)
  5  timed out (the session is resumable with --session)
  130/143  this wrapper was interrupted by SIGINT/SIGTERM
`;

// ---------- argument parsing ----------

const VALUE_OPTS = {
  '--repo': 'repo',
  '--prompt-file': 'promptFile',
  '--model': 'model',
  '--effort': 'effort',
  '--session': 'session',
  '--timeout': 'timeout',
  '--out-dir': 'outDir',
};
const FLAG_OPTS = {
  '--write': 'write',
  '--allow-any-model': 'allowAnyModel',
  '--keep-credential-env': 'keepCredentialEnv',
  '--session-check': 'sessionCheck',
  '--dry-run': 'dryRun',
  '--help': 'help',
  '-h': 'help',
};

export function parseArgs(argv) {
  const opts = { positionals: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    if (FLAG_OPTS[arg]) {
      opts[FLAG_OPTS[arg]] = true;
    } else if (VALUE_OPTS[arg]) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      if (v.startsWith('--')) throw new UsageError(`${arg} needs a value, got option ${v}`);
      opts[VALUE_OPTS[arg]] = v;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      opts.positionals.push(arg);
    }
  }
  opts.command = opts.positionals.shift();
  return opts;
}

function validateRepo(repo) {
  if (!repo) throw new UsageError('--repo is required');
  if (!path.isAbsolute(repo)) throw new UsageError(`--repo must be an absolute path: ${repo}`);
  let st;
  try { st = fs.statSync(repo); } catch { st = null; }
  if (!st || !st.isDirectory()) throw new UsageError(`--repo is not an existing directory: ${repo}`);
  // Some agents compare canonical paths (macOS /tmp is a symlink).
  return fs.realpathSync(repo);
}

// Splits a legacy "<model>-<level>" id. Returns { model, effort }.
export function resolveModel(model, effort, { allowAnyModel = false } = {}) {
  const raw = String(model ?? '').trim();
  if (!raw) throw new UsageError('--model is required (list the ids with: probe --session-check --repo <empty dir>)');
  if (/\s/.test(raw)) throw new UsageError(`invalid --model "${model}"`);
  if (!allowAnyModel && /claude|gpt/i.test(raw)) {
    throw new UsageError(`--model "${raw}" looks like a Claude/GPT model: routing outsourced work back to an in-house model family defeats the purpose; use a Gemini model (or pass --allow-any-model, which never counts as a second vendor's opinion)`);
  }
  let level = effort ? String(effort).toLowerCase() : null;
  let id = raw;
  const m = EFFORT_SUFFIX.exec(raw);
  if (m) {
    if (level && level !== m[2]) throw new UsageError(`--model "${raw}" carries level "${m[2]}" but --effort is "${level}"; give one of them`);
    id = m[1];
    level = m[2];
  }
  if (!level) throw new UsageError('--effort is required (one of the thinking levels agy offers, e.g. low, medium, high)');
  return { model: id, effort: level, legacyModel: m ? raw : null };
}

export function validateRunOptions(opts, { now = new Date() } = {}) {
  if (opts.command !== 'run') throw new UsageError(`unknown command "${opts.command ?? ''}" (use run or probe)`);
  if (opts.positionals.length) throw new UsageError(`unexpected argument: ${opts.positionals[0]}`);
  if (opts.sessionCheck) throw new UsageError('--session-check belongs to the probe command');
  const repo = validateRepo(opts.repo);
  if (!opts.promptFile) throw new UsageError('--prompt-file is required');
  const promptFile = path.resolve(opts.promptFile);
  let prompt;
  try { prompt = fs.readFileSync(promptFile, 'utf8'); } catch {
    throw new UsageError(`--prompt-file does not exist: ${opts.promptFile}`);
  }
  if (!prompt.trim()) throw new UsageError(`--prompt-file is empty: ${opts.promptFile}`);
  const { model, effort, legacyModel } = resolveModel(opts.model, opts.effort, opts);
  const timeoutSec = parseDuration(opts.timeout ?? DEFAULT_TIMEOUT);
  const write = Boolean(opts.write);
  return {
    repo,
    promptFile,
    prompt,
    model,
    effort,
    legacyModel,
    write,
    mode: write ? WRITE_MODE : READONLY_MODE,
    session: opts.session || null,
    allowAnyModel: Boolean(opts.allowAnyModel),
    keepCredentialEnv: Boolean(opts.keepCredentialEnv),
    timeoutSec,
    timeoutGiven: opts.timeout !== undefined,
    outDir: path.resolve(opts.outDir ?? path.join(os.tmpdir(), 'agy-acp-run', timestampDirName(now))),
    dryRun: Boolean(opts.dryRun),
  };
}

export function validateProbeOptions(opts) {
  if (opts.positionals.length) throw new UsageError(`unexpected argument: ${opts.positionals[0]}`);
  if (!opts.sessionCheck) return { sessionCheck: false, repo: opts.repo ? validateRepo(opts.repo) : process.cwd(), keepCredentialEnv: Boolean(opts.keepCredentialEnv) };
  const repo = validateRepo(opts.repo);
  if (fs.readdirSync(repo).length) {
    throw new UsageError(`--session-check opens a session, which can start hooks and MCP servers: use an empty scratch directory, not ${repo}`);
  }
  return { sessionCheck: true, repo, keepCredentialEnv: Boolean(opts.keepCredentialEnv) };
}

// ---------- environment and version ----------

export function agentEnv(base = process.env, { keepCredentialEnv = false } = {}) {
  const env = { ...base };
  const removed = [];
  if (!keepCredentialEnv) {
    for (const k of CREDENTIAL_ENV) if (k in env) { delete env[k]; removed.push(k); }
  }
  return { env, removed };
}

export function parseVersion(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

// Returns { error, warning } for the version agy reports in initialize.
export function checkAgyVersion(version) {
  const v = parseVersion(version);
  if (!v) return { error: null, warning: `agy reported no parsable version (${JSON.stringify(version ?? null)}); minimum ${MIN_AGY.join('.')}, recommended ${RECOMMENDED_AGY.join('.')}` };
  if (compareVersions(v, MIN_AGY) < 0) return { error: `agy ${v.join('.')} is older than ${MIN_AGY.join('.')}, the first release with \`agy acp\`; ask the user to update it (\`agy update\`)`, warning: null };
  if (compareVersions(v, RECOMMENDED_AGY) < 0) return { error: null, warning: `agy ${v.join('.')} works over ACP but ${RECOMMENDED_AGY.join('.')} or newer is recommended (\`agy update\`, with the user's consent)` };
  return { error: null, warning: null };
}

// ---------- session configuration ----------

function preview(values, n = 12) {
  return values.length > n ? `${values.slice(0, n).join(', ')}, ... (${values.length} in total)` : values.join(', ');
}

export function describeSession(session) {
  const opts = session?.configOptions;
  const model = findOption(opts, 'model', 'model');
  const level = findOption(opts, 'thought_level', 'thought_level');
  const modeOpt = findOption(opts, 'mode', 'mode');
  const modes = (session?.modes?.availableModes || []).map((m) => m.id);
  return {
    models: model ? flattenValues(model) : [],
    defaultModel: model?.currentValue ?? null,
    efforts: level ? flattenValues(level) : [],
    defaultEffort: level?.currentValue ?? null,
    modes: modes.length ? modes : (modeOpt ? flattenValues(modeOpt) : []),
    defaultMode: session?.modes?.currentModeId ?? modeOpt?.currentValue ?? null,
  };
}

// Selects mode, then model, then thinking level (each can change the options
// after it), and verifies the result. Throws SetupError with an actionable message.
export async function applyConfig(client, sessionId, session, cfg) {
  let opts = session?.configOptions;
  let currentMode = session?.modes?.currentModeId ?? findOption(opts, 'mode', 'mode')?.currentValue ?? null;
  const warnings = [];
  const set = async (option, value) => {
    const r = await client.request('session/set_config_option', { sessionId, configId: option.id, value });
    if (Array.isArray(r?.configOptions)) opts = r.configOptions;
  };
  if (REFUSED_MODES.includes(cfg.mode)) throw new SetupError(`mode "${cfg.mode}" is refused by this wrapper`);
  const available = describeSession({ ...session, configOptions: opts }).modes;
  if (!available.includes(cfg.mode)) throw new SetupError(`agy offered no "${cfg.mode}" session mode (offered: ${available.join(', ') || 'none'}); cannot enforce the job's permissions`);
  if (currentMode !== cfg.mode) {
    const modeOpt = findOption(opts, 'mode', 'mode');
    if (modeOpt) await set(modeOpt, cfg.mode);
    else await client.request('session/set_mode', { sessionId, modeId: cfg.mode });
    currentMode = findOption(opts, 'mode', 'mode')?.currentValue ?? cfg.mode;
  }
  let model = findOption(opts, 'model', 'model');
  if (!model) throw new SetupError('agy offered no model option');
  // An id that only looks suffixed (e.g. gpt-oss-120b-medium) is used whole when agy offers it.
  if (!flattenValues(model).includes(cfg.model) && cfg.legacyModel && flattenValues(model).includes(cfg.legacyModel)) {
    cfg = { ...cfg, model: cfg.legacyModel, legacyModel: null };
  }
  if (!flattenValues(model).includes(cfg.model)) {
    throw new SetupError(`model "${cfg.model}" is not offered to this account (offered: ${preview(flattenValues(model))}). Run probe --session-check for the full list.`);
  }
  if (model.currentValue !== cfg.model) await set(model, cfg.model);
  let level = findOption(opts, 'thought_level', 'thought_level');
  if (level) {
    if (!flattenValues(level).includes(cfg.effort)) {
      throw new SetupError(`thinking level "${cfg.effort}" is not offered for ${cfg.model} (offered: ${flattenValues(level).join(', ')})`);
    }
    if (level.currentValue !== cfg.effort) await set(level, cfg.effort);
  } else {
    warnings.push(`${cfg.model} offers no thinking levels; --effort ${cfg.effort} was not applied`);
  }
  model = findOption(opts, 'model', 'model');
  level = findOption(opts, 'thought_level', 'thought_level');
  const modeAfter = findOption(opts, 'mode', 'mode')?.currentValue ?? currentMode;
  const applied = { mode: modeAfter, model: model?.currentValue ?? null, effort: level?.currentValue ?? null };
  if (applied.mode !== cfg.mode) throw new SetupError(`session mode is "${applied.mode}" after selecting "${cfg.mode}"`);
  if (applied.model !== cfg.model) throw new SetupError(`model is "${applied.model}" after selecting "${cfg.model}"`);
  if (level && applied.effort !== cfg.effort) throw new SetupError(`thinking level is "${applied.effort}" after selecting "${cfg.effort}"`);
  return { applied, warnings };
}

// ---------- classification ----------

export function isQuotaError(err) {
  return Boolean(err) && QUOTA_RE.test(String(err.message || err));
}

export function classify(s) {
  const reply = s.reply || '';
  const hasReply = Boolean(reply.trim());
  const warnings = [...(s.setupWarnings || [])];
  const base = { ok: false, partial: false, warning: null, error: null, authRequired: false, quotaExhausted: false, deniedAction: false };
  const done = (exitCode, extra = {}) => {
    const out = { ...base, exitCode, ok: exitCode === EXIT.OK, ...extra };
    if (warnings.length && !out.warning) out.warning = warnings.join('; ');
    return out;
  };
  if (s.launchError) return done(EXIT.SETUP, { error: s.launchError });
  if (s.interrupted) return done(SIGNAL_EXIT[s.interrupted] ?? 1, { error: `interrupted by ${s.interrupted}; agy was stopped` });
  if (s.setupError) {
    const auth = isAuthError({ message: s.setupError });
    return done(auth ? EXIT.AGENT_ERROR : EXIT.SETUP, {
      authRequired: auth,
      error: auth ? `${s.setupError} - the user signs in (run \`agy\` once interactively, or \`agy acp --login\`); never handle the credentials` : s.setupError,
    });
  }
  if (s.timedOut) {
    return done(EXIT.TIMEOUT, { partial: hasReply, error: `timed out after ${s.timeoutSec}s${s.stopReason ? ` (stopReason ${s.stopReason})` : '; agy was stopped'}` });
  }
  if (s.promptError) {
    const auth = isAuthError(s.promptError);
    const quota = !auth && isQuotaError(s.promptError);
    return done(EXIT.AGENT_ERROR, {
      authRequired: auth,
      quotaExhausted: quota,
      error: auth ? `${s.promptError.message} - the user signs in (run \`agy\` once interactively, or \`agy acp --login\`), then retry`
        : quota ? `${s.promptError.message} - quota or rate limit: record it in the quota ledger and let the layer above switch channel; do not retry or switch accounts`
          : s.promptError.message,
    });
  }
  if (s.exitedEarly) return done(EXIT.SETUP, { error: s.exitedEarly });
  if (s.permissionRequests?.length) warnings.push(`${s.permissionRequests.length} permission request(s) were rejected; the reply may describe work that was not done`);
  if (s.failedToolCalls) warnings.push(`${s.failedToolCalls} tool call(s) failed (denied or errored)`);
  if (s.unfinishedToolCalls) warnings.push(`${s.unfinishedToolCalls} tool call(s) had not finished when the turn ended; closing the session stopped them, check the diff`);
  switch (s.stopReason) {
    case 'end_turn':
      if (!hasReply && s.permissionRequests?.length) {
        const kinds = [...new Set(s.permissionRequests.map((p) => p.kind || 'unknown'))].join(', ');
        return done(EXIT.AGENT_ERROR, {
          deniedAction: true,
          error: `agy ended its turn after a rejected permission request (${kinds}); agy stops at the first denied action. Fix the brief (read-only jobs make no edits; no job runs shell commands) or use --write for edits, then continue with --session ${s.sessionId}`,
        });
      }
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
  if (cfg.write) parts.push('--write');
  if (cfg.allowAnyModel) parts.push('--allow-any-model');
  if (cfg.keepCredentialEnv) parts.push('--keep-credential-env');
  if (cfg.timeoutGiven) parts.push('--timeout', `${cfg.timeoutSec}s`);
  return parts.map((p) => (p === '<NEW_PROMPT>' ? p : shellQuote(p))).join(' ');
}

// ---------- run ----------

function initializeParams() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
  };
}

const launch = (opts) => startAgent({ ...opts, args: ['acp'], label: 'agy acp' });

export async function runJob(cfg, { bin, env }) {
  const handshakeMs = envMs('AGY_ACP_HANDSHAKE_MS', 90_000);
  const cancelGraceMs = envMs('AGY_ACP_CANCEL_GRACE_MS', 10_000);
  const killGraceMs = envMs('AGY_ACP_KILL_GRACE_MS', KILL_GRACE_MS);
  const t = createTracker();
  const toolStatus = new Map();
  const s = { timeoutSec: cfg.timeoutSec, sessionId: cfg.session, setupWarnings: [] };
  let sessionId = cfg.session;
  let promptSent = false;
  const conn = launch({
    bin, cwd: cfg.repo, env, outDir: cfg.outDir,
    onNotification: (method, params) => {
      if (method !== 'session/update' || (sessionId && params?.sessionId !== sessionId)) return;
      // session/resume may replay history; only the new prompt's updates count.
      if (!promptSent) return;
      const u = params.update;
      if (u && (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') && u.toolCallId) {
        toolStatus.set(u.toolCallId, u.status ?? toolStatus.get(u.toolCallId) ?? 'pending');
      }
      trackUpdate(t, u);
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
    const ver = checkAgyVersion(s.agentInfo?.version);
    if (ver.error) { s.setupError = ver.error; return await finishRun(); }
    if (ver.warning) s.setupWarnings.push(ver.warning);
    if (cfg.session && !init?.agentCapabilities?.sessionCapabilities?.resume) {
      s.setupError = 'this agy does not offer session/resume; send the follow-up as a fresh job with the first diff and the failure in its brief';
      return await finishRun();
    }
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
      const r = await applyConfig({ request: (m, p) => client.request(m, p, handshakeMs) }, sessionId, session, cfg);
      s.applied = r.applied;
      s.setupWarnings.push(...r.warnings);
    } catch (err) {
      s.setupError = err instanceof SetupError ? err.message : `selecting mode, model and thinking level failed: ${err.message}`;
      return await finishRun();
    }
    timer = setTimeout(() => {
      s.timedOut = true;
      client.notify('session/cancel', { sessionId });
      escalate(cancelGraceMs);
    }, cfg.timeoutSec * 1000);
    try {
      promptSent = true;
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
    s.unfinishedToolCalls = [...toolStatus.values()].filter((st) => st === 'pending' || st === 'in_progress').length;
    if (sessionId && !conn.exit && !s.interrupted) {
      try { await client.request('session/close', { sessionId }, 5000); } catch { /* best effort */ }
    }
    await stopAgent(conn, { graceMs: killGraceMs, force: Boolean(s.timedOut || s.interrupted) });
    killTimers.forEach(clearTimeout);
    conn.closeFiles?.();
    return { ...s, launchError: s.launchError || (conn.launchError && !s.agentInfo ? conn.launchError : null), tracker: t, nonJsonLines: client.nonJsonLines };
  }
}

export function buildSummary(cfg, run, c, removedEnv = []) {
  const t = run.tracker;
  return {
    ok: c.ok,
    exitCode: c.exitCode,
    channel: 'acp',
    stopReason: run.stopReason ?? null,
    timedOut: Boolean(run.timedOut),
    partial: c.partial,
    sessionId: run.sessionId ?? null,
    agyVersion: run.agentInfo?.version ?? null,
    protocolVersion: run.protocolVersion ?? null,
    mode: run.applied?.mode ?? cfg.mode,
    model: run.applied?.model ?? cfg.model,
    effort: run.applied ? run.applied.effort : cfg.effort,
    legacyModel: cfg.legacyModel,
    write: cfg.write,
    toolCalls: t.toolCalls,
    failedToolCalls: t.failedToolCalls.size,
    unfinishedToolCalls: run.unfinishedToolCalls ?? 0,
    permissionRequests: t.permissionRequests,
    usage: run.usage ?? null,
    contextUsed: t.contextUsed,
    authRequired: c.authRequired,
    quotaExhausted: c.quotaExhausted,
    deniedAction: c.deniedAction,
    credentialEnvRemoved: removedEnv,
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
  const handshakeMs = envMs('AGY_ACP_HANDSHAKE_MS', 90_000);
  const out = {
    ok: false, exitCode: EXIT.SETUP, channel: 'acp', agyVersion: null, protocolVersion: null, versionOk: null,
    authMethods: [], loadSession: null, sessionCapabilities: [], sessionChecked: cfg.sessionCheck,
    modes: [], defaultMode: null, models: [], defaultModel: null, efforts: [], defaultEffort: null,
    readOnlyMode: null, writeMode: null, warnings: [], error: null,
  };
  const conn = launch({ bin, cwd: cfg.repo, env, outDir: null });
  if (!conn.child) { out.error = conn.launchError; return out; }
  const { client } = conn;
  let sessionId = null;
  try {
    const init = await client.request('initialize', initializeParams(), handshakeMs);
    out.agyVersion = init?.agentInfo?.version ?? null;
    out.protocolVersion = init?.protocolVersion ?? null;
    out.authMethods = (init?.authMethods || []).map((m) => m.id);
    out.loadSession = init?.agentCapabilities?.loadSession ?? null;
    out.sessionCapabilities = Object.keys(init?.agentCapabilities?.sessionCapabilities || {});
    const ver = checkAgyVersion(out.agyVersion);
    out.versionOk = !ver.error;
    if (ver.error) throw new SetupError(ver.error);
    if (ver.warning) out.warnings.push(ver.warning);
    if (cfg.sessionCheck) {
      const session = await client.request('session/new', { cwd: cfg.repo, mcpServers: [] }, handshakeMs);
      sessionId = session?.sessionId ?? null;
      Object.assign(out, describeSession(session));
      out.readOnlyMode = out.modes.includes(READONLY_MODE) ? READONLY_MODE : null;
      out.writeMode = out.modes.includes(WRITE_MODE) ? WRITE_MODE : null;
      if (!out.readOnlyMode) out.warnings.push(`no "${READONLY_MODE}" mode: read-only jobs cannot be enforced`);
      if (!out.writeMode) out.warnings.push(`no "${WRITE_MODE}" mode: write jobs cannot run`);
      const home = out.models.filter((m) => /claude|gpt/i.test(m));
      if (home.length) out.warnings.push(`agy also offers ${home.join(', ')}: do not use them under a host of the same vendor`);
    }
    out.ok = true;
    out.exitCode = EXIT.OK;
  } catch (err) {
    out.error = conn.launchError || err.message;
    if (isAuthError(err)) out.warnings.push('not signed in: the user runs `agy` once interactively (or `agy acp --login`)');
  } finally {
    if (sessionId && !conn.exit) {
      try { await client.request('session/close', { sessionId }, 5000); } catch { /* best effort */ }
    }
    await stopAgent(conn, { graceMs: envMs('AGY_ACP_KILL_GRACE_MS', KILL_GRACE_MS) });
  }
  return out;
}

// ---------- main ----------

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function hint(msg) {
  process.stderr.write(`agy-acp-run: ${msg}\n`);
}

async function runMode(opts) {
  const cfg = validateRunOptions(opts);
  const bin = process.env.AGY_BIN || 'agy';
  const { env, removed } = agentEnv(process.env, cfg);
  if (cfg.dryRun) {
    printJson({
      bin, args: ['acp'], cwd: cfg.repo, outDir: cfg.outDir, credentialEnvRemoved: removed,
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      steps: ['initialize', cfg.session ? `session/resume ${cfg.session}` : 'session/new',
        `set mode ${cfg.mode}`, `set model ${cfg.model}`, `set thought_level ${cfg.effort}`,
        `session/prompt <${cfg.promptFile} (${cfg.prompt.length} chars)>`, 'session/close'],
      permissionRequests: 'rejected', timeoutSec: cfg.timeoutSec,
    });
    return EXIT.OK;
  }
  if (cfg.legacyModel) hint(`note: legacy model id ${cfg.legacyModel} split into model ${cfg.model} and thinking level ${cfg.effort}.`);
  if (removed.length) hint(`note: removed ambient credential variables (${removed.join(', ')}); agy uses the user's own sign-in. Pass --keep-credential-env only if the user set them for agy on purpose.`);
  if (cfg.write) hint(`note: --write selects mode ${WRITE_MODE}: agy approves edits inside the workspace; commands stay rejected.`);
  fs.mkdirSync(cfg.outDir, { recursive: true });
  hint(`running agy acp (model=${cfg.model}, effort=${cfg.effort}, mode=${cfg.mode}, timeout=${cfg.timeoutSec}s); output: ${cfg.outDir}`);
  const run = await runJob(cfg, { bin, env });
  const t = run.tracker;
  const reply = finalReply(t);
  const c = classify({
    ...run, reply,
    permissionRequests: t.permissionRequests,
    failedToolCalls: t.failedToolCalls.size,
  });
  fs.writeFileSync(path.join(cfg.outDir, 'last.md'), reply);
  fs.writeFileSync(path.join(cfg.outDir, 'reply.md'), fullReply(t));
  const summary = buildSummary(cfg, run, c, removed);
  fs.writeFileSync(path.join(cfg.outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (summary.warning) hint(`warning: ${summary.warning}`);
  if (summary.timedOut) hint(`timed out.${summary.sessionId ? ` Session ${summary.sessionId} is resumable with --session ${summary.sessionId}.` : ''}`);
  else if (summary.error && !summary.ok) hint(`error: ${summary.error}`);
  printJson(summary);
  return summary.exitCode;
}

async function probeMode(opts) {
  const cfg = validateProbeOptions(opts);
  const bin = process.env.AGY_BIN || 'agy';
  const { env } = agentEnv(process.env, cfg);
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
      process.stderr.write(`agy-acp-run: ${err.message}\nRun with --help for usage.\n`);
      return EXIT.USAGE;
    }
    throw err;
  }
}

if (isMainModule(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
