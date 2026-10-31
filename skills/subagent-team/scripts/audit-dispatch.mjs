#!/usr/bin/env node
// audit-dispatch.mjs - list what actually ran in a Claude Code session from
// the harness transcripts: each subagent's model, requestedModel and effort,
// plus external CLI dispatch attempts from the main transcript.
//
// Usage:
//   audit-dispatch.mjs --session-dir <dir> [--main <main transcript .jsonl>]
//
// Dependency-free (node: builtins only). Run with --help for details.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Hard minimum shared by every script in these skills. Recommended: 24.
export const MIN_NODE_MAJOR = 18;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
  console.error(`audit-dispatch.mjs: Node.js >= ${MIN_NODE_MAJOR} is required (found v${process.versions.node}). ` +
    'Install Node.js 24 LTS (e.g. `nvm install 24`), or use the fallback described in SKILL.md.');
  process.exit(1);
}

export const USAGE = `audit-dispatch.mjs - audit actual subagent models, effort and dispatch attempts from session transcripts.

Usage:
  audit-dispatch.mjs --session-dir <dir> [--main <main transcript .jsonl>]

Options:
  --session-dir <dir>  Session directory containing subagents/agent-*.jsonl (and optional .meta.json).
  --main <path>        Main session transcript .jsonl (default: <dir>.jsonl if it exists).
  --help               Show this help.

Dispatch attempts come from the main transcript only: they include refused attempts and briefs that merely mention a job command, and they miss commands a liaison runs inside its own transcript.

Output: JSON summary on stdout; one human-readable line per agent on stderr.
Exit codes: 0 ok; 1 usage error, missing subagents directory or unreadable file.
`;

export class UsageError extends Error {}

class ReadError extends Error {
  constructor(fileName) {
    super(`cannot read ${fileName}`);
    this.fileName = fileName;
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new ReadError(path.basename(filePath));
  }
}

export function parseArgs(argv) {
  const opts = { sessionDir: null, main: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      if (v.startsWith('--')) throw new UsageError(`${arg} needs a value, got option ${v}`);
      return v;
    };
    switch (arg) {
      case '--session-dir': opts.sessionDir = value(); break;
      case '--main': opts.main = value(); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  if (!opts.help && !opts.sessionDir) {
    throw new UsageError('--session-dir is required');
  }
  return opts;
}

export function parseAgentTranscript(text) {
  let turns = 0;
  const counts = new Map();
  const seenIds = new Set();
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'assistant' || typeof obj.message?.model !== 'string') continue;
    const msgId = typeof obj.message.id === 'string' && obj.message.id.length > 0 ? obj.message.id : null;
    if (msgId !== null) {
      if (seenIds.has(msgId)) continue;
      seenIds.add(msgId);
    }
    const model = obj.message.model;
    const requestedModel = typeof obj.requestedModel === 'string' ? obj.requestedModel : null;
    const effort = typeof obj.effort === 'string' ? obj.effort : null;
    turns += 1;
    const key = JSON.stringify([model, requestedModel, effort]);
    const prev = counts.get(key);
    if (prev) prev.turns += 1;
    else counts.set(key, { model, requestedModel, effort, turns: 1 });
  }
  const models = [...counts.values()].sort((a, b) => (
    b.turns - a.turns
    || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)
    || ((a.requestedModel ?? '') < (b.requestedModel ?? '') ? -1 : (a.requestedModel ?? '') > (b.requestedModel ?? '') ? 1 : 0)
    || ((a.effort ?? '') < (b.effort ?? '') ? -1 : (a.effort ?? '') > (b.effort ?? '') ? 1 : 0)
  ));
  return { turns, models };
}

const CODEX_JOB_RE = /codex-run\.mjs(?:[^\n]*?\s|\s+)exec\b|\bcodex\s+exec\b/;
const AGY_JOB_RE = /agy-run\.mjs(?:[^\n]*?\s|\s+)run\b|\bagy\s+-p\b/;

export function emptyDispatchAttempts() {
  return {
    codex: { bash: 0, agentPrompt: 0 },
    agy: { bash: 0, agentPrompt: 0 },
  };
}

