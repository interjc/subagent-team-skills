// Fake `codex` used by tests (loaded through a generated executable shim).
// Records { argv, cwd, stdin } to $FAKE_RECORD; behavior chosen by $FAKE_MODE:
//   ok (default), effort-mismatch, fail, hang, version.
// $FAKE_TOKENS=inline prints "tokens used: N" instead of the two-line form.
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
if (process.env.FAKE_RECORD) {
  fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, cwd: process.cwd(), stdin }));
}

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
