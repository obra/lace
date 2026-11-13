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
  recall: {
    modelDirectory: '/service/state/models/embeddinggemma-2-ONNX',
    search: { url: 'http://127.0.0.1:6333', apiKeyFile: '/service/state/qdrant.key' },
  },
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
must be a real repository root. Child Lace processes also run on the host. Each
new, resumed or nested delegate receives the shared database path and a newly
derived non-root binding. The main agent owns extraction, document discovery and
automatic recall. Delegates can search and read the shared projections through
the explicit `recall` tool under their current role grants and tool permissions.

Derived notes are ordinary instance-wide memory: reads require current
`canRead`, acceptance requires current `canMutate`. Writable document collection
grants do not select or gate their destination. Selecting the root persona in a
child does not transfer root mutation rights. Bindings, generation and grants
stay outside persisted session configuration and model requests. Memory-bearing
sessions store only top-level `SessionState.memoryInstanceId`; opening, forking,
clearing or prompting one checks the configured instance and current authority.
An unconfigured process cannot resume a session that already has this affinity.

## Originals and discovery

Local discovery/indexing and one extraction worker belong to the server
lifetime. Startup, a local durable append and a 30-second maintenance tick
coalesce their work. Local discovery and passage indexing remain available while
extraction is disabled or waiting for its provider. At most one extraction
request is active. Maintenance observes writes from child processes and
committed Git changes after the final foreground turn. Extraction does not run
as a foreground turn and has no elapsed-time failure deadline.

The worker enumerates the existing transcript layouts, reads newly appended
complete lines in bounded pages and yields between pages. A moved retained-event
locator falls back to bounded line reads in the same shard order, then checks
the original content version. The fallback skips an oversized canonical record
only when its sequence identifies a different event and no later top-level key
overrides that identity. An oversized record that could be the first copy makes
the requested original unavailable. Durable file cursors avoid rereading
unchanged transcripts at every wake. Event/session identities and source-content
versions provide coverage; recall index row IDs do not. The recall index and
journal remain independently rebuildable discovery caches, and their write
failures do not suppress retained-file discovery.

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

Assistant message events with empty content arrays preserve model-response
boundaries but supply no extraction original. Discovery and loading skip them
before adding provenance headers, so they consume no extraction slot or request.

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
current candidate notes. The request identifies newly pending originals by
their exact handles in `primarySourceIds`. The instructions tell the extractor
to learn from those originals and use the other originals to reconcile offered
accounts. Unchanged support alone does not justify creating or revising an
account. Candidate prose is reconciliation context, never independent factual
support. When a note is offered for revision, its supporting
originals are offered too, including immutable older document versions marked
superseded or missing from the current tree. Accepted support must be exactly
offered with current or superseded status; missing, unavailable, unknown-status
and unoffered support is rejected. A revision may cite only historical originals
when they support its dated account. Fresh primary admission remains
current-only. A source handle identifies its exact source version.

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
One worker thread verifies local assets, loads the process-wide text model on
the first nonempty request, and runs tokenization and inference. The parent
schedules one batch of up to four at a time; waiting foreground queries take the
next slot. Cancelled queued batches are skipped, and cancellation during
inference discards the result after the batch finishes. Pending batches keep the
process alive; the idle encoder does not. Failed initialization or loss of the
worker leaves the encoder unavailable for the process lifetime. An individual
batch error leaves a healthy worker usable. The model runs with vision and audio
disabled and 2 intra-op / 1 inter-op CPU threads, returning the projected
normalized 768-dimensional `sentence_embedding`. The 512-token encoder window
preserves BOS/content/EOS; the extractor still receives complete admitted
originals. This bounded window and the 16-candidate union cannot ensure complete
contradiction coverage.

The extraction worker reads up to 128 pending originals at a time, most recently
discovered first. A newly discovered original can be selected on the next read;
it does not interrupt work already in progress. Older originals stay eligible,
though sustained arrivals can delay them.

Each admitted fresh original gets related-note reconciliation before further
fresh originals consume support capacity. A batch splits when needed. Candidate
support is admitted atomically: unavailable or oversized support leaves no
partial capacity consumption. Offers retain candidate IDs and reasons for
unavailable, budget-limited or unexamined candidates, as well as text-fallback
reasons. Only fresh originals actually supplied in an extraction become
completed.

