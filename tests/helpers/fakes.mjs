// Test helpers: temp dirs, fake binaries and a child-process runner.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
export const SCRIPTS = {
  codexRun: path.join(ROOT, 'skills', 'cli-agent-delegation', 'scripts', 'codex-run.mjs'),
  agyRun: path.join(ROOT, 'skills', 'cli-agent-delegation', 'scripts', 'agy-run.mjs'),
  opencodeAcpRun: path.join(ROOT, 'skills', 'cli-agent-delegation', 'scripts', 'opencode-acp-run.mjs'),
  doctor: path.join(ROOT, 'skills', 'cli-agent-delegation', 'scripts', 'doctor.mjs'),
  modelRoster: path.join(ROOT, 'skills', 'subagent-team', 'scripts', 'model-roster.mjs'),
};

export function makeTempDir(prefix = 'sts-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Writes an executable shim <dir>/<name>.mjs that runs tests/helpers/<source>.
export function makeFakeBin(dir, name, source) {
  const target = pathToFileURL(path.join(here, source)).href;
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, `#!${process.execPath}\nimport ${JSON.stringify(target)};\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

// Runs a script with node; returns { status, stdout, stderr, json }.
export function runScript(script, args, { env = {}, cwd, timeout = 30_000 } = {}) {
  const fullEnv = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete fullEnv[k];
  const r = spawnSync(process.execPath, [script, ...args], { env: fullEnv, cwd, encoding: 'utf8', timeout });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, error: r.error };
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Polls a fake's record until `ready(record)` holds. Unparsable reads count as
// "not yet". Returns the record, or throws after `timeoutMs`.
export async function waitForRecord(file, ready, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* missing or being replaced */ }
    if (rec && ready(rec)) return rec;
    if (Date.now() > deadline) throw new Error(`record ${file} not ready after ${timeoutMs}ms`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

// Cleanup for tests that spawn a wrapper around a hanging fake: kills the
// wrapper and every pid the fake recorded, so a failed assertion cannot leave
// processes that keep the test runner alive.
export function killLeftovers(child, file) {
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* nothing recorded */ }
  const pids = [rec?.pid, rec?.grandchildPid].filter(Number.isInteger);
  if (child.exitCode === null && child.signalCode === null) pids.unshift(child.pid);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

// True while `pid` exists (process.kill(pid, 0) does not throw ESRCH).
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

// Polls (synchronously) until `pid` is gone; returns true if it went away in time.
export function waitUntilGone(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    Atomics.wait(cell, 0, 0, 50);
  }
  return !isAlive(pid);
}
