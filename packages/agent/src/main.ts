import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from './server.js';

const state = createAgentServerState();
const transport = createNdjsonStdioTransport({ readable: process.stdin, writable: process.stdout });
const peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
registerAgentRpcMethods(peer, state);

const shutdown = () => {
  peer.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
