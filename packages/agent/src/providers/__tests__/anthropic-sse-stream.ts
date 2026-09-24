// ABOUTME: Test helper: writes a minimal Anthropic Messages SSE stream that the SDK's
// ABOUTME: messages.stream() consumes to completion, for local fake-API servers in tests.

import type { ServerResponse } from 'node:http';

// Build and write a minimal SSE stream that the Anthropic SDK can fully consume.
// The SDK's messages.stream() requires: message_start → content_block_start →
// content_block_delta → content_block_stop → message_delta → message_stop.
export function writeSseStream(res: ServerResponse, model = 'claude-sonnet-4-20250514'): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_smoke_stream',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });

  send('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });

  send('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'ok' },
  });

  send('content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });

  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  });

  send('message_stop', { type: 'message_stop' });

  res.end();
}
