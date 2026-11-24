#!/usr/bin/env node
// compute-config.mjs - the user's external compute plan, kept in local files
// instead of an agent's memory: which external team · model · effort takes
// which responsibility, fallbacks, time windows, quota state and a usage log.
//
//   compute-config.mjs paths | show | init | set | remove | route | schedule
//                      | quota | record | usage | resolve | reviewed | check-models
//
// Two scopes, merged project over global:
//   global   $SUBAGENT_TEAM_HOME, else ~/.subagent-team
//   project  <main checkout>/.agent-team/ (git-ignored through .git/info/exclude)
// Session-only choices are not written here. Dependency-free. Run --help.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Hard minimum shared by every script in these skills. Recommended: 24.
export const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`compute-config.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Use Node.js 22 or newer: a version the project pins or nvm already has (`nvm use <version>`), else install 24 with nvm (`nvm install 24 && nvm use 24`; native installers only without nvm), or edit the JSON files by hand as described in references/compute-config.md.');
  process.exit(1);
}

export const SCHEMA = 1;
export const CONFIG_FILE = 'compute.json';
export const USAGE_FILE = 'compute-usage.jsonl';
export const RANKING_FILE = 'model-ranking.json';
export const PROJECT_DIR = '.agent-team';
export const TIERS = ['external-fast', 'external-strong'];
export const EDIT_ROLES = ['bulk', 'homogeneous', 'bounded', 'code-sync'];
export const REVIEW_ROLES = ['review', 'sensitive-review'];
export const ROLES = [...EDIT_ROLES, ...REVIEW_ROLES];
export const QUOTA_STATES = ['plenty', 'ok', 'low', 'exhausted', 'unknown'];
export const OUTCOMES = ['accepted', 'rework', 'in-house', 'quota', 'failed', 'cancelled'];
export const DEFAULT_REVIEW_DAYS = 7;
export const RANKING_STALE_DAYS = 30;
export const TEAM_VENDORS = { codex: ['openai'], agy: ['google'], opencode: [] };
export const UPDATE_HINTS = {
  codex: 'npm install -g @openai/codex@latest (or the package manager it was installed with, e.g. brew upgrade codex)',
  agy: "agy's own update command (see `agy --help`; unverified) or its installer",
  opencode: 'opencode upgrade (unverified; see `opencode --help`)',
};
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,31}$/;
const DAY_MS = 86_400_000;

export const USAGE = `compute-config.mjs - the user's external compute plan in local files (project or global).

Usage:
  compute-config.mjs paths    [--root <dir>]
  compute-config.mjs show     [--root <dir>] [--at <time>]
  compute-config.mjs init     --scope project|global [--from <file.json>] [--force] [--root <dir>]
  compute-config.mjs set      <id> --scope S [--team T] [--channel C] [--model M] [--effort E]
                              [--tier external-fast|external-strong] [--roles a,b] [--fallback x,y]
                              [--may-edit yes|no] [--enabled yes|no] [--windows "<when>[; <when>]"]
                              [--vendor v] [--note text]
  compute-config.mjs remove   <id> --scope S
  compute-config.mjs route    <role> <id,id,...|-> --scope S
  compute-config.mjs schedule add <rule-id> --scope S --when "<when>" [--prefer ids] [--avoid ids]
                              [--roles r,s] [--note text]
  compute-config.mjs schedule remove <rule-id> --scope S
  compute-config.mjs quota    <id> --state ${QUOTA_STATES.join('|')} [--resets <time|unknown>]
                              [--expires <time>] [--source <text>] [--note text] [--scope global|project]
  compute-config.mjs record   <id> --outcome ${OUTCOMES.join('|')} [--task T] [--role R]
                              [--minutes n] [--tokens-in n] [--tokens-out n] [--cost usd] [--note text]
                              [--scope global|project]
  compute-config.mjs usage    [--since-days n] [--resource id] [--root <dir>]
  compute-config.mjs resolve  --role <role> [--at <time>] [--root <dir>]
  compute-config.mjs reviewed --scope S [--every-days n]
  compute-config.mjs check-models --available <team>=<file> [--available ...] [--ranking <file>]

Scopes: global = ${'$'}SUBAGENT_TEAM_HOME, else ~/.subagent-team;
project = <main checkout>/${PROJECT_DIR}/ (added to .git/info/exclude on first write).
Effective config = global, overridden by project. Writes to the config need an
explicit --scope: ask the user which one. quota and record default to global
(quota and spend belong to the account, not the project).

Roles: ${ROLES.join(', ')} (custom lowercase names allowed).
<when>: space-separated tokens: days (mon-fri, sat,sun: the days a window starts on),
a time range (22:00-08:00, may wrap midnight), tz=<IANA zone>, from=<date|time>, until=<date|time>.
<time>: ISO 8601 with an offset (2026-11-22T19:00+08:00, ...Z) or "now". A date alone
(YYYY-MM-DD) is a whole local day in the window's or the plan's zone (until: inclusive;
--resets: from its start; --expires: after its end); --at needs a time.
Fallback entries: resource ids, or in-house:<tier>[:<effort>] (e.g. in-house:mid:medium).

