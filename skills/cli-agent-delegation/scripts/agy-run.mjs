#!/usr/bin/env node
// agy-run.mjs - run Google Antigravity CLI (`agy`) headless with a captured,
// machine-readable result. For users without the agy-staff Claude Code plugin.
//
// Usage:
//   agy-run.mjs run --repo <abs dir> --prompt-file <file> --model <id-low|medium|high> [options]
//   agy-run.mjs models
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
  console.error(`agy-run.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or use the fallback described in SKILL.md.');
  process.exit(1);
}

const KILL_GRACE_MS = 5000;
const DRAIN_MS = 500;
const MAX_TIMEOUT_SEC = 24 * 3600;
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };
const DEFAULT_TIMEOUT = '10m';
export const MAX_PROMPT_BYTES = 100 * 1024;
const DEFAULT_OUTER_GRACE_SEC = 60;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const EXIT = { OK: 0, USAGE: 1, AGY_ERROR: 2, LAUNCH_OR_PARSE: 3, TIMEOUT: 5 };

export const USAGE = `agy-run.mjs - run Google Antigravity CLI (agy) headless.

Usage:
  agy-run.mjs run --repo <abs dir> --prompt-file <file> --model <id-with-effort-suffix>
                  [--write] [--timeout <dur>] [--conversation <id>] [--out-dir <dir>]
                  [--allow-any-model] [--dry-run]
  agy-run.mjs models        List model ids (passthrough to \`agy models\`).

Options:
  --repo <dir>           Absolute path of the workspace (must exist); agy runs there
                         and gets it via --add-dir.
  --prompt-file <file>   Prompt text (non-empty, at most 100 KB: it is passed to agy as
                         a command-line argument). For long briefs, write a spec file
                         inside the repo and send a short prompt such as
                         "Read docs/tasks/job-spec.md and follow it."
  --model <id>           REQUIRED, must end with -low, -medium or -high
                         (e.g. gemini-3.8-flash-high). See \`agy models\`.
  --write                Add --dangerously-skip-permissions: agy runs unrestricted and
                         may edit files and run commands; without --write, agy runs
                         with its default permission prompts; in headless mode,
                         actions that need approval are not performed.
  --timeout <dur>        agy --print-timeout, e.g. 90s, 10m, 1h (default ${DEFAULT_TIMEOUT},
                         max 24h). The wrapper stops agy's process group and every
                         descendant at timeout + 60s (SIGTERM, then SIGKILL after 5s).
  --conversation <id>    Continue an earlier conversation.
  --out-dir <dir>        Where to write result.json, last.md, stderr.txt, summary.json
                         (default: <tmp>/agy-run/<YYYYMMDD-HHMMSS>-<hex>).
  --allow-any-model      Allow model ids that look like Claude or GPT models.
  --dry-run              Validate and print the command without running it.
  --help                 Show this help.

Environment:
  AGY_BIN                agy executable (default: agy).

Output:
  One JSON object on stdout (also saved as summary.json). Hints go to stderr.

Exit codes:
  0  success (also when agy reported an error, or hit its time limit, but still
     returned a response; "warning" is set then, and "partial": true for a
     time limit - review the response carefully)
  1  usage error
  2  agy reported an error and returned no response
  3  agy could not be launched, or its output could not be parsed
  5  timed out (if a conversation id is known it can be resumed with --conversation)
  130/143  this wrapper was interrupted by SIGINT/SIGTERM (forwarded to agy)
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
  '--model': 'model',
  '--timeout': 'timeout',
  '--conversation': 'conversation',
  '--out-dir': 'outDir',
};
const FLAG_OPTS = {
  '--write': 'write',
  '--allow-any-model': 'allowAnyModel',
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

export function validateModel(model, { allowAnyModel = false } = {}) {
  if (!model) throw new UsageError('--model is required (an id with an effort suffix, e.g. gemini-3.8-flash-high; see `agy models`)');
  if (!/-(low|medium|high)$/.test(model)) {
    throw new UsageError(`--model "${model}" has no effort suffix; use e.g. ${model}-high (suffix -low, -medium or -high). Run \`agy models\` (or \`agy-run.mjs models\`) to list ids.`);
  }
  if (!allowAnyModel && /claude|gpt/i.test(model)) {
    throw new UsageError(`--model "${model}" looks like a Claude/GPT model: routing outsourced work back to your in-house model family defeats the purpose; use your harness's own subagents instead (or pass --allow-any-model).`);
  }
  return model;
}

