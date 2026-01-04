import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from './server';

const state = createAgentServerState();
const transport = createNdjsonStdioTransport({ readable: process.stdin, writable: process.stdout });
const peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
registerAgentRpcMethods(peer, state);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  peer.close();
  await state.mcpServerManager.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());
