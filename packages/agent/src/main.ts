import { createNdjsonStdioTransport, JsonRpcPeer } from '@lace/ent-protocol';
import { createAgentServerState, registerAgentRpcMethods } from './server';

const state = createAgentServerState();
const transport = createNdjsonStdioTransport({ readable: process.stdin, writable: process.stdout });
const peer = new JsonRpcPeer(transport, { idPrefix: 'a_' });
registerAgentRpcMethods(peer, state);

process.on('SIGINT', () => peer.close());
process.on('SIGTERM', () => peer.close());