Output: one JSON object on stdout; hints on stderr.
Exit codes: 0 ok; 1 usage error; 2 no compute config yet (run init); 3 invalid config file;
4 file system, lock or unexpected error; 5 unknown resource or rule id; 6 config exists (init without --force).
`;

export class UsageError extends Error {}
export class CodedError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- argument parsing ----------

const COMMANDS = ['paths', 'show', 'init', 'set', 'remove', 'route', 'schedule', 'quota', 'record', 'usage', 'resolve', 'reviewed', 'check-models'];
const VALUED = {
  '--root': 'root', '--scope': 'scope', '--at': 'at', '--from': 'from', '--team': 'team', '--channel': 'channel',
  '--model': 'model', '--effort': 'effort', '--tier': 'tier', '--roles': 'roles', '--fallback': 'fallback',
  '--may-edit': 'mayEdit', '--enabled': 'enabled', '--windows': 'windows', '--vendor': 'vendor', '--note': 'note',
  '--when': 'when', '--prefer': 'prefer', '--avoid': 'avoid', '--state': 'state', '--resets': 'resets',
  '--expires': 'expires', '--source': 'source', '--outcome': 'outcome', '--task': 'task', '--role': 'role',
  '--minutes': 'minutes', '--tokens-in': 'tokensIn', '--tokens-out': 'tokensOut', '--cost': 'cost',
  '--since-days': 'sinceDays', '--resource': 'resource', '--every-days': 'everyDays', '--ranking': 'ranking',
};

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') return { help: true };
  if (!COMMANDS.includes(command)) throw new UsageError(`unknown command: ${command}`);
  const opts = { command, root: process.cwd(), positional: [], available: [], force: false };
  for (let i = 0; i < rest.length; i++) {
    let arg = rest[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--available' || VALUED[arg]) {
      const v = inline ?? rest[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      if (inline === undefined && v.startsWith('--')) throw new UsageError(`${arg} needs a value, got option ${v}`);
      if (arg === '--available') opts.available.push(v);
      else opts[VALUED[arg]] = v;
      continue;
    }
    if (arg.startsWith('--')) throw new UsageError(`unknown argument: ${arg}`);
    opts.positional.push(arg);
  }
  const needScope = ['init', 'set', 'remove', 'route', 'schedule', 'reviewed'];
  if (opts.scope !== undefined && !['project', 'global'].includes(opts.scope)) throw new UsageError('--scope must be project or global');
  if (needScope.includes(command) && !opts.scope) throw new UsageError(`${command} needs --scope project|global (ask the user which)`);
  if (['quota', 'record'].includes(command) && !opts.scope) opts.scope = 'global';
  const id = opts.positional[0];
  if (['set', 'remove', 'quota', 'record'].includes(command)) {
    if (!id || !ID_RE.test(id)) throw new UsageError(`${command} needs a resource id (lowercase letters, digits, . _ -)`);
    opts.id = id;
  }
  if (command === 'route') {
    if (!opts.positional[0] || !ROLE_RE.test(opts.positional[0])) throw new UsageError('route needs a role name');
    if (opts.positional[1] === undefined) throw new UsageError('route needs a comma-separated id list, or - to clear');
    opts.role = opts.positional[0];
    opts.order = opts.positional[1] === '-' ? null : splitList(opts.positional[1]);
  }
  if (command === 'schedule') {
    const [action, ruleId] = opts.positional;
    if (!['add', 'remove'].includes(action)) throw new UsageError('schedule needs add or remove');
    if (!ruleId || !ID_RE.test(ruleId)) throw new UsageError('schedule needs a rule id');
    opts.action = action;
    opts.id = ruleId;
    if (action === 'add' && !opts.when) throw new UsageError('schedule add needs --when');
    if (action === 'add' && !opts.prefer && !opts.avoid) throw new UsageError('schedule add needs --prefer or --avoid');
  }
  if (command === 'quota' && !QUOTA_STATES.includes(opts.state)) throw new UsageError(`--state must be one of ${QUOTA_STATES.join(', ')}`);
  if (command === 'record' && !OUTCOMES.includes(opts.outcome)) throw new UsageError(`--outcome must be one of ${OUTCOMES.join(', ')}`);
  if (command === 'resolve' && (!opts.role || !ROLE_RE.test(opts.role))) throw new UsageError('resolve needs --role');
  if (opts.tier !== undefined && !TIERS.includes(opts.tier)) throw new UsageError(`--tier must be ${TIERS.join(' or ')}`);
  for (const k of ['mayEdit', 'enabled']) {
    if (opts[k] !== undefined) {
      if (!['yes', 'no'].includes(opts[k])) throw new UsageError(`--${k === 'mayEdit' ? 'may-edit' : 'enabled'} must be yes or no`);
      opts[k] = opts[k] === 'yes';
    }
  }
  for (const k of ['minutes', 'tokensIn', 'tokensOut', 'cost', 'sinceDays', 'everyDays']) {
    if (opts[k] !== undefined) {
      const n = Number(opts[k]);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a non-negative number`);
      opts[k] = n;
    }
  }
  if (opts.everyDays !== undefined && !(Number.isInteger(opts.everyDays) && opts.everyDays > 0)) throw new UsageError('--every-days must be a positive integer');
  if (opts.windows !== undefined) opts.windows = opts.windows.split(';').map((s) => s.trim()).filter(Boolean).map(parseWhen);
  if (opts.when !== undefined) opts.when = parseWhen(opts.when);
  for (const k of ['roles', 'fallback', 'prefer', 'avoid']) if (opts[k] !== undefined) opts[k] = splitList(opts[k]);
  if (opts.roles) for (const r of opts.roles) if (!ROLE_RE.test(r)) throw new UsageError(`bad role name: ${r}`);
  if (opts.at !== undefined) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(opts.at)) throw new UsageError('--at needs a time with an offset, not a date alone');
    opts.at = parseTime(opts.at, '--at');
  }
  for (const k of ['resets', 'expires']) {
    if (opts[k] === undefined || opts[k] === 'unknown') continue;
    // A date alone stays a date, read in the plan's zone: resets at its start, expires at its end.
    opts[k] = /^\d{4}-\d{2}-\d{2}$/.test(opts[k]) ? (parseTime(opts[k], `--${k}`), opts[k]) : parseTime(opts[k], `--${k}`).toISOString();
  }
  if (command === 'check-models' && !opts.available.length) throw new UsageError('check-models needs at least one --available <team>=<file>');
  return opts;
}

function splitList(s) {
  return String(s).split(',').map((x) => x.trim()).filter(Boolean);
}

export function parseTime(s, name = 'time') {
  if (s instanceof Date) return s;
  if (s === 'now') return new Date();
  if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2}))?$/.test(String(s))) {
    throw new UsageError(`${name}: use YYYY-MM-DD or an ISO 8601 time with an offset (2026-11-22T19:00+08:00 or ...Z), got: ${s}`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new UsageError(`${name}: invalid time: ${s}`);
  return d;
}

// "mon-fri 22:00-08:00 tz=Asia/Shanghai until=2026-11-30" -> window object.
export function parseWhen(spec) {
  const w = {};
  for (const tok of String(spec).trim().split(/\s+/).filter(Boolean)) {
    const kv = tok.match(/^(tz|from|until)=(.+)$/);
    if (kv) {
      if (kv[1] === 'tz') { checkZone(kv[2]); w.tz = kv[2]; } else { dateOrTime(kv[2], kv[1]); w[kv[1]] = kv[2]; }
    } else if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(tok)) {
      const [a, b] = tok.split('-').map(toMinutes);
      if (a === null || b === null || a === b) throw new UsageError(`bad time range: ${tok}`);
      w.hours = tok;
    } else {
      w.days = expandDays(tok);
    }
  }
  if (!Object.keys(w).length) throw new UsageError(`empty window: "${spec}"`);
  return w;
}

