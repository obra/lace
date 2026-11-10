# Persistent search qualification

The populated trial supports proceeding with Qdrant **exact search** for the
first integration. It does not support shipping the tested approximate-search
setting. This is engine qualification, not a delivered-answer or deployment
result.

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

Next implement durable incremental publication, then replace vector nomination
while preserving semantic, text and identifier routes, admission,
current-account checks and evidence presentation. Validate selected evidence and
actual answers, text-only fallback, interrupted publication, and the populated
native-worker path before the Reeve-only deployment. These results do not
establish total recall latency or answer-quality improvement.

All private inputs, output events, comparisons and failed preflights remain in
the incident evidence directory under `qdrant-fit.ZxJtHI`. The initial macOS
bind mount emitted a FUSE safety error before import; the trial moved to a Linux
volume. The first preparation refused an orphan SQLite sidecar; a separate
sealed file-only copy succeeded. The original SQLite file still matched its
saved hash. Neither failure was overwritten or silently retried.
