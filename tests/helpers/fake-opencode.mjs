// Fake `opencode` used by tests (loaded through a generated executable shim).
// `--version` and `acp --help` answer like OpenCode 2.2.5 ($FAKE_NO_ACP=1 makes
// `acp --help` fail). `acp` speaks newline-delimited JSON-RPC (ACP v1) on stdio.
// Records { argv, cwd, pid, configContent, received[] } to $FAKE_RECORD after
// every message. Prompt behavior is chosen by $FAKE_MODE:
//   ok (default), permission, failed-tool, child, retry, auth-required, refusal,
//   max-tokens, max-tokens-empty, empty-reply, hang (answers session/cancel with
//   stopReason cancelled), hang-hard (ignores cancel), ignore-term (ignores cancel
//   and SIGTERM), grandchild-hang (spawns `sleep 30`, ignores cancel), crash.
// Setup variations: no-injected-agent, no-effort, grouped, sticky-model,
// init-hang, garbage, resume-fails.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';

if (argv[0] === '--version') {
  process.stdout.write('opencode v2.2.5\n');
  process.exit(0);
}
if (argv[0] === 'acp' && argv.includes('--help')) {
  if (process.env.FAKE_NO_ACP) {
    process.stderr.write('unknown command "acp"\n');
    process.exit(1);
  }
  process.stdout.write('Start an Agent Client Protocol server\n');
  process.exit(0);
}
if (argv[0] !== 'acp') {
  process.stderr.write(`fake opencode: unsupported ${argv.join(' ')}\n`);
  process.exit(9);
}

const received = [];
const extra = {};
const record = () => {
  if (!process.env.FAKE_RECORD) return;
  fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({
    argv, cwd: process.cwd(), pid: process.pid, configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null, received, ...extra,
  }));
};
record();

if (mode === 'garbage') {
  process.stdout.write('Welcome to OpenCode!\n');
  process.exit(3);
}
if (mode === 'ignore-term' || mode === 'grandchild-hang') process.on('SIGTERM', () => {});

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const update = (sessionId, u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });

const MODELS = ['opencode/deepseek-v4.1-flash-free', 'openai/gpt-6.1-terra', 'anthropic/claude-haiku-5-5'];
const EFFORTS = {
  'opencode/deepseek-v4.1-flash-free': ['low', 'high', 'max', 'default'],
  'openai/gpt-6.1-terra': ['low', 'medium', 'high', 'default'],
};
let injected = [];
try {
  injected = Object.entries(JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}').agents || {})
    .filter(([, a]) => a && a.mode === 'primary').map(([id]) => id);
} catch { injected = []; }
const sessions = new Map();

function newState() {
  return { model: 'openai/gpt-6.1-terra', effort: 'default', mode: 'build' };
}

function configOptions(st) {
  const agents = ['build', 'plan', ...(mode === 'no-injected-agent' ? [] : injected)];
  const modelOptions = mode === 'grouped'
    ? [{ group: 'free', name: 'Free', options: [{ value: MODELS[0], name: 'DeepSeek' }] },
      { group: 'paid', name: 'Paid', options: MODELS.slice(1).map((v) => ({ value: v, name: v })) }]
    : MODELS.map((v) => ({ value: v, name: v }));
  const list = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: st.model, options: modelOptions }];
  const efforts = mode === 'no-effort' ? null : EFFORTS[st.model];
  if (efforts) list.push({ id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: st.effort, options: efforts.map((v) => ({ value: v, name: v })) });
  list.push({ id: 'mode', name: 'Agent', category: 'mode', type: 'select', currentValue: st.mode, options: agents.map((v) => ({ value: v, name: v })) });
  return list;
}

let activePrompt = null;

function finishPrompt(id, result) {
  if (activePrompt && activePrompt.id === id) activePrompt = null;
  send({ jsonrpc: '2.0', id, result });
}

