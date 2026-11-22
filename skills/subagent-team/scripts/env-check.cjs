#!/usr/bin/env node
// env-check.cjs - environment health check for the subagent-team skills.
//
//   node env-check.cjs [--root <project dir>] [--json]
//
// Run once per session before the team starts working. Checks Node.js
// (hard minimum; the user's or project's version wins when it meets it), git, which host harness this
// session probably runs in (a hint to confirm with the user), the optional
// external teams (Codex CLI and its Claude Code plugin, agy, the agy-staff
// plugin, OpenCode, Pi, Grok Build CLIs, project MCP servers), whether the project
// already has a "## Subagent team" policy section (and its "External
// delegation:" choice), and whether it has a team board.
// Prints blockers, warnings and the exact fix for each; never installs or
// changes anything.
//
// Written in conservative CommonJS on purpose, so that it still runs and can
// explain the problem on a Node.js that is too old for the other scripts.
//
// Exit codes: 0 ready (warnings allowed), 1 usage error, 2 blocked.

'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var MIN_NODE_MAJOR = 22;
var RECOMMENDED_NODE_MAJOR = 24;
var PROBE_TIMEOUT_MS = 10000;

var USAGE = [
  'env-check.cjs - environment health check for the subagent-team skills.',
  '',
  'Usage: node env-check.cjs [--root <project dir>] [--json]',
  '',
  '  --root <dir>  project to inspect for a "## Subagent team" policy (default: current directory)',
  '  --json        print one JSON object instead of the report',
  '',
  'Requirements: Node.js >= ' + MIN_NODE_MAJOR + ' (hard minimum; the user\'s own version is used when it meets it), ' + RECOMMENDED_NODE_MAJOR + ' or newer for a new install; git.',
  'Optional external teams: Codex CLI, Codex plugin, agy, agy-staff plugin, OpenCode (ACP), Pi, Grok Build, project MCP servers.',
  'The host harness is detected from environment variables: a hint, confirm it with the user.',
  'Node.js version: the project pin (.nvmrc, .node-version, volta.node), else the running one, else the newest nvm one, if >= ' + MIN_NODE_MAJOR + '; else ' + RECOMMENDED_NODE_MAJOR + '.',
  'Node.js: nvm first (NVM_DIR, default ~/.nvm); a native install only without nvm. Install nothing without the user\'s consent.',
  'Env overrides: GIT_BIN, CODEX_BIN, AGY_BIN, OPENCODE_BIN, PI_BIN, GROK_BIN, CLAUDE_CONFIG_DIR, NVM_DIR, SUBAGENT_TEAM_HOME, HOME.',
  'Exit codes: 0 ready (warnings allowed), 1 usage error, 2 blocked.'
].join('\n');

function parseArgs(argv) {
  var opts = { root: process.cwd(), json: false, help: false };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--root') {
      var v = argv[i + 1];
      if (!v || v.indexOf('--') === 0) throw new Error('--root needs a directory');
      opts.root = path.resolve(v);
      i++;
    } else throw new Error('unknown argument: ' + a);
  }
  return opts;
}

function nodeMajor(version) {
  var m = /^v?(\d+)/.exec(String(version));
  return m ? Number(m[1]) : 0;
}

// nvm is the preferred way to get Node.js; a native install only without it.
function findNvm(env) {
  var dir = env.NVM_DIR ? path.resolve(env.NVM_DIR) : path.join(homeDir(env), '.nvm');
  var found = false;
  try { found = fs.statSync(path.join(dir, 'nvm.sh')).isFile(); } catch (e) { /* not installed */ }
  var versions = [];
  if (found) {
    try {
      fs.readdirSync(path.join(dir, 'versions', 'node')).forEach(function (n) { if (/^v\d+\.\d+\.\d+$/.test(n)) versions.push(n); });
    } catch (e) { /* no versions yet */ }
    versions.sort(function (a, b) {
      var x = a.slice(1).split('.').map(Number);
      var y = b.slice(1).split('.').map(Number);
      return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]);
    });
  }
  return { found: found, dir: dir, versions: versions };
}