function toMinutes(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

function expandDays(tok) {
  const out = new Set();
  for (const part of tok.toLowerCase().split(',').filter(Boolean)) {
    const range = part.split('-');
    if (range.length === 2 && DAYS.includes(range[0]) && DAYS.includes(range[1])) {
      let i = DAYS.indexOf(range[0]);
      const end = DAYS.indexOf(range[1]);
      for (;;) { out.add(DAYS[i]); if (i === end) break; i = (i + 1) % 7; }
    } else if (DAYS.includes(part)) out.add(part);
    else throw new UsageError(`bad window token: ${tok} (days like mon-fri or sat,sun; HH:MM-HH:MM; tz=, from=, until=)`);
  }
  return DAYS.filter((d) => out.has(d));
}

function checkZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new UsageError(`unknown time zone: ${tz}`); }
}

function dateOrTime(v, name) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return parseTime(v, name);
}

// ---------- time helpers ----------

export function systemZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Local date, weekday and minute-of-day of an instant in a zone.
export function zoned(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday.toLowerCase().slice(0, 3),
    minutes: hour * 60 + Number(parts.minute),
    hour,
  };
}

function boundOk(bound, at, local, isUntil) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bound)) return isUntil ? local.date <= bound : local.date >= bound;
  const t = new Date(bound).getTime();
  return isUntil ? at.getTime() < t : at.getTime() >= t;
}

// Is the instant past a bound? A date alone is a local day in tz: "start"
// means from that day's start, "end" means after that day's end.
export function pastBound(bound, at, tz, edge) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bound)) {
    const today = zoned(at, tz).date;
    return edge === 'end' ? today > bound : today >= bound;
  }
  return at.getTime() >= new Date(bound).getTime();
}

// True when `at` falls inside the window. Days are the days a window starts
// on: "fri 22:00-08:00" covers Friday night until Saturday 08:00.
export function matchesWindow(w, at, defaultTz) {
  const tz = w.tz || defaultTz || systemZone();
  const local = zoned(at, tz);
  if (w.from && !boundOk(w.from, at, local, false)) return false;
  if (w.until && !boundOk(w.until, at, local, true)) return false;
  let day = local.weekday;
  if (w.hours) {
    const [a, b] = w.hours.split('-').map(toMinutes);
    const m = local.minutes;
    if (a < b ? !(m >= a && m < b) : !(m >= a || m < b)) return false;
    if (a > b && m < b) day = DAYS[(DAYS.indexOf(day) + 6) % 7];
  }
  if (w.days && !w.days.includes(day)) return false;
  return true;
}

export function formatWhen(w) {
  return [w.days ? w.days.join(',') : null, w.hours, w.tz ? `tz=${w.tz}` : null,
    w.from ? `from=${w.from}` : null, w.until ? `until=${w.until}` : null].filter(Boolean).join(' ');
}

// ---------- files and scopes ----------

export function globalDir(env = process.env) {
  if (env.SUBAGENT_TEAM_HOME) return path.resolve(env.SUBAGENT_TEAM_HOME);
  // A dedicated directory, not a subdirectory of a shared one such as ~/.config.
  return path.join(env.HOME || os.homedir(), '.subagent-team');
}

// The project directory lives in the main checkout, so every worktree shares it.
export function projectInfo(root) {
  const abs = path.resolve(root);
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'], { cwd: abs, encoding: 'utf8' });
  if (r.status === 0) {
    const [commonDir, top] = r.stdout.trim().split('\n');
    const main = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : top;
    return { root: main, dir: path.join(main, PROJECT_DIR), gitCommonDir: commonDir };
  }
  return { root: abs, dir: path.join(abs, PROJECT_DIR), gitCommonDir: null };
}

export function scopeDir(scope, root, env = process.env) {
  return scope === 'global' ? globalDir(env) : projectInfo(root).dir;
}

export function emptyConfig() {
  return { schema: SCHEMA, resources: {}, routing: {}, schedules: [], quota: {}, review: {} };
}

export function readConfig(dir) {
  const file = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    throw new CodedError(3, `${file}: not valid JSON (${err.message})`);
  }
  const errors = validateConfig(data);
  if (errors.length) throw new CodedError(3, `${file}: ${errors.join('; ')}`);
  return { ...emptyConfig(), ...data };
}

