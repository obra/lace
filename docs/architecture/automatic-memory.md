# Configured automatic memory

A trusted host can opt Lace into background extraction with the optional
`initialize.memory` parameter. The host acquires its instance runtime lock,
claims the authority generation and configures role grants before initializing
Lace. Lace opens the existing database with `create=false`; it never claims a
second owner or recreates a missing authority.

```ts
memory: {
  databasePath: '/service/state/memory.sqlite',
  binding, // HostMemoryBinding issued by the current boot owner
  extraction: { connectionId: 'balanced', modelId: 'configured-model' },
  documentSources: {
    gitRoot: '/service/instance',
    paths: ['journal', 'knowledge'],
    extensions: ['.md'], // Optional positive suffix allowlist
  },
}
```

`extraction` and `documentSources` are optional and root-only. Document paths
are literal relative files or directories within the host-visible Git repository
root. Optional `extensions` restricts discovered files to the listed literal,
case-sensitive suffixes; `['.md']` admits new Markdown entries while excluding
sibling generated caches. Each suffix is a dot followed by letters or digits,
and an explicit list must be nonempty. Omitting this field preserves admission
of all regular files beneath the literal roots. This selects originals during
discovery; it does not introduce glob syntax or change snapshotting. The root
must be a real repository root. Child Lace processes run on the host too; their
fresh initialization includes only the database path and a newly derived
non-root binding. It omits extraction and document settings.

Derived notes are ordinary instance-wide memory: reads require current
`canRead`, acceptance requires current `canMutate`. Writable document collection
grants do not select or gate their destination. Selecting the root persona in a
child does not transfer root mutation rights. Bindings, generation and grants
stay outside persisted session configuration and model requests. Memory-bearing
sessions store only top-level `SessionState.memoryInstanceId`; opening, forking,
clearing or prompting one checks the configured instance and current authority.
An unconfigured process cannot resume a session that already has this affinity.

## Originals and discovery

One worker belongs to the server lifetime. Startup, a local durable append and a
30-second maintenance tick coalesce into its wake loop. At most one extraction
request is active. Maintenance observes writes from child processes and
committed Git changes after the final foreground turn. Extraction does not run
as a foreground turn and has no elapsed-time failure deadline.

The worker enumerates the existing transcript layouts, reads newly appended
complete lines in bounded pages and yields between pages. Durable file cursors
avoid rereading unchanged transcripts at every wake. Event/session identities
and source-content versions provide coverage; recall index row IDs do not. The
recall index and journal remain independently rebuildable discovery caches, and
their write failures do not suppress retained-file discovery.

Primary event input covers prompts, assistant messages, context injections and
completed tool results. It excludes compaction summaries and `recall` tool
output. This prevents direct derived-note self-feed; it cannot universally
identify an assistant echo of a past note. Spilled tool text is read from its
complete sidecar within the source limit, rather than the reader's default
200-line head. The original reader checks the opened descriptor's size and reads
at most the budget plus one sentinel byte before decoding, so oversize or
growing spills are rejected without reading the whole file. Missing sidecars,
unsupported content, oversized input and partial transcript lines remain
unavailable, omitted or unprocessed; they are never successful empty
extractions. Canonical Ent image blocks are normalized to provider-native blocks
for extraction. Images retain base64 bytes and PNG/JPEG/GIF/WebP media types
when the configured catalog model declares attachment support. Other image
coverage is explicitly omitted.

For documents, discovery pins Git HEAD once, enumerates only configured paths
and reads immutable blobs. First discovery uses the current committed tree;
later discoveries offer changed blob versions. Uncommitted edits await the
host's existing snapshotter. Lace does not commit files, walk all Git history,
replace journal/knowledge writers or create a second source archive. Durable
references retain event coordinates or Git commit/blob/path identities, not
copies of original payloads. Current document heads and deletions are tracked
separately from extraction completion.

## Model proposals and acceptance

A separately owned `oneShotQuery` provider receives originals and up to 16
current candidate notes. Candidate prose is reconciliation context, never
independent factual support. When a note is offered for revision, its supporting
originals are offered too, including immutable older document versions marked
superseded or missing from the current tree. A proposal may support new claims
only with current supplied originals. A source handle identifies its exact
source version.

Related-note selection searches current heads across all note ages with the
local EmbeddingGemma 2 text encoder. Notes have disposable vectors in the same
database, keyed by exact note revision and encoder/preprocessing generation. New
original text ranks current prose by semantic similarity alone. There is no
identifier promotion or recency boost. Runtime reads local model assets only.
Missing or failed assets produce a recorded `text-only` fallback using safely
quoted literal OR terms against note FTS; that fallback is not semantic
retrieval.

