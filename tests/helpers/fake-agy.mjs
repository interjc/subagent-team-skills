// Fake `agy` used by tests (loaded through a generated executable shim).
// Records { argv, cwd, pid } to $FAKE_RECORD; behavior chosen by $FAKE_MODE:
//   ok (default), error-with-response, error-no-response, error-timeout-text,
//   timeout-status, timeout-partial, noise-before-json, pretty-json-trailing,
//   unparseable, hang, grandchild-hang (spawns `sleep 30` sharing stdout, then
//   hangs; grandchildPid is recorded), ignore-term (ignores SIGTERM, hangs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';

if (argv[0] === '--version') {
  process.stdout.write('agy 1.4.2\n');
  process.exit(0);
}
if (argv[0] === 'models') {
  process.stdout.write('gemini-3.8-flash-low\ngemini-3.8-flash-medium\ngemini-3.8-flash-high\n');
  process.exit(0);
}
const record = (extra = {}) => {
  if (process.env.FAKE_RECORD) {
    fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, cwd: process.cwd(), stdin: '', pid: process.pid, ...extra }));
  }
};
record();

const base = { conversation_id: 'conv-123', usage: { input_tokens: 100, output_tokens: 20 }, num_turns: 2, duration_seconds: 3.5 };
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

switch (mode) {
  case 'ok':
    emit({ status: 'SUCCESS', response: 'Done: all good.', ...base });
    break;
  case 'error-with-response':
    emit({ status: 'ERROR', response: 'Partial answer.', error: 'tool call failed', ...base });
    break;
  case 'error-no-response':
    process.stderr.write('agy: quota exceeded\n');
    emit({ status: 'ERROR', response: '', error: { message: 'quota exceeded' }, ...base });
    process.exit(1);
    break;
  case 'error-timeout-text':
    emit({ status: 'ERROR', response: '', error: 'upstream connection timeout', ...base });
    process.exit(1);
    break;
  case 'timeout-status':
    emit({ status: 'TIMEOUT', response: '', error: 'print timeout exceeded', ...base });
    process.exit(1);
    break;
  case 'timeout-partial':
    emit({ status: 'TIMEOUT', response: 'Half done: steps 1-3.', ...base });
    break;
  case 'pretty-json-trailing':
    process.stdout.write('Loading {workspace}...\n');
    process.stdout.write(`${JSON.stringify({ status: 'SUCCESS', response: 'Pretty {braces} and "quotes" inside.', ...base }, null, 2)}\n`);
    process.stdout.write('Bye.\n');
    break;
  case 'noise-before-json':
    process.stdout.write('Loading workspace... done\n[info] model ready\n');
    emit({ status: 'SUCCESS', response: 'After noise.', ...base });
    break;
  case 'unparseable':
    process.stdout.write('this is not json at all\n');
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    break;
  case 'grandchild-hang': {
    const gc = spawn('sleep', ['30'], { stdio: ['ignore', 'inherit', 'inherit'] });
    record({ grandchildPid: gc.pid });
    setInterval(() => {}, 1000);
    break;
  }
  case 'ignore-term':
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    break;
  default:
    process.stderr.write(`unknown FAKE_MODE ${mode}\n`);
    process.exit(9);
}
