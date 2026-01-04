import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function request(id, method, params) {
  send({ jsonrpc: '2.0', id, method, params });
}

let pendingPromptId = null;
let awaitingUpdateAcks = 0;

function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '1.0',
      agentInfo: { name: 'fake-agent-session-update-request', version: '0.0.0' },
      capabilities: { streaming: true, tools: [] },
    });
    return;
  }

  if (method === 'session/new') {
    respond(id, { sessionId: 'sess_test', created: new Date().toISOString() });
    return;
  }

  if (method === 'session/prompt') {
    pendingPromptId = id;
    const sessionId = 'sess_test';
    const turnId = 'turn_test';

    awaitingUpdateAcks = 2;
    request('u_1', 'session/update', { sessionId, turnId, turnSeq: 1, streamSeq: 1, type: 'text_delta', text: 'Hello world!' });
    request('u_2', 'session/update', { sessionId, turnId, turnSeq: 2, streamSeq: 2, type: 'turn_end', data: { stopReason: 'end_turn' } });
    return;
  }

  respond(id, null);
}

function handleResponse(msg) {
  if (msg.id === 'u_1' || msg.id === 'u_2') {
    awaitingUpdateAcks -= 1;
    if (awaitingUpdateAcks === 0 && pendingPromptId) {
      respond(pendingPromptId, {
        turnId: 'turn_test',
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'Hello world!' }],
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      pendingPromptId = null;
    }
  }
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