export function parseExternalJobs(text) {
  const out = emptyDispatchAttempts();
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'assistant' || !Array.isArray(obj.message?.content)) continue;
    for (const item of obj.message.content) {
      if (!item || item.type !== 'tool_use') continue;
      if (item.name === 'Bash' && typeof item.input?.command === 'string') {
        if (CODEX_JOB_RE.test(item.input.command)) out.codex.bash += 1;
        if (AGY_JOB_RE.test(item.input.command)) out.agy.bash += 1;
      } else if (item.name === 'Agent' && typeof item.input?.prompt === 'string') {
        if (CODEX_JOB_RE.test(item.input.prompt)) out.codex.agentPrompt += 1;
        if (AGY_JOB_RE.test(item.input.prompt)) out.agy.agentPrompt += 1;
      }
    }
  }
  return out;
}

export function summarize(agents, dispatchAttempts = emptyDispatchAttempts()) {
  const sorted = [...(agents || [])]
    .map((a) => ({
      id: a.id,
      description: a.description ?? null,
      turns: a.turns ?? 0,
      models: a.models ?? [],
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const totals = {};
  for (const agent of sorted) {
    if (agent.models.length > 0) {
      const top = agent.models[0].model;
      totals[top] = (totals[top] || 0) + 1;
    }
  }
  return {
    agents: sorted,
    totals,
    dispatchAttempts: {
      codex: {
        bash: dispatchAttempts?.codex?.bash ?? 0,
        agentPrompt: dispatchAttempts?.codex?.agentPrompt ?? 0,
      },
      agy: {
        bash: dispatchAttempts?.agy?.bash ?? 0,
        agentPrompt: dispatchAttempts?.agy?.agentPrompt ?? 0,
      },
    },
  };
}

export function sanitizeField(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
}

export function formatAgentStderr(agent) {
  const desc = agent.description ? ` (${sanitizeField(agent.description)})` : '';
  const models = agent.models.length
    ? agent.models.map((m) => (
      `${sanitizeField(m.model)} [requested=${m.requestedModel != null ? sanitizeField(m.requestedModel) : 'null'}, effort=${m.effort != null ? sanitizeField(m.effort) : 'null'}, turns=${m.turns}]`
    )).join(', ')
    : 'no turns';
  return `${agent.id}${desc}: ${agent.turns} turn(s) - ${models}`;
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`audit-dispatch: ${err.message}\nRun with --help for usage.\n`);
      return 1;
    }
    throw err;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const sessionDir = path.resolve(opts.sessionDir);
  const subagentsDir = path.join(sessionDir, 'subagents');
  try {
    if (!fs.existsSync(subagentsDir) || !fs.statSync(subagentsDir).isDirectory()) {
      process.stderr.write(`audit-dispatch: missing subagents directory: ${subagentsDir}\n`);
      return 1;
    }
  } catch {
    process.stderr.write(`audit-dispatch: missing subagents directory: ${subagentsDir}\n`);
    return 1;
  }

  let files;
  try {
    files = fs.readdirSync(subagentsDir)
      .filter((f) => /^agent-.*\.jsonl$/.test(f))
      .sort();
  } catch {
    process.stderr.write(`cannot read ${path.basename(subagentsDir)}\n`);
    return 1;
  }

  try {
    const agents = [];
    for (const file of files) {
      const id = file.replace(/\.jsonl$/, '');
      const transcriptText = readTextFile(path.join(subagentsDir, file));
      const { turns, models } = parseAgentTranscript(transcriptText);
      let description = null;
      const metaPath = path.join(subagentsDir, `${id}.meta.json`);
      if (fs.existsSync(metaPath)) {
        const metaRaw = readTextFile(metaPath);
        try {
          const meta = JSON.parse(metaRaw);
          if (typeof meta?.description === 'string') description = meta.description;
        } catch {
          // ignore malformed JSON in optional meta file
        }
      }
      agents.push({ id, description, turns, models });
    }
    let mainPath = null;
    if (opts.main) {
      mainPath = path.resolve(opts.main);
    } else {
      const candidate = `${sessionDir}.jsonl`;
      if (fs.existsSync(candidate)) mainPath = candidate;
    }
    const dispatchAttempts = mainPath
      ? parseExternalJobs(readTextFile(mainPath))
      : emptyDispatchAttempts();
    const summary = summarize(agents, dispatchAttempts);
    for (const agent of summary.agents) {
      process.stderr.write(`${formatAgentStderr(agent)}\n`);
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof ReadError) {
      process.stderr.write(`${err.message}\n`);
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
  process.exitCode = main();
}