The extraction instructions require preserving dates, attribution, distinct
people/scopes, material transition history and uncertainty. A departure can make
a former assignment unsafe without naming a successor. The latest applicable
decision, assignment or stated preference remains the latest known state until
evidence changes or ends it, respecting explicit end dates and scope. Missing
later confirmation, an older record arriving later, or a superseded source
version alone is not evidence of a change; state the latest known state without
adding a reconfirmation caveat. Genuine conflicts or unresolved applicability
retain uncertainty and competing accounts; latest known state does not imply
live verification. Ingestion order is not fact time. Retained event `recordedAt`
is separate metadata for prompts, messages, context injections and completed
tools; adding it does not change source hashes or authenticate the author or a
claim's effective date. Existing strict proposal and acceptance checks remain in
force.

The extraction prompt explains that its durable account will guide future
answers and actions, so reports, intentions and completed actions must remain
distinct. It explains revisions as a way for later readers to understand what
changed since an older original, and source references as the way to inspect a
note's basis. The format-repair instruction preserves supported meaning while
repairing the storage contract.

The extractor is instructed to name a speaker only when the supplied text or
metadata identifies them for that specific statement and to leave the speaker
unnamed when the only identity available is another message's sender, addressee
or parent message author. It is also instructed to preserve stated action
targets and scope. A successful tool result supports only the operation on its
recorded target. A message send records publication; it does not establish that
an action described in the message happened. Retained plans, work in progress
and reports of completion keep their attribution and status. Applicable
corrections and clarifications to an existing account belong in one supported
revision.

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
coverage. Acceptance updates note heads, revisions, same-database FTS, indexed
original-to-note links and primary completion atomically. It rechecks current
grants, owner generation, worker attempt, offered source identities, versions
and statuses, and candidate revisions. Document heads and retained input are
verified again at acceptance. These checks enforce provenance and authority;
they do not establish whether a model-authored claim applies to the present.
Restart can resume unfinished work; completed source versions are not submitted
again. Removing the note FTS projection allows a configured writable root to
rebuild it from current heads.

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
directly supported a retained note revision. A derived SQLite lookup indexes
those references by exact event session and sequence or document ID and version.
It keeps links from every revision and resolves the linked note IDs to their
current heads in note-ID order. A verified root builds the lookup from immutable
revisions in one transaction when it initializes an existing database, including
when its grant is read-only. Readers can use it after that commit. Shared
originals keep every linked current head, deduplicated by note ID within each
event group. Links are not followed recursively.

An attachment includes note ID/revision/prose, producer attribution and usable
support handles. Event handles are `<sessionId>:<eventSeq>` for ordinary
`recall(read)` expansion; pinned document handles retain the exact document
version; opaque `source:<digest>` handles identify exact admitted document
versions and expanded sidecar-backed originals through `recall(read)`. Arbitrary
paths cannot be used as handles. Historical source reads retain
current/superseded/missing/unavailable status and never substitute new bytes.
Internal byte offsets, locator paths and content hashes remain in validated
storage rather than being repeated in attached model-visible groups. Attachments
share a 64 KiB budget per recall result. Current accounts are the latest stored
summary revisions and help readers see what changed since older originals.
Readable pinned superseded document support remains attached with its actual
status as historical evidence. The tool description directs readers to interpret
decisions, assignments and preferences within their dates and scope, and use
live tools when the work requires a current observation.

If a required account lacks current or readable superseded document support,
changes during awaited reads, or exceeds the attachment bound, the entire
affected original group is omitted with an explicit reason. Read context and
thread events use the same guard as search hits. Current authority and source
support are revalidated after asynchronous reads. Unconfigured transcript recall
is unchanged, including its public limits, filtering, ordering and chronology.

Each revision retains its own original-source references. For a transcript,
these include the session ID and exact event sequence number, plus a file
locator. Combine the session and sequence as `<sessionId>:<eventSeq>` for
`recall({ action: 'read', event_id, context: 5, full: true })` to inspect the
source event and nearby conversation. This identifies an event, not an annotated
sentence within it. A foreground agent or a delegated reader can use the same
reference with its existing access. Document support instead pins the committed
path, commit and blob. A reference neither grants access nor guarantees that the
retained source is still available.

A derived memory is model-authored synthesis with attributed support, not
independently verified truth. No new manual memory tool, correction/forget
protocol or source archive is included. Procedures continue to use skills. Sen
integration and production enablement require their own host configuration and
validation. Controlled behavior tests demonstrate durability and permission
contracts; useful model extraction and source faithfulness still require a
separate real-model sample.

## Before-answer automatic recall

