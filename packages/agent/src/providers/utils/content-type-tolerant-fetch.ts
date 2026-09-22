// ABOUTME: Fetch wrapper that tolerates a mislabeled non-streaming JSON body
// ABOUTME: on Responses-API-compatible gateways (LunaRoute-class Content-Type bug)

/**
 * Wraps `fetch` to tolerate a specific gateway bug seen on LunaRoute-class
 * Responses-API-compatible endpoints: every `/v1/responses` reply is labeled
 * `Content-Type: text/event-stream`, even for a genuinely non-streaming
 * (`stream: false`) request.
 *
 * The OpenAI SDK's response parser picks JSON-vs-text purely from that header
 * (see `openai/internal/parse.js` `defaultParseResponse`): a mislabeled
 * non-streaming JSON body gets treated as opaque text, and the SDK's own
 * `Responses.create()` discriminator check (`'object' in rsp`) then throws a
 * `TypeError` because `rsp` is a string, not an object -- `in` requires an
 * object operand.
 *
 * That's the gateway's bug, not something to route around by weakening a
 * check elsewhere in the SDK we don't control. But `fetch` is a first-class,
 * documented `ClientOptions` extension point (see `openai/client.d.ts`), so
 * this corrects the one header the SDK actually inspects -- and only when
 * every one of these holds, each independently sufficient to prove the body
 * cannot be a real event stream:
 *
 *   - the outgoing request body says `stream` is not `true`, so we are never
 *     buffering a request the caller actually asked to stream (a real
 *     streaming reply is never sniffed, whatever its header says);
 *   - the response Content-Type claims an event-stream;
 *   - the full response body parses cleanly as a single JSON document. A real
 *     SSE stream's concatenated frames are `data: {...}\n\ndata: {...}\n\n`
 *     -- not valid top-level JSON -- so this can only succeed on a body that
 *     was never actually SSE-framed.
 *
 * Any response that fails one of those checks is returned completely
 * untouched (mislabeled-but-unparseable bodies, real errors, real streams),
 * so this can only ever add a success path, never remove one.
 */
// Matches the `Fetch` type OpenAI's SDK actually accepts for `ClientOptions.fetch`
// (see `openai/internal/builtin-types.d.ts`) -- deliberately narrower than
// `typeof fetch`, whose DOM/undici lib type also requires static members like
// `preconnect` that a plain wrapper function doesn't (and needn't) implement.
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createContentTypeTolerantFetch(realFetch: FetchLike = fetch): FetchLike {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await realFetch(input, init);

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/event-stream')) {
      return response;
    }
    if (requestedStreaming(init)) {
      return response;
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Mislabeled AND not JSON either -- not a shape we understand. Return
      // the original (broken) behavior unchanged rather than guess further.
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(parsed), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function requestedStreaming(init?: RequestInit): boolean {
  const body = init?.body;
  if (typeof body !== 'string') return false;
  try {
    const parsedBody = JSON.parse(body) as { stream?: unknown };
    return parsedBody.stream === true;
  } catch {
    return false;
  }
}
