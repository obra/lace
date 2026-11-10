# Persistent search qualification

The populated trial supports Qdrant **exact search** for this integration. It
does not support shipping the tested approximate-search setting. The subsequent
native integration and retained-answer regression are recorded below. Deployment
remains pending.

## Method

The private frozen SQLite snapshot contributed 196,574 existing 768-dimensional
passage vectors from the pinned local EmbeddingGemma generation. No corpus
re-embedding occurred. Eight existing fictional evaluation queries were encoded
once. They exercise nearest-neighbor fidelity on this corpus; their fictional
answer labels are not ground truth for this colleague's history.

The JavaScript oracle exhaustively scored the corpus. Qdrant used Float32/Dot,
cold vectors, a cached HNSW graph, m=16, ef_construct=100, ef=128, and top 100.
Returned boundary IDs were independently scored against SQLite. Raw agreement
and agreement allowing score ties within 1e-5 are reported separately.

Qdrant 1.20.0 image digest
`sha256:2d1b0bfd0a961275481ea09400fc98008216ae54e1b52ed7d24520d63050c644` ran as
linux/amd64 under emulation on the shared Mac. Its private container had 2 CPUs,
a 4 GiB hard memory limit, no swap allowance, and a Docker-managed Linux volume.
The endpoint was authenticated and bound to loopback. These are not native
production latency measurements.

The benchmark implementation is `1fecd8f1ed77e7005095c3edc68d8596737118a6`. Two
independent Sol reviewers checked the implementation and receipts. The ten
focused behavioral tests, strict touched-file typecheck, scoped lint and
formatting passed. No runtime code changed in this trial.

## Results

| Measurement                                                    | Observation                                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Preparation, including eight query embeddings and exact oracle | 24.1 seconds                                                                                                                              |
| Import command, including hash/count verification              | 49.3 seconds                                                                                                                              |
| Background maintenance                                         | Last indexing job finished about 29 seconds after the last upsert; final merge about 50 seconds after it                                  |
| Maximum observed server cgroup memory                          | 1,345,945,600 bytes, about 1.25 GiB; zero memory-limit or OOM events                                                                      |
| Exact top-100 fidelity                                         | 100/100 allowing ties in all 32 comparisons across four runs of the same eight-query panel; raw overlap as low as 95/100 after recreation |
| Initial exact top-1/5/10/25/50 fidelity                        | Full raw agreement for all eight queries                                                                                                  |
| Initial approximate top-100 fidelity                           | 590/800 allowing ties, with individual queries at 61–93/100                                                                               |
| Initial approximate top-1 and top-5 fidelity                   | 7/8 and 35/40 allowing ties; worst top-5 was 2/5                                                                                          |
| Exact request latency                                          | First request of each panel 368–492 ms; following requests about 17–34 ms                                                                 |
| Approximate request latency                                    | About 5–14 ms after the initial exact panel; 13–59 ms when run first after recreation                                                     |

Per-segment telemetry showed exact search in all three populated segments for
the exact arm, and HNSW traversal in all three for the approximate arm. The
approximate losses are not explained by a planner choosing plain scans.

Exact-then-approximate order warms the latter arm. A separate recreation ran
approximate first. Another diagnostic rotated the same frozen queries: the 463
ms delay moved to the new first query and the previous first query took 19 ms
when last. That identifies a first-request effect in this procedure, not its
cause. Process recreation does not clear the OS cache. The maximum observed
native-versus-JavaScript score difference in the initial panel was 1.36e-7.

Waited insertion was visible through direct lookup and filtered exact search. A
new revision replaced the test sentinel, the previous revision and a separate
deletion control disappeared, and replaying the same operations preserved the
result. After graceful container recreation with the same volume, a read-only
check found only the new revision before any new client writes. This establishes
the observed engine behavior; it does not establish crash/power-loss recovery or
recovery of Lace's future publication progress.

## Decision and remaining work

Use native exact search initially. The tested approximate mode loses candidates,
including at the very top of the ranking, for a small observed warm-request
latency saving. Exact search still scans vectors inside the engine; it does not
establish sublinear scaling for years of history. The integration is intended to
remove full-corpus JSON decoding and JavaScript scoring from each request while
retaining the engine's persistent storage and resource controls. Any later
approximation needs its own quality evidence.

The subsequent integration implements durable incremental publication and
replaces vector nomination while preserving semantic, text and identifier
routes, admission, current-account checks and evidence presentation. Its
selected-evidence, answer and native-worker checks are recorded below. Merge
checks and Reeve-only deployment remain pending. These results do not establish
general recall latency or answer-quality improvement.

All private inputs, output events, comparisons and failed preflights remain in
the incident evidence directory under `qdrant-fit.ZxJtHI`. The initial macOS
bind mount emitted a FUSE safety error before import; the trial moved to a Linux
volume. The first preparation refused an orphan SQLite sidecar; a separate
sealed file-only copy succeeded. The original SQLite file still matched its
saved hash. Neither failure was overwritten or silently retried.

## Populated Lace integration

The integrated candidate at `aea2c3b696aa5459978d3b0ff485a1dd9f923371` completed
the existing root-plus-two-native-workers scenario. Its comparison used Lace
`d0834134e1e24fd60bc50f8bcaf053332b9e5303`, the same frozen SQLite snapshot, and
identical manifests for 1,362 retained files. Both ran the same evaluator and
immutable Debian 13/Node 22 lab image under 2 CPUs, 6 GiB and no swap. The
candidate's Qdrant server was in the same container and resource accounting as
Lace and its workers. This remains an emulated Linux operational test with a
deterministic provider, not an answer-quality result.

