#!/usr/bin/env node
// env-check.cjs - environment health check for the subagent-team skills.
//
//   node env-check.cjs [--root <project dir>] [--json]
//
// Run once per session before the team starts working. Checks Node.js
// (hard minimum and recommended version), git, which host harness this
// session probably runs in (a hint to confirm with the user), the optional
// external teams (Codex CLI, agy, the agy-staff plugin, OpenCode, Pi, Grok
// CLIs, project MCP servers), whether the project already has a
// "## Subagent team" policy section, and whether it has a team board.
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

var MIN_NODE_MAJOR = 18;
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
  'Requirements: Node.js >= ' + MIN_NODE_MAJOR + ' (hard minimum), ' + RECOMMENDED_NODE_MAJOR + ' recommended; git.',
  'Optional external teams: Codex CLI, agy, agy-staff plugin, OpenCode, Pi, Grok CLI, project MCP servers.',
  'The host harness is detected from environment variables: a hint, confirm it with the user.',
  'Env overrides: GIT_BIN, CODEX_BIN, AGY_BIN, OPENCODE_BIN, PI_BIN, GROK_BIN, CLAUDE_CONFIG_DIR, HOME.',
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

function checkNode(version) {
  var major = nodeMajor(version);
  var install = 'Install Node.js ' + RECOMMENDED_NODE_MAJOR + ' LTS, e.g. `nvm install ' + RECOMMENDED_NODE_MAJOR +
    '` (then `nvm use ' + RECOMMENDED_NODE_MAJOR + '` in the shell that runs the agent) or from https://nodejs.org';
  if (major < MIN_NODE_MAJOR) {
    return {
      id: 'node', status: 'error', detail: 'Node.js ' + version + ' is below the minimum ' + MIN_NODE_MAJOR + '; the helper scripts will not work.',
      fix: install + '. Until then, use the fallbacks in SKILL.md (the method itself needs no scripts).'
    };
  }
  if (major < RECOMMENDED_NODE_MAJOR) {
    return {
      id: 'node', status: 'warn', detail: 'Node.js ' + version + ' works (minimum ' + MIN_NODE_MAJOR + '); ' + RECOMMENDED_NODE_MAJOR + ' is recommended.',
      fix: install + '.'
    };
  }
  return { id: 'node', status: 'ok', detail: 'Node.js ' + version + ' (minimum ' + MIN_NODE_MAJOR + ', recommended ' + RECOMMENDED_NODE_MAJOR + ')' };
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

function findAgyStaff(env) {
  var dir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), '.claude');
  var file = path.join(dir, 'plugins', 'installed_plugins.json');
  try {
    return fs.readFileSync(file, 'utf8').indexOf('agy-staff') !== -1;
  } catch (e) {
    return false;
  }
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
  { id: 'grok', label: 'Grok CLI', envBin: 'GROK_BIN', bin: 'grok' }
];

function checkOtherAgents(env, root) {
  var checks = [];
  for (var i = 0; i < OTHER_AGENTS.length; i++) {
    var a = OTHER_AGENTS[i];
    var r = probe(env[a.envBin] || a.bin, ['--version']);
    if (r.found) {
      checks.push({ id: a.id, status: 'ok', detail: a.label + ' (presumed): ' + (r.output || 'found') + '. Not tested with these skills; confirm it is the agent you mean before outsourcing to it.' });
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
      return {
        found: true, file: names[i], modelPolicy: m ? m[1] : null,
        hostHarness: h ? h[1].trim() : null, teamBoard: b ? b[1].trim() : null
      };
    }
  }
  return { found: false, file: null, modelPolicy: null, hostHarness: null, teamBoard: null };
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

function runChecks(opts, env, nodeVersion) {
  var checks = [checkNode(nodeVersion)];
  var git = checkGit(env, opts.root);
  var projectRoot = opts.root;
  for (var i = 0; i < git.length; i++) if (git[i].root) projectRoot = git[i].root;
  var host = detectHost(env);
  checks = checks.concat(git, [checkHost(host)], checkExternal(env), checkOtherAgents(env, projectRoot));
  var policy = findPolicy(projectRoot);
  var board = findBoard(projectRoot, policy);
  var blocked = checks.some(function (c) { return c.status === 'error'; });
  var warned = checks.some(function (c) { return c.status === 'warn'; });
  var status = blocked ? 'blocked' : warned ? 'ready-with-warnings' : 'ready';
  var next = [];
  if (blocked) next.push('Tell the user what is missing and the fix; install only with their consent, then re-run this check. If they decline, continue with the fallbacks in SKILL.md.');
  if (!policy.found) next.push('No "## Subagent team" policy yet: run the first-use setup (references/project-setup.md).');
  else if (!policy.modelPolicy) next.push('The policy section in ' + policy.file + ' has no "Model policy:" line: complete it with the user.');
  if (policy.found && !policy.hostHarness) next.push('The policy has no "Host harness:" line: confirm the host' + (host.id === 'unknown' ? '' : ' (detected: ' + host.name + ')') + ' with the user and record it.');
  if (!board.found && !(policy.teamBoard && /^(native|none)\b/i.test(policy.teamBoard))) next.push('No team board yet: when the work involves external teams, several sessions or Strict mode, create one (scripts/team-board.mjs init) and link it from the policy section.');
  if (!next.length) next.push('Environment ready and policy found: proceed.');
  return {
    status: status,
    minNode: MIN_NODE_MAJOR,
    recommendedNode: RECOMMENDED_NODE_MAJOR,
    projectRoot: projectRoot,
    host: host,
    checks: checks,
    policy: policy,
    board: board,
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
