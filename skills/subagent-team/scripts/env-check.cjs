#!/usr/bin/env node
// env-check.cjs - environment health check for the subagent-team skills.
//
//   node env-check.cjs [--root <project dir>] [--json]
//
// Run once per session before the team starts working. Checks Node.js
// (hard minimum and recommended version), git, the optional external CLIs
// (Codex CLI, agy, the agy-staff plugin) and whether the project already has
// a "## Subagent team" policy section. Prints blockers, warnings and the
// exact fix for each; never installs or changes anything.
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
  'Optional: Codex CLI, agy, agy-staff plugin (external staff).',
  'Env overrides: GIT_BIN, CODEX_BIN, AGY_BIN, CLAUDE_CONFIG_DIR, HOME.',
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

function checkExternal(env) {
  var checks = [];
  var codexBin = env.CODEX_BIN || 'codex';
  var codex = probe(codexBin, ['--version']);
  checks.push(codex.found
    ? { id: 'codex', status: 'ok', detail: 'Codex CLI: ' + codex.output }
    : { id: 'codex', status: 'info', detail: 'Codex CLI not found (optional external-strong staff).', fix: 'Optional: `npm install -g @openai/codex`, then sign in once with `codex`.' });
  var agyBin = env.AGY_BIN || 'agy';
  var agy = probe(agyBin, ['--version']);
  checks.push(agy.found
    ? { id: 'agy', status: 'ok', detail: 'agy: ' + agy.output }
    : { id: 'agy', status: 'info', detail: 'agy not found (optional external-fast staff).', fix: 'Optional: install Google Antigravity CLI (https://antigravity.google/docs/cli/install), then sign in once with `agy`.' });
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
      return { found: true, file: names[i], modelPolicy: m ? m[1] : null };
    }
  }
  return { found: false, file: null, modelPolicy: null };
}

function runChecks(opts, env, nodeVersion) {
  var checks = [checkNode(nodeVersion)];
  var git = checkGit(env, opts.root);
  checks = checks.concat(git, checkExternal(env));
  var projectRoot = opts.root;
  for (var i = 0; i < git.length; i++) if (git[i].root) projectRoot = git[i].root;
  var policy = findPolicy(projectRoot);
  var blocked = checks.some(function (c) { return c.status === 'error'; });
  var warned = checks.some(function (c) { return c.status === 'warn'; });
  var status = blocked ? 'blocked' : warned ? 'ready-with-warnings' : 'ready';
  var next = [];
  if (blocked) next.push('Tell the user what is missing and the fix; install only with their consent, then re-run this check. If they decline, continue with the fallbacks in SKILL.md.');
  if (!policy.found) next.push('No "## Subagent team" policy yet: run the first-use setup (references/project-setup.md).');
  else if (!policy.modelPolicy) next.push('The policy section in ' + policy.file + ' has no "Model policy:" line: complete it with the user.');
  if (!next.length) next.push('Environment ready and policy found: proceed.');
  return {
    status: status,
    minNode: MIN_NODE_MAJOR,
    recommendedNode: RECOMMENDED_NODE_MAJOR,
    projectRoot: projectRoot,
    checks: checks,
    policy: policy,
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
  findPolicy: findPolicy,
  runChecks: runChecks,
  formatReport: formatReport,
  main: main
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