export function validateRunOptions(opts, { now = new Date() } = {}) {
  if (opts.command !== 'run') throw new UsageError(`unknown command "${opts.command ?? ''}" (use run or models)`);
  if (opts.positionals.length) throw new UsageError(`unexpected argument: ${opts.positionals[0]}`);
  const model = validateModel(opts.model, { allowAnyModel: opts.allowAnyModel });
  if (!opts.repo) throw new UsageError('--repo is required');
  if (!path.isAbsolute(opts.repo)) throw new UsageError(`--repo must be an absolute path: ${opts.repo}`);
  let st;
  try { st = fs.statSync(opts.repo); } catch { st = null; }
  if (!st || !st.isDirectory()) throw new UsageError(`--repo is not an existing directory: ${opts.repo}`);
  if (!opts.promptFile) throw new UsageError('--prompt-file is required');
  const promptFile = path.resolve(opts.promptFile);
  let prompt;
  try { prompt = fs.readFileSync(promptFile, 'utf8'); } catch {
    throw new UsageError(`--prompt-file does not exist: ${opts.promptFile}`);
  }
  if (!prompt.trim()) throw new UsageError(`--prompt-file is empty: ${opts.promptFile}`);
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > MAX_PROMPT_BYTES) {
    throw new UsageError(`--prompt-file is ${promptBytes} bytes; agy takes the prompt as a command-line argument, so the limit is ${MAX_PROMPT_BYTES} bytes (100 KB). Keep the brief short and point agy at a spec file inside the repo, e.g. "Read docs/tasks/job-spec.md and follow it."`);
  }
  const timeoutSec = parseDuration(opts.timeout ?? DEFAULT_TIMEOUT);
  const outDir = path.resolve(opts.outDir ?? path.join(os.tmpdir(), 'agy-run', timestampDirName(now)));
  return {
    repo: path.resolve(opts.repo),
    promptFile,
    prompt,
    model,
    write: Boolean(opts.write),
    timeoutSec,
    timeoutGiven: opts.timeout !== undefined,
    conversation: opts.conversation || null,
    outDir,
    dryRun: Boolean(opts.dryRun),
  };
}

// ---------- argv builder ----------

export function buildArgs({ prompt, model, timeoutSec, repo, conversation, write }) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json',
    '--print-timeout', `${timeoutSec}s`, '--add-dir', repo];
  if (conversation) args.push('--conversation', conversation);
  if (write) args.push('--dangerously-skip-permissions');
  return args;
}

export function redactPrompt(args, promptFile, prompt) {
  const out = [...args];
  const i = out.indexOf('-p');
  if (i >= 0 && i + 1 < out.length) out[i + 1] = `<prompt from ${promptFile} (${prompt.length} chars)>`;
  return out;
}

// ---------- output parsing ----------

// Returns the end index (exclusive) of the balanced {...} starting at `start`,
// respecting JSON strings and escapes, or -1 if it never closes.
function scanObject(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const PAYLOAD_KEYS = ['response', 'status', 'conversation_id'];

// agy prints one JSON object (single-line or pretty), possibly surrounded by
// noise. Collects every top-level {...} that parses as an object and returns
// the last one that looks like an agy payload (else the last object), or null.
export function parseAgyOutput(stdout) {
  const text = String(stdout ?? '');
  const objects = [];
  let i = text.indexOf('{');
  while (i >= 0) {
    const end = scanObject(text, i);
    let parsed = null;
    if (end > 0) {
      try { parsed = JSON.parse(text.slice(i, end)); } catch { parsed = null; }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      objects.push(parsed);
      i = text.indexOf('{', end);
    } else {
      i = text.indexOf('{', i + 1);
    }
  }
  const payloads = objects.filter((o) => PAYLOAD_KEYS.some((k) => k in o));
  return payloads.at(-1) ?? objects.at(-1) ?? null;
}

export function isErrorStatus(status) {
  return typeof status === 'string' && /err|fail|cancel|abort|timeout|timed.?out|deadline/i.test(status);
}

function errorText(err) {
  if (err === undefined || err === null || err === '') return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && typeof err.message === 'string') return err.message;
  return JSON.stringify(err);
}

// Only the status field decides "timed out"; free error text such as
// "upstream connection timeout" is an ordinary agy error.
export function isTimeoutStatus(status) {
  return typeof status === 'string' && /time[\s_-]?d?[\s_-]?out|deadline/i.test(status);
}

// agy 1.4.10 keeps status "SUCCESS" when --print-timeout fires and says so only
// on stderr: "[agy] print timeout after 15s with turn in progress; ...".
export function stderrReportsTimeout(stderr) {
  return /\bprint timeout after\b/i.test(String(stderr ?? ''));
}

