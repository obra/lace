import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

let nextSessionId = 'sess_test';
let pendingPermission = null;

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function request(id, method, params) {
  send({ jsonrpc: '2.0', id, method, params });
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '1.0',
      agentInfo: { name: 'fake-agent', version: '0.0.0' },
      capabilities: { streaming: true, tools: [] },
    });
    return;
  }

  if (method === 'session/new') {
    respond(id, { sessionId: nextSessionId, created: new Date().toISOString() });
    return;
  }

  if (method === 'session/load') {
    respond(id, { sessionId: params?.sessionId, messageCount: 0, lastActive: new Date().toISOString() });
    return;
  }

  if (method === 'session/list') {
    respond(id, { sessions: [{ sessionId: nextSessionId, workDir: params?.workDir ?? '.', created: new Date().toISOString() }] });
    return;
  }

  if (method === 'session/cancel') {
    respond(id, null);
    return;
  }

  if (method === 'session/prompt') {
    const sessionId = nextSessionId;
    const turnId = 'turn_test';

    notify('session/update', {
      sessionId,
      streamSeq: 1,
      turnId,
      turnSeq: 1,
      type: 'tool_use',
      toolCallId: 'tool_1',
      name: 'shell.exec',
      kind: 'execute',
      input: { command: 'echo hi' },
      status: 'awaiting_permission',
    });

    pendingPermission = { promptRequestId: id, sessionId, turnId };
    request('a_1', 'session/request_permission', {
      sessionId,
      turnId,
      turnSeq: 1,
      toolCallId: 'tool_1',
      tool: 'shell.exec',
      kind: 'execute',
      resource: 'echo hi',
      options: [
        { optionId: 'allow', label: 'Allow' },
        { optionId: 'deny', label: 'Deny' },
      ],
    });

    return;
  }

  respond(id, null);
}

function handleResponse(msg) {
  if (!pendingPermission) return;
  if (msg.id !== 'a_1') return;

  const decision = msg?.result?.decision;
  if (decision !== 'allow') {
    notify('session/update', {
      sessionId: pendingPermission.sessionId,
      streamSeq: 2,
      turnId: pendingPermission.turnId,
      turnSeq: 2,
      type: 'tool_use',
      toolCallId: 'tool_1',
      name: 'shell.exec',
      kind: 'execute',
      input: { command: 'echo hi' },
      status: 'denied',
      result: { outcome: 'denied', content: [{ type: 'error', message: 'Denied' }] },
    });
    respond(pendingPermission.promptRequestId, { turnId: pendingPermission.turnId, stopReason: 'end_turn', content: [] });
    pendingPermission = null;
    return;
  }

  notify('session/update', {
    sessionId: pendingPermission.sessionId,
    streamSeq: 2,
    turnId: pendingPermission.turnId,
    turnSeq: 2,
    type: 'text_delta',
    text: 'ok',
  });

  respond(pendingPermission.promptRequestId, {
    turnId: pendingPermission.turnId,
    stopReason: 'end_turn',
    content: [{ type: 'text', text: 'ok' }],
    usage: { inputTokens: 0, outputTokens: 0 },
  });

  pendingPermission = null;
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg && msg.method && msg.id !== undefined) {
    handleRequest(msg);
    return;
  }
  if (msg && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    handleResponse(msg);
  }
});