The independent optional `recall: { modelDirectory, search? }` configuration
enables the root agent to retrieve evidence before provider requests. It
defaults off. Omit `recall` to disable automatic retrieval and insertion.
Extraction is independently configured. Omitting `extraction` leaves recall
available, and omitting `recall` preserves extraction, explicit recall and
retained memory. Host configuration is applied at initialization;
restart/reinitialize with `recall` omitted and resume the session to disable it.
Selections belong to the runtime and session rather than persisted temporary
context, so disabled resumes do not reinstall prior automatic evidence. No
live-toggle API is provided. It does not require an extraction connection.
Configure document discovery on the root for committed originals even when
extraction is disabled. Missing or invalid pinned assets produce an explicit
text-only outcome; runtime never downloads weights. One process rejects
conflicting configured model directories. Trusted host configuration may supply
a loopback Qdrant URL and an optional API key file. The endpoint, model
directory, and key file stay in host configuration. Without a usable search
service, the root reports text-only recall and explicit memory tools remain
available. Child sessions retain scoped explicit readers and have no automatic
recall preparation.

Each memory index request asks Qdrant to close the connection after its
response. Publication and recall therefore leave no idle connections for a later
request to reuse after Qdrant's idle timeout.

Root initialization, durable event appends and the maintenance timer trigger
coalesced local maintenance. Foreground recall uses the available index coverage
without waiting for corpus catch-up. A running document embedding batch may
finish, and maintenance waits for active automatic recall to finish before
starting another passage or note embedding batch. Discovery and projection can
continue. Available index coverage remains explicit. The memory database holds
disposable source-versioned passages, their redacted coordinates and
encoder-generation vectors. Passages use a conservative 384-byte UTF-8 bound
within the 512-token encoder input. Existing transcript and note FTS nominate
covered text; the additional original FTS covers committed documents and
retained text absent from transcript FTS, including full sidecars. Root
maintenance reads missing projections and vectors in pages and checks the keyed
source or revision and host authority after awaited work before publication. A
writable root drains a durable SQLite identity queue into its owned Qdrant
collection, independently of model loading and local discovery. Existing vectors
seed in bounded pages with a checkpoint bound to the collection incarnation. The
wake drains newly queued changes after local projection and vector maintenance
settle. A Qdrant outage leaves work durable. Query preparation never creates or
waits for a collection. To restore an older SQLite backup, provision a fresh
owned derived collection and reseed.

Fresh recall reads coverage with SQLite aggregates. When semantic retrieval is
available, recall makes one approximate Qdrant Dot query for up to 128 passage
and current-note points at or above the semantic floor. The query uses
`exact: false` and `hnsw_ef: 1024`. Recall resolves those identities against
current SQLite metadata. Stale, already represented, or subsequently grouped
points consume shortlist slots. Useful evidence can fall outside the shortlist.

Recall requests exact scores by point ID for remaining text and identifier
candidates. Missing engine scores leave text candidates eligible. If projected
passages have no vectors in the active generation, recall ranks text by literal
overlap. An engine failure discards partial semantic ranks and reranks the
retained text matches. Neither path decodes stored vector JSON. Publication in
flight, queued work, and overlap between publication and preparation make
coverage partial.

Before expanding passages or requesting their scores, each text surface
(transcript events, retained originals, and note heads) nominates at most 128
distinct admitted source identities in ascending FTS5 BM25 rank, with rowid
breaking ties. It separately nominates up to 128 for safely quoted complete
identifiers from the incoming question, preserving each identifier as a phrase
instead of splitting its components into OR alternatives. The two routes share
the existing request-private match union. Duplicate and orphan FTS rows do not
consume the budget; ranked pages refill it. Notes require a current head, and
events and originals require an admitted source version with a passage, without
filtering by extraction status. An original identity includes its version; an
event identity can expand all its admitted versions. Final source currentness
and exact identifier validation still happen after nomination.

For retained originals, SQLite ranks a raw FTS page before checking source
admission for that page in the same statement. Recall skips rejected rows and
advances by the number of raw rows returned, including duplicates and rejected
rows, so later pages can fill the distinct-source allowance.

The limit bounds nominated sources, independently of transport page sizing; one
large source can still expand to many passages. This shortlist changes selection
from exhaustive text retrieval. The semantic route can discover evidence beyond
it, and the separate identifier route protects exact references from
ordinary-word competition, but neither route promises every matching source.
Ranking, grouping, and the 2,000-token allowance apply to the nominated union as
before.