| Measurement                                    | Exhaustive baseline | Persistent search candidate    |
| ---------------------------------------------- | ------------------- | ------------------------------ |
| Initial publication barrier                    | Not applicable      | 200.1 seconds                  |
| First fresh recall preparation                 | 24.72 seconds       | 7.61 seconds after publication |
| Second fresh recall preparation                | 21.42 seconds       | 18.15 seconds                  |
| Four reused preparations, total                | 4.55 seconds        | 6.28 seconds                   |
| Second root turn and workers through idle      | 37.70 seconds       | 41.57 seconds                  |
| Combined cgroup memory peak                    | 4.73 GiB            | 5.70 GiB                       |
| OOM or memory-limit events                     | Zero                | Zero                           |
| Workers completing while maintenance published | 2 of 2              | 2 of 2                         |

All six root calls selected byte-identical evidence bodies, including ordering,
excerpts, source ranges and read-context instructions. The first four complete
temporary-context payloads also matched. The two notification payloads differed
only in a coverage source count, 37,378 versus 37,379. Every worker provider
call had no automatic-recall context. Both arms reported partial hybrid
coverage; neither fell back to text. This corpus had no derived note accounts.

The candidate's peak occurred with the root and both worker processes alive,
after initial publication, leaving about 305 MiB below the combined limit. The
nearest sampled peak consisted mainly of filesystem cache. The measurement does
not attribute the peak to a specific component or demonstrate improved capacity.
All four reused preparations were slower. These results support faster fresh
preparation for the two measured cues, not a general latency or memory
improvement.

Both fresh queries used one native page at offset zero. The second native
semantic query took about 25 ms, but scoring text-nominated candidates required
157 batches and about 4.67 seconds. Other text retrieval, candidate validation
and packing work remained. This run does not establish behavior at deep native
offsets or years-of-history scale. Initial publication is recorded separately;
the first end-to-end response including that work took longer than the baseline.

The first integrated attempt failed before any query when a synchronous startup
FTS backfill blocked the request loop and the server returned HTTP 408. The
preserved failure led to a small ordering repair: finish that existing backfill
before admitting RPC work. A deterministic real-process regression failed on the
old ordering and passed on the repair; two independent Sol reviews accepted it.
No timeout or retry policy changed. The fresh repaired attempt completed, and
the server subsequently stopped cleanly with zero restarts or OOMs. The failed
attempt and its volume remain separate from the successful run.

Two independent Sol reviewers checked the populated comparison and its limits.
Private receipts are retained under `qdrant-native.qLUEDL`. Full checks,
dependency-ordered merges and Reeve-only deployment remain pending. The existing
Reeve deployment was healthy in a read-only check; this candidate has not been
deployed.

## Retained delivered-answer regression

One retained changed-responsibility question was run through the existing native
Sen evaluator with the same stopped state, current Sen build, DeepSeek 4.1 Flash
background model and normal runtime settings. Recall was enabled and extraction
disabled in both arms. The seed's six successful and six failed extraction
sources remained intact, with all 19 passage vectors and six current-note
vectors available. The persistent arm used a fresh isolated server and awaited
publication. Original seed hashes matched before and after both runs.

Both delivered answers correctly named the current owner and included the
unfinished work; neither attributed current responsibility to a previous owner.
Both sent their answer before any explicit source search. Their first automatic
recall selected the same four originals, including the decisive handoff, and the
same note. All recall rounds reported hybrid mode, with no text fallback. Two
independent, unblinded Sol reviews graded the outward deliveries against the
frozen required and forbidden claims and inspected the actual transcripts.

Both sessions performed checks after sending their answer. The exhaustive arm
read conversation history and searched its journal; the persistent arm reopened
the exact handoff record. Both also wrote private journal observations. Neither
sent a second answer, and both ended normally without pending jobs or dead
letters. These observed post-answer calls are not evidence of a retrieval
failure or an answer-quality advantage.

Both sessions were then resumed in private copies for the same neutral
retrospective question. The same native session and historical bytes were
preserved, and the original completed cells and seed remained unchanged. The
persistent session said the handoff text was already in its working context
before sending. The exhaustive session claimed only the question was available,
then attributed the sources to later recall. That account conflicts with its
original pre-answer trace and recall preparation. It also confused the
historical question date with the experiment's publication date, then corrected
that criticism after converting timestamps. Retrospective explanations are not
authoritative evidence of what the model saw.

For these answer runs, diagnostics record the selected recall block before the
model call, and the runner passes that block as temporary request context. The
original sessions refer to the handoff before their first send. There is no
independent raw provider-request capture for these two live answer runs. The
populated deterministic scenario above does capture each provider context.
Original post-answer checks and additional interview searches also cross the
existing required-verification reminder boundary; the persistent session's
original trace explicitly identifies that reminder. Ordinary verification was
unchanged. Two independent Sol reviews checked the interviews against the
original chronology and found no new current-owner or index regression. The
interviews do not establish a new quality or tool-efficiency result.

This is one known regression case, not fresh held-out evidence or a new
comparison against main. It establishes the observed answer and recall behavior
for that case, not general quality improvement. Private receipts are under
`rs-answer.fln6z6`; the original completed cells are preserved.

## Integration checks

The full protocol suite passed 106 tests, and the CLI suite passed 14 with two
optional live tests skipped. Full typechecking and linting passed. The full
agent suite on macOS recorded 4,669 passes, 31 failures and 36 skips. The
failures were in unchanged tests assuming Linux `/proc`, GNU find, `setsid`, or
Node in a fixed system path. All 166 tests across those 15 files passed on the
first clean Linux run at `21561a31345ba04aed6531de16b92ac819509695`. Its build
and root formatting check also passed. The original failed macOS run is
retained; this does not claim a passing full Linux suite. PR CI and the
dependent Sen pin and integration checks remain required before deployment.