export function validateConfig(c) {
  const errors = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['config must be a JSON object'];
  if (c.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  const res = c.resources ?? {};
  if (typeof res !== 'object' || Array.isArray(res)) errors.push('resources must be an object keyed by id');
  for (const [id, r] of Object.entries(res)) {
    if (!ID_RE.test(id)) errors.push(`resource id "${id}" is invalid`);
    if (!r || typeof r !== 'object') { errors.push(`resource ${id} must be an object`); continue; }
    if (r.tier !== undefined && !TIERS.includes(r.tier)) errors.push(`resource ${id}: tier must be ${TIERS.join(' or ')}`);
    if (r.roles !== undefined && (!Array.isArray(r.roles) || r.roles.some((x) => !ROLE_RE.test(x)))) errors.push(`resource ${id}: roles must be a list of role names`);
    if (r.fallback !== undefined && !Array.isArray(r.fallback)) errors.push(`resource ${id}: fallback must be a list`);
    if (r.windows !== undefined && !Array.isArray(r.windows)) errors.push(`resource ${id}: windows must be a list`);
  }
  if (c.routing !== undefined && (!c.routing || typeof c.routing !== 'object' || Array.isArray(c.routing))) errors.push('routing must be an object keyed by role');
  else for (const [role, list] of Object.entries(c.routing ?? {})) if (!Array.isArray(list)) errors.push(`routing.${role} must be a list`);
  if (c.schedules !== undefined && !Array.isArray(c.schedules)) errors.push('schedules must be a list');
  if (c.quota !== undefined && (!c.quota || typeof c.quota !== 'object' || Array.isArray(c.quota))) errors.push('quota must be an object keyed by id');
  for (const [id, q] of Object.entries(c.quota && typeof c.quota === 'object' ? c.quota : {})) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) errors.push(`quota ${id} must be an object`);
    else if (!QUOTA_STATES.includes(q.state)) errors.push(`quota ${id}: state must be one of ${QUOTA_STATES.join(', ')}`);
  }
  const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const windowErr = (w, where) => {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return `${where} must be an object`;
    if (w.tz !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: w.tz }); } catch { return `${where}: unknown time zone ${w.tz}`; } }
    if (w.days !== undefined && !(strList(w.days) && w.days.every((d) => DAYS.includes(d)))) return `${where}: days must be a list of sun..sat`;
    if (w.hours !== undefined) {
      const [a, b] = String(w.hours).split('-').map(toMinutes);
      if (a == null || b == null || a === b) return `${where}: hours must be HH:MM-HH:MM`;
    }
    for (const k of ['from', 'until']) if (w[k] !== undefined && Number.isNaN(Date.parse(w[k]))) return `${where}: ${k} is not a date or time`;
    return null;
  };
  for (const [id, r] of Object.entries(res && typeof res === 'object' ? res : {})) {
    if (!r || typeof r !== 'object') continue;
    if (r.fallback !== undefined && !strList(r.fallback)) errors.push(`resource ${id}: fallback must be a list of ids`);
    for (const [i, w] of (Array.isArray(r.windows) ? r.windows : []).entries()) { const e = windowErr(w, `resource ${id} window ${i + 1}`); if (e) errors.push(e); }
  }
  for (const [role, list] of Object.entries(c.routing && typeof c.routing === 'object' ? c.routing : {})) if (Array.isArray(list) && !strList(list)) errors.push(`routing.${role} must list ids`);
  for (const [i, sch] of (Array.isArray(c.schedules) ? c.schedules : []).entries()) {
    if (!sch || typeof sch !== 'object' || typeof sch.id !== 'string') { errors.push(`schedule ${i + 1} needs a string id`); continue; }
    const e = windowErr(sch.when ?? {}, `schedule ${sch.id}`); if (e) errors.push(e);
    for (const k of ['prefer', 'avoid', 'roles']) if (sch[k] !== undefined && !strList(sch[k])) errors.push(`schedule ${sch.id}: ${k} must be a list`);
  }
  if (c.review !== undefined && (typeof c.review !== 'object' || c.review === null)) errors.push('review must be an object');
  return errors;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Read-modify-write under a lock file, written atomically (tmp + rename).
export function updateFile(file, mutate, { initial = null, timeoutMs = 12_000, staleMs = 10_000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try { fd = fs.openSync(lock, 'wx'); fs.writeSync(fd, token); break; } catch (err) {
      if (err.code !== 'EEXIST') throw new CodedError(4, `cannot lock ${file}: ${err.message}`);
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) {
          // Take a stale lock over by renaming it away: only one waiter's rename succeeds.
          const aside = `${lock}.stale-${token}`;
          fs.renameSync(lock, aside);
          fs.rmSync(aside, { force: true });
          continue;
        }
      } catch { continue; }
      if (Date.now() > deadline) throw new CodedError(4, `${lock} is held by another writer; retry, or remove it if no session is writing`);
      sleepMs(50);
    }
  }
  try {
    let current = initial;
    if (fs.existsSync(file)) {
      try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new CodedError(3, `${file}: not valid JSON (${err.message})`); }
    }
    const next = mutate(current);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return next;
  } finally {
    fs.closeSync(fd);
    try { if (fs.readFileSync(lock, 'utf8') === token) fs.rmSync(lock, { force: true }); } catch { /* already gone */ }
  }
}

// Keep the project directory out of git without touching a tracked file.
export function ensureExcluded(info) {
  if (!info.gitCommonDir) return { excluded: false, reason: 'not a git repository' };
  const file = path.join(info.gitCommonDir, 'info', 'exclude');
  const line = `/${PROJECT_DIR}/`;
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => [line, `${PROJECT_DIR}/`, `/${PROJECT_DIR}`, PROJECT_DIR].includes(l.trim()))) return { excluded: true, added: false, file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
  return { excluded: true, added: true, file };
}

function writeScope(opts, mutate) {
  const dir = scopeDir(opts.scope, opts.root);
  let exclude = null;
  if (opts.scope === 'project') exclude = ensureExcluded(projectInfo(opts.root));
  const file = path.join(dir, CONFIG_FILE);
  const next = updateFile(file, (cur) => {
    const base = cur ? { ...emptyConfig(), ...cur } : emptyConfig();
    const out = mutate(base);
    out.updatedAt = new Date().toISOString();
    const errors = validateConfig(out);
    if (errors.length) throw new CodedError(3, errors.join('; '));
    return out;
  });
  return { file, config: next, exclude };
}

// ---------- merging ----------

export function mergeConfigs(globalCfg, projectCfg) {
  const g = globalCfg ? { ...emptyConfig(), ...globalCfg } : null;
  const p = projectCfg ? { ...emptyConfig(), ...projectCfg } : null;
  const out = { resources: {}, routing: {}, schedules: [], quota: {}, review: {}, timezone: null, sources: {} };
  const order = [...Object.keys(p?.resources ?? {}), ...Object.keys(g?.resources ?? {})];
  for (const id of [...new Set(order)]) {
    const gr = g?.resources?.[id]; const pr = p?.resources?.[id];
    out.resources[id] = { ...(gr || {}), ...(pr || {}) };
    out.sources[id] = gr && pr ? 'project+global' : pr ? 'project' : 'global';
  }
  out.routing = { ...(g?.routing ?? {}), ...(p?.routing ?? {}) };
  const seen = new Set();
  for (const s of [...(p?.schedules ?? []).map((x) => ({ ...x, scope: 'project' })), ...(g?.schedules ?? []).map((x) => ({ ...x, scope: 'global' }))]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.schedules.push(s);
  }
  for (const src of [g?.quota ?? {}, p?.quota ?? {}]) {
    for (const [id, q] of Object.entries(src)) {
      const prev = out.quota[id];
      const t = (x) => { const n = Date.parse(x?.checked ?? ''); return Number.isNaN(n) ? -Infinity : n; };
      if (!prev || t(q) >= t(prev)) out.quota[id] = q;
    }
  }
  out.review = { ...(g?.review ?? {}), ...(p?.review ?? {}) };
  const dates = [g?.review?.lastReviewed, p?.review?.lastReviewed].filter((d) => typeof d === 'string' && !Number.isNaN(Date.parse(d)));
  out.review.lastReviewed = dates.sort().at(-1) ?? null;
  out.timezone = p?.timezone || g?.timezone || null;
  return out;
}