// The Node.js version a project pins: .nvmrc, .node-version, or package.json volta.node.
function findNodePin(root) {
  var files = ['.nvmrc', '.node-version'];
  for (var i = 0; i < files.length; i++) {
    var text = null;
    try { text = fs.readFileSync(path.join(root, files[i]), 'utf8'); } catch (e) { continue; }
    var value = String(text).split(/\r?\n/)[0].trim();
    if (!value) continue;
    var m = /^v?(\d+)/.exec(value);
    return { file: files[i], value: value, major: m ? Number(m[1]) : null };
  }
  try {
    var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    var volta = pkg && pkg.volta && pkg.volta.node;
    if (typeof volta === 'string' && volta.trim()) {
      var mv = /^v?(\d+)/.exec(volta.trim());
      return { file: 'package.json volta.node', value: volta.trim(), major: mv ? Number(mv[1]) : null };
    }
  } catch (e) { /* no package.json or not JSON */ }
  return null;
}

// Which Node.js major to use or install. The user's own choice wins when it
// meets the minimum: the project's pin, then the running version, then the
// newest version already installed through nvm; the recommended version only
// when none of them qualifies.
function nodeTarget(version, pin, nvm) {
  var installed = function (major) {
    var list = (nvm && nvm.versions) || [];
    for (var i = 0; i < list.length; i++) if (nodeMajor(list[i]) === major) return true;
    return false;
  };
  var pick = function (major, source) { return { major: major, source: source, installed: installed(major) }; };
  if (pin && pin.major && pin.major >= MIN_NODE_MAJOR) return pick(pin.major, 'project (' + pin.file + ')');
  var running = nodeMajor(version);
  if (running >= MIN_NODE_MAJOR) return pick(running, 'running');
  var list = (nvm && nvm.versions) || [];
  for (var i = 0; i < list.length; i++) if (nodeMajor(list[i]) >= MIN_NODE_MAJOR) return pick(nodeMajor(list[i]), 'nvm');
  return pick(RECOMMENDED_NODE_MAJOR, 'recommended');
}

function nodeInstallHint(nvm, target) {
  var v = target && target.major ? target.major : RECOMMENDED_NODE_MAJOR;
  if (nvm && nvm.found && target && target.installed) return '`nvm use ' + v + '` (already installed through nvm in ' + nvm.dir + '; nothing to install)';
  if (nvm && nvm.found) return 'With the user\'s consent: `nvm install ' + v + ' && nvm use ' + v + '` (nvm found in ' + nvm.dir + ')';
  return 'With the user\'s consent, install nvm (https://github.com/nvm-sh/nvm, its install script) and then `nvm install ' + v + ' && nvm use ' + v +
    '`; only if the user does not want nvm, install Node.js ' + v + ' natively (https://nodejs.org or the system package manager)';
}

// The Node.js running this check is not nvm's although nvm is installed.
function checkNvm(nvm, execPath, target) {
  if (!nvm || !nvm.found || !execPath) return [];
  if (path.resolve(execPath).indexOf(nvm.dir + path.sep) === 0) return [];
  var v = target && target.major ? target.major : RECOMMENDED_NODE_MAJOR;
  return [{
    id: 'nvm', status: 'info', detail: 'nvm is installed (' + nvm.dir + '), but this Node.js runs from ' + execPath + '.',
    fix: 'Fine if this is the version the user wants. To run the helper scripts with nvm\'s Node.js: `nvm use ' + v + '` in the shell that runs them, or `nvm exec ' + v + ' node <script>`.'
  }];
}

function checkNode(version, nvm, pin) {
  var major = nodeMajor(version);
  var target = nodeTarget(version, pin, nvm);
  if (major < MIN_NODE_MAJOR) {
    return {
      id: 'node', status: 'error', detail: 'Node.js ' + version + ' is below the minimum ' + MIN_NODE_MAJOR + '; the helper scripts will not work.',
      fix: nodeInstallHint(nvm, target) + '. Until then, use the fallbacks in references/environment-check.md (the method itself needs no scripts).'
    };
  }
  // Any version at or above the minimum is the user's choice: use it as it is.
  return { id: 'node', status: 'ok', detail: 'Node.js ' + version + ' (minimum ' + MIN_NODE_MAJOR + '; the user\'s version is used, ' + RECOMMENDED_NODE_MAJOR + ' or newer only for a new install)' };
}