FTS matches, nominated identities, sorted runs, and group aliases use
request-private SQLite scratch space on the memory database's state volume. The
host needs room for that scratch data. On POSIX hosts, Lace unlinks the file
before writing request data and holds it open only for that preparation. The
connection has a bounded page cache and closes on completion, cancellation, or
failure. Bounded fan-in merges preserve JavaScript locale ordering and SQLite
nomination order for equal native scores. Validation consumes nominated
candidates in order, with no further fixed cutoff before checking originals and
their required current accounts.

The `memory.recall.stages` debug event reports wall-clock times and aggregate
row or candidate counts for successful preparations. It records semantic query
count and duration separately from exact score batch count and duration. Run
merging is reported separately from validation, which consumes the final lazy
merge. Reused preparations report coverage and validation only.

The passage and current-vector counts can use metadata indexes, avoiding a scan
of vector-bearing rows. Passage vector maintenance seeks pending generations in
a SQLite index and reads up to four admitted passages at a time within each
generation. The writable root creates the coverage and generation indexes when
initializing a store that lacks them. A read-only store can still compute exact
coverage without them.

Transcript FTS hits join to admitted source versions by event identity.
Validation uses keyed admission reads and keeps only a bounded cache of source
text and account results. Groups that cannot fit all their required accounts are
omitted whole. After awaited source and account reads, Lace rechecks authority,
original admission and retained bytes, and the selected accounts' head revisions
and support before packing. Reuse reads aggregate coverage, reloads each
directly nominated account at its expected revision, and revalidates originals
and their indexed account links without encoding a query or searching the corpus
again.

A bounded query prioritizes incoming ordinary input and adds only a short
user/assistant conversational tail. Literal text alternatives are safely quoted
OR terms with stopwords removed. Complete quoted and code-shaped identifiers
from the incoming question grant one boolean preference; multiple matches do not
add boosts, and unmatched identifiers impose no constraint. Semantic evidence
must meet the fixed generation-specific floor, 0.8279641135636632. This
development-calibrated relevance threshold is not a probability or a guarantee
of useful answers. Textual nominations independently require an FTS match and
literal term overlap or a complete identifier match. Native Dot scores order
both methods' candidates. Text-only fallback remains observable, including empty
results. A note nomination ranks the note's own text without requiring any
supporting passage to be projected.

Candidate selection excludes cue events and passages actually present in
required history. An event represented only by a digest does not exclude its
full sidecar. Compaction records retained event identities; its watermark does
not establish presence. The boolean complete-identifier preference applies
before each method fills up to 24 shortlist slots with valid groups, with cosine
ordering inside each tier and refill after invalid or duplicate nominations. A
directly nominated account and a group that attaches it share a shortlist slot
when both qualify through the same method. The direct account remains eligible
for packing even when that method has filled its slots. Group merges preserve
identifier preference.

At equal identifier priority and score, originals precede directly nominated
accounts. Packing first attempts the first original and every required current
account, or a directly nominated account on its own.

The first fitting group containing an account wins; later groups that repeat it
are skipped whole. Packing admits at most six groups, then uses remaining room
for a ranked prefix of sibling passages. Bridging sources can still coalesce
originals that share accounts. Only current originals are selected. A directly
nominated account or an account linked to an original can retain readable
superseded document support with explicit status. An original and all directly
linked current accounts stay together. Reused selections are revalidated and
repacked for each request. The displayed redacted framing and JSON data count
against the 2,000 estimated tokens reserved for recall. Before each request with
an automatic recall cue, including after resume and tool results, the runner
estimates the messages, system prompt, tool definitions and current caller text
together with the full recall allowance and the model's requested output
allowance. If the estimate exceeds the window, the runner passes the space
available for history to compaction and rechecks the rebuilt request. An
unfinished paused response restarts from durable history after compaction.
Caller updates during retrieval are included in the check before submission.
Packing prioritizes group coverage before sibling expansion and keeps every
required current account together with its original. A complete unit that
exceeds the recall budget is omitted. If the strategy's retained tail and
summary still leave too little room for both allowances, the runner returns a
context-window stop.

Prompt and inject requests can carry retrieval-only
`recall: { query: string; context?: string }` alongside provider content. The
query is the current message body; context carries catch-up message bodies.
Explicitly empty queries remain empty. Without this object, ordinary content
text supplies the query. These bodies are persisted on the input event without
replacing provider content, represented originals, or their source identities.
The incoming query remains bounded to 2,400 characters.