// Pure classification of a finished run -> { exitCode, ok, timedOut, warning, error, ... }.
export function classify({ payload, launchError, killedByTimeout, interrupted, agyExitCode, conversation = null, stderr = '' }) {
  const base = {
    status: payload?.status ?? null,
    conversationId: payload?.conversation_id ?? payload?.conversationId ?? conversation ?? null,
    response: typeof payload?.response === 'string' ? payload.response : null,
    durationSeconds: payload?.duration_seconds ?? null,
    numTurns: payload?.num_turns ?? null,
    usage: payload?.usage ?? null,
    warning: null,
    error: errorText(payload?.error),
    timedOut: false,
    partial: false,
  };
  const hasResponse = Boolean(base.response && base.response.trim());
  if (launchError) return { ...base, exitCode: EXIT.LAUNCH_OR_PARSE, error: launchError };
  if (interrupted) {
    return { ...base, exitCode: SIGNAL_EXIT[interrupted] ?? 1, error: `interrupted by ${interrupted}; agy was stopped` };
  }
  if (killedByTimeout) {
    return { ...base, exitCode: EXIT.TIMEOUT, timedOut: true, error: base.error || 'agy did not finish within timeout + grace; it was killed' };
  }
  if (!payload) {
    return { ...base, exitCode: EXIT.LAUNCH_OR_PARSE, error: `could not parse agy output as JSON (agy exit code ${agyExitCode})` };
  }
  const statusTimeout = isTimeoutStatus(base.status);
  if (statusTimeout || stderrReportsTimeout(stderr)) {
    if (hasResponse) {
      const cont = base.conversationId ? `--conversation ${base.conversationId}` : '--conversation <id>';
      return { ...base, exitCode: EXIT.OK, timedOut: true, partial: true,
        warning: `agy hit its time limit; the response may be incomplete; continue with ${cont}` };
    }
    return { ...base, exitCode: EXIT.TIMEOUT, timedOut: true,
      error: base.error || (statusTimeout ? `agy reported status ${base.status}` : 'agy hit its print timeout before replying') };
  }
  const isError = isErrorStatus(base.status) || (!base.status && base.error !== null);
  if (isError) {
    if (hasResponse) {
      return { ...base, exitCode: EXIT.OK, warning: `agy reported ${base.status || 'an error'}${base.error ? `: ${base.error}` : ''}, but returned a response; review it carefully.` };
    }
    return { ...base, exitCode: EXIT.AGY_ERROR, error: base.error || `agy reported status ${base.status}` };
  }
  const warnings = [];
  if (!hasResponse) warnings.push('agy returned an empty response');
  const killedTasks = String(stderr ?? '').match(/terminating (\d+) background task/i);
  if (killedTasks) warnings.push(`agy terminated ${killedTasks[1]} background task(s) on exit; work they were doing did not finish`);
  if (agyExitCode) warnings.push(`agy exited with code ${agyExitCode} despite status ${base.status ?? 'unknown'}`);
  return { ...base, exitCode: EXIT.OK, warning: warnings.length ? warnings.join('; ') : null };
}

export function buildContinueHint(cfg, conversationId, scriptPath = SCRIPT_PATH) {
  if (!conversationId) return null;
  const parts = ['node', scriptPath, 'run', '--repo', cfg.repo, '--prompt-file', '<NEW_PROMPT>',
    '--model', cfg.model, '--conversation', conversationId];
  if (cfg.write) parts.push('--write');
  if (cfg.timeoutGiven) parts.push('--timeout', `${cfg.timeoutSec}s`);
  return parts.map((p) => (p === '<NEW_PROMPT>' ? p : shellQuote(p))).join(' ');
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
// or just the child (Windows). Descendants that moved to their own session are
// outside the group, so they are also signalled one by one. `known` remembers
// them across calls: once agy dies they are reparented and can no longer be
// found from its pid.
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

// Runs agy in its own process group. Resolves shortly after agy exits even if a
// grandchild still holds stdout/stderr open. On timeout (or SIGINT/SIGTERM to
// this wrapper) the group and all descendants get SIGTERM, then SIGKILL after 5s.
export function runAgy({ bin, args, cwd, killAfterSec, killGraceMs = KILL_GRACE_MS, drainMs = DRAIN_MS }) {
  return new Promise((resolve) => {
    const known = new Set();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let interrupted = null;
    let settled = false;
    let timer = null;
    let killTimer = null;
    let drainTimer = null;
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
      clearTimeout(drainTimer);
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      // Clean up anything agy left behind in its group, and stop waiting on its pipes.
      signalTree(child, timedOut || interrupted ? 'SIGKILL' : 'SIGTERM', known);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve({ stdout, stderr, timedOut, interrupted, ...res });
    };
    try {
      child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (err) {
      finish({ exitCode: null, launchError: `failed to launch ${bin}: ${err.message}` });
      return;
    }
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish({ exitCode: null, launchError: `failed to launch ${bin}: ${err.message}` }));
    child.on('exit', (code, signal) => {
      drainTimer = setTimeout(() => finish({ exitCode: code, signal }), drainMs);
    });
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    timer = setTimeout(() => {
      timedOut = true;
      signalTree(child, 'SIGTERM', known);
      killTimer = setTimeout(() => signalTree(child, 'SIGKILL', known), killGraceMs);
    }, killAfterSec * 1000);
  });
}

