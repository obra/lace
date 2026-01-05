import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function handleRequest(msg) {
  const { id, method } = msg;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '1.0',
      agentInfo: { name: 'fake-agent-streaming', version: '0.0.0' },
      capabilities: { streaming: true, tools: [] },
    });
    return;
  }

  if (method === 'session/new') {
    respond(id, { sessionId: 'sess_test', created: new Date().toISOString() });
    return;
  }

  if (method === 'session/prompt') {
    const sessionId = 'sess_test';
    const turnId = 'turn_test';
    notify('session/update', { sessionId, streamSeq: 1, turnId, turnSeq: 1, type: 'text_delta', text: 'Hello' });
    setTimeout(() => {
      notify('session/update', {
        sessionId,
        streamSeq: 2,
        turnId,
        turnSeq: 2,
        type: 'text_delta',
        text: ' world!',
      });
      notify('session/update', {
        sessionId,
        streamSeq: 3,
        turnId,
        turnSeq: 3,
        type: 'turn_end',
        data: { stopReason: 'end_turn' },
      });
      respond(id, {
        turnId,
        stopReason: 'end_turn',
        content: [{ type: 'text', text: 'Hello world!' }],
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    }, 20);
    return;
  }

  respond(id, null);
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
  }
});