The conversational retrieval tail is projected separately from provider history.
Each ordinary input contributes catch-up bodies before its current query;
completed assistant prose also contributes, including prose accompanying tool
calls. Internal continuations, tool payloads, compaction summaries and generated
operational reminders do not enter this view. The last four entries are joined
and bounded to 800 characters. Durable event order is shared by live injections,
cold rebuilds and incremental replay; compaction keeps only entries whose source
event identities it retains. The latest ordinary cue survives separately.

Prompt/inject `inputKind` defaults to `message`; internal drains, notifications
and maintenance use `continuation`. New ordinary messages refresh a
session-owned selection before the next provider request, while tool/maintenance
continuations reuse it. Midturn arrivals at one intake boundary form one lookup.
The latest ordinary cue survives compaction independently of recalled contents
and is reconstructed from retained events on a cold resume. Session changes
clear selection. Cancellation stops waiting, prevents a provider call and fences
late installation.

Automatic evidence is rendered as untrusted historical quotations and
model-authored accounts after required history/tool results, alongside
separately owned caller temporary text. Presentation validates each retrieved
passage against the unchanged redacted source text used by search, then
completes both ends to enclosing sentence boundaries within recognized message
bodies, journal bodies or a plain source. Sentence boundaries use the built-in
English sentence segmenter; unusual prose is not guaranteed a linguistic
interpretation. The presented offsets and text remain exact slices of that same
source version. Metadata-only selections do not acquire unrelated body text.
Overlapping or touching completed ranges from the same immutable source and
required-account binding coalesce, including original-only evidence. Ranges
within a source appear in ascending source order; separated ranges stay separate
rather than quoting omitted text. Every message retains its own attribution,
including selections crossing message boundaries. Indexing and retrieval
priority remain seed-derived: a contextual identifier introduced by sentence
completion does not promote the source.

Sen's finite message envelopes become historical message records with quoted
bodies, source/channel or room, conversation, sender and message reference where
recorded. Transport `current`/`catch_up` wrappers, reply hints and external
harness reminders are omitted. Source-authored words, including instructions and
literal markup, remain safely escaped quotations. Each message keeps its own
attribution. Original post time comes from producer `sent_at` or fixture `at`,
with its field identified; missing, invalid or conflicting times remain
explicit. Transcript `recorded_at` is separate ingestion time and never
substitutes for post time. Unknown source formats remain generic escaped
historical excerpts.

Documents under the repository's `user/journal/` or `journal/` paths become
journal quotations. Their full retained entry supplies the title and entry time
from the finite journal frontmatter, even for a later body passage. Titles are
source labels, not inferred authorship. Missing, invalid or conflicting date and
epoch-millisecond timestamp fields remain explicit. Other documents keep their
source path without being labeled journals.

Every quotation includes an executable native `recall` read call. Message
records use `recall({action:"read", event_id, context:5, full:true})` for
retained historical surrounding context: this bounded event window is not a
complete thread. Journal and other document records use
`recall({action:"read", event_id:"source:…"})` for the complete immutable
retained source version. The renderer retains required current accounts,
revisions and support statuses. Redaction applies before packing, and all
displayed metadata, escaping, calls, accounts and framing count against the same
2,000-token maximum. This presentation overhead can change how many ranked
complete presentation units fit, while selected quotations retain exact source
offsets and text. The framing explains that a model-authored account may appear
without a raw quotation and directs readers to compare it with older originals
when supplied. It reserves source expansion for a concrete missing fact,
ambiguity, contradiction or freshness need. Recalled quotations are untrusted,
and repeated background alone creates no new reply, tool or journal obligation.
Automatic evidence is never persisted or extracted as a new original. Caller
set/peek/clear remain sticky and independent. Provider context overflow can
still occur because request sizing is an estimate. The runner uses its bounded
emergency compaction recovery and revalidates recall for the rebuilt request. A
cleared tail remains explicit after temporary context has been used.
`session_info._meta.automaticRecall` and logs contain only mode/reason,
coverage, identities, counts, duration and packed size.

An ordinary image-only input advances the cue identity and clears prior
automatic evidence without inventing a textual image query. Complete tool
calls/results use the same redacted source text as passage indexing for history
exclusion; digest-only results continue to leave full sidecar text eligible.
Both failed text surfaces with working semantics report `semantic-only`; one
working text surface remains partial `hybrid`. This mode survives continuation
reuse. The optional `textual` dependency used by offline tests/harnesses
disables textual nomination and identifier preference together; it is internal
and has no Ent, initialize or environment setting. Diagnostic observers run
after provider dispatch, so they do not delay dispatch after the final evidence
fence.
