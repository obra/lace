import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

let configured = false;
let connectionId = 'conn_1';
let modelId = 'gpt-test';

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, message, code = 0, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '1.0',
      agentInfo: { name: 'fake-agent-configure', version: '0.0.0' },
      capabilities: { streaming: true, tools: [] },
    });
    return;
  }

  if (method === 'session/new') {
    respond(id, { sessionId: 'sess_test', created: new Date().toISOString() });
    return;
  }

  if (method === 'session/prompt') {
    if (!configured) {
      error(id, 'Missing provider configuration: connectionId and modelId are required');
      return;
    }
    notify('session/update', {
      sessionId: 'sess_test',
      streamSeq: 1,
      turnId: 'turn_test',
      turnSeq: 1,
      type: 'text_delta',
      text: 'ok',
    });
    respond(id, {
      turnId: 'turn_test',
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    return;
  }

  if (method === 'ent/connections/list') {
    respond(id, { connections: [] });
    return;
  }

  if (method === 'ent/providers/list') {
    respond(id, {
      providers: [
        {
          providerId: 'openai',
          displayName: 'OpenAI',
          supportsConnections: true,
          supportsCatalogRefresh: false,
        },
      ],
    });
    return;
  }

  if (method === 'ent/connections/upsert') {
    respond(id, { connectionId, providerId: params?.providerId ?? 'openai', created: true });
    return;
  }

  if (method === 'ent/connections/credentials/start') {
    respond(id, {
      kind: 'needs_input',
      fields: [{ name: 'apiKey', label: 'API Key', secret: true }],
    });
    return;
  }

  if (method === 'ent/connections/credentials/submit') {
    respond(id, { ok: true });
    return;
  }

  if (method === 'ent/models/list') {
    respond(id, {
      providerId: 'openai',
      connectionId,
      models: [{ providerId: 'openai', modelId }],
    });
    return;
  }

  if (method === 'ent/session/configure') {
    configured = true;
    respond(id, {
      applied: ['connectionId', 'modelId'],
      config: { connectionId, modelId, approvalMode: 'ask' },
    });
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
  if (msg && msg.method && msg.id !== undefined) handleRequest(msg);
});

