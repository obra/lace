# Automatic extraction and derived recall

Jesse selected automatic extraction and automatic remembering first, with
**derived memories available through existing recall**. The existing journal and
knowledge writers remain in charge of their documents. New manual
`remember`/`memory_read` tools and a new source archive are out of scope.

## Product behavior

When a trusted host opts into memory, one background worker reads retained
transcript events and configured, committed journal/knowledge documents,
extracts useful attributed facts and persists accepted derived memories. The
foreground agent can find and read them through `recall` after restart. The
foreground agent need not remember to invoke a new writing tool.

An extracted fact is model-authored synthesis with support, not independently
verified truth. Preserve attribution, qualifications and uncertainty. Existing
memories are offered as reconciliation context; rereading one is not new
independent evidence. The initial writer can create and revise derived notes. It
does not infer authenticated human forget/correction directives from role labels
or prose. That broader protocol needs trusted provenance absent on main.

## Approaches and decision

1. **Selected:** use the existing memory authority database for derived notes
   and expose them through recall. Journal, knowledge and transcripts remain
   originals in their current stores. This preserves the automatic-memory
   ownership model without a duplicate manual interface.
2. Update knowledge files through the existing librarian instead. This would
   share its editing surface but change the generated-output owner and require
   reconciliation with ordinary file edits. Jesse did not select this option.

There is no dual write. The landed authority currently contains identity and
permissions only; note/work storage is necessary new code, not already shipped
functionality. No existing journal or knowledge tools are retired.

## Trusted configuration and ownership

Add one optional top-level `initialize.memory` field:

```ts
{
  databasePath: string;
  binding: HostMemoryBinding;
  extraction?: { connectionId: string; modelId: string };
  documentSources?: { gitRoot: string; paths: string[] };
}
```

The host holds its existing instance lock and claims/configures the authority
before initialization. Lace opens it with `create=false`; it never claims a
competing owner or silently recreates a missing authority. Only a root binding
may configure extraction/document discovery. Delegates receive the database path
and a freshly derived non-root binding, not extraction configuration. Check
current authority at writes and reads; an old provider result cannot commit
after owner, grants, source versions or its active attempt changed.

Keep binding/grants out of session configuration and model input. Persist only
instance affinity in memory-bearing sessions. New/load/resume/fork/clear and
persona changes must preserve/check affinity and avoid inheriting root rights
merely by selecting the root persona. Ordinary unconfigured sessions retain
their current behavior. Source material never supplies authority.

## One worker and existing originals

Current main has startup recall backfill, not a recurring maintenance service.
Add one small worker under the existing server lifetime. It coalesces startup,
local append and a 30-second maintenance wake. At most one inference request is
active. The tick discovers child-process writes and a Git snapshot committed
after the final foreground turn; it never starts an overlapping request. It is
not a new general job scheduler and adds no extraction/offer RPC.

Discover events through existing transcript/index code, verifying actual
retained events before acceptance. The recall journal is a derived discovery
cache; a row ID is not the durable processed identity. Rebuild/catch-up must not
duplicate already processed sources or turn an index-write failure into evidence
that no source exists. Do not rescan the entire corpus on every wake. Yield
between bounded discovery pages and reuse existing backfill behavior where
appropriate.

Use existing session/event/block and full tool-result sidecar identities. Read
full saved text when needed, not the sidecar reader's default 200-line excerpt.
Missing/truncated input remains explicitly unprocessed or omitted. Preserve
native image bytes and known media types when the configured model supports
them; otherwise record unsupported input, without inventing image contents.
Exclude `recall` tool output from fresh primary input so generated notes cannot
directly feed themselves. Do not claim universal detection of assistant echoes.

For documents, resolve Git HEAD once, enumerate only configured relative paths,
then read immutable blobs from that pinned version. First discovery uses the
current committed tree; later discovery processes changed versions. Keep current
heads/deletions separately from processed coverage so a held request cannot
accept a replaced version and old document-supported notes are not presented as
current. Uncommitted file edits await the existing snapshotter. Do not create
snapshots, crawl every historical Git revision, duplicate blobs or archive logs.

## Accepted notes and model calls

Keep a small current-note/revision store, durable extraction progress and
current document heads in the same authority database. A revision contains its
actual supporting references and trusted extraction producer. Immutable work
identifies its offered sources and extraction version. Atomically accept
revisions and completion; replay returns the prior outcome rather than
duplicating notes. Revision checks prevent late proposals overwriting newer
accepted work.

Source links identify real supplied content. Never accept invented source IDs.
For a replacement, offer the old supporting originals when retaining their
claims; candidate prose by itself is not factual support. There is no relation
graph, cross-document publication protocol or speculative consolidation engine.
Derived-note FTS may live in this same database, transactionally maintained with
the current heads; this avoids a second projection owner. It is rebuildable.

Reuse `oneShotQuery` and the current provider registry. Its exclusively owned
provider may set the system prompt and `config.maxTokens`. Add returned terminal
metadata so extraction rejects unfinished or tool-calling responses even when
their text parses. Preserve all existing callers. No provider-factory redesign.

Use named finite limits: at most 16 primary sources, 16 candidate notes and 16
proposed changes per request; 64 KiB source text, 4 MiB image data, 64 KiB
response text, 16,384 output tokens and 4,096 characters per accepted note.
State which inputs were withheld. One format repair is allowed; provider failure
is not an empty successful batch. Do not retry terminal failures every tick. No
elapsed-time failure deadline: background routes have no SLA. Shutdown
invalidates the active attempt, aborts the request and closes owned resources.

## Recall and compatibility boundary

Preserve existing transcript search/read/thread behavior. Memory search is an
additional bounded result group with a distinct `memory:<id>` read handle.
`recall(action:"read", event_id:"memory:<id>")` reads the current note,
revision, attribution and source references. Query current heads directly; do
not walk all revisions for an ordinary read. Recheck authority/current source
state when hydrating a hit. Explain missing or superseded support explicitly.

No automatic prompt insertion, embeddings, ranking experiments or manual memory
tools are required for this landing. Procedures continue to use skills. The full
project's correction/forget and multimodal delivery requirements are not
declared complete by this limited automatic path.

## Delivery and evidence

Land Lace's configured automatic path first, then connect Sen's existing boot
owner to it with opt-in configuration. Sen must preserve journal, knowledge,
skills and its snapshotter; root/child processes share the service filesystem
namespace, separate from tool containers. Production enablement is separate.

Use real SQLite/filesystem and paired-RPC behavior tests with controlled model
responses for restart/replay, accepted revisions, source change during
inference, empty/error/omitted outcomes, authorization, child behavior,
cancellation and later recall. Test completed provider output/cleanup and native
image mappings. These establish behavior, not model quality. A
source-faithfulness sample and later main comparison must separately establish
useful extraction. No broad campaign or periodic Codex automation is restarted.

Sol implements each landing; two independent Sol reviews examine its actual
diff. Run focused offline checks with one worker, then full CI once. Keep
evidence, evergreen docs and limitations accurate. Do not copy the frozen
candidate wholesale or rewrite unrelated runtime behavior.