// A project pin that differs from the running Node.js: information, never a reason to switch unasked.
function checkNodePin(version, pin, nvm) {
  if (!pin || !pin.major) return [];
  var running = nodeMajor(version);
  if (pin.major < MIN_NODE_MAJOR) {
    var t = nodeTarget(version, null, nvm);
    return [{
      id: 'node-pin', status: 'info', detail: 'The project pins Node.js ' + pin.value + ' (' + pin.file + '), below the scripts\' minimum ' + MIN_NODE_MAJOR + '.',
      fix: 'Keep the project\'s pin; run the helper scripts with Node.js ' + t.major + ' (`nvm exec ' + t.major + ' node <script>`).'
    }];
  }
  if (pin.major === running) return [];
  return [{
    id: 'node-pin', status: 'info', detail: 'The project pins Node.js ' + pin.value + ' (' + pin.file + '); this is ' + version + '. Both work for the scripts.',
    fix: 'To match the project: `nvm use ' + pin.major + '`' + (nvm && nvm.found && !nodeTarget(version, pin, nvm).installed ? ' after `nvm install ' + pin.major + '` (with the user\'s consent)' : '') + '.'
  }];
}

function probe(bin, args, cwd) {
  try {
    var r = childProcess.spawnSync(bin, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, cwd: cwd, windowsHide: true });
    if (r.error) return { found: false, error: r.error.code || r.error.message };
    var out = String(r.stdout || '').trim() || String(r.stderr || '').trim();
    return { found: true, ok: r.status === 0, output: out.split('\n')[0] };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

function checkGit(env, root) {
  var bin = env.GIT_BIN || 'git';
  var v = probe(bin, ['--version'], root);
  if (!v.found) {
    return [{
      id: 'git', status: 'error', detail: 'git not found (' + bin + ').',
      fix: 'Install git (https://git-scm.com/downloads); leases, diffs, reviews and commits all rely on it.'
    }];
  }
  var checks = [{ id: 'git', status: 'ok', detail: v.output }];
  var top = probe(bin, ['rev-parse', '--show-toplevel'], root);
  if (top.found && top.ok) {
    checks.push({ id: 'git-repo', status: 'ok', detail: 'repository: ' + top.output, root: top.output });
  } else {
    checks.push({
      id: 'git-repo', status: 'warn', detail: root + ' is not inside a git repository.',
      fix: 'Run the agent from the project repository (or `git init` it); file leases, diffs and commits assume git.'
    });
  }
  return checks;
}

function homeDir(env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function readInstalledPlugins(env) {
  var dir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), '.claude');
  try {
    return fs.readFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), 'utf8');
  } catch (e) {
    return '';
  }
}

function findAgyStaff(env) {
  return readInstalledPlugins(env).indexOf('agy-staff') !== -1;
}

// Returns the installed codex@<marketplace> key, or null.
function findCodexPlugin(env) {
  var m = /"(codex@[^"]+)"/.exec(readInstalledPlugins(env));
  return m ? m[1] : null;
}

