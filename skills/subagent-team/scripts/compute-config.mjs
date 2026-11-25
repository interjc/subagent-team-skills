#!/usr/bin/env node
// Manage the user's compute plan across global and project scopes. Session
// overrides and host observations live separately in compute-state.json.
// Dependency-free. Run --help for commands, paths and exit codes.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

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
const { detectHost, scenarioFromName, kindFromName, HOST_HINTS, WRAPPER_HOSTS } = createRequire(import.meta.url)('./env-check.cjs');
const STATE_FILE = 'compute-state.json';
const PARALLEL = { balanced: 'normal', performance: 'max', frugal: 'low', 'load-balance': 'normal' };
const SCENARIOS = ['vendor-native', 'harness', 'open-router', 'bot', 'unknown'];
const SEAT_TIERS = ['top', 'high', 'mid', 'low'];
const AUTO = /^auto:(top|high|mid|low)(?::([^:\s]+))?$/;
const RESOURCE_FIELDS = ['team', 'channel', 'model', 'effort', 'tier', 'roles', 'fallback', 'mayEdit', 'enabled', 'windows', 'vendor', 'note', 'account', 'cost'];
const RULE_FIELDS = ['when', 'prefer', 'avoid', 'roles', 'note'];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entries = (value) => Object.entries(value ?? {});
const fields = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

export const USAGE = `compute-config.mjs - the user's external compute plan in local files (project or global).

Usage:
  compute-config.mjs paths    [--root <dir>]
  compute-config.mjs start    [--root <dir>] [--host H] [--runtime R] [--session K] [--served file] [--at time]
  compute-config.mjs show     [--root <dir>] [--at <time>] [--host H] [--session K]
  compute-config.mjs init     --scope project|global [--from <file.json>] [--force] [--root <dir>]
  compute-config.mjs set      <id> --scope S [--team T] [--channel C] [--model M] [--effort E]
                              [--tier external-fast|external-strong] [--roles a,b] [--fallback x,y]
                              [--may-edit yes|no] [--enabled yes|no] [--windows "<when>[; <when>]"]
                              [--vendor v] [--note text] [--account id] [--cost free|included|metered]
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
  compute-config.mjs resolve  --role <role> [--at time] [--root dir] [--host H] [--session K] [--profile name] [--count 1-50]
  compute-config.mjs reviewed --scope S [--what models|preferences] [--decision keep|adjust|later] [--snooze-days n] [--every-days n]
  compute-config.mjs profile list
  compute-config.mjs profile use <name> --scope S [--session K] [--until time]
  compute-config.mjs profile define <name> --extends base [--parallelism max|normal|low] [--note text] --scope S
  compute-config.mjs account set <id> --scope S --vendor v --team t --billing b [--plan p] [--cycle c] [--resets time] [--expires time] [--weight n] [--note text]
  compute-config.mjs account remove <id> --scope S
  compute-config.mjs account quota <id> --state s [--resets time] [--expires time] [--remaining n] [--source s] [--note text] [--scope S]
  compute-config.mjs seat set <id> --scope S --team t --vendor v --model m --effort e --tier top|high|mid|low [--note text]
  compute-config.mjs seat remove <id> --scope S
  compute-config.mjs host set <id> --scope S (--from file | [--name n] [--scenario s] [--kind k] [--route r] [--home a,b] [--confirmed date])
  compute-config.mjs host remove <id> --scope S
  compute-config.mjs host show <id>
  compute-config.mjs promote --session K (--scope project|global | --decline) (--all | --what "note summary")
  compute-config.mjs plan check --from file [--host H]
  compute-config.mjs plan render [--from file] [--host H] [--session K]
  compute-config.mjs plan apply --from file --scope project|global
  compute-config.mjs migrate --dry-run [--root dir]
  compute-config.mjs check-models --available <team>=<file> [--available ...] [--ranking <file>]

Scopes: global = ${'$'}SUBAGENT_TEAM_HOME, else ~/.subagent-team;
project = <main checkout>/${PROJECT_DIR}/ (added to .git/info/exclude on first write).
Session overrides: set, route, schedule add and profile use accept --scope session --session K.
record also accepts --host H, --account id, --instance id and --session K.
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
4 file system, lock or unexpected error; 5 unknown id; 6 config exists (init without --force).
`;

export class UsageError extends Error {}
export class CodedError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- argument parsing ----------

const ACTIONS = { profile: ['use', 'list', 'define'], account: ['set', 'remove', 'quota'],
  seat: ['set', 'remove'], host: ['set', 'remove', 'show'], plan: ['check', 'render', 'apply'] };
const COMMANDS = ['paths', 'show', 'init', 'set', 'remove', 'route', 'schedule', 'quota', 'record', 'usage',
  'resolve', 'reviewed', 'check-models', 'start', 'promote', 'migrate', ...Object.keys(ACTIONS)];
