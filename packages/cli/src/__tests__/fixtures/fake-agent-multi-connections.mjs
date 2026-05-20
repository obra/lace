import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

let connectionConfigured = false;
let modelConfigured = false;

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '1.0',
      agentInfo: { name: 'fake-agent-multi-connections', version: '0.0.0' },
      capabilities: { streaming: true, tools: [] },
    });
    return;
  }

  if (method === 'session/new') {
    respond(id, { sessionId: 'sess_test', created: new Date().toISOString() });
    return;
  }

  if (method === 'ent/connections/list') {
    respond(id, {
      connections: [
        {
          connectionId: 'openai-openai',
          providerId: 'openai',
          name: 'OpenAI',
          credentialState: 'ready',
        },
        { connectionId: 'groq-groq', providerId: 'groq', name: 'Groq', credentialState: 'ready' },
      ],
    });
    return;
  }

  if (method === 'ent/connections/credentials/start') {
    respond(id, { kind: 'ready' });
    return;
  }

  if (method === 'ent/models/list') {
    respond(id, {
      providerId: params?.connectionId?.includes('openai') ? 'openai' : 'groq',
      connectionId: params?.connectionId,
      models: [{ modelId: 'model_1' }, { modelId: 'model_2' }],
    });
    return;
  }

  if (method === 'ent/session/configure') {
    if (params?.modelId) {
      send({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: 'modelId must be configured via session/set_config_option',
        },
      });
      return;
    }
    connectionConfigured = true;
    respond(id, { applied: ['connectionId'], config: { connectionId: params?.connectionId } });
    return;
  }

  if (method === 'session/set_config_option') {
    if (params?.configId === 'model') {
      modelConfigured = true;
      respond(id, {
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: params.value,
            options: [{ value: params.value, name: params.value }],
          },
        ],
      });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown config option' } });
    return;
  }

  if (method === 'session/prompt') {
    if (!connectionConfigured || !modelConfigured) {
      send({
        jsonrpc: '2.0',
        id,
        error: {
          code: 0,
          message: 'Missing provider configuration: connectionId and modelId are required',
        },
      });
      return;
    }
    respond(id, {
      turnId: 'turn_test',
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { inputTokens: 0, outputTokens: 0 },
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