// Environment variables a host harness sets for the commands it runs. Only the
// Claude Code entries were observed by the authors; the others are unverified
// hints. Detection never decides anything: the director confirms with the user.
var HOST_HINTS = [
  { id: 'claude-code', name: 'Claude Code', vars: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'], verified: true },
  { id: 'codex', name: 'Codex', vars: ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID'], verified: false },
  { id: 'opencode', name: 'OpenCode', vars: ['OPENCODE'], verified: false },
  { id: 'gemini-cli', name: 'Gemini CLI', vars: ['GEMINI_CLI'], verified: false },
  { id: 'cursor', name: 'Cursor', vars: ['CURSOR_AGENT', 'CURSOR_TRACE_ID'], verified: false }
];

function detectHost(env) {
  var found = [];
  for (var i = 0; i < HOST_HINTS.length; i++) {
    var h = HOST_HINTS[i];
    var evidence = [];
    for (var j = 0; j < h.vars.length; j++) if (env[h.vars[j]]) evidence.push(h.vars[j]);
    if (evidence.length) found.push({ id: h.id, name: h.name, evidence: evidence, verified: h.verified });
  }
  if (env.AI_AGENT) {
    if (found.length) found[0].evidence.push('AI_AGENT');
    else found.push({ id: 'other', name: String(env.AI_AGENT).split(/[_\s]/)[0], evidence: ['AI_AGENT'], verified: false });
  }
  if (!found.length) return { id: 'unknown', name: 'unknown', evidence: [], verified: false, candidates: [] };
  var host = found[0];
  host.candidates = found.slice(1).map(function (f) { return f.id; });
  return host;
}

function checkHost(host) {
  if (host.id === 'unknown') {
    return {
      id: 'host', status: 'info', detail: 'Host harness: not detected from the environment.',
      fix: 'Ask the user which agent runs this session; see references/host-harness.md.'
    };
  }
  var detail = 'Host harness (hint): ' + host.name + ' (' + host.evidence.join(', ') + (host.verified ? '' : '; unverified hint') + ')' +
    (host.candidates.length ? '; also matched: ' + host.candidates.join(', ') : '') + '. Confirm with the user.';
  return { id: 'host', status: 'info', detail: detail };
}

function findMcpServers(root) {
  try {
    var json = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
    return Object.keys((json && json.mcpServers) || {});
  } catch (e) {
    return null;
  }
}

// CLIs of other agents that may serve as external teams. Presence only: the
// name on PATH may belong to another program, so confirm before using it.
var OTHER_AGENTS = [
  { id: 'opencode', label: 'OpenCode CLI', envBin: 'OPENCODE_BIN', bin: 'opencode' },
  { id: 'pi', label: 'Pi coding agent CLI', envBin: 'PI_BIN', bin: 'pi' },
  { id: 'grok', label: 'Grok Build', envBin: 'GROK_BIN', bin: 'grok' }
];

function checkOtherAgents(env, root) {
  var checks = [];
  for (var i = 0; i < OTHER_AGENTS.length; i++) {
    var a = OTHER_AGENTS[i];
    var r = probe(env[a.envBin] || a.bin, ['--version']);
    if (r.found) {
      var note = a.id === 'opencode'
        ? 'Reachable through ACP with the cli-agent-delegation skill (opencode-acp-run.mjs; its probe lists models without spending tokens); confirm it is the agent you mean before outsourcing to it.'
        : 'Not tested with these skills; confirm it is the agent you mean before outsourcing to it.';
      checks.push({ id: a.id, status: 'ok', detail: a.label + ' (presumed): ' + (r.output || 'found') + '. ' + note });
    }
  }
  var mcp = findMcpServers(root);
  if (mcp && mcp.length) {
    checks.push({ id: 'mcp', status: 'info', detail: 'Project MCP servers (.mcp.json): ' + mcp.join(', ') + '. Any that front another agent can serve as an external team.' });
  }
  return checks;
}

function checkExternal(env) {
  var checks = [];
  var codexBin = env.CODEX_BIN || 'codex';
  var codex = probe(codexBin, ['--version']);
  checks.push(codex.found
    ? { id: 'codex', status: 'ok', detail: 'Codex CLI: ' + codex.output }
    : { id: 'codex', status: 'info', detail: 'Codex CLI not found (optional external team, external-strong).', fix: 'Optional: `npm install -g @openai/codex`, then sign in once with `codex`.' });
  var codexPlugin = findCodexPlugin(env);
  if (codexPlugin) {
    checks.push(codexPlugin === 'codex@openai-codex'
      ? { id: 'codex-plugin', status: 'ok', detail: 'Codex plugin installed (Claude Code, ' + codexPlugin + '): review commands for read-only second opinions.' }
      : { id: 'codex-plugin', status: 'warn', detail: 'Codex plugin "' + codexPlugin + '" is not OpenAI\'s codex@openai-codex.', fix: 'Check its sandbox default before use (some forks run danger-full-access); prefer codex-run.mjs from the cli-agent-delegation skill.' });
  }
  var agyBin = env.AGY_BIN || 'agy';
  var agy = probe(agyBin, ['--version']);
  checks.push(agy.found
    ? { id: 'agy', status: 'ok', detail: 'agy: ' + agy.output }
    : { id: 'agy', status: 'info', detail: 'agy not found (optional external team, external-fast).', fix: 'Optional: install Google Antigravity CLI (https://antigravity.google/docs/cli/install), then sign in once with `agy`.' });
  var staff = findAgyStaff(env);
  checks.push(staff
    ? { id: 'agy-staff', status: 'ok', detail: 'agy-staff plugin installed (Claude Code).' }
    : { id: 'agy-staff', status: 'info', detail: 'agy-staff plugin not found in Claude Code.', fix: 'Optional, if you use agy: `claude plugin marketplace add keli-wen/agy-staff && claude plugin install agy@agy-staff` (otherwise the raw agy CLI works).' });
  return checks;
}

function findPolicy(root) {
  var names = ['AGENTS.md', 'CLAUDE.md'];
  for (var i = 0; i < names.length; i++) {
    var file = path.join(root, names[i]);
    var text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      continue;
    }
    if (/^##\s+Subagent team\b/m.test(text)) {
      var m = /^\s*-?\s*Model policy:\s*([A-Za-z-]+)/m.exec(text);
      var h = /^\s*-?\s*Host harness:\s*([^<\n]+)/m.exec(text);
      var b = /^\s*-?\s*Team board:\s*([^<\n]+)/m.exec(text);
      var x = /^\s*-?\s*External delegation:\s*([A-Za-z-]+)/m.exec(text);
      return {
        found: true, file: names[i], modelPolicy: m ? m[1] : null,
        hostHarness: h ? h[1].trim() : null, teamBoard: b ? b[1].trim() : null,
        externalDelegation: x ? x[1].toLowerCase() : null
      };
    }
  }
  return { found: false, file: null, modelPolicy: null, hostHarness: null, teamBoard: null, externalDelegation: null };
}

function findBoard(root, policy) {
  var candidates = [];
  if (policy.teamBoard) {
    var value = policy.teamBoard.replace(/`/g, '');
    var link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(value);
    var first = link ? link[1] : value.split(/[\s(]/)[0];
    if (first && !/^(native|none)$/i.test(first)) candidates.push(first);
  }
  candidates.push('docs/agent-team/README.md');
  for (var i = 0; i < candidates.length; i++) {
    var rel = candidates[i];
    var file = path.join(root, rel);
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'README.md');
      if (fs.statSync(file).isFile()) return { found: true, path: path.relative(root, file).split(path.sep).join('/') };
    } catch (e) {
      // try the next candidate
    }
  }
  return { found: false, path: null };
}

// The user's external compute plan (compute-config.mjs): global config
// directory, and .agent-team/ in the main checkout (shared by worktrees).
function computeGlobalDir(env) {
  if (env.SUBAGENT_TEAM_HOME) return path.resolve(env.SUBAGENT_TEAM_HOME);
  return path.join(homeDir(env), '.subagent-team');
}

function findCompute(env, root) {
  var main = root;
  var common = probe(env.GIT_BIN || 'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
  if (common.found && common.ok && path.basename(common.output) === '.git') main = path.dirname(common.output);
  var g = path.join(computeGlobalDir(env), 'compute.json');
  var p = path.join(main, '.agent-team', 'compute.json');
  var exists = function (f) { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };
  return { global: g, globalFound: exists(g), project: p, projectFound: exists(p) };
}

function runChecks(opts, env, nodeVersion) {
  var checks = [null];
  var git = checkGit(env, opts.root);
  var projectRoot = opts.root;
  for (var i = 0; i < git.length; i++) if (git[i].root) projectRoot = git[i].root;
  var host = detectHost(env);
  var nvm = findNvm(env);
  var pin = findNodePin(projectRoot);
  var target = nodeTarget(nodeVersion, pin, nvm);
  checks[0] = checkNode(nodeVersion, nvm, pin);
  checks = checks.concat(checkNodePin(nodeVersion, pin, nvm), checkNvm(nvm, opts.execPath, target), git, [checkHost(host)], checkExternal(env), checkOtherAgents(env, projectRoot));
  var policy = findPolicy(projectRoot);
  var board = findBoard(projectRoot, policy);
  var compute = findCompute(env, projectRoot);
  var blocked = checks.some(function (c) { return c.status === 'error'; });
  var warned = checks.some(function (c) { return c.status === 'warn'; });
  var status = blocked ? 'blocked' : warned ? 'ready-with-warnings' : 'ready';
  var next = [];
  if (blocked) next.push('Tell the user what is missing and the fix; install only with their consent, then re-run this check. If they decline, continue with the fallbacks in references/environment-check.md.');
  if (!policy.found) next.push('No "## Subagent team" policy yet: run the first-use setup (references/project-setup.md).');
  else if (!policy.modelPolicy) next.push('The policy section in ' + policy.file + ' has no "Model policy:" line: complete it with the user.');
  if (policy.found && !policy.hostHarness) next.push('The policy has no "Host harness:" line: confirm the host' + (host.id === 'unknown' ? '' : ' (detected: ' + host.name + ')') + ' with the user and record it.');
  var teams = checks.filter(function (c) {
    return c.status === 'ok' && ['codex', 'agy', 'opencode', 'pi', 'grok'].indexOf(c.id) !== -1;
  }).map(function (c) { return c.id; });
  if (checks.some(function (c) { return c.id === 'mcp'; })) teams.push('MCP servers');
  var choice = policy.externalDelegation;
  if (policy.found && teams.length && choice !== 'roster' && choice !== 'none') {
    next.push('External teams available (' + teams.join(', ') + '): ask the user which may take work this session, pre-selecting the policy roster (references/environment-check.md, step 5). Policy "External delegation: roster" or "none" skips this question.');
  } else if (choice === 'roster' || choice === 'none') {
    next.push('External delegation: ' + choice + ' (from the policy): ' + (choice === 'none' ? 'keep all work in-house' : 'use the roster as recorded') + ' and say so in one line; re-check only when the user asks.');
  }
  if (teams.length && choice !== 'none') {
    if (compute.globalFound || compute.projectFound) {
      next.push('Compute plan found (' + [compute.globalFound ? 'global' : null, compute.projectFound ? 'project' : null].filter(Boolean).join(' + ') + '): run scripts/compute-config.mjs show and route by it; ask nothing about compute unless it reports a review is due (then notify and proceed).');
    } else {
      next.push('Compute plan: none yet: draft one (teams, model and effort per role, fallbacks, windows) and confirm it once, asking whether to keep it globally, for this project or for this session (references/compute-config.md).');
    }
  }
  if (!board.found && !(policy.teamBoard && /^(native|none)\b/i.test(policy.teamBoard))) next.push('No team board yet: when the work involves external teams, several sessions or Strict mode, create one (scripts/team-board.mjs init) and link it from the policy section.');
  if (!next.length || next.every(function (n) { return n.indexOf('External delegation: ') === 0 || n.indexOf('Compute plan found') === 0; })) next.push('Environment ready and policy found: proceed.');
  return {
    status: status,
    minNode: MIN_NODE_MAJOR,
    recommendedNode: RECOMMENDED_NODE_MAJOR,
    nodePin: pin,
    nodeTarget: target,
    projectRoot: projectRoot,
    host: host,
    checks: checks,
    policy: policy,
    board: board,
    compute: compute,
    next: next
  };
}

var MARK = { ok: '✓', warn: '!', error: '✗', info: '-' };

function formatReport(r) {
  var lines = ['Environment health check (subagent-team)', ''];
  r.checks.forEach(function (c) {
    lines.push('  ' + MARK[c.status] + ' ' + c.detail);
    if (c.fix && c.status !== 'ok') lines.push('      fix: ' + c.fix);
  });
  lines.push('');
  lines.push('Project policy: ' + (r.policy.found
    ? 'found in ' + r.policy.file + (r.policy.modelPolicy ? ' (Model policy: ' + r.policy.modelPolicy + ')' : ' (no Model policy line)')
    : 'not found in ' + r.projectRoot));
  lines.push('Team board: ' + (r.board.found ? r.board.path : (r.policy.teamBoard || 'none')));
  lines.push('Compute plan: ' + (r.compute.globalFound || r.compute.projectFound
    ? [r.compute.globalFound ? r.compute.global : null, r.compute.projectFound ? r.compute.project : null].filter(Boolean).join(' + ')
    : 'none'));
  lines.push('Status: ' + r.status.toUpperCase());
  lines.push('');
  lines.push('Next:');
  r.next.forEach(function (n) { lines.push('  - ' + n); });
  return lines.join('\n');
}

function main(argv) {
  var opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('env-check: ' + e.message + '\nRun with --help for usage.\n');
    return 1;
  }
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  opts.execPath = process.execPath;
  var r = runChecks(opts, process.env, process.version);
  process.stdout.write((opts.json ? JSON.stringify(r, null, 2) : formatReport(r)) + '\n');
  return r.status === 'blocked' ? 2 : 0;
}

module.exports = {
  MIN_NODE_MAJOR: MIN_NODE_MAJOR,
  RECOMMENDED_NODE_MAJOR: RECOMMENDED_NODE_MAJOR,
  parseArgs: parseArgs,
  nodeMajor: nodeMajor,
  checkNode: checkNode,
  detectHost: detectHost,
  findCompute: findCompute,
  findNvm: findNvm,
  checkNvm: checkNvm,
  findNodePin: findNodePin,
  nodeTarget: nodeTarget,
  checkNodePin: checkNodePin,
  nodeInstallHint: nodeInstallHint,
  findPolicy: findPolicy,
  findBoard: findBoard,
  findMcpServers: findMcpServers,
  runChecks: runChecks,
  formatReport: formatReport,
  main: main
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