export function configWarnings(eff) {
  const w = [];
  const ids = new Set(Object.keys(eff.resources));
  const ref = (x, where) => { if (!x.startsWith('in-house:') && !ids.has(x)) w.push(`${where} names unknown resource "${x}"`); };
  for (const [id, r] of Object.entries(eff.resources)) {
    for (const f of r.fallback ?? []) ref(f, `resource ${id} fallback`);
    if (!r.model) w.push(`resource ${id} has no model`);
    if (!r.effort) w.push(`resource ${id} has no effort: pin one, never inherit the tool's default`);
    if (!r.roles?.length) w.push(`resource ${id} has no roles`);
  }
  for (const [role, list] of Object.entries(eff.routing)) for (const x of list) ref(x, `routing.${role}`);
  for (const s of eff.schedules) for (const x of [...(s.prefer ?? []), ...(s.avoid ?? [])]) ref(x, `schedule ${s.id}`);
  return w;
}

// ---------- resolve ----------

export function defaultInHouse(role, tier) {
  if (REVIEW_ROLES.includes(role)) return 'in-house senior review only (no other-vendor opinion; record it as missing)';
  if (role === 'bulk' || tier === 'external-fast') return 'in-house:low for purely mechanical edits, else in-house:mid:medium';
  if (role === 'code-sync') return 'in-house:mid:high';
  return 'in-house:mid:medium';
}

export function resolveRole(eff, role, at = new Date()) {
  const tz = eff.timezone || systemZone();
  const res = eff.resources;
  const candidates = [];
  const excluded = [];
  const via = new Map();
  const base = eff.routing[role]
    ? eff.routing[role]
    : Object.keys(res).filter((id) => (res[id].roles ?? []).includes(role));
  for (const id of base) via.set(id, eff.routing[role] ? `routing.${role}` : `role ${role}`);
  let list = [...base];
  const active = [];
  const avoided = new Map();
  for (const s of eff.schedules) {
    if (s.roles?.length && !s.roles.includes(role)) continue;
    if (!matchesWindow(s.when ?? {}, at, tz)) continue;
    active.push(s.id);
    for (const id of s.avoid ?? []) if (!avoided.has(id)) avoided.set(id, s.id);
    const pref = (s.prefer ?? []).filter((id) => res[id] && (list.includes(id) || (res[id].roles ?? []).includes(role)));
    for (const id of pref) via.set(id, `schedule ${s.id}`);
    list = [...pref, ...list.filter((x) => !pref.includes(x))];
  }
  list = list.filter((id) => !avoided.has(id));
  // Fallback chains, breadth first, after the primary list.
  const inHouse = [];
  const queue = [...list];
  const ordered = [];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    if (id.startsWith('in-house:')) { inHouse.push(id); continue; }
    if (avoided.has(id)) continue;
    ordered.push(id);
    for (const f of res[id]?.fallback ?? []) {
      if (!seen.has(f)) { queue.push(f); if (!via.has(f)) via.set(f, `fallback of ${id}`); }
    }
  }
  for (const [id, rule] of avoided) if (base.includes(id) || seen.has(id)) excluded.push({ id, reason: `avoided by schedule ${rule}` });
  for (const id of ordered) {
    const r = res[id];
    if (!r) { excluded.push({ id, reason: 'unknown resource' }); continue; }
    if (excluded.some((e) => e.id === id)) continue;
    if (r.enabled === false) { excluded.push({ id, reason: 'disabled' }); continue; }
    if (EDIT_ROLES.includes(role) && r.mayEdit === false) { excluded.push({ id, reason: 'review only (mayEdit: false)' }); continue; }
    if (r.windows?.length && !r.windows.some((w) => matchesWindow(w, at, tz))) {
      excluded.push({ id, reason: `outside its windows: ${r.windows.map(formatWhen).join('; ')}` });
      continue;
    }
    const flags = [];
    const q = eff.quota[id];
    if (q?.expires && pastBound(q.expires, at, tz, 'end')) flags.push(`credits expired ${q.expires}`);
    if (q?.state === 'exhausted') {
      if (!q.resets || q.resets === 'unknown') { excluded.push({ id, reason: 'quota exhausted, reset unknown: ask the user once' }); continue; }
      if (!pastBound(q.resets, at, tz, 'start')) { excluded.push({ id, reason: `quota exhausted until ${q.resets}` }); continue; }
      flags.push(`reset ${q.resets} has passed: the next job is the probe`);
    } else if (q?.state === 'low') flags.push('quota low: small batches only');
    if (!(r.roles ?? []).includes(role)) flags.push(`fallback outside its roles (${(r.roles ?? []).join(',') || 'none'}): state it`);
    candidates.push({
      id, team: r.team ?? null, channel: r.channel ?? null, model: r.model ?? null, effort: r.effort ?? null,
      tier: r.tier ?? null, via: via.get(id) ?? null, flags,
    });
  }
  const tier = candidates[0]?.tier ?? res[base[0]]?.tier ?? null;
  return {
    role, at: at.toISOString(), timezone: tz, activeSchedules: active,
    pick: candidates[0] ?? null,
    candidates, excluded,
    inHouse: inHouse[inHouse.length - 1] ?? defaultInHouse(role, tier),
  };
}

// ---------- review cadence, usage ----------