const VALUED = {
  '--root': 'root', '--scope': 'scope', '--at': 'at', '--from': 'from', '--team': 'team', '--channel': 'channel',
  '--model': 'model', '--effort': 'effort', '--tier': 'tier', '--roles': 'roles', '--fallback': 'fallback',
  '--may-edit': 'mayEdit', '--enabled': 'enabled', '--windows': 'windows', '--vendor': 'vendor', '--note': 'note',
  '--when': 'when', '--prefer': 'prefer', '--avoid': 'avoid', '--state': 'state', '--resets': 'resets',
  '--expires': 'expires', '--source': 'source', '--outcome': 'outcome', '--task': 'task', '--role': 'role',
  '--minutes': 'minutes', '--tokens-in': 'tokensIn', '--tokens-out': 'tokensOut', '--cost': 'cost',
  '--since-days': 'sinceDays', '--resource': 'resource', '--every-days': 'everyDays', '--ranking': 'ranking',
  '--host': 'host', '--runtime': 'runtime', '--served': 'served', '--session': 'session', '--profile': 'profile',
  '--count': 'count', '--until': 'until', '--extends': 'extends', '--parallelism': 'parallelism', '--billing': 'billing',
  '--plan': 'plan', '--cycle': 'cycle', '--weight': 'weight', '--remaining': 'remaining', '--name': 'name',
  '--scenario': 'scenario', '--kind': 'kind', '--route': 'route', '--home': 'home', '--confirmed': 'confirmed',
  '--what': 'what', '--decision': 'decision', '--snooze-days': 'snoozeDays', '--account': 'account', '--instance': 'instance',
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
    if (['--dry-run', '--all', '--decline'].includes(arg)) { opts[arg.slice(2)] = true; continue; }
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
  const [action, item] = opts.positional;
  if (Object.hasOwn(ACTIONS, command)) {
    if (!ACTIONS[command].includes(action)) throw new UsageError(`${command} needs ${ACTIONS[command].join(' or ')}`);
    opts.action = action;
    if (command !== 'plan' && action !== 'list') {
      if (!item || !ID_RE.test(item)) throw new UsageError(`${command} ${action} needs a valid id`);
      opts.id = item;
    }
    if (['use', 'define', 'set', 'remove', 'apply'].includes(action)) needScope.push(command);
    if (['check', 'apply'].includes(action) && !opts.from) throw new UsageError(`plan ${action} needs --from`);
    if (action === 'quota' && !opts.scope) opts.scope = 'global';
    const required = { 'profile define': ['extends'], 'account set': ['vendor', 'team', 'billing'],
      'seat set': ['team', 'vendor', 'model', 'effort', 'tier'], 'account quota': ['state'] };
    for (const key of required[`${command} ${action}`] ?? []) {
      if (!opts[key]) throw new UsageError(`${command} ${action} needs --${key}`);
    }
  }
  const sessionWrite = ['set', 'route'].includes(command) || (command === 'schedule' && action === 'add') || (command === 'profile' && action === 'use');
  if (opts.scope === 'session' && sessionWrite) {
    if (!opts.session) throw new UsageError('--scope session needs --session');
  } else if (opts.scope !== undefined && !['project', 'global'].includes(opts.scope)) throw new UsageError('--scope must be project or global');
  if (command === 'promote') {
    const oneTarget = Boolean(opts.scope) !== Boolean(opts.decline);
    const oneSelector = Boolean(opts.all) !== (opts.what !== undefined);
    if (!opts.session || !oneTarget || !oneSelector || opts.what === '') {
      throw new UsageError('promote needs --session and either --scope or --decline, with exactly one of --all or --what');
    }
  }
  if (command === 'migrate' && !opts['dry-run']) throw new UsageError('use migrate --dry-run, then plan apply after the user confirms');
  if (command === 'reviewed' && ((opts.what && !['preferences', 'models'].includes(opts.what)) ||
    (opts.what === 'preferences' && !['keep', 'adjust', 'later'].includes(opts.decision)))) throw new UsageError('reviewed needs --what models or --what preferences --decision keep|adjust|later');
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
  if (opts.tier !== undefined && command !== 'seat' && !TIERS.includes(opts.tier)) throw new UsageError(`--tier must be ${TIERS.join(' or ')}`);
  for (const k of ['mayEdit', 'enabled']) {
    if (opts[k] !== undefined) {
      if (!['yes', 'no'].includes(opts[k])) throw new UsageError(`--${k === 'mayEdit' ? 'may-edit' : 'enabled'} must be yes or no`);
      opts[k] = opts[k] === 'yes';
    }
  }
  for (const k of ['minutes', 'tokensIn', 'tokensOut', ...(command === 'set' ? [] : ['cost']), 'sinceDays', 'everyDays', 'count', 'snoozeDays', 'remaining', 'weight']) {
    if (opts[k] !== undefined) {
      const n = Number(opts[k]);
      if ((!Number.isFinite(n) || n < 0) && !['weight', 'remaining'].includes(k)) throw new UsageError(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a non-negative number`);
      opts[k] = n;
    }
  }
  if (opts.host !== undefined && !ID_RE.test(opts.host)) throw new UsageError('--host needs a valid host id');
  if (opts.count !== undefined && !(Number.isInteger(opts.count) && opts.count >= 1 && opts.count <= 50)) throw new UsageError('--count must be an integer from 1 to 50');
  if (opts.snoozeDays !== undefined && !Number.isInteger(opts.snoozeDays)) throw new UsageError('--snooze-days must be an integer');
  if (opts.everyDays !== undefined && !(Number.isInteger(opts.everyDays) && opts.everyDays > 0)) throw new UsageError('--every-days must be a positive integer');
  if (opts.windows !== undefined) opts.windows = opts.windows.split(';').map((s) => s.trim()).filter(Boolean).map(parseWhen);
  if (opts.when !== undefined) opts.when = parseWhen(opts.when);
  for (const k of ['roles', 'fallback', 'prefer', 'avoid']) if (opts[k] !== undefined) opts[k] = splitList(opts[k]);
  if (opts.roles) for (const r of opts.roles) if (!ROLE_RE.test(r)) throw new UsageError(`bad role name: ${r}`);
  if (opts.at !== undefined) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(opts.at)) throw new UsageError('--at needs a time with an offset, not a date alone');
    opts.at = parseTime(opts.at, '--at');
  }
  for (const k of ['resets', 'expires', 'until']) {
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

export function readConfig(dir, parent = null) {
  const file = path.join(dir, CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    throw new CodedError(3, `${file}: not valid JSON (${err.message})`);
  }
  const errors = validateConfig(data, parent);
  if (errors.length) throw new CodedError(3, `${file}: ${errors.join('; ')}`);
  return { ...emptyConfig(), ...data };
}

export function profileInfo(name, profiles) {
  const seen = new Set();
  let base = name;
  let parallel;
  while (!Object.hasOwn(PARALLEL, base)) {
    if (seen.has(base) || !Object.hasOwn(profiles, base)) return null;
    seen.add(base);
    const definition = profiles[base];
    if (typeof definition?.extends !== 'string') return null;
    parallel ??= definition?.parallelism;
    base = definition?.extends;
  }
  return { name, base, parallel: parallel ?? PARALLEL[base] };
}

function validateAdditions(c, inheritedProfiles = {}) {
  const errors = [];
  const check = (ok, path, message) => { if (!ok) errors.push(`${path}: ${message}`); };
  const string = (v) => typeof v === 'string' && v.trim().length > 0;
  const list = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const time = (v) => {
    if (v === null) return true;
    if (typeof v !== 'string' || v === 'now') return false;
    try {
      parseTime(v);
      const day = v.slice(0, 10);
      return new Date(day).toISOString().slice(0, 10) === day;
    } catch { return false; }
  };
  const items = (obj, path, fn) => {
    if (obj === undefined) return;
    if (!record(obj)) { errors.push(`${path}: must be an object`); return; }
    for (const [id, value] of entries(obj)) {
      const key = `${path}.${id}`;
      check(ID_RE.test(id), key, 'invalid id');
      if (record(value)) fn(value, key, id);
      else errors.push(`${key}: must be an object`);
    }
  };
  const constraints = (v, path) => {
    if (v === undefined) return;
    if (!record(v)) { errors.push(`${path}: must be an object`); return; }
    for (const k of ['onlyVendors', 'denyVendors']) if (k in v) check(list(v[k]), `${path}.${k}`, 'must list vendors');
    if ('inHouseOnly' in v) check(typeof v.inHouseOnly === 'boolean', `${path}.inHouseOnly`, 'must be boolean');
  };
  const profiles = { ...inheritedProfiles, ...c.profiles };
  const active = (v, path) => {
    const name = typeof v === 'string' ? v : v?.active;
    check(string(name) && profileInfo(name, profiles), record(v) ? `${path}.active` : path, 'unknown or cyclic profile');
    if (record(v) && 'until' in v) check(time(v.until), `${path}.until`, 'invalid time or date');
  };
  if ('rev' in c) check(Number.isInteger(c.rev) && c.rev >= 1, 'rev', 'must be a positive integer');
  if ('profile' in c) {
    check(record(c.profile), 'profile', 'must be an object');
    active(c.profile, 'profile');
  }
  items(c.profiles, 'profiles', (v, path, id) => {
    check(!Object.hasOwn(PARALLEL, id), path, 'built-in profile name');
    check(string(v.extends) && profileInfo(id, profiles), `${path}.extends`, 'must resolve to a built-in profile without cycles');
    if ('parallelism' in v) check(['normal', 'max', 'low'].includes(v.parallelism), `${path}.parallelism`, 'invalid parallelism');
  });
  constraints(c.constraints, 'constraints');
  items(c.accounts, 'accounts', (v, path) => {
    for (const k of ['team', 'vendor']) check(string(v[k]), `${path}.${k}`, 'required string');
    check(['subscription', 'prepaid', 'metered', 'free'].includes(v.billing), `${path}.billing`, 'invalid billing');
    check(/^\d{4}-\d\d-\d\d$/.test(v.declared) && time(v.declared), `${path}.declared`, 'date required');
    if ('weight' in v) check(Number.isFinite(v.weight) && v.weight > 0, `${path}.weight`, 'must be positive');
    for (const k of ['resets', 'expires']) if (k in v) check(time(v[k]), `${path}.${k}`, 'invalid time or date');
  });
  items(c.accountQuota, 'accountQuota', (v, path) => {
    check(QUOTA_STATES.includes(v.state), `${path}.state`, 'invalid state');
    if ('remaining' in v) check(Number.isFinite(v.remaining) && v.remaining >= 0 && v.remaining <= 100, `${path}.remaining`, 'must be 0-100');
  });
  items(c.seats, 'seats', (v, path) => {
    check(SEAT_TIERS.includes(v.tier), `${path}.tier`, 'invalid in-house tier');
    for (const k of ['model', 'effort']) check(string(v[k]), `${path}.${k}`, 'required string');
  });
  items(c.hosts, 'hosts', (h, path) => {
    for (const [key, allowed] of [['scenario', SCENARIOS], ['kind', ['vendor-native', 'multi-vendor', 'unknown']], ['route', ['acp-liaison', 'host-switch', 'none']]]) {
      if (key in h) check(allowed.includes(h[key]), `${path}.${key}`, `must be one of ${allowed.join(', ')}`);
    }
    if ('home' in h) check(list(h.home), `${path}.home`, 'must list vendors');
    if (h.profile != null) active(h.profile, `${path}.profile`);
    constraints(h.constraints, `${path}.constraints`);
    for (const k of ['roles', 'routing']) {
      if (!(k in h)) continue;
      check(record(h[k]), `${path}.${k}`, 'must be an object');
      for (const [role, ids] of entries(h[k])) {
        check(list(ids) && (k !== 'roles' || ids.every((id) => ID_RE.test(id) || AUTO.test(id))), `${path}.${k}.${role}`, 'invalid candidate list');
      }
    }
    items(h.serves, `${path}.serves`, (v, p) => {
      if ('strategy' in v) check(['primary-backup', 'spread', 'fixed'].includes(v.strategy), `${p}.strategy`, 'invalid strategy');
      if ('accounts' in v) check(Array.isArray(v.accounts) && v.accounts.every((x) => record(x) && string(x.account) && string(x.instance)), `${p}.accounts`, 'must list {account, instance} objects');
      for (const k of ['options', 'models']) if (k in v) check(record(v[k]) && Object.values(v[k]).every(string), `${p}.${k}`, 'must map strings to strings');
    });
  });
  for (const [id, r] of entries(c.resources)) {
    if (!record(r)) continue;
    if ('account' in r) check(string(r.account), `resources.${id}.account`, 'must be a string');
    if ('cost' in r) check(['free', 'included', 'metered'].includes(r.cost), `resources.${id}.cost`, 'invalid cost');
  }
  return errors;
}

export function validateConfig(c, parent = null) {
  const errors = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['config must be a JSON object'];
  if (c.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  const res = c.resources ?? {};
  if (c.resources !== undefined && !record(c.resources)) errors.push('resources must be an object keyed by id');
  for (const [id, r] of Object.entries(res)) {
    if (!ID_RE.test(id)) errors.push(`resource id "${id}" is invalid`);
    if (!record(r)) { errors.push(`resource ${id} must be an object`); continue; }
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
  const inherited = { ...c };
  for (const key of ['profiles', 'accounts', 'seats', 'hosts']) {
    if (parent?.[key] && record(c[key]) && Object.values(c[key]).every(record)) {
      inherited[key] = key === 'hosts' ? mergeHosts(parent[key], c[key]) : mergeRows(parent[key], c[key]);
    }
  }
  errors.push(...validateAdditions(inherited, parent?.profiles));
  if (c.review !== undefined && !record(c.review)) errors.push('review must be an object');
  if (c.review?.preferences !== undefined && !record(c.review.preferences)) errors.push('review.preferences must be an object');
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
    out.rev = 2;
    out.updatedAt = new Date().toISOString();
    const errors = validateConfig(out, opts.scope === 'project' ? readConfig(globalDir()) : null);
    if (errors.length) throw new CodedError(3, errors.join('; '));
    return out;
  });
  return { file, config: next, exclude };
}

// ---------- merging ----------

export function mergeConstraints(a = {}, b = {}) {
  const left = a.onlyVendors ?? [], right = b.onlyVendors ?? [];
  const both = left.length > 0 && right.length > 0;
  const onlyVendors = both ? left.filter((v) => right.includes(v)) : [...left, ...right];
  const result = { onlyVendors: [...new Set(onlyVendors)], denyVendors: [...new Set([...(a.denyVendors ?? []), ...(b.denyVendors ?? [])])],
    inHouseOnly: !!(a.inHouseOnly || b.inHouseOnly) };
  if (a.noVendorsAllowed || b.noVendorsAllowed || (both && !onlyVendors.length)) {
    result.onlyVendors = [];
    result.noVendorsAllowed = true;
  }
  return result;
}

function mergeRows(a, b) {
  const result = { ...a };
  for (const [id, row] of entries(b)) result[id] = { ...a?.[id], ...row };
  return result;
}

function mergeHosts(a, b) {
  const result = mergeRows(a, b);
  for (const [id, host] of entries(b)) {
    if (record(host.serves)) result[id].serves = { ...a?.[id]?.serves, ...host.serves };
  }
  return result;
}

function mergeQuota(a, b) {
  const result = { ...a };
  const checked = (row) => {
    const time = Date.parse(row?.checked);
    return Number.isNaN(time) ? -Infinity : time;
  };
  for (const [id, q] of entries(b)) if (checked(q) >= checked(result[id])) result[id] = q;
  return result;
}

function newestReviewDate(a, b) {
  return [a, b].filter((date) => typeof date === 'string' && !Number.isNaN(Date.parse(date))).sort().at(-1) ?? null;
}

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
  out.quota = mergeQuota(g?.quota, p?.quota);
  out.accountQuota = mergeQuota(g?.accountQuota, p?.accountQuota);
  out.rowSources = { resources: { ...out.sources } };
  for (const key of ['accounts', 'seats', 'profiles']) {
    out[key] = mergeRows(g?.[key], p?.[key]);
    out.rowSources[key] = {};
    for (const id of Object.keys(out[key])) {
      out.rowSources[key][id] = g?.[key]?.[id] && p?.[key]?.[id] ? 'project+global' : p?.[key]?.[id] ? 'project' : 'global';
    }
  }
  out.hosts = mergeHosts(g?.hosts, p?.hosts);
  out.rev = Math.max(p?.rev ?? 1, g?.rev ?? 1);
  out.profile = p?.profile ?? g?.profile ?? { active: 'balanced' };
  out.profileSource = p?.profile ? 'project' : g?.profile ? 'global' : 'default';
  out.constraints = mergeConstraints(g?.constraints, p?.constraints);
  out.review = { ...(g?.review ?? {}), ...(p?.review ?? {}) };
  if (g?.review.preferences || p?.review.preferences) {
    const global = g?.review.preferences ?? {}, project = p?.review.preferences ?? {};
    const prefs = { ...global, ...project };
    for (const key of ['lastConfirmed', 'lastAsked', 'snoozeUntil']) {
      if (key in prefs) prefs[key] = newestReviewDate(global[key], project[key]);
    }
    out.review.preferences = prefs;
  }
  out.review.lastReviewed = newestReviewDate(g?.review?.lastReviewed, p?.review?.lastReviewed);
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
  checkReferences(eff, (_path, message) => w.push(message));
  return w;
}

// ---------- resolve ----------

export function defaultInHouse(role, tier) {
  if (REVIEW_ROLES.includes(role)) return 'in-house senior review only (no other-vendor opinion; record it as missing)';
  if (role === 'bulk' || tier === 'external-fast') return 'in-house:low for purely mechanical edits, else in-house:mid:medium';
  if (role === 'code-sync') return 'in-house:mid:high';
  return 'in-house:mid:medium';
}

export function resolveRole(eff, role, at = new Date(), opts = {}) {
  const tz = eff.timezone || systemZone();
  const res = eff.resources;
  const candidates = [];
  const excluded = [];
  const outsideRole = new Set();
  const via = new Map();
  const host = opts.host && Object.hasOwn(eff.hosts ?? {}, opts.host) ? eff.hosts[opts.host] : null;
  const hostRoles = Object.hasOwn(host?.roles ?? {}, role) ? host.roles[role] : null;
  const routing = Object.hasOwn(eff.routing, role) ? eff.routing[role] : null;
  const base = hostRoles ?? routing ?? Object.keys(res).filter((id) => (res[id].roles ?? []).includes(role));
  const origin = hostRoles ? `hosts.${opts.host}.roles.${role}` : routing ? `routing.${role}` : `role ${role}`;
  for (const id of base) via.set(id, origin);
  let list = [...base];
  const active = [];
  const avoided = new Map();
  for (const s of eff.schedules) {
    if (s.roles?.length && !s.roles.includes(role)) continue;
    if (!matchesWindow(s.when ?? {}, at, tz)) continue;
    active.push(s.id);
    for (const id of s.avoid ?? []) if (!avoided.has(id)) avoided.set(id, s.id);
    const pref = (hostRoles ? [] : s.prefer ?? []).filter((id) => res[id] && (list.includes(id) || (res[id].roles ?? []).includes(role)));
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
    // An in-house seat may share its id with an external resource.
    if (hostRoles?.includes(id) && Object.hasOwn(eff.seats, id)) continue;
    for (const f of res[id]?.fallback ?? []) {
      if (!seen.has(f)) { queue.push(f); if (!via.has(f)) via.set(f, `fallback of ${id}`); }
    }
  }
  for (const [id, rule] of avoided) if (base.includes(id) || seen.has(id)) excluded.push({ id, reason: `avoided by schedule ${rule}` });
  for (const id of ordered) {
    if (hostRoles?.includes(id)) {
      const seat = Object.hasOwn(eff.seats, id) ? eff.seats[id] : null, auto = AUTO.exec(id);
      if (seat || auto) {
        const reason = seat?.vendor && vendorDenied(seat.vendor, eff.constraints) ? 'denied by constraint' : null;
        if (reason) excluded.push({ id, reason });
        else if (auto) candidates.push({ kind: 'auto', route: 'in-house', tier: auto[1], effort: auto[2] ?? null });
        else candidates.push({ kind: 'seat', route: 'in-house', id, ...fields(seat, ['team', 'vendor', 'model', 'effort', 'tier']) });
        continue;
      }
    }
    const r = Object.hasOwn(res, id) ? res[id] : null;
    if (!r) { excluded.push({ id, reason: 'unknown resource' }); continue; }
    if (excluded.some((e) => e.id === id)) continue;
    const restriction = resourceRestriction(r, eff.constraints, host, role);
    if (restriction) { excluded.push({ id, reason: restriction }); continue; }
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
    if (!hostRoles?.includes(id) && !(r.roles ?? []).includes(role)) {
      outsideRole.add(id);
      flags.push(`fallback outside its roles (${(r.roles ?? []).join(',') || 'none'}): state it`);
    }
    const candidate = {
      id, team: r.team ?? null, channel: r.channel ?? null, model: r.model ?? null, effort: r.effort ?? null,
      tier: r.tier ?? null, via: via.get(id) ?? null, flags,
    };
    expandResource(candidate, r, eff, host, opts, at, tz, candidates, excluded);
  }
  const tier = candidates[0]?.tier ?? res[base[0]]?.tier ?? null;
  const result = {
    role, at: at.toISOString(), timezone: tz, activeSchedules: active,
    pick: candidates[0] ?? null,
    candidates, excluded,
    inHouse: inHouse[inHouse.length - 1] ?? defaultInHouse(role, tier),
  };
  return orderCandidates(result, eff, opts, at, outsideRole);
}

function resourceVendor(r) {
  return r.vendor ?? TEAM_VENDORS[r.team]?.[0] ?? null;
}

function vendorDenied(vendor, c) {
  return c && (c.noVendorsAllowed || c.denyVendors?.includes(vendor) ||
    (c.onlyVendors?.length && !c.onlyVendors.includes(vendor)));
}

function resourceRestriction(r, constraints, host, role) {
  if (constraints?.inHouseOnly) return 'in-house only';
  const vendor = resourceVendor(r);
  if (vendorDenied(vendor, constraints)) return 'denied by constraint';
  if (!role.startsWith('in-house-') && host?.home?.includes(vendor)) return 'home vendor on this host: dispatch in-house';
  return null;
}

function expandResource(candidate, r, eff, host, opts, at, tz, candidates, excluded) {
  const id = candidate.id;
  const served = Object.hasOwn(host?.serves ?? {}, r.team) ? host.serves[r.team] : null;
  const routes = served?.accounts ?? [{ account: r.account ?? null, instance: null }];
  if (!routes.length) {
    excluded.push({ id, reason: `no account served for team ${r.team} on this host` });
    return;
  }
  if (r.account && !routes.some((a) => a.account === r.account)) {
    excluded.push({ id, reason: `account ${r.account} ${Object.hasOwn(eff.accounts ?? {}, r.account) ? 'not served on this host' : 'undeclared'}` });
    return;
  }
  for (const { account, instance } of routes) {
    if (r.account && account !== r.account) continue;
    if (account && !Object.hasOwn(eff.accounts ?? {}, account)) { excluded.push({ id, reason: `account ${account} undeclared` }); continue; }
    const quota = account == null ? null : eff.accountQuota?.[account];
    if (quota?.state === 'exhausted' && (!quota.resets || quota.resets === 'unknown' || !pastBound(quota.resets, at, tz, 'start'))) {
      const until = quota.resets && quota.resets !== 'unknown' ? ` until ${quota.resets}` : ', reset unknown: ask the user once';
      excluded.push({ id, reason: `account ${account} exhausted${until}` });
      continue;
    }
    if (!opts.host) { candidates.push(candidate); continue; }
    candidates.push({ ...candidate, route: served ? 'host-switch' : 'acp-liaison', account, instance,
      hostModel: served?.models?.[r.model] ?? candidate.model, options: served?.options?.effort ? { [served.options.effort]: r.effort } : {} });
  }
}

function orderCandidates(result, eff, opts, at, outsideRole) {
  const name = opts.profile ?? eff.profile?.active ?? 'balanced';
  const profile = profileInfo(name, eff.profiles ?? {});
  if (!profile) throw new CodedError(opts.profile ? 5 : 3, `profile: unknown profile ${name}`);
  const ranked = result.candidates.map((candidate) => {
    const id = candidate.id;
    const r = candidate.kind ? {} : eff.resources[id] ?? {};
    const account = candidate.account ?? r.account ?? null;
    const a = account == null ? null : eff.accounts?.[account];
    const aq = account == null ? null : eff.accountQuota?.[account];
    const rq = candidate.kind ? null : eff.quota?.[id];
    const state = aq?.state ?? rq?.state;
    const soon = [a?.expires, aq?.expires, rq?.expires].some((t) => expiresSoon(t, at, result.timezone));
    const bucket = soon ? 0 : state === 'plenty' ? 1 : state === 'low' ? 3 : 2;
    const cost = r.cost ?? { free: 'free', subscription: 'included', metered: 'metered', prepaid: 'metered' }[a?.billing];
    return { candidate, account, bucket, weight: a?.weight ?? 1, cost: { free: 0, included: 1, metered: 3 }[cost] ?? 2,
      tier: candidate.tier === 'external-strong' ? 1 : 0, outside: outsideRole.has(id) ? 1 : 0 };
  });
  // Every profile keeps the role's own candidates ahead of out-of-role fallbacks, so `pick` agrees with `assignments`.
  if (profile.base === 'frugal') ranked.sort((a, b) => a.outside - b.outside || a.cost - b.cost || a.tier - b.tier);
  if (profile.base === 'load-balance') ranked.sort((a, b) => a.outside - b.outside || a.bucket - b.bucket);
  result.candidates = ranked.map((item) => item.candidate);
  result.pick = result.candidates[0] ?? null;
  if (opts.host || opts.profile || opts.session || opts.count || eff.constraints?.noVendorsAllowed) {
    result.host = opts.host ?? null;
    result.constraints = eff.constraints;
    result.profile = { name, base: profile.base, source: opts.profile ? 'session' : eff.profileSource ?? 'default' };
    result.parallel = profile.parallel;
  }
  if (opts.count) {
    const counts = new Map(), usedLow = new Set();
    const inRole = ranked.filter(({ candidate }) => !outsideRole.has(candidate.id));
    result.assignments = [];
    for (let job = 1; job <= opts.count; job++) {
      let pick = ranked[0];
      if (profile.base === 'load-balance') {
        pick = null;
        let best = Infinity;
        const eligible = inRole.some((item) => !usedLow.has(item)) ? inRole : ranked;
        for (const item of eligible) {
          const used = counts.get(item.account ?? item.candidate) ?? 0;
          if (usedLow.has(item)) continue;
          const score = (used + 1) / item.weight;
          if (!pick || item.bucket < pick.bucket || (item.bucket === pick.bucket && score < best)) { pick = item; best = score; }
        }
      }
      if (!pick) break;
      if (pick.bucket === 3) usedLow.add(pick);
      const key = pick.account ?? pick.candidate;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      result.assignments.push({ job, id: pick.candidate.id ?? `auto:${pick.candidate.tier}${pick.candidate.effort ? ':' + pick.candidate.effort : ''}`,
        account: pick.account, instance: pick.candidate.instance ?? null });
    }
  }
  return result;
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
  const gc = readConfig(g); const pc = readConfig(info.dir, gc);
  const eff = mergeConfigs(gc, pc);
  return { global: { dir: g, exists: !!gc }, project: { dir: info.dir, root: info.root, exists: !!pc }, eff, any: hasPlan(eff) };
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

function hasPlan(eff) {
  return ['resources', 'hosts', 'seats'].some((key) => Object.keys(eff[key] ?? {}).length > 0);
}

function checkReferences(eff, report) {
  const account = (id, keys) => {
    if (!Object.hasOwn(eff.accounts ?? {}, id)) report(keys, `${keys.join('.')}: account ${id} undeclared`);
  };
  for (const [id, r] of entries(eff.resources)) if (r.account) account(r.account, ['resources', id, 'account']);
  for (const [id, h] of entries(eff.hosts)) {
    for (const [team, served] of entries(h.serves)) {
      for (const a of served.accounts ?? []) account(a.account, ['hosts', id, 'serves', team, 'accounts']);
    }
    for (const [role, list] of entries(h.roles)) {
      for (const x of list) if (!AUTO.test(x) && !Object.hasOwn(eff.seats, x) && !Object.hasOwn(eff.resources, x)) {
        report(['hosts', id, 'roles', role], `hosts.${id}.roles.${role}: unknown seat or resource ${x}`);
      }
    }
  }
}

function stateLocation(root) {
  const info = projectInfo(root);
  return { info, file: path.join(info.gitCommonDir ? info.dir : globalDir(), STATE_FILE) };
}

function stateData(raw) {
  if (raw === null) return { schema: 1, lastHost: null, sessions: Object.create(null), carryOver: [] };
  if (raw.schema !== 1 || !record(raw.sessions) || !Array.isArray(raw.carryOver)) throw new CodedError(3, 'invalid compute-state.json');
  raw.sessions = Object.assign(Object.create(null), raw.sessions);
  // Older carry-over entries omit saveAsked. Only unanswered notes were carried.
  for (const note of raw.carryOver) if (note.saveAsked === undefined) note.saveAsked = null;
  return raw;
}

function readJsonFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(text); } catch (err) { throw new CodedError(3, `${file}: ${err.message}`); }
}

function readState(root) {
  const { file } = stateLocation(root);
  return stateData(fs.existsSync(file) ? readJsonFile(file) : null);
}

function pruneState(state, at) {
  for (const [session, current] of entries(state.sessions)) {
    if (Date.parse(current.touchedAt) >= at.getTime() - 14 * DAY_MS) continue;
    for (const note of current.notes) if (note.saveAsked === null) {
      state.carryOver.push({ at: note.at, session, what: note.what, saveAsked: null });
    }
    delete state.sessions[session];
  }
  state.carryOver.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  state.carryOver = state.carryOver.slice(-10);
}

// A summary retains the individual edit even after a later edit or pruning.
// Quote free text as one JSON string so notes round-trip without invoking a shell.
function summaryWord(text) {
  return /^[a-z0-9.,_:+/-]+$/i.test(text) ? text : JSON.stringify(text);
}

function summarizeEdit(command, values) {
  const words = [command];
  for (const [key, value] of entries(values)) {
    let arg;
    if (key === 'windows') arg = value.map(formatWhen).join('; ');
    else if (key === 'when') arg = formatWhen(value);
    else if (Array.isArray(value)) arg = value.join(',');
    else if (typeof value === 'boolean') arg = value ? 'yes' : 'no';
    else arg = value;
    const flag = '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    words.push(flag, summaryWord(arg));
  }
  return words.join(' ');
}

function notePatch(note) {
  const words = note.what.match(/"(?:\\.|[^"\\])*"|[^\s"]+/g) ?? [];
  const argv = [];
  const decode = (word) => word.startsWith('"') ? JSON.parse(word) : word;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word.startsWith('--')) { argv.push(decode(word)); continue; }
    const next = words[++i];
    if (next === undefined) throw new CodedError(3, `missing value for ${word} in session note`);
    argv.push(word + '=' + decode(next));
  }
  const opts = parseArgs([...argv, '--scope', 'session', '--session', 'saved']);
  if (opts.command === 'set') return { resources: { [opts.id]: fields(opts, RESOURCE_FIELDS) } };
  if (opts.command === 'route') return { routing: { [opts.role]: opts.order } };
  if (opts.command === 'schedule' && opts.action === 'add') return { schedules: [{ id: opts.id, ...fields(opts, RULE_FIELDS) }] };
  if (opts.command === 'profile' && opts.action === 'use') return { profile: { active: opts.id, until: opts.until ?? null } };
  throw new CodedError(3, 'unrecognized session override');
}

function updateState(opts, mutate) {
  const { info, file } = stateLocation(opts.root);
  if (info.gitCommonDir && !fs.existsSync(file)) ensureExcluded(info);
  const at = opts.at ?? new Date();
  const state = updateFile(file, (cur) => {
    const data = stateData(cur);
    pruneState(data, at);
    mutate(data, at);
    return data;
  });
  return { state, file };
}

function newSession(host, runtime, at) {
  return { host, runtime, startedAt: at.toISOString(), touchedAt: at.toISOString(),
    patch: { resources: {}, routing: {}, schedules: [], constraints: {} }, notes: [] };
}

function mergePlan(base, patch) {
  const out = { ...base, ...patch };
  for (const key of ['accounts', 'seats', 'profiles', 'resources', 'hosts']) {
    if (key in patch) out[key] = mergeRows(base[key], patch[key]);
  }
  for (const key of ['routing', 'quota', 'accountQuota']) if (key in patch) out[key] = { ...base[key], ...patch[key] };
  if ('schedules' in patch) {
    const byId = new Map((base.schedules ?? []).map((s) => [s.id, s]));
    for (const s of patch.schedules) byId.set(s.id, s);
    out.schedules = [...byId.values()];
  }
  if ('review' in patch) {
    out.review = { ...base.review, ...patch.review };
    if (patch.review.preferences) out.review.preferences = { ...base.review?.preferences, ...patch.review.preferences };
  }
  return out;
}

function scopedPlan(eff, hostId, patch = {}) {
  const host = hostId && Object.hasOwn(eff.hosts, hostId) ? eff.hosts[hostId] : {};
  const result = mergePlan(eff, patch);
  result.routing = { ...eff.routing, ...host.routing, ...patch.routing };
  result.constraints = mergeConstraints(mergeConstraints(eff.constraints, host.constraints), patch.constraints);
  const p = patch.profile ?? host.profile ?? eff.profile;
  result.profile = typeof p === 'string' ? { active: p } : p;
  result.profileSource = patch.profile ? 'session' : host.profile ? 'host' : eff.profileSource;
  result.sources = { ...eff.sources };
  for (const id of Object.keys(patch.resources ?? {})) result.sources[id] = 'session';
  result.rowSources = { ...eff.rowSources, resources: result.sources };
  return result;
}

function loadPlan(opts) {
  const loaded = loadEffective(opts.root);
  const session = opts.session ? readState(opts.root).sessions[opts.session] : null;
  loaded.eff = scopedPlan(loaded.eff, opts.host, session?.patch);
  loaded.any = hasPlan(loaded.eff);
  return loaded;
}

function profileSummary(eff) {
  const info = profileInfo(eff.profile.active, eff.profiles);
  if (!info) throw new CodedError(3, `profile.active: unknown profile ${eff.profile.active}`);
  return { active: info.name, base: info.base, source: eff.profileSource };
}

export function preferencesStatus(p = {}, at, tz) {
  const everyDays = p.everyDays ?? 30;
  const lastConfirmed = p.lastConfirmed ?? null, snoozeUntil = p.snoozeUntil ?? null;
  const today = zoned(at, tz).date;
  const due = (!snoozeUntil || snoozeUntil < today) &&
    (!lastConfirmed || (Date.parse(today) - Date.parse(lastConfirmed)) / DAY_MS >= everyDays);
  return { due, lastConfirmed, snoozeUntil, everyDays };
}

function expiresSoon(time, at, tz) {
  if (!time || pastBound(time, at, tz, 'end')) return false;
  const end = new Date(at.getTime() + 3 * DAY_MS);
  return /^\d{4}-\d\d-\d\d$/.test(time) ? time <= zoned(end, tz).date : Date.parse(time) <= end.getTime();
}

function startQuestions(host, state, key, eff, prefs, at) {
  const ask = [];
  const add = (id, question, options, recommended) => ask.push({ id, question, options, recommended });
  if (['unknown', 'new'].includes(host.change)) add('host-scenario', 'Where does this session run?', SCENARIOS, host.scenario);
  if (host.change === 'served-changed') add('host-served-changed', 'Update the providers and models this host serves?', ['review', 'keep'], 'review');
  if (prefs.due && hasPlan(eff)) add('preferences-review', 'Keep or adjust your compute preferences?', ['keep', 'adjust', 'later'], 'keep');
  const pending = (n) => n.saveAsked === null;
  if (state.carryOver.some(pending) || entries(state.sessions).some(([id, s]) => id !== key && s.notes.some(pending))) {
    add('unsaved-overrides', 'Where should the previous overrides be kept?', ['session', 'project', 'global'], 'session');
  }
  const seen = new Map();
  const remember = (id, what) => { if (!seen.has(what)) seen.set(what, new Set()); seen.get(what).add(id); };
  for (const [id, s] of entries(state.sessions)) for (const n of s.notes.filter(pending)) remember(id, n.what);
  for (const n of state.carryOver.filter(pending)) remember(n.session, n.what);
  if ([...seen.values()].some((ids) => ids.size >= 2)) add('repeat-override', 'Where should the repeated override be kept?', ['session', 'project', 'global'], 'project');
  const tz = eff.timezone || systemZone();
  if ([...Object.values(eff.accounts), ...Object.values(eff.accountQuota)].some((a) => expiresSoon(a.expires, at, tz))) {
    add('account-expiry', 'Review accounts expiring within three days?', ['review', 'later'], 'review');
  }
  if (eff.profile.until && pastBound(eff.profile.until, at, tz, 'end')) add('profile-until-passed', 'Review the expired profile?', ['review', 'keep'], 'review');
  return ask;
}

function cmdStart(opts) {
  const loaded = loadEffective(opts.root);
  const hint = detectHost(process.env);
  const id = opts.host ?? hint.id;
  const h = Object.hasOwn(loaded.eff.hosts, id) ? loaded.eff.hosts[id] : null;
  const matched = id === hint.id;
  const runtime = opts.runtime ?? hint.runtime ?? null;
  const known = matched ? hint : [...HOST_HINTS, ...WRAPPER_HOSTS].find((entry) => entry.id === id);
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const generated = !opts.session && !hint.sessionVar;
  const key = opts.session ?? (generated ? randomBytes(6).toString('hex') : sha(`${id}:${process.env[hint.sessionVar]}`).slice(0, 16));
  const lines = opts.served ? fs.readFileSync(opts.served, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : null;
  const served = lines ? `sha256:${sha([...new Set(lines)].sort().join('\n'))}` : null;
  const kind = h?.kind ?? known?.kind ?? kindFromName(id) ?? 'unknown';
  const kindRoute = { 'vendor-native': 'acp-liaison', 'multi-vendor': 'host-switch' }[kind] ?? null;
  const host = { id, name: h?.name ?? known?.name ?? id, scenario: h?.scenario ?? known?.scenario ?? scenarioFromName(id) ?? 'unknown',
    kind, route: h?.route ?? (matched && !h?.kind ? hint.route : kindRoute),
    runtime, evidence: matched ? hint.evidence : [], verified: matched && hint.verified, plan: h ? 'present' : 'missing' };
  if (!matched) host.detected = { id: hint.id, evidence: hint.evidence };
  let resumed;
  const at = opts.at ?? new Date();
  const { state, file } = updateState({ ...opts, at }, (s) => {
    const prev = s.lastHost;
    const current = Object.hasOwn(s.sessions, key) ? s.sessions[key] : null;
    resumed = !!current;
    host.previous = prev;
    if (!opts.host && ['unknown', 'other'].includes(id)) host.change = 'unknown';
    else if (!h) host.change = 'new';
    else if (prev && (id !== prev.id || (current?.host != null && current.host !== id))) host.change = 'changed';
    else if (prev && runtime !== prev.runtime) host.change = 'runtime-changed';
    else if (served && prev?.served && served !== prev.served) host.change = 'served-changed';
    else host.change = 'same';
    s.lastHost = { id, runtime, served, at: at.toISOString(), session: key };
    s.sessions[key] = { ...(current ?? newSession(id, runtime, at)), host: id, runtime, touchedAt: at.toISOString() };
  });
  const eff = scopedPlan(loaded.eff, id, state.sessions[key].patch);
  const tz = eff.timezone || systemZone();
  const review = { models: reviewStatus(eff.review, at, tz), preferences: preferencesStatus(eff.review.preferences, at, tz) };
  const ranking = rankingStatus(at);
  const harnessOverlays = overlaysFor(loaded);
  const say = [];
  if (eff.constraints.noVendorsAllowed) say.push('No vendors satisfy the combined vendor allowlists.');
  if (['same', 'changed', 'runtime-changed'].includes(host.change)) say.push(`Host ${id} (${host.change}), runtime ${runtime ?? 'unknown'}.`);
  if (review.models.due) say.push('Model review is due.');
  if (ranking.stale) say.push('Model ranking is stale or missing.');
  for (const o of harnessOverlays) if (o.superseded) say.push(`Host ${o.host}: the plan supersedes ${path.basename(o.file)}.`);
  return { ok: true, needsInit: !hasPlan(eff), host, session: { key, generated, resumed, file },
    profile: profileSummary(eff), constraints: eff.constraints, review, ranking, harnessOverlays,
    ask: startQuestions(host, state, key, eff, review.preferences, at), say };
}

function overlaysFor({ project, global, eff }) {
  return listOverlays([['project', project.dir], ['global', global.dir]]).map((o) =>
    eff.hosts[o.host]?.serves ? { ...o, superseded: true } : o);
}

function cmdShow(opts) {
  const at = opts.at ?? new Date();
  const { global, project, eff, any } = loadPlan(opts);
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
    rev: eff.rev, profile: profileSummary(eff), constraints: eff.constraints, sources: eff.rowSources, accounts: eff.accounts, accountQuota: eff.accountQuota,
    seats: eff.seats, profiles: eff.profiles, hosts: Object.fromEntries(entries(eff.hosts).map(([id, h]) => [id, fields(h, ['scenario', 'kind', 'route'])])),
    ...(opts.host ? { effectiveHost: eff.hosts[opts.host] ?? null } : {}),
    review: reviewStatus(eff.review, at, tz),
    ranking: rankingStatus(at),
    resources: Object.fromEntries(Object.entries(eff.resources).map(([id, r]) => [id, { ...r, scope: eff.sources[id] }])),
    routing: eff.routing, schedules: eff.schedules, activeSchedules: active, expiredSchedules: expired,
    quota: eff.quota, quotaNotes, warnings: configWarnings(eff),
    harnessOverlays: overlaysFor({ global, project, eff }),
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
  const errors = validateConfig(data, opts.scope === 'project' ? readConfig(globalDir()) : null);
  if (errors.length) throw new CodedError(3, errors.join('; '));
  const out = writeScope(opts, () => data);
  return { ok: true, scope: opts.scope, file: out.file, exclude: out.exclude, resources: Object.keys(out.config.resources) };
}

function cmdSet(opts) {
  const patch = fields(opts, RESOURCE_FIELDS);
  if (opts.scope === 'session') {
    return sessionEdit(opts, { resources: { [opts.id]: patch } }, summarizeEdit(`set ${opts.id}`, patch));
  }
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
  if (opts.scope === 'session') return sessionEdit(opts, { routing: { [opts.role]: opts.order } }, `route ${opts.role} ${summaryWord(opts.order?.join(',') ?? '-')}`);
  const out = writeScope(opts, (c) => {
    if (opts.order === null) delete c.routing[opts.role];
    else c.routing[opts.role] = opts.order;
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, role: opts.role, order: out.config.routing[opts.role] ?? null };
}

function cmdSchedule(opts) {
  const values = fields(opts, RULE_FIELDS);
  const rule = { id: opts.id, ...values };
  if (opts.scope === 'session') return sessionEdit(opts, { schedules: [rule] }, summarizeEdit(`schedule add ${opts.id}`, values));
  const out = writeScope(opts, (c) => {
    const i = c.schedules.findIndex((s) => s.id === opts.id);
    if (opts.action === 'remove') {
      if (i < 0) throw new CodedError(5, `no schedule ${opts.id} in the ${opts.scope} config`);
      c.schedules.splice(i, 1);
      return c;
    }
    if (i >= 0) c.schedules[i] = rule; else c.schedules.push(rule);
    return c;
  });
  return { ok: true, scope: opts.scope, file: out.file, schedules: out.config.schedules };
}

function sessionEdit(opts, patch, what) {
  const { eff } = loadEffective(opts.root);
  const { state, file } = updateState(opts, (s, at) => {
    const current = s.sessions[opts.session] ??= newSession(null, null, at);
    const merged = mergePlan(current.patch, patch);
    if (patch.routing && opts.order === null) delete merged.routing[opts.role];
    const plan = scopedPlan(eff, opts.host ?? current.host, merged);
    const errors = validateConfig({ ...plan, schema: SCHEMA });
    if (errors.length) throw new CodedError(3, errors.join('; '));
    current.patch = merged;
    current.touchedAt = at.toISOString();
    current.notes.push({ at: at.toISOString(), what, saveAsked: null });
  });
  return { ok: true, scope: 'session', file, session: opts.session, patch: state.sessions[opts.session].patch };
}

function cmdPromote(opts) {
  let saved = 0, target;
  const matches = (note) => (!opts.what || note.what === opts.what);
  const { file } = updateState(opts, (s, at) => {
    const current = s.sessions[opts.session];
    const notes = (current?.notes ?? []).filter(matches);
    const carried = s.carryOver.filter((n) => n.session === opts.session && matches(n));
    if (!current && !carried.length) throw new CodedError(5, 'session patch is unavailable');
    const selected = [...carried, ...notes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (!opts.decline && selected.length) {
      const tz = loadEffective(opts.root).eff.timezone || systemZone();
      target = writeScope(opts, (c) => {
        for (const n of selected) {
          const patch = notePatch(n);
          c = mergePlan(c, patch);
          if (patch.profile) c.profile = { ...patch.profile, by: 'user', at: zoned(new Date(n.at), tz).date };
          for (const [role, ids] of entries(patch.routing)) if (ids === null) delete c.routing[role];
        }
        return c;
      }).file;
    }
    s.carryOver = s.carryOver.filter((n) => !carried.includes(n));
    for (const n of notes) n.saveAsked = opts.decline ? 'session' : opts.scope;
    if (current) current.touchedAt = at.toISOString();
    saved = selected.length;
  });
  return { ok: true, session: opts.session, scope: opts.scope ?? 'session', file: target ?? file, saved };
}

function cmdEntity(opts) {
  const { eff } = loadEffective(opts.root);
  const key = { profile: 'profiles', host: 'hosts', account: 'accounts', seat: 'seats' }[opts.command];
  const id = opts.id;
  const at = opts.at ?? new Date(), today = zoned(at, eff.timezone || systemZone()).date;
  if (opts.action === 'list') {
    return { ok: true, profiles: Object.fromEntries([...Object.keys(PARALLEL), ...Object.keys(eff.profiles)].map((name) => [name, profileInfo(name, eff.profiles)])) };
  }
  if (opts.action === 'show') {
    if (!Object.hasOwn(eff.hosts, id)) throw new CodedError(5, `unknown host ${id}`);
    return { ok: true, id, host: eff.hosts[id] };
  }
  if (opts.action === 'use') {
    if (!profileInfo(id, eff.profiles)) throw new CodedError(5, `unknown profile ${id}`);
    const profile = { active: id, by: 'user', at: today, until: opts.until ?? null };
    if (opts.scope === 'session') return sessionEdit(opts, { profile: opts.until ? profile : id }, `profile use ${id}${opts.until ? ' --until ' + opts.until : ''}`);
    const { file } = writeScope(opts, (c) => ({ ...c, profile }));
    return { ok: true, scope: opts.scope, file, profile };
  }
  if (opts.action === 'quota') {
    if (!Object.hasOwn(eff.accounts, id)) throw new CodedError(5, `unknown account ${id}`);
    const quota = { checked: at.toISOString(), ...fields(opts, ['state', 'resets', 'expires', 'remaining', 'source', 'note']) };
    const { file } = writeScope(opts, (c) => ({ ...c, accountQuota: { ...c.accountQuota, [id]: quota } }));
    return { ok: true, scope: opts.scope, file, account: id, quota };
  }
  let value;
  if (opts.action !== 'remove') {
    switch (key) {
      case 'profiles': value = fields(opts, ['extends', 'parallelism', 'note']); break;
      case 'accounts': value = fields(opts, ['vendor', 'team', 'billing', 'plan', 'cycle', 'resets', 'expires', 'weight', 'note']); break;
      case 'seats': value = fields(opts, ['team', 'vendor', 'model', 'effort', 'tier', 'note']); break;
      case 'hosts':
        if (opts.from && ['name', 'scenario', 'kind', 'route', 'home', 'confirmed'].some((k) => opts[k] !== undefined)) throw new UsageError('host set takes --from or host fields');
        value = opts.from ? readJsonFile(opts.from) : fields(opts, ['name', 'scenario', 'kind', 'route', 'confirmed']);
        if (!record(value)) throw new CodedError(3, `hosts.${id}: must be an object`);
        if (opts.home !== undefined) value.home = splitList(opts.home);
        break;
    }
  }
  const { file, config } = writeScope(opts, (c) => {
    c[key] ??= {};
    if (opts.action === 'remove') {
      if (!Object.hasOwn(c[key], id)) throw new CodedError(5, `unknown ${opts.command} ${id} in ${opts.scope}`);
      delete c[key][id];
    } else {
      if (key === 'accounts') {
        value.declared = c.accounts[id]?.declared ?? (opts.scope === 'project' ? eff.accounts[id]?.declared : null) ?? today;
      }
      c[key][id] = { ...c[key][id], ...value };
    }
    return c;
  });
  return { ok: true, file, scope: opts.scope, id, value: config[key][id] ?? null };
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
  const { eff } = loadPlan(opts);
  const r = eff.resources[opts.id] ?? {};
  const entry = { at: new Date().toISOString(), resource: opts.id, model: r.model ?? null, effort: r.effort ?? null, outcome: opts.outcome };
  for (const k of ['task', 'role', 'minutes', 'tokensIn', 'tokensOut', 'note', 'host', 'account', 'instance', 'session']) if (opts[k] !== undefined) entry[k] = opts[k];
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
  const { eff, any } = loadPlan(opts);
  if (!any) throw new CodedError(2, 'no compute config yet: ask the user the setup questions, then run init');
  return { ok: true, ...resolveRole(eff, opts.role, opts.at ?? new Date(), opts) };
}

function cmdReviewed(opts) {
  const { eff } = loadEffective(opts.root);
  const today = zoned(opts.at ?? new Date(), eff.timezone || systemZone()).date;
  const out = writeScope(opts, (c) => {
    if (opts.what === 'preferences') {
      const p = c.review.preferences ??= {};
      p.lastAsked = today;
      if (opts.decision === 'later') p.snoozeUntil = new Date(Date.parse(today) + (opts.snoozeDays ?? 3) * DAY_MS).toISOString().slice(0, 10);
      else { p.lastConfirmed = today; p.snoozeUntil = null; }
      if (opts.everyDays) p.everyDays = opts.everyDays;
      return c;
    }
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

function checkPlan(eff, hostId, draft) {
  const errors = [], warnings = [];
  // Resources and ledger rows are keyed by id. Hosts also inherit routes,
  // role lists and served teams independently; a name edit touches none of those.
  const report = (keys, message) => {
    const [section, id, field, item] = keys;
    const touched = section === 'hosts'
      ? Object.hasOwn(draft?.hosts?.[id]?.[field] ?? {}, item)
      : Object.hasOwn(draft?.[section] ?? {}, id);
    (draft && !touched ? warnings : errors).push(message);
  };
  checkReferences(eff, report);
  for (const id of Object.keys(eff.accountQuota)) {
    if (!Object.hasOwn(eff.accounts, id)) report(['accountQuota', id], `accountQuota.${id}: account ${id} undeclared`);
  }
  const reachesInHouse = (id, seen) => {
    if (id.startsWith('in-house:')) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (eff.resources[id]?.fallback ?? []).some((next) => reachesInHouse(next, seen));
  };
  for (const [id, r] of entries(eff.resources)) {
    if (typeof r.effort !== 'string' || !r.effort.trim()) report(['resources', id], `resources.${id}.effort: pin an effort`);
    if (!reachesInHouse(id, new Set())) warnings.push(`resources.${id}.fallback never reaches an in-house: entry`);
  }
  const checkRoutes = (routing, prefix, home = [], roles = false) => {
    for (const [role, list] of entries(routing)) for (const id of list) {
      if (id.startsWith('in-house:') || (roles && (AUTO.test(id) || Object.hasOwn(eff.seats, id)))) continue;
      const keys = [...prefix, role];
      if (!Object.hasOwn(eff.resources, id)) {
        // checkReferences already checked seat/resource references in host roles.
        if (!roles) report(keys, `${keys.join('.')}: unknown resource ${id}`);
      } else if (!role.startsWith('in-house-') && home.includes(resourceVendor(eff.resources[id]))) {
        (draft ? warnings : errors).push(`${keys.join('.')}: ${id} is a home-vendor resource`);
      }
    }
  };
  checkRoutes(eff.routing, ['routing']);
  const hosts = hostId ? [[hostId, eff.hosts[hostId] ?? {}]] : entries(eff.hosts);
  for (const [id, host] of hosts) {
    checkRoutes(host.routing, ['hosts', id, 'routing'], host.home);
    checkRoutes(host.roles, ['hosts', id, 'roles'], host.home, true);
  }
  for (const [id, host] of hosts.length ? hosts : [[null, {}]]) {
    const vendorsFor = (role) => {
      const ids = host.roles?.[role] ?? host.routing?.[role] ?? eff.routing[role] ??
        entries(eff.resources).filter(([, r]) => r.roles?.includes(role)).map(([key]) => key);
      return ids.map((key) => host.roles?.[role] && Object.hasOwn(eff.seats, key)
        ? eff.seats[key].vendor : resourceVendor(eff.resources[key] ?? {}));
    };
    const edits = EDIT_ROLES.flatMap(vendorsFor);
    for (const role of REVIEW_ROLES) {
      const review = vendorsFor(role);
      if (review.length && edits.length && review[0] && [...edits, ...review].every((v) => v === review[0])) {
        warnings.push(`${id ? 'hosts.' + id + '.' : ''}${role}: review and edit candidates all share vendor ${review[0]}`);
      }
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings };
}

function renderPlan(eff, opts) {
  const rows = [['Role', 'Candidate', 'Model · effort', 'Route', 'Account → instance', 'Fallback']];
  const roles = new Set([...Object.keys(eff.routing), ...Object.keys(eff.hosts[opts.host]?.roles ?? {}),
    ...Object.values(eff.resources).flatMap((r) => r.roles ?? [])]);
  for (const role of roles) {
    const resolved = resolveRole(eff, role, opts.at ?? new Date(), opts);
    if (!resolved.candidates.length) rows.push([role, '—', '—', '—', '—', resolved.inHouse]);
    for (const c of resolved.candidates) {
      const id = c.id ?? `auto:${c.tier}${c.effort ? ':' + c.effort : ''}`;
      const resource = c.kind ? null : eff.resources[id];
      const fallback = resource?.fallback?.join(' → ') || resolved.inHouse;
      const account = c.account ?? resource?.account;
      rows.push([role, id, `${c.hostModel ?? c.model ?? c.tier ?? '—'} · ${c.effort ?? '—'}`,
        c.route ?? 'acp-liaison', [account, c.instance].filter(Boolean).join(' → ') || '—', fallback]);
    }
  }
  const markdown = rows.map((r) => `| ${r.map((cell) => String(cell).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ')).join(' | ')} |`);
  markdown.splice(1, 0, '| --- | --- | --- | --- | --- | --- |');
  return markdown.join('\n');
}

function changedKeys(base, next, draft) {
  const changed = [];
  for (const [key, value] of entries(draft)) {
    if (['resources', 'seats', 'accounts', 'profiles', 'hosts', 'routing', 'quota', 'accountQuota'].includes(key)) {
      for (const id of Object.keys(value)) if (!isDeepStrictEqual(base[key]?.[id], next[key][id])) changed.push(`${key}.${id}`);
    } else if (key === 'schedules') {
      for (const s of value) if (!isDeepStrictEqual(base.schedules.find((p) => p.id === s.id), s)) changed.push(`schedules.${s.id}`);
    } else if (key !== 'schema' && !isDeepStrictEqual(base[key], next[key])) changed.push(key);
  }
  return changed;
}

function cmdPlan(opts) {
  const { eff } = loadEffective(opts.root);
  let draft;
  if (opts.from) {
    try { draft = readJsonFile(opts.from); }
    catch (err) {
      if (opts.action === 'check' && err instanceof CodedError) return { ok: false, errors: [err.message], warnings: [] };
      throw err;
    }
    const errors = record(draft) ? validateConfig({ schema: SCHEMA, ...draft }, eff) : ['draft must be an object'];
    if (errors.length) {
      if (opts.action === 'check') return { ok: false, errors, warnings: [] };
      throw new CodedError(3, errors.join('; '));
    }
  }
  if (opts.action === 'apply') {
    let changed, warnings;
    const { file } = writeScope(opts, (base) => {
      const next = mergePlan(base, draft);
      const parent = opts.scope === 'project' ? readConfig(globalDir()) : null;
      const errors = validateConfig(next, parent);
      if (errors.length) throw new CodedError(3, errors.join('; '));
      const checked = checkPlan(mergeConfigs(parent, next), null, draft);
      if (!checked.ok) throw new CodedError(3, checked.errors.join('; '));
      warnings = checked.warnings;
      changed = changedKeys(base, next, draft);
      return next;
    });
    return { ok: true, scope: opts.scope, file, changed, warnings };
  }
  const plan = draft ? mergePlan(eff, draft) : eff;
  if (opts.action === 'check') return checkPlan(plan, opts.host);
  const session = opts.session ? readState(opts.root).sessions[opts.session] : null;
  return { ok: true, markdown: renderPlan(scopedPlan(plan, opts.host, session?.patch), opts) };
}

function cmdMigrate(opts) {
  const loaded = loadEffective(opts.root);
  const global = readConfig(loaded.global.dir), project = readConfig(loaded.project.dir, global);
  let policyCostPreference = null;
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const file = path.join(loaded.project.root, name);
    if (!fs.existsSync(file)) continue;
    const match = /^[\t ]*-[\t ]*Cost preference:[\t ]*([^\r\n<]+)/im.exec(fs.readFileSync(file, 'utf8'));
    if (match) { policyCostPreference = match[1].trim().replaceAll('`', ''); break; }
  }
  return { ok: true, rev: { global: global ? global.rev ?? 1 : null, project: project ? project.rev ?? 1 : null },
    overlaysWithoutHost: [...new Set(overlaysFor(loaded).map((o) => o.host).filter((id) => !Object.hasOwn(loaded.eff.hosts, id)))],
    inHouseRoutingRoles: Object.keys(loaded.eff.routing).filter((id) => id.startsWith('in-house-')),
    policyCostPreference, legacyProfile: new Map([['economize', 'frugal'], ['balanced', 'balanced'], ['max-quality', 'performance']]).get(policyCostPreference) ?? null };
}

export function run(opts) {
  switch (opts.command) {
    case 'paths': { const info = projectInfo(opts.root); return { ok: true, global: globalDir(), project: info.dir, projectRoot: info.root, files: { config: CONFIG_FILE, usage: USAGE_FILE, ranking: RANKING_FILE } }; }
    case 'start': return cmdStart(opts);
    case 'profile': case 'account': case 'seat': case 'host': return cmdEntity(opts);
    case 'promote': return cmdPromote(opts);
    case 'plan': return cmdPlan(opts);
    case 'migrate': return cmdMigrate(opts);
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
    if (out.ok === false && out.errors) { process.stderr.write(out.errors.join('\n') + '\n'); return 3; }
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
