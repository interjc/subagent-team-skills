// Fake `codex` used by tests (loaded through a generated executable shim).
// Records { argv, cwd, stdin } to $FAKE_RECORD; behavior chosen by $FAKE_MODE:
//   ok (default), effort-mismatch, fail, hang, grandchild-hang (spawns
//   `sleep 30` sharing stdout, then hangs), setsid-grandchild-hang (same, but
//   the sleep gets its own session), ignore-term (ignores SIGTERM, hangs).
// The record also holds the fake's pid and, for grandchild-hang, grandchildPid.
// $FAKE_TOKENS=inline prints "tokens used: N" instead of the two-line form.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';
const headerFile = new URL('../fixtures/codex-log-header.txt', import.meta.url);

if (argv[0] === '--version') {
  process.stdout.write('codex-cli 0.165.0\n');
  process.exit(0);
}

let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
const record = (extra = {}) => {
  if (process.env.FAKE_RECORD) {
    fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, cwd: process.cwd(), stdin, pid: process.pid, ...extra }));
  }
};
record();

const valueAfter = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const configs = argv.flatMap((a, i) => (a === '-c' ? [argv[i + 1]] : []));
const effortCfg = configs.find((c) => c.startsWith('model_reasoning_effort='));
const requested = effortCfg ? effortCfg.split('=')[1] : 'medium';
const reported = mode === 'effort-mismatch' ? (requested === 'high' ? 'xhigh' : 'high') : requested;
const sandbox = valueAfter('-s') || (configs.find((c) => c.startsWith('sandbox_mode=')) || 'sandbox_mode="read-only"').split('=')[1].replace(/"/g, '');

let header = fs.readFileSync(headerFile, 'utf8')
  .replace(/^workdir: .*$/m, `workdir: ${process.cwd()}`)
  .replace(/^reasoning effort: .*$/m, `reasoning effort: ${reported}`)
  .replace(/^sandbox: .*$/m, `sandbox: ${sandbox}`);
const model = valueAfter('-m');
if (model) header = header.replace(/^model: .*$/m, `model: ${model}`);
process.stdout.write(header);

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'grandchild-hang') {
  const gc = spawn('sleep', ['30'], { stdio: ['ignore', 'inherit', 'inherit'] });
  record({ grandchildPid: gc.pid });
  setInterval(() => {}, 1000);
} else if (mode === 'setsid-grandchild-hang') {
  // codex-cli 0.165.0 runs tool commands in their own session, outside codex's group.
  const gc = spawn('sleep', ['30'], { stdio: 'ignore', detached: true });
  record({ grandchildPid: gc.pid });
  setInterval(() => {}, 1000);
} else if (mode === 'ignore-term') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (mode === 'fail') {
  process.stderr.write('ERROR: stream disconnected before completion\n');
  process.exit(3);
} else {
  const out = valueAfter('-o');
  if (out) fs.writeFileSync(out, 'Hi from fake codex.\n');
  process.stdout.write('codex\nHi from fake codex.\nexec\nbash -lc ls in /tmp\n succeeded in 3ms:\n');
  process.stdout.write(process.env.FAKE_TOKENS === 'inline' ? 'tokens used: 4321\n' : 'tokens used\n4,321\n');
  process.stdout.write('Hi from fake codex.\n');
}
