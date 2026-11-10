# Private memory search benchmark

This developer command compares Lace's exhaustive JavaScript passage ranking
with Qdrant exact and HNSW-enabled search. It uses stored passage vectors and
encodes only the query panel. Each command writes a new private run directory.

## Inputs

- Use Node 22, the repository dependencies, and a locally installed pinned Lace
  memory encoder. The benchmark uses the generation declared by that encoder.
- Use a sealed SQLite backup in DELETE journal mode. Keep it read-only and
  separate from live SQLite files. The command rejects WAL, SHM, and journal
  sidecars and verifies the file digest around each read stage. The scan joins
  passage and source versions and skips passages without a vector in the
  selected generation.
- Supply a private UTF-8 JSON panel such as
  `{"queries":[{"id":"case-01","text":"What did we decide?"}]}`. IDs must be
  unique. Freeze the panel and reuse the saved preparation for each query run.
- Provision a dedicated Qdrant 1.20.0 server and data directory outside the
  benchmark. Pin its image digest, disable outbound usage telemetry, and bind
  the listener to loopback. Use API key authentication on shared hosts and pass
  the key in a private `0600` file. The command uses literal `127.0.0.1` or
  `[::1]` addresses and refuses redirects.

## Run the stages

From the Lace checkout, set `RUNS` to an existing private directory outside the
repo. Set `SNAPSHOT`, `PANEL`, `MODEL_DIR`, and `KEY_FILE` to the inputs above,
`QDRANT_URL` to the loopback endpoint, and `COLLECTION` to a fresh unique name.

```sh
npx --no-install tsx scripts/benchmark-memory-search.ts prepare \
  --snapshot "$SNAPSHOT" --panel "$PANEL" --model-dir "$MODEL_DIR" \
  --output "$RUNS/prepare"

npx --no-install tsx scripts/benchmark-memory-search.ts import \
  --snapshot "$SNAPSHOT" --prepared "$RUNS/prepare" \
  --qdrant-url "$QDRANT_URL" --collection "$COLLECTION" --api-key-file "$KEY_FILE" \
  --output "$RUNS/import"

npx --no-install tsx scripts/benchmark-memory-search.ts query \
  --snapshot "$SNAPSHOT" --prepared "$RUNS/prepare" \
  --qdrant-url "$QDRANT_URL" --collection "$COLLECTION" --api-key-file "$KEY_FILE" \
  --output "$RUNS/query-01"

npx --no-install tsx scripts/benchmark-memory-search.ts mutations \
  --prepared "$RUNS/prepare" --qdrant-url "$QDRANT_URL" --collection "$COLLECTION" \
  --api-key-file "$KEY_FILE" --output "$RUNS/mutations"

# After independently recreating the server with the same owned data directory:
npx --no-install tsx scripts/benchmark-memory-search.ts mutations --verify \
  --prepared "$RUNS/prepare" --qdrant-url "$QDRANT_URL" --collection "$COLLECTION" \
  --api-key-file "$KEY_FILE" --output "$RUNS/restart-verify"
```

Preparation records the snapshot and selected dataset digests, generation, point
count, query vectors, the deterministic point mapping, and the top 100 reference
IDs and scores per query. Import uses sequential waited upserts and checks the
server's exact count and collection configuration. A partially imported
collection remains available for inspection. Retry with a fresh collection name
and run directory.

Query defaults to exact then HNSW-enabled search. Use `--mode exact` or
`--mode hnsw` to measure an arm separately. Run all corpus-only comparisons
before mutations. The mutation stage leaves one revised sentinel in the
collection for the read-only restart check. The check reads that sentinel and
looks up the old revision and deletion-control IDs directly to confirm their
absence.

## Read the results

Keep `prepared.json`, `point-mapping.jsonl`, and every `events.jsonl` private.
They can contain query vectors, point IDs, source identity, or scores. Each
stage's JSON result is written on success. The events log records progress and
errors for runs that stop partway through. Failed HTTP requests include the
method, path, status, and a bounded diagnostic with the API key redacted.
Transport errors record an exception type and cause code when available. The CLI
prints stage status only.

- Raw results include Qdrant server time and client wall time per request.
  Client time includes HTTP overhead and payload decoding. The independent
  comparison and telemetry capture occur outside those request times.
- Comparison reports raw ID overlap and same-position counts. It also credits
  ties within `1e-5` using the JavaScript reference and independent SQLite
  scores for returned IDs outside the stored top 100.
- `exact: false` permits HNSW, and Qdrant may scan some or all segments. Inspect
  collection state and the saved per-arm telemetry counter deltas to establish
  whether graph traversal occurred. Treat missing telemetry or ambiguous
  counters as unknown. Indexed-vector counts are approximate.
- Measure server CPU, memory, and time to finish indexing separately. Label
  execution order and cache conditions. Exact requests can warm a following HNSW
  arm, and restarting the process does not clear the OS page cache.
- Mutation receipts cover post-acknowledgment visibility, idempotent replay, and
  persistence in the owned data directory. This benchmark measures vector
  candidates and engine behavior. Answer quality, full recall latency, and Lace
  publication recovery require separate validation.