Install the fixed public q8 text assets explicitly with
`npm run memory:setup-model`. The default directory is
`<LACE_DIR>/models/embeddinggemma-2-ONNX`; a host can set
`LACE_MEMORY_MODEL_DIR` to a shared model directory containing `config.json`,
tokenizer files and `onnx/model_quantized.onnx` plus its data file. Setup
downloads only the pinned revision and verifies exact sizes and SHA-256 hashes.
Runtime verifies local assets and loads one lazy process-wide text model, with
vision and audio disabled, 2 intra-op / 1 inter-op CPU threads, serialized
batches of four, and the projected normalized 768-dimensional
`sentence_embedding`. The 512-token encoder window preserves BOS/content/EOS;
the extractor still receives complete admitted originals. This bounded window
and the 16-candidate union cannot ensure complete contradiction coverage.
Missing-model initialization is not retried on every worker wake.

Each admitted fresh original gets related-note reconciliation before further
fresh originals consume support capacity. A batch splits when needed. Candidate
support is admitted atomically: unavailable or oversized support leaves no
partial capacity consumption. Offers retain candidate IDs and reasons for
unavailable, budget-limited or unexamined candidates, as well as text-fallback
reasons. Only fresh originals actually supplied in an extraction become
completed.

The extraction instructions require preserving dates, attribution, distinct
people/scopes, material transition history and uncertainty. A departure can make
a former assignment unsafe without naming a successor. Ingestion order is not
fact time. Retained event `recordedAt` is separate metadata for prompts,
messages, context injections and completed tools; adding it does not change
source hashes or authenticate the author or a claim's effective date. Existing
strict proposal and acceptance checks remain in force.

The only proposal shape is:

```json
{
  "changes": [
    {
      "text": "Attributed fact, with qualifications.",
      "sourceIds": ["exact offered source/version handle"],
      "target": { "noteId": "offered current note", "revision": 1 }
    }
  ]
}
```

`target` is optional for creation. Lace supplies note IDs, work IDs and trusted
producer attribution. An empty `changes` array completes only offered primary
input. Each request has at most 16 supplied sources, 16 candidate notes and 16
changes; aggregate original text is capped at 64 KiB and image data at 4 MiB.
Output is capped at 64 KiB, 16,384 tokens and 4,096 characters per accepted
note. The request states which otherwise considered inputs were withheld by
coverage or budget limits. One format repair is allowed. Incomplete,
tool-calling, refused, oversized or provider-failed output is a failed attempt,
never empty success; terminal failures are not retried on each maintenance tick.

The authority database owns current heads, immutable revision receipts,
immutable offered-work manifests, completion/failure receipts and source
coverage. Acceptance updates note heads, revisions, same-database FTS and
primary completion atomically. It rechecks current grants, owner generation,
worker attempt, offered source versions and candidate revisions. Document heads
and retained input are verified again at acceptance. Restart can resume
unfinished work; completed source versions are not submitted again. Removing the
note FTS projection allows a configured writable root to rebuild it from current
heads.

Shutdown fences the runtime before aborting its request, removing wake hooks and
closing its database. A provider that ignores abort cannot write a late result
or indefinitely hold database shutdown. The one-shot primitive owns provider
cleanup when its call settles.

## Recall and limits of evidence

Existing transcript `search`, `read` and `thread` retain their shape and limits.
Configured `search` additionally returns a `memories` group, capped at 16 and
the requested search limit, with `memory:<id>` handles, revision, preview,
extraction producer and current support status. Transcript filters apply to
transcript hits; derived notes are instance-wide and are not filtered as
transcript events. `read` on a memory handle reads the current note head
directly and returns its supporting references with current, superseded, missing
or unavailable status. It never silently substitutes a new original version. All
three transcript actions attach compact `current_accounts` to any original that
directly supported a retained note revision. The lookup joins those existing
revision source references to current heads: event session/sequence identities
must match exactly, and document identities include the exact source version.
Shared originals keep every linked current head, deduplicated by note ID within
each event group. Links are not followed recursively.

An attachment includes note ID/revision/prose, producer attribution and usable
support handles. Event handles are `<sessionId>:<eventSeq>` for ordinary
`recall(read)` expansion; pinned document handles retain the exact document
version; document handles identify committed support and are not accepted as
`recall(read)` event handles. Automatic original/document retrieval remains
separate. Internal byte offsets, locator paths and content hashes remain in
validated storage rather than being repeated in attached model-visible groups.
Attachments share a 64 KiB budget per recall result. If a required account lacks
current readable support, changes during awaited reads, or exceeds the
attachment bound, the entire affected original group is omitted with an explicit
reason. Read context and thread events use the same guard as search hits.
Current authority and source support are revalidated after asynchronous reads.
Unconfigured transcript recall is unchanged, including its public limits,
filtering, ordering and chronology.

A derived memory is model-authored synthesis with attributed support, not
independently verified truth. No automatic prompt insertion, experimental
identifier ranking, new manual memory tool, correction/forget protocol or source
archive is included. Procedures continue to use skills. Sen integration and
production enablement require their own host configuration and validation.
Controlled behavior tests demonstrate durability and permission contracts;
useful model extraction and source faithfulness still require a separate
real-model sample.
