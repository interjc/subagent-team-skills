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
