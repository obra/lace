# Model-call correlation

The conversation runner and one-shot query boundary create one `modelCallId` per
provider invocation and write `model.call` to the existing logger with any
available `sessionId` and `turnId`. Provider retries retain that ID. Compaction
queries use their owning session and, when available, turn. Manual compaction
does not invent a turn. These fields are diagnostics, not durable runtime state.

`RequestOptions.correlation` reaches the Anthropic adapter as per-request
headers on the SDK's effective HTTP loopback `/anthropic/<upstream>` base URL.
Other routes receive no internal headers. `X-Lace-Session-Id`, `X-Lace-Turn-Id`
and `X-Lace-Model-Call-Id` are intended for a compatible proxy that strips them
before forwarding and stores them as capture metadata. The adapter does not
change provider selection, messages, cached client defaults, timeouts or
retries.

At child prompt completion, `job.subagent.turn` records the invoking parent's
session, optional origin turn, job ID, child session and valid returned child
turn. Repeated resumes remain distinct through their job and turn IDs. Parent
identity is captured before awaiting the child. A missing/malformed returned ID
produces no association; no ID is guessed and no RPC is repeated for it.

Added diagnostic write failures are ignored without changing model or job
outcomes. Existing runtime/security error handling is unchanged. Direct-provider
calls and child prompts without a returned turn remain correlation gaps.