export function reviewStatus(review, now = new Date(), tz = systemZone()) {
  const every = Number(review?.everyDays) || DEFAULT_REVIEW_DAYS;
  if (!review?.lastReviewed || Number.isNaN(Date.parse(review.lastReviewed))) return { lastReviewed: review?.lastReviewed ?? null, everyDays: every, daysSince: null, due: true };
  const today = zoned(now, tz).date;
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${review.lastReviewed}T00:00:00Z`)) / DAY_MS);
  return { lastReviewed: review.lastReviewed, everyDays: every, daysSince: days, due: days >= every };
}

export function readUsage(dir) {
  const file = path.join(dir, USAGE_FILE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function summarizeUsage(entries, { sinceDays, resource, now = new Date(), tz = systemZone() } = {}) {
  const cutoff = sinceDays ? now.getTime() - sinceDays * DAY_MS : -Infinity;
  const rows = entries.filter((e) => Date.parse(e.at) >= cutoff && (!resource || e.resource === resource))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const by = {};
  for (const e of rows) {
    const s = by[e.resource] ??= { jobs: 0, outcomes: {}, minutes: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byDay: {}, byHour: {}, contentTrail: [] };
    s.jobs += 1;
    s.outcomes[e.outcome] = (s.outcomes[e.outcome] ?? 0) + 1;
    for (const [k, f] of [['minutes', 'minutes'], ['tokensIn', 'tokensIn'], ['tokensOut', 'tokensOut'], ['costUsd', 'costUsd']]) if (typeof e[f] === 'number') s[k] += e[f];
    const local = zoned(new Date(e.at), tz);
    s.byDay[local.date] = (s.byDay[local.date] ?? 0) + 1;
    const h = String(local.hour).padStart(2, '0');
    s.byHour[h] = (s.byHour[h] ?? 0) + 1;
    if (['accepted', 'rework', 'in-house'].includes(e.outcome)) s.contentTrail.push(e.outcome);
  }
  for (const s of Object.values(by)) {
    const content = s.contentTrail.length;
    s.firstPassRate = content ? Math.round((s.outcomes.accepted ?? 0) / content * 100) / 100 : null;
    const last2 = s.contentTrail.slice(-2);
    s.qualityFlag = (last2.length === 2 && last2.every((o) => o !== 'accepted')) || s.contentTrail.at(-1) === 'in-house'
      ? 'content failures in a row or taken back in-house: next job to a stronger model or another team'
      : null;
    s.costUsd = Math.round(s.costUsd * 10_000) / 10_000;
    delete s.contentTrail;
  }
  return { entries: rows.length, timezone: tz, resources: by };
}

// ---------- model checks ----------

const EFFORT_SUFFIX = /-(minimal|low|medium|high|xhigh|max|ultra)$/;

export function normalizeModelId(id) {
  let s = String(id).toLowerCase().trim();
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (s.includes('/')) s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/:.*$/, '').replace(/[\s._]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  // Snapshot dates and thinking budgets name a build of a model, not another model.
  s = s.replace(/-\d{4}-\d{2}-\d{2}(?=-|$)/g, '').replace(/-20\d{6}(?=-|$)/g, '').replace(/-thinking(-\d+k?)?$/, '');
  while (EFFORT_SUFFIX.test(s)) s = s.replace(EFFORT_SUFFIX, '');
  return s;
}

// "gpt-6-2-sol-pro" extends "gpt-6-2-sol"; "gpt-6-2" does not extend "gpt-6"
// (a number after the base is another version, not a variant).
export function extendsModel(longer, base) {
  if (!longer.startsWith(`${base}-`)) return false;
  return !/^v?\d/.test(longer.slice(base.length + 1));
}

// "gpt-6-2-sol" -> { family: "gpt-sol", version: [6, 2] }
// "deepseek-v4-1-flash" -> { family: "deepseek-flash", version: [4, 1] }
export function modelFamily(id) {
  const parts = normalizeModelId(id).split('-');
  const version = []; const family = [];
  for (const p of parts) {
    const m = p.match(/^v?(\d+)$/);
    if (m && !(version.length && /^\d{4}$/.test(p))) version.push(Number(m[1]));
    else if (!m) family.push(p);
  }
  return { family: family.join('-'), version };
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function readAvailable(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j.map((x) => (typeof x === 'string' ? x : x.id ?? x.slug ?? x.name)).filter(Boolean);
    if (Array.isArray(j?.models)) return j.models.map((x) => (typeof x === 'string' ? x : x.id ?? x.slug ?? x.name)).filter(Boolean);
    if (j && typeof j === 'object') return [];
  } catch { /* plain text */ }
  return text.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((l) => l && !l.startsWith('#'));
}

// ranking: model-roster.mjs --json output ({ vendors, arena? }).
export function checkModels(eff, ranking, available, { perVendor = 3 } = {}) {
  const teams = {};
  for (const [team, ids] of Object.entries(available)) {
    const norm = new Set(ids.map(normalizeModelId));
    const vendorSet = new Set(TEAM_VENDORS[team] ?? []);
    for (const r of Object.values(eff.resources)) if (r.team === team && r.vendor) vendorSet.add(String(r.vendor).toLowerCase());
    const vendors = [...vendorSet];
    const ranked = [];
    for (const v of vendors) {
      const arena = (ranking?.arena?.models ?? []).filter((m) => (m.organization ?? '').toLowerCase() === v).slice(0, perVendor);
      for (const m of arena) ranked.push({ id: m.name, source: 'arena', rank: m.rank ?? null });
      for (const m of (ranking?.vendors?.[v] ?? []).slice(0, perVendor)) ranked.push({ id: m.id, source: 'openrouter', listed: m.listed ?? null });
    }
    const missing = [];
    const variants = [];
    const seen = new Set();
    for (const m of ranked) {
      const n = normalizeModelId(m.id);
      if (seen.has(n)) continue;
      seen.add(n);
      if ([...norm].some((a) => a === n || extendsModel(a, n))) continue;
      // e.g. gpt-6-2-sol-pro while the channel offers gpt-6-2-sol: an API variant, not an outdated CLI.
      const base = [...norm].find((a) => extendsModel(n, a));
      if (base) variants.push({ ...m, normalized: n, variantOf: base });
      else missing.push({ ...m, normalized: n });
    }
    const newer = [];
    for (const [id, r] of Object.entries(eff.resources)) {
      if (r.team !== team || !r.model) continue;
      const mine = modelFamily(r.model);
      let best = null;
      for (const a of ids) {
        const f = modelFamily(a);
        if (f.family === mine.family && compareVersions(f.version, mine.version) > 0 && (!best || compareVersions(f.version, modelFamily(best).version) > 0)) best = a;
      }
      if (best) newer.push({ resource: id, configured: r.model, newer: best });
    }
    teams[team] = {
      vendors, available: ids.length, missing, variants, newer,
      updateHint: missing.length ? (UPDATE_HINTS[team] ?? 'the tool\'s own update command') : null,
    };
  }
  return { rankingFetchedAt: ranking?.fetchedAt ?? null, teams };
}

// ---------- commands ----------

function loadEffective(root) {
  const g = globalDir(); const info = projectInfo(root);
  const gc = readConfig(g); const pc = readConfig(info.dir);
  const eff = mergeConfigs(gc, pc);
  return { global: { dir: g, exists: !!gc }, project: { dir: info.dir, root: info.root, exists: !!pc }, eff, any: Object.keys(eff.resources).length > 0 };
}

// Harness overlays: harness-<host>.md beside compute.json, one per multi-vendor host, mapping each
// vendor to that host's provider instances (accounts). Read only when the session runs in that host.
export function listOverlays(dirs) {
  const out = [];
  for (const [scope, dir] of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names.sort()) {
      const m = /^harness-([a-z0-9][a-z0-9-]*)\.md$/.exec(n);
      if (m) out.push({ host: m[1], scope, file: path.join(dir, n) });
    }
  }
  return out;
}

function rankingStatus(now = new Date()) {
  const file = path.join(globalDir(), RANKING_FILE);
  if (!fs.existsSync(file)) return { file, fetchedAt: null, ageDays: null, stale: true };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const age = j.fetchedAt ? Math.floor((now.getTime() - Date.parse(j.fetchedAt)) / DAY_MS) : null;
    return { file, fetchedAt: j.fetchedAt ?? null, ageDays: age, stale: age === null || age >= RANKING_STALE_DAYS };
  } catch { return { file, fetchedAt: null, ageDays: null, stale: true }; }
}

function cmdShow(opts) {
  const at = opts.at ?? new Date();
  const { global, project, eff, any } = loadEffective(opts.root);
  const tz = eff.timezone || systemZone();
  const quotaNotes = [];
  for (const [id, q] of Object.entries(eff.quota)) {
    if (q.state === 'exhausted' && q.resets && q.resets !== 'unknown' && pastBound(q.resets, at, tz, 'start')) quotaNotes.push(`${id}: reset ${q.resets} has passed`);
    if (q.state === 'exhausted' && (!q.resets || q.resets === 'unknown')) quotaNotes.push(`${id}: exhausted, reset unknown: ask the user`);
    if (q.expires && !pastBound(q.expires, at, tz, 'end') && pastBound(q.expires, new Date(at.getTime() + 3 * DAY_MS), tz, 'end')) quotaNotes.push(`${id}: credits expire ${q.expires}`);
    if (q.expires && pastBound(q.expires, at, tz, 'end')) quotaNotes.push(`${id}: credits expired ${q.expires}`);
  }
  const active = eff.schedules.filter((s) => matchesWindow(s.when ?? {}, at, tz)).map((s) => s.id);
  const expired = eff.schedules.filter((s) => s.when?.until && !boundOk(s.when.until, at, zoned(at, s.when.tz || tz), true)).map((s) => `${s.id} (${s.scope})`);
  return {
    ok: true, needsInit: !any, global, project, timezone: tz,
    review: reviewStatus(eff.review, at, tz),
    ranking: rankingStatus(at),
    resources: Object.fromEntries(Object.entries(eff.resources).map(([id, r]) => [id, { ...r, scope: eff.sources[id] }])),
    routing: eff.routing, schedules: eff.schedules, activeSchedules: active, expiredSchedules: expired,
    quota: eff.quota, quotaNotes, warnings: configWarnings(eff),
    harnessOverlays: listOverlays([['project', project.dir], ['global', global.dir]]),
  };
}

function cmdInit(opts) {
  const dir = scopeDir(opts.scope, opts.root);
  const file = path.join(dir, CONFIG_FILE);
  if (fs.existsSync(file) && !opts.force) throw new CodedError(6, `${file} exists; use set/route/schedule, or --force to replace it`);
  let data = emptyConfig();
  if (opts.from) {
    try { data = { ...emptyConfig(), ...JSON.parse(fs.readFileSync(opts.from, 'utf8')) }; } catch (err) { throw new CodedError(3, `${opts.from}: ${err.message}`); }
  }
  data.review = { everyDays: DEFAULT_REVIEW_DAYS, ...data.review, lastReviewed: data.review?.lastReviewed ?? zoned(new Date(), data.timezone || systemZone()).date };
  const errors = validateConfig(data);
  if (errors.length) throw new CodedError(3, errors.join('; '));
  const out = writeScope(opts, () => data);
  return { ok: true, scope: opts.scope, file: out.file, exclude: out.exclude, resources: Object.keys(out.config.resources) };
}

function cmdSet(opts) {
  const fields = ['team', 'channel', 'model', 'effort', 'tier', 'roles', 'fallback', 'mayEdit', 'enabled', 'windows', 'vendor', 'note'];
  const patch = Object.fromEntries(fields.filter((f) => opts[f] !== undefined).map((f) => [f, opts[f]]));
  const out = writeScope(opts, (c) => {
    c.resources[opts.id] = { ...(c.resources[opts.id] ?? {}), ...patch };
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, exclude: out.exclude, resource: opts.id, value: out.config.resources[opts.id] };
}

function cmdRemove(opts) {
  const out = writeScope(opts, (c) => {
    if (!c.resources[opts.id]) throw new CodedError(5, `no resource ${opts.id} in the ${opts.scope} config`);
    delete c.resources[opts.id];
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, removed: opts.id };
}

function cmdRoute(opts) {
  const out = writeScope(opts, (c) => {
    if (opts.order === null) delete c.routing[opts.role];
    else c.routing[opts.role] = opts.order;
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, role: opts.role, order: out.config.routing[opts.role] ?? null };
}

function cmdSchedule(opts) {
  const out = writeScope(opts, (c) => {
    const i = c.schedules.findIndex((s) => s.id === opts.id);
    if (opts.action === 'remove') {
      if (i < 0) throw new CodedError(5, `no schedule ${opts.id} in the ${opts.scope} config`);
      c.schedules.splice(i, 1);
      return c;
    }
    const rule = { id: opts.id, when: opts.when };
    if (opts.prefer) rule.prefer = opts.prefer;
    if (opts.avoid) rule.avoid = opts.avoid;
    if (opts.roles) rule.roles = opts.roles;
    if (opts.note) rule.note = opts.note;
    if (i >= 0) c.schedules[i] = rule; else c.schedules.push(rule);
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, schedules: out.config.schedules };
}

function cmdQuota(opts) {
  const { eff } = loadEffective(opts.root);
  if (!eff.resources[opts.id]) throw new CodedError(5, `no resource ${opts.id} in the compute plan; add it with set first`);
  const entry = { state: opts.state, checked: new Date().toISOString() };
  for (const k of ['resets', 'expires', 'source', 'note']) if (opts[k] !== undefined) entry[k] = opts[k];
  if (opts.state === 'exhausted' && entry.resets === undefined) entry.resets = 'unknown';
  const out = writeScope(opts, (c) => { c.quota[opts.id] = entry; return c; });
  return { ok: true, scope: opts.scope, file: out.file, resource: opts.id, quota: entry };
}

function cmdRecord(opts) {
  const dir = scopeDir(opts.scope, opts.root);
  if (opts.scope === 'project') ensureExcluded(projectInfo(opts.root));
  fs.mkdirSync(dir, { recursive: true });
  const { eff } = loadEffective(opts.root);
  const r = eff.resources[opts.id] ?? {};
  const entry = { at: new Date().toISOString(), resource: opts.id, model: r.model ?? null, effort: r.effort ?? null, outcome: opts.outcome };
  for (const k of ['task', 'role', 'minutes', 'tokensIn', 'tokensOut', 'note']) if (opts[k] !== undefined) entry[k] = opts[k];
  if (opts.cost !== undefined) entry.costUsd = opts.cost;
  entry.project = path.basename(projectInfo(opts.root).root);
  const file = path.join(dir, USAGE_FILE);
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  if (!eff.resources[opts.id]) process.stderr.write(`compute-config: ${opts.id} is not a resource in the plan; the line was still recorded.\n`);
  return { ok: true, scope: opts.scope, file, entry, known: !!eff.resources[opts.id] };
}

function cmdUsage(opts) {
  const { eff, global, project } = loadEffective(opts.root);
  const entries = [...readUsage(global.dir), ...readUsage(project.dir)];
  return { ok: true, ...summarizeUsage(entries, { sinceDays: opts.sinceDays, resource: opts.resource, tz: eff.timezone || systemZone() }) };
}

function cmdResolve(opts) {
  const { eff, any } = loadEffective(opts.root);
  if (!any) throw new CodedError(2, 'no compute config yet: ask the user the setup questions, then run init');
  return { ok: true, ...resolveRole(eff, opts.role, opts.at ?? new Date()) };
}

function cmdReviewed(opts) {
  const out = writeScope(opts, (c) => {
    c.review = { ...c.review, lastReviewed: zoned(new Date(), c.timezone || systemZone()).date };
    if (opts.everyDays) c.review.everyDays = opts.everyDays;
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, review: out.config.review };
}

function cmdCheckModels(opts) {
  const { eff } = loadEffective(opts.root);
  const rankingFile = opts.ranking ?? path.join(globalDir(), RANKING_FILE);
  let ranking = null;
  if (fs.existsSync(rankingFile)) {
    try { ranking = JSON.parse(fs.readFileSync(rankingFile, 'utf8')); } catch (err) { throw new CodedError(3, `${rankingFile}: ${err.message}`); }
  }
  const available = {};
  for (const spec of opts.available) {
    const m = spec.match(/^([a-z0-9-]+)=(.+)$/);
    if (!m) throw new UsageError(`--available must be <team>=<file>, got ${spec}`);
    try { available[m[1]] = readAvailable(m[2]); } catch (err) { throw new CodedError(4, `${m[2]}: ${err.message}`); }
  }
  const result = checkModels(eff, ranking, available);
  if (!ranking) result.warning = `no ranking at ${rankingFile}: run model-roster.mjs --arena --save first; only "newer" checks ran`;
  return { ok: true, rankingFile, ...result };
}

export function run(opts) {
  switch (opts.command) {
    case 'paths': { const info = projectInfo(opts.root); return { ok: true, global: globalDir(), project: info.dir, projectRoot: info.root, files: { config: CONFIG_FILE, usage: USAGE_FILE, ranking: RANKING_FILE } }; }
    case 'show': return cmdShow(opts);
    case 'init': return cmdInit(opts);
    case 'set': return cmdSet(opts);
    case 'remove': return cmdRemove(opts);
    case 'route': return cmdRoute(opts);
    case 'schedule': return cmdSchedule(opts);
    case 'quota': return cmdQuota(opts);
    case 'record': return cmdRecord(opts);
    case 'usage': return cmdUsage(opts);
    case 'resolve': return cmdResolve(opts);
    case 'reviewed': return cmdReviewed(opts);
    case 'check-models': return cmdCheckModels(opts);
    default: throw new UsageError(`unknown command: ${opts.command}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`compute-config: ${err.message}\nRun with --help for usage.\n`);
      return 1;
    }
    throw err;
  }
  if (opts.help) { process.stdout.write(USAGE); return 0; }
  try {
    const out = run(opts);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    if (out.needsInit) process.stderr.write('compute-config: no compute config yet; ask the user the setup questions (references/compute-config.md), then run init.\n');
    if (out.review?.due && !out.needsInit) process.stderr.write(`compute-config: review due (last ${out.review.lastReviewed ?? 'never'}); tell the user the current plan and proceed unless they object.\n`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) { process.stderr.write(`compute-config: ${err.message}\n`); return 1; }
    if (err instanceof CodedError) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: err.message, code: err.code })}\n`);
      process.stderr.write(`compute-config: ${err.message}\n`);
      return err.code;
    }
    process.stdout.write(`${JSON.stringify({ ok: false, error: err.message, code: 4 })}\n`);
    process.stderr.write(`compute-config: ${err.message}\n`);
    return 4;
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

if (isMain()) process.exitCode = main();
