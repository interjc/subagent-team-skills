// Fake `agy` speaking ACP, used by tests (loaded through a generated executable
// shim). Shaped after agy 1.5.14 as observed on 2026-11-22: session modes
// default / accept-edits / auto / plan, config options model, thought_level and
// mode, session/resume and session/close; a denied permission ends the turn
// with no reply. `--version` prints $FAKE_AGY_VERSION (default 1.5.14), and
// `acp` reports it as agentInfo.version.
// Records { argv, cwd, pid, credentialEnv[], received[] } to $FAKE_RECORD after
// every message. Prompt behavior is chosen by $FAKE_MODE:
//   ok (default), edit-denied, quota, auth-prompt, pending-tool, empty-reply,
//   hang (answers session/cancel with stopReason cancelled), crash.
// Setup variations: auth-required (session/new fails), no-accept-edits,
// sticky-level, replay (session/resume replays an old reply), no-resume.
import fs from 'node:fs';

const writeAtomic = (file, text) => {
  fs.writeFileSync(`${file}.${process.pid}.tmp`, text);
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
};

const argv = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';
const version = process.env.FAKE_AGY_VERSION || '1.5.14';

if (argv[0] === '--version') {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}
if (argv[0] === 'acp' && argv.includes('--help')) {
  process.stdout.write('Usage: agy acp [flags]\n\nStart the Agent Client Protocol (ACP) stdio server\n');
  process.exit(0);
}
if (argv[0] !== 'acp') {
  process.stderr.write(`fake agy acp: unsupported ${argv.join(' ')}\n`);
  process.exit(9);
}

const CREDENTIAL_ENV = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT'];
const received = [];
const extra = {};
const record = () => {
  if (!process.env.FAKE_RECORD) return;
  writeAtomic(process.env.FAKE_RECORD, JSON.stringify({
    argv, cwd: process.cwd(), pid: process.pid, credentialEnv: CREDENTIAL_ENV.filter((k) => k in process.env), received, ...extra,
  }));
};
record();

const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const update = (sessionId, u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });

const MODELS = ['gemini-4-neon', 'gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.8-flash', 'claude-sonnet-5-5', 'gpt-oss-120b-medium'];
const LEVELS = ['low', 'medium', 'high', 'xhigh'];
const MODES = mode === 'no-accept-edits' ? ['default', 'plan'] : ['default', 'accept-edits', 'auto', 'plan'];
const sessions = new Map();

const newState = () => ({ model: 'gemini-4-neon', level: 'high', mode: 'default' });
const sel = (id, category, current, values) => ({ id, name: id, category, type: 'select', currentValue: current, options: values.map((v) => ({ value: v, name: v })) });
const configOptions = (st) => [
  sel('model', 'model', st.model, MODELS),
  ...(st.model === 'gpt-oss-120b-medium' ? [] : [sel('thought_level', 'thought_level', st.level, LEVELS)]),
  sel('mode', 'mode', st.mode, MODES),
];
const sessionBody = (sid, st) => ({
  sessionId: sid,
  modes: { currentModeId: st.mode, availableModes: MODES.map((id) => ({ id, name: id })) },
  configOptions: configOptions(st),
});

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
  const st = sessions.get(sessionId);
  extra.promptState = { ...st };
  record();
  const text = (t) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
  const usage = { inputTokens: 9764, outputTokens: 241, thoughtTokens: 99, totalTokens: 10005 };
  switch (mode) {
    case 'edit-denied': {
      const call = { toolCallId: 'call_1', name: 'write_file', kind: 'edit', title: 'File probe.txt', status: 'pending' };
      update(sessionId, { sessionUpdate: 'tool_call', ...call, status: 'in_progress' });
      const reply = await askClient('session/request_permission', {
        sessionId,
        toolCall: { sessionUpdate: 'tool_call', ...call },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'allow_always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
        ],
      });
      extra.permissionReply = reply;
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'failed' });
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    }
    case 'quota':
      activePrompt = null;
      return send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'RESOURCE_EXHAUSTED: You have exhausted your capacity on this model. Your quota will reset after 3h.' } });
    case 'auth-prompt':
      activePrompt = null;
      return send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Authentication required' } });
    case 'pending-tool':
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'bg_1', kind: 'execute', title: 'npm run dev', status: 'in_progress' });
      text('Started the dev server.');
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    case 'empty-reply':
      return finishPrompt(id, { stopReason: 'end_turn', usage });
    case 'crash':
      process.stderr.write('panic: language server exploded\n');
      process.exit(1);
      break;
    case 'hang':
      text('Working...');
      return undefined;
    default:
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking about it.' } });
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_1', kind: 'read', title: 'Read a.txt', status: 'in_progress' });
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed' });
      text('Done: ');
      text('all good.');
      update(sessionId, { sessionUpdate: 'usage_update', used: 10005, size: 1048576 });
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
    return undefined;
  }
  const { id, method, params } = msg;
  const ok = (result) => send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: false, embeddedContext: true },
          sessionCapabilities: mode === 'no-resume' ? { close: {}, list: {} } : { resume: {}, close: {}, load: {}, list: {} },
          auth: { logout: {} },
          _meta: { antigravity: { tier: true, systemPrompt: { append: true } } },
        },
        agentInfo: { name: 'Antigravity ACP Server', version },
        authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }, { id: 'gemini-api-key', name: 'Gemini API key' }],
      });
    case 'session/new': {
      if (mode === 'auth-required') return fail(-32000, 'Authentication required');
      if (!String(params?.cwd || '').startsWith('/')) return fail(-32602, 'cwd must be absolute');
      const sid = `sess-${sessions.size + 1}`;
      const st = newState();
      sessions.set(sid, st);
      return ok(sessionBody(sid, st));
    }
    case 'session/resume': {
      const st = newState();
      sessions.set(params.sessionId, st);
      if (mode === 'replay') update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD REPLY FROM HISTORY' } });
      return ok(sessionBody(params.sessionId, st));
    }
    case 'session/set_config_option': {
      const st = sessions.get(params.sessionId);
      if (!st) return fail(-32602, 'unknown session');
      if (params.configId === 'model') st.model = params.value;
      else if (params.configId === 'thought_level') { if (mode !== 'sticky-level') st.level = params.value; }
      else if (params.configId === 'mode') {
        if (!MODES.includes(params.value)) return fail(-32602, `unknown mode ${params.value}`);
        st.mode = params.value;
      } else return fail(-32602, `unknown config ${params.configId}`);
      return ok({ configOptions: configOptions(st) });
    }
    case 'session/set_mode': {
      const st = sessions.get(params.sessionId);
      if (!st) return fail(-32602, 'unknown session');
      st.mode = params.modeId;
      return ok({});
    }
    case 'session/prompt':
      if (activePrompt) return fail(-32603, 'a prompt is already active');
      return runPrompt(id, params.sessionId);
    case 'session/cancel':
      if (activePrompt && mode === 'hang') finishPrompt(activePrompt.id, { stopReason: 'cancelled' });
      return undefined;
    case 'session/close':
      return ok(null);
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
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
