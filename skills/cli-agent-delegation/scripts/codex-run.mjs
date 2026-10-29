#!/usr/bin/env node
// codex-run.mjs - run `codex exec` with an explicit reasoning effort, a safe
// sandbox, a captured log and a machine-readable result.
//
// Usage:
//   codex-run.mjs exec   --repo <abs dir> --prompt-file <file> --effort <level> [options]
//   codex-run.mjs resume --repo <abs dir> --session <id> --prompt-file <file> --effort <level> [options]
//   codex-run.mjs summary <log-file>
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
  console.error(`codex-run.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or use the fallback described in SKILL.md.');
  process.exit(1);
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const SANDBOXES = ['read-only', 'workspace-write'];
const KILL_GRACE_MS = 5000;
const DRAIN_MS = 500;
const MAX_TIMEOUT_SEC = 24 * 3600;
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const USAGE = `codex-run.mjs - run Codex CLI non-interactively with explicit settings.

Usage:
  codex-run.mjs exec   --repo <abs dir> --prompt-file <file> --effort <level>
                       [--model <id>] [--sandbox read-only|workspace-write]
                       [--out-dir <dir>] [--timeout <dur>] [--json] [--dry-run]
  codex-run.mjs resume --repo <abs dir> --session <id> --prompt-file <file> --effort <level>
                       [--model <id>] [--sandbox ...] [--out-dir <dir>] [--timeout <dur>]
                       [--json] [--dry-run]
  codex-run.mjs summary <log-file>

Options:
  --repo <dir>          Absolute path of the working directory (must exist).
  --prompt-file <file>  Prompt to send (non-empty); passed to codex on stdin.
  --effort <level>      REQUIRED: low | medium | high | xhigh | max.
                        Always passed as -c model_reasoning_effort=<level> so Codex
                        never silently inherits the effort from ~/.codex/config.toml.
                        "ultra" is refused: it lets Codex spawn its own sub-agents.
  --model <id>          Model id. If omitted, Codex uses its configured default.
  --sandbox <mode>      read-only (default) | workspace-write. danger-full-access is refused.
  --session <id>        Session id to resume (resume only).
  --out-dir <dir>       Where to write log.txt, last.md, summary.json
                        (default: <tmp>/codex-run/<YYYYMMDD-HHMMSS>-<hex>).
  --timeout <dur>       Kill codex after e.g. 90s, 10m, 1h (max 24h; default: no timeout).
                        SIGTERM, then SIGKILL after 5s; exit code 124.
  --json                Ask codex for JSONL events (--json) instead of plain text.
  --dry-run             Validate and print the command without running it.
  --help                Show this help.

Environment:
  CODEX_BIN             Codex executable (default: codex).

Output:
  One JSON object on stdout (also saved as summary.json). Hints go to stderr.
  Exit code: codex's exit code; 124 on timeout; 1 on usage or launch errors;
  130/143 when this wrapper is interrupted by SIGINT/SIGTERM (forwarded to codex).
  codex runs in its own process group; on timeout or interrupt the group and every
  descendant process are stopped, so commands codex started do not outlive it.
`;

export class UsageError extends Error {}

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

// ---------- argument parsing ----------

const VALUE_OPTS = {
  '--repo': 'repo',
  '--prompt-file': 'promptFile',
  '--effort': 'effort',
  '--model': 'model',
  '--sandbox': 'sandbox',
  '--session': 'session',
  '--out-dir': 'outDir',
  '--timeout': 'timeout',
};
const FLAG_OPTS = { '--json': 'json', '--dry-run': 'dryRun', '--help': 'help', '-h': 'help' };

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
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      opts.positionals.push(arg);
    }
  }
  opts.command = opts.positionals.shift();
  return opts;
}

export function validateEffort(effort) {
  if (!effort) throw new UsageError(`--effort is required (${EFFORTS.join('|')}); without it codex silently inherits model_reasoning_effort from ~/.codex/config.toml`);
  const e = String(effort).toLowerCase();
  if (e === 'ultra') throw new UsageError('--effort ultra is refused: ultra lets Codex spawn its own sub-agents outside the orchestrator\'s control. Use max at most.');
  if (!EFFORTS.includes(e)) throw new UsageError(`unknown --effort "${effort}" (use ${EFFORTS.join('|')})`);
  return e;
}

export function validateSandbox(sandbox) {
  const s = sandbox ?? 'read-only';
  if (s === 'danger-full-access') throw new UsageError('--sandbox danger-full-access is refused: delegated work must stay inside read-only or workspace-write.');
  if (!SANDBOXES.includes(s)) throw new UsageError(`unknown --sandbox "${s}" (use ${SANDBOXES.join('|')})`);
  return s;
}

// Validates a parsed exec/resume invocation; returns a normalized config.
export function validateRunOptions(opts, { now = new Date() } = {}) {
  const mode = opts.command;
  if (mode !== 'exec' && mode !== 'resume') throw new UsageError(`unknown command "${mode ?? ''}" (use exec, resume or summary)`);
  if (opts.positionals.length) throw new UsageError(`unexpected argument: ${opts.positionals[0]}`);
  const effort = validateEffort(opts.effort);
  const sandbox = validateSandbox(opts.sandbox);
  if (!opts.repo) throw new UsageError('--repo is required');
  if (!path.isAbsolute(opts.repo)) throw new UsageError(`--repo must be an absolute path: ${opts.repo}`);
  let st;
  try { st = fs.statSync(opts.repo); } catch { st = null; }
  if (!st || !st.isDirectory()) throw new UsageError(`--repo is not an existing directory: ${opts.repo}`);
  if (!opts.promptFile) throw new UsageError('--prompt-file is required');
  const promptFile = path.resolve(opts.promptFile);
  let pst;
  try { pst = fs.statSync(promptFile); } catch { pst = null; }
  if (!pst || !pst.isFile()) throw new UsageError(`--prompt-file does not exist: ${opts.promptFile}`);
  if (!fs.readFileSync(promptFile, 'utf8').trim()) throw new UsageError(`--prompt-file is empty: ${opts.promptFile}`);
  if (mode === 'resume' && !opts.session) throw new UsageError('resume needs --session <id>');
  if (mode === 'exec' && opts.session) throw new UsageError('--session is only valid with resume');
  const timeoutSec = opts.timeout !== undefined ? parseDuration(opts.timeout) : null;
  const outDir = path.resolve(opts.outDir ?? path.join(os.tmpdir(), 'codex-run', timestampDirName(now)));
  return {
    mode,
    repo: path.resolve(opts.repo),
    promptFile,
    effort,
    sandbox,
    model: opts.model || null,
    session: opts.session || null,
    outDir,
    timeoutSec,
    json: Boolean(opts.json),
    dryRun: Boolean(opts.dryRun),
  };
}

// ---------- argv builders ----------

export function buildExecArgs({ model, effort, sandbox, repo, outDir, json }) {
  const args = ['exec'];
  if (model) args.push('-m', model);
  args.push('-c', `model_reasoning_effort=${effort}`, '-s', sandbox, '-C', repo,
    '-o', path.join(outDir, 'last.md'));
  if (json) args.push('--json');
  args.push('-');
  return args;
}

// `codex exec resume` has no -C / -s: cwd selects the session scope and the
// sandbox goes through a config override.
export function buildResumeArgs({ model, effort, sandbox, session, outDir, json }) {
  const args = ['exec', 'resume'];
  if (model) args.push('-m', model);
  args.push('-c', `model_reasoning_effort=${effort}`, '-c', `sandbox_mode="${sandbox}"`,
    '-o', path.join(outDir, 'last.md'));
  if (json) args.push('--json');
  args.push(session, '-');
  return args;
}

export function buildArgs(cfg) {
  return cfg.mode === 'resume' ? buildResumeArgs(cfg) : buildExecArgs(cfg);
}

// ---------- log parsing ----------

const HEADER_KEYS = {
  workdir: 'workdir',
  model: 'model',
  provider: 'provider',
  approval: 'approval',
  sandbox: 'sandbox',
  'reasoning effort': 'effortReported',
  'session id': 'sessionId',
};

function toNumber(s) {
  const digits = String(s).replace(/[,_\s]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

export function parseLog(text) {
  const out = {
    workdir: null, model: null, provider: null, approval: null, sandbox: null,
    effortReported: null, sessionId: null, tokensUsed: null, execCount: 0,
  };
  const lines = String(text ?? '').split(/\r?\n/);
  let separators = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^-{4,}\s*$/.test(line)) { separators++; continue; }
    const header = separators < 2 && /^([a-z][a-z ]*?):\s*(.*?)\s*$/.exec(line);
    if (header && HEADER_KEYS[header[1]] && header[2] && out[HEADER_KEYS[header[1]]] === null) {
      out[HEADER_KEYS[header[1]]] = header[2];
      continue;
    }
    const tok = /^tokens used:?\s*(.*?)\s*$/i.exec(line);
    if (tok) {
      let value = toNumber(tok[1]);
      if (value === null && !tok[1]) {
        const next = lines.slice(i + 1).find((l) => l.trim());
        if (next !== undefined) value = toNumber(next.trim());
      }
      if (value !== null) out.tokensUsed = value; // keep the last one
      continue;
    }
    if (/^exec(\s|$)/.test(line)) { out.execCount++; continue; }
    if (line.startsWith('{')) parseJsonEvent(line, out);
  }
  return out;
}

// Best-effort support for `--json` (JSONL events) logs.
function parseJsonEvent(line, out) {
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'thread.started' && ev.thread_id && !out.sessionId) out.sessionId = ev.thread_id;
  if (ev.type === 'turn.completed' && ev.usage) {
    const u = ev.usage;
    const total = (u.input_tokens || 0) + (u.output_tokens || 0);
    if (total) out.tokensUsed = (out.tokensUsed || 0) + total;
  }
  if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') out.execCount++;
}

// ---------- result assembly ----------

export function buildResumeHint(cfg, sessionId, scriptPath = SCRIPT_PATH) {
  if (!sessionId) return null;
  const parts = ['node', scriptPath, 'resume', '--repo', cfg.repo, '--session', sessionId,
    '--prompt-file', '<NEW_PROMPT>', '--effort', cfg.effort];
  if (cfg.model) parts.push('--model', cfg.model);
  if (cfg.sandbox && cfg.sandbox !== 'read-only') parts.push('--sandbox', cfg.sandbox);
  return parts.map((p) => (p === '<NEW_PROMPT>' ? p : shellQuote(p))).join(' ');
}

export function buildResult(cfg, { exitCode, timedOut, logText, launchError, interrupted = null }) {
  const parsed = parseLog(logText);
  const logFile = path.join(cfg.outDir, 'log.txt');
  const lastMessageFile = path.join(cfg.outDir, 'last.md');
  let lastMessageBytes = 0;
  try { lastMessageBytes = fs.statSync(lastMessageFile).size; } catch { /* missing */ }
  const sessionId = parsed.sessionId || cfg.session || null;
  const effortMismatch = Boolean(parsed.effortReported && parsed.effortReported.toLowerCase() !== cfg.effort);
  const result = {
    ok: exitCode === 0 && !timedOut && !interrupted,
    exitCode,
    timedOut,
    mode: cfg.mode,
    sessionId,
    model: parsed.model || cfg.model || null,
    effortRequested: cfg.effort,
    effortReported: parsed.effortReported,
    effortMismatch,
    sandbox: parsed.sandbox || cfg.sandbox,
    approval: parsed.approval,
    workdir: parsed.workdir || cfg.repo,
    tokensUsed: parsed.tokensUsed,
    execCount: parsed.execCount,
    outDir: cfg.outDir,
    logFile,
    lastMessageFile,
    lastMessageBytes,
    resumeHint: buildResumeHint(cfg, sessionId),
  };
  if (interrupted) result.interrupted = interrupted;
  if (launchError) result.error = launchError;
  return result;
}

// ---------- process runner ----------

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

// Sends a signal to the child's process group and to every descendant (POSIX),
// or just the child (Windows). codex-cli 0.165.0 runs tool commands in their own
// session, outside the group, so descendants are also signalled one by one.
// `known` remembers them across calls: once codex dies they are reparented and
// can no longer be found from its pid.
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

// Runs codex in its own process group with stdin from a file and stdout+stderr
// into the log. On timeout (or SIGINT/SIGTERM to this wrapper) the group and all
// descendants get SIGTERM, then SIGKILL after 5s. Leftover group members are
// cleaned up when codex exits.
export function runCodex({ bin, args, cwd, stdinFile, logFile, timeoutSec, killGraceMs = KILL_GRACE_MS }) {
  return new Promise((resolve) => {
    const logFd = fs.openSync(logFile, 'w');
    const inFd = fs.openSync(stdinFile, 'r');
    const known = new Set();
    let timedOut = false;
    let interrupted = null;
    let settled = false;
    let timer = null;
    let killTimer = null;
    let child = null;
    const onSignal = (sig) => {
      if (interrupted) return;
      interrupted = sig;
      signalTree(child, sig, known);
      killTimer = killTimer || setTimeout(() => signalTree(child, 'SIGKILL', known), killGraceMs);
    };
    const onInt = () => onSignal('SIGINT');
    const onTerm = () => onSignal('SIGTERM');
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      // Clean up anything codex left behind in its group.
      signalTree(child, timedOut || interrupted ? 'SIGKILL' : 'SIGTERM', known);
      try { fs.closeSync(logFd); } catch { /* ignore */ }
      try { fs.closeSync(inFd); } catch { /* ignore */ }
      resolve({ ...res, timedOut, interrupted });
    };
    try {
      child = spawn(bin, args, { cwd, stdio: [inFd, logFd, logFd], detached: process.platform !== 'win32' });
    } catch (err) {
      finish({ exitCode: 1, launchError: `failed to launch ${bin}: ${err.message}` });
      return;
    }
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    child.on('error', (err) => finish({ exitCode: 1, launchError: `failed to launch ${bin}: ${err.message}` }));
    child.on('exit', (code, signal) => {
      if (interrupted) return finish({ exitCode: SIGNAL_EXIT[interrupted] ?? 1, launchError: `interrupted by ${interrupted}; codex was stopped` });
      if (timedOut) return finish({ exitCode: 124 });
      if (code !== null) return finish({ exitCode: code });
      return finish({ exitCode: 1, launchError: `codex was terminated by ${signal}` });
    });
    if (timeoutSec) {
      timer = setTimeout(() => {
        timedOut = true;
        signalTree(child, 'SIGTERM', known);
        killTimer = setTimeout(() => signalTree(child, 'SIGKILL', known), killGraceMs);
      }, timeoutSec * 1000);
    }
  });
}

// ---------- main ----------

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function hint(msg) {
  process.stderr.write(`codex-run: ${msg}\n`);
}

async function runMode(opts) {
  const cfg = validateRunOptions(opts);
  const bin = process.env.CODEX_BIN || 'codex';
  const args = buildArgs(cfg);
  if (cfg.dryRun) {
    printJson({ bin, args, cwd: cfg.repo, stdinFile: cfg.promptFile, outDir: cfg.outDir });
    return 0;
  }
  if (!cfg.model) hint('warning: no --model given; Codex will use its configured default model.');
  fs.mkdirSync(cfg.outDir, { recursive: true });
  const logFile = path.join(cfg.outDir, 'log.txt');
  hint(`running codex ${cfg.mode} (effort=${cfg.effort}, sandbox=${cfg.sandbox}${cfg.timeoutSec ? `, timeout=${cfg.timeoutSec}s` : ''}); log: ${logFile}`);
  const run = await runCodex({ bin, args, cwd: cfg.repo, stdinFile: cfg.promptFile, logFile, timeoutSec: cfg.timeoutSec });
  let logText = '';
  try { logText = fs.readFileSync(logFile, 'utf8'); } catch { /* missing */ }
  const result = buildResult(cfg, { ...run, logText });
  fs.writeFileSync(path.join(cfg.outDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (result.effortMismatch) {
    hint(`warning: requested effort "${result.effortRequested}" but codex reported "${result.effortReported}". Check ~/.codex/config.toml profiles and the model's supported efforts.`);
  }
  if (run.launchError) hint(run.launchError);
  if (result.timedOut) hint(`timed out after ${cfg.timeoutSec}s; codex was killed.${result.resumeHint ? ' The session may be resumable.' : ''}`);
  printJson(result);
  return result.exitCode;
}

function summaryMode(opts) {
  const file = opts.positionals[0];
  if (!file) throw new UsageError('summary needs a <log-file>');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    throw new UsageError(`cannot read log file ${file}: ${err.message}`);
  }
  printJson({ logFile: path.resolve(file), ...parseLog(text) });
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (!opts.command) throw new UsageError('missing command (exec, resume or summary)');
    if (opts.command === 'summary') return summaryMode(opts);
    return await runMode(opts);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`codex-run: ${err.message}\nRun with --help for usage.\n`);
      return 1;
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