const pendingClient = new Map();
let clientId = 1000;
function askClient(method, params) {
  const id = clientId++;
  return new Promise((resolve) => {
    pendingClient.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

async function runPrompt(id, sessionId) {
  activePrompt = { id, sessionId };
  const text = (t) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
  const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150 };
  switch (mode) {
    case 'permission': {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'rm -rf build', kind: 'execute', status: 'pending' });
      const reply = await askClient('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 'call_1', title: 'rm -rf build', kind: 'execute' },
        options: [
          { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      });
      extra.permissionReply = reply;
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'failed' });
      text('Could not clean the build directory.');
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    }
    case 'failed-tool':
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'touch x', kind: 'execute', status: 'pending' });
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'failed' });
      text('Shell was denied.');
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    case 'child':
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'child chatter' }, _meta: { 'opencode/child-session': { id: 'ses_child', parentID: sessionId, depth: 1 } } });
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'ses_child:call_1', status: 'failed', _meta: { 'opencode/child-session': { id: 'ses_child', parentID: sessionId, depth: 1 } } });
      text('Parent reply.');
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    case 'retry':
      update(sessionId, { sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': { attempt: 1, nextRetryAt: '2026-10-02T12:00:05.000Z', error: { type: 'provider.rate-limit', message: 'Rate limit exceeded', status: 429 } } } });
      update(sessionId, { sessionUpdate: 'session_info_update', _meta: { 'opencode/retry': null } });
      text('Done after a retry.');
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    case 'auth-required':
      activePrompt = null;
      return send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Authentication required' } });
    case 'refusal':
      return finishPrompt(id, { stopReason: 'refusal' });
    case 'max-tokens':
      text('Steps 1-2 done, ');
      return finishPrompt(id, { stopReason: 'max_tokens', usage });
    case 'max-tokens-empty':
      return finishPrompt(id, { stopReason: 'max_tokens' });
    case 'empty-reply':
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    case 'crash':
      process.stderr.write('panic: provider exploded\n');
      process.exit(1);
      break;
    case 'grandchild-hang': {
      const gc = spawn('sleep', ['30'], { stdio: 'ignore' });
      extra.grandchildPid = gc.pid;
      record();
      text('Working...');
      return undefined;
    }
    case 'hang':
    case 'hang-hard':
    case 'ignore-term':
      text('Working...');
      return undefined;
    default:
      text('Looking at the code.');
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'read src/a.ts', kind: 'read', status: 'pending' });
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed' });
      text('Done: ');
      text('all good.');
      update(sessionId, { sessionUpdate: 'usage_update', used: 150, size: 200000, cost: { amount: 0.012, currency: 'USD' } });
      return finishPrompt(id, { stopReason: 'end_turn', usage });
  }
  return undefined;
}

function handle(msg) {
  received.push(msg);
  record();
  if (msg.id !== undefined && !msg.method) {
    const resolve = pendingClient.get(msg.id);
    if (resolve) { pendingClient.delete(msg.id); resolve(msg.result ?? msg.error); }
    return;
  }
  const { id, method, params } = msg;
  const ok = (result) => send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      if (mode === 'init-hang') return undefined;
      return ok({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { close: {}, delete: {}, resume: {}, list: {} } },
        authMethods: [{ id: 'opencode-login', name: 'Login with opencode' }],
        agentInfo: { name: 'OpenCode', version: '2.2.5' },
      });
    case 'session/new': {
      if (!String(params?.cwd || '').startsWith('/')) return fail(-32602, 'cwd must be absolute');
      const sid = `ses_fake${sessions.size + 1}`;
      const st = newState();
      sessions.set(sid, st);
      ok({ sessionId: sid, configOptions: configOptions(st) });
      return update(sid, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact the session' }] });
    }
    case 'session/resume': {
      if (mode === 'resume-fails') return fail(-32602, `session ${params?.sessionId} not found`);
      const st = newState();
      sessions.set(params.sessionId, st);
      return ok({ configOptions: configOptions(st) });
    }
    case 'session/set_config_option': {
      const st = sessions.get(params.sessionId);
      if (!st) return fail(-32602, 'unknown session');
      if (params.configId === 'model') {
        if (mode !== 'sticky-model') { st.model = params.value; st.effort = 'default'; }
      } else if (params.configId === 'effort') st.effort = params.value;
      else if (params.configId === 'mode') st.mode = params.value;
      else return fail(-32602, `unknown config ${params.configId}`);
      return ok({ configOptions: configOptions(st) });
    }
    case 'session/prompt':
      if (activePrompt) return fail(-32603, 'a prompt is already active');
      return runPrompt(id, params.sessionId);
    case 'session/cancel':
      if (activePrompt && mode === 'hang') finishPrompt(activePrompt.id, { stopReason: 'cancelled' });
      return undefined;
    case 'session/close':
    case 'session/delete':
      return ok({});
    default:
      if (id !== undefined) return fail(-32601, `Method not found: ${method}`);
      return undefined;
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => {
  if (!['hang-hard', 'ignore-term', 'grandchild-hang'].includes(mode)) process.exit(0);
});
setInterval(() => {}, 1000);