// ---------- main ----------

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function hint(msg) {
  process.stderr.write(`agy-run: ${msg}\n`);
}

function outerGraceSec() {
  // Test hook: shrink the outer kill grace (seconds). Not meant for normal use.
  const v = Number(process.env.AGY_RUN_GRACE_SECONDS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_OUTER_GRACE_SEC;
}

async function runMode(opts) {
  const cfg = validateRunOptions(opts);
  const bin = process.env.AGY_BIN || 'agy';
  const args = buildArgs(cfg);
  if (cfg.dryRun) {
    printJson({ bin, args: redactPrompt(args, cfg.promptFile, cfg.prompt), cwd: cfg.repo, outDir: cfg.outDir });
    return EXIT.OK;
  }
  if (cfg.write) hint('note: --write passes --dangerously-skip-permissions; agy runs unrestricted and may edit files and run commands in the workspace.');
  fs.mkdirSync(cfg.outDir, { recursive: true });
  hint(`running agy (model=${cfg.model}, timeout=${cfg.timeoutSec}s); output: ${cfg.outDir}`);
  const run = await runAgy({ bin, args, cwd: cfg.repo, killAfterSec: cfg.timeoutSec + outerGraceSec() });
  const payload = run.launchError ? null : parseAgyOutput(run.stdout);
  const c = classify({ payload, launchError: run.launchError, killedByTimeout: run.timedOut,
    interrupted: run.interrupted, agyExitCode: run.exitCode, conversation: cfg.conversation, stderr: run.stderr });

  const lastMessageFile = path.join(cfg.outDir, 'last.md');
  fs.writeFileSync(path.join(cfg.outDir, 'result.json'), payload ? `${JSON.stringify(payload, null, 2)}\n` : run.stdout);
  fs.writeFileSync(lastMessageFile, c.response ?? '');
  fs.writeFileSync(path.join(cfg.outDir, 'stderr.txt'), run.stderr);

  const conversationId = c.conversationId || cfg.conversation || null;
  const result = {
    ok: c.exitCode === EXIT.OK,
    exitCode: c.exitCode,
    agyExitCode: run.exitCode ?? null,
    status: c.status,
    timedOut: c.timedOut,
    partial: c.partial,
    conversationId,
    model: cfg.model,
    durationSeconds: c.durationSeconds,
    numTurns: c.numTurns,
    usage: c.usage,
    warning: c.warning,
    error: c.error,
    outDir: cfg.outDir,
    lastMessageFile,
    continueHint: buildContinueHint(cfg, conversationId),
  };
  fs.writeFileSync(path.join(cfg.outDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (result.warning) hint(`warning: ${result.warning}`);
  if (result.timedOut && !result.partial) {
    hint(`timed out.${conversationId ? ` Conversation ${conversationId} is resumable with --conversation ${conversationId}.` : ''}`);
  } else if (result.error && !result.ok) {
    hint(`error: ${result.error}`);
  }
  printJson(result);
  return result.exitCode;
}

function modelsMode() {
  const bin = process.env.AGY_BIN || 'agy';
  return new Promise((resolve) => {
    const child = spawn(bin, ['models'], { stdio: 'inherit' });
    child.on('error', (err) => {
      hint(`failed to launch ${bin}: ${err.message}`);
      resolve(EXIT.LAUNCH_OR_PARSE);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (!opts.command) throw new UsageError('missing command (run or models)');
    if (opts.command === 'models') return await modelsMode();
    return await runMode(opts);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`agy-run: ${err.message}\nRun with --help for usage.\n`);
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
