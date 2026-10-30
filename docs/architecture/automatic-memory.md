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
  },
}
```

`extraction` and `documentSources` are optional and root-only. Document paths
are literal relative files or directories within the host-visible Git repository
root. The root must be a real repository root. Child Lace processes run on the
host too; their fresh initialization includes only the database path and a newly
derived non-root binding. It omits extraction and document settings.

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
or unavailable status. It never silently substitutes a new original version.
Both operations check current read authority and apply recall redaction.
`thread` is unchanged.

A derived memory is model-authored synthesis with attributed support, not
independently verified truth. No automatic prompt insertion, embeddings, ranking
experiments, new manual memory tool, correction/forget protocol or source
archive is included. Procedures continue to use skills. Sen integration and
production enablement require their own host configuration and validation.
Controlled behavior tests demonstrate durability and permission contracts;
useful model extraction and source faithfulness still require a separate
real-model sample.
