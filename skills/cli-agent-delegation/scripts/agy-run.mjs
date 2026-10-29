#!/usr/bin/env node
// agy-run.mjs - run Google Antigravity CLI (`agy`) headless with a captured,
// machine-readable result. For users without the agy-staff Claude Code plugin.
//
// Usage:
//   agy-run.mjs run --repo <abs dir> --prompt-file <file> --model <id-low|medium|high> [options]
//   agy-run.mjs models
//
// Dependency-free (node: builtins only). Run with --help for details.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KILL_GRACE_MS = 5000;
const DEFAULT_TIMEOUT = '10m';
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
  --prompt-file <file>   Prompt text (non-empty).
  --model <id>           REQUIRED, must end with -low, -medium or -high
                         (e.g. gemini-3.8-flash-high). See \`agy models\`.
  --write                Add --dangerously-skip-permissions: agy runs unrestricted and
                         may edit files and run commands. Without it the run is
                         read-only-ish.
  --timeout <dur>        agy --print-timeout, e.g. 90s, 10m, 1h (default ${DEFAULT_TIMEOUT}).
                         The wrapper kills agy at timeout + 60s.
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
  0  success (also when agy reported an error but still returned a response;
     "warning" is set then - review the response carefully)
  1  usage error
  2  agy reported an error and returned no response
  3  agy could not be launched, or its output could not be parsed
  5  timed out (if a conversation id is known it can be resumed with --conversation)
`;

export class UsageError extends Error {}

// ---------- small helpers ----------

export function parseDuration(value) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i.exec(String(value ?? '').trim());
  if (!m) throw new UsageError(`invalid duration "${value}" (use e.g. 90s, 10m, 1h)`);
  const n = Number(m[1]) * { s: 1, m: 60, h: 3600 }[(m[2] || 's').toLowerCase()];
  if (!(n > 0)) throw new UsageError(`duration must be positive: "${value}"`);
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

// agy prints one JSON object, possibly after some noise. Returns the object or null.
export function parseAgyOutput(stdout) {
  const text = String(stdout ?? '');
  const candidates = [];
  const first = text.indexOf('{');
  if (first >= 0) candidates.push(text.slice(first));
  for (const line of text.split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (t.startsWith('{')) candidates.push(t);
  }
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch { /* try next */ }
  }
  return null;
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

function looksLikeTimeout(...values) {
  return values.some((v) => typeof v === 'string' && /timeout|timed.?out|deadline/i.test(v));
}

// Pure classification of a finished run -> { exitCode, ok, timedOut, warning, error, ... }.
export function classify({ payload, launchError, killedByTimeout, agyExitCode }) {
  const base = {
    status: payload?.status ?? null,
    conversationId: payload?.conversation_id ?? payload?.conversationId ?? null,
    response: typeof payload?.response === 'string' ? payload.response : null,
    durationSeconds: payload?.duration_seconds ?? null,
    numTurns: payload?.num_turns ?? null,
    usage: payload?.usage ?? null,
    warning: null,
    error: errorText(payload?.error),
    timedOut: false,
  };
  const hasResponse = Boolean(base.response && base.response.trim());
  if (launchError) return { ...base, exitCode: EXIT.LAUNCH_OR_PARSE, error: launchError };
  if (killedByTimeout) {
    return { ...base, exitCode: EXIT.TIMEOUT, timedOut: true, error: base.error || 'agy did not finish within timeout + grace; it was killed' };
  }
  if (!payload) {
    return { ...base, exitCode: EXIT.LAUNCH_OR_PARSE, error: `could not parse agy output as JSON (agy exit code ${agyExitCode})` };
  }
  const isError = isErrorStatus(base.status) || (!base.status && base.error !== null);
  if (isError) {
    if (hasResponse) {
      return { ...base, exitCode: EXIT.OK, warning: `agy reported ${base.status || 'an error'}${base.error ? `: ${base.error}` : ''}, but returned a response; review it carefully.` };
    }
    if (looksLikeTimeout(base.status, base.error)) return { ...base, exitCode: EXIT.TIMEOUT, timedOut: true };
    return { ...base, exitCode: EXIT.AGY_ERROR, error: base.error || `agy reported status ${base.status}` };
  }
  const warnings = [];
  if (!hasResponse) warnings.push('agy returned an empty response');
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

export function runAgy({ bin, args, cwd, killAfterSec }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    let killTimer = null;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ stdout, stderr, timedOut, ...res });
    };
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ exitCode: null, launchError: `failed to launch ${bin}: ${err.message}` });
      return;
    }
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish({ exitCode: null, launchError: `failed to launch ${bin}: ${err.message}` }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
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
  const c = classify({ payload, launchError: run.launchError, killedByTimeout: run.timedOut, agyExitCode: run.exitCode });

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
  if (result.timedOut) {
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
