#!/usr/bin/env node
// acp-core.mjs - shared Agent Client Protocol (ACP) client pieces for the
// wrappers in this directory (opencode-acp-run.mjs, agy-acp-run.mjs):
// JSON-RPC over stdio, starting and stopping the agent's process tree,
// session-update tracking and the default permission answer (reject).
//
// A library, not a command: it has no main(). Dependency-free (node: builtins only).

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Hard minimum: below it, built-ins these scripts rely on (global fetch,
// process-group handling as tested) are missing or untested. Recommended: 24.
export const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`${path.basename(process.argv[1] || 'acp-core.mjs')}: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Use Node.js 22 or newer: a version the project pins or nvm already has (`nvm use <version>`), else install 24 with nvm (`nvm install 24 && nvm use 24`; native installers only without nvm), or use the raw commands in SKILL.md, "Channels and fallbacks".');
  process.exit(1);
}

export const MAX_TIMEOUT_SEC = 24 * 3600;
export const KILL_GRACE_MS = 5000;

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

export function envMs(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
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

export function rpcError(code, message) {
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

export function waitForExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

// Starts `<bin> <args>` (default `acp`) in its own process group and wires an AcpClient to it.
export function startAgent({ bin, args = ['acp'], label = null, cwd, env, outDir, onNotification, onRequest }) {
  const name = label || `${path.basename(String(bin))} ${args.join(' ')}`;
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
    child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
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
    client.close(new Error(`${name} exited (${signal ? `signal ${signal}` : `code ${code}`})${stderrTail.trim() ? `: ${stderrTail.trim().split('\n').slice(-3).join(' | ')}` : ''}`));
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

// True when this module file is the script node was started with.
export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
