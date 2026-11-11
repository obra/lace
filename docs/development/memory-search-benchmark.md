# Private memory search benchmark

This developer command compares Lace's exhaustive JavaScript passage ranking
with Qdrant exact and HNSW-enabled search. It uses stored passage vectors and
encodes only the query panel. Each command writes a new private run directory.

## Inputs

The separate `packages/agent/tests/scenarios/recall-native-evaluation.ts`
scenario accepts an optional `query` in its private case JSON. It uses that text
for the initial recall and the existing worker-overlap turn. Without it, the
scenario asks for historical evidence containing `cue`. The cue still checks the
frozen event index, and `expectedOriginalHandle` still must appear in supplied
context. Use identical queries and evaluator code in both arms; this
controlled-provider scenario measures retrieval and runtime behavior, not
delivered-answer quality.

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

## Measure Lace and Qdrant under one resource limit

The development image runs the Lace evaluator and Qdrant in the same Linux
cgroup. It uses the qualified Qdrant 1.20.0 image and the same amd64 Node
22.23.4 binary as the historical Linux evaluator. The final base is Debian 13.
The historical Node-only evaluator used Debian 12 (Bookworm). Run both arms in
this image for a comparison that holds the base OS constant.

From the repo root, check the Docker inventories and choose fresh names for
`LAB_IMAGE`, `LAB_CONTAINER`, and `LAB_VOLUME`. Set `LAB_CODE` to an absolute
path to the evaluator checkout with Linux amd64 dependencies and build output,
`LAB_CASE` to a fresh writable copy of the case, and `MODEL_DIR` to the local
encoder directory. Mount any frozen baseline inputs read-only as well. The build
context contains only the image definition.

```sh
docker ps -a
docker compose ls -a
docker build --platform linux/amd64 -t "$LAB_IMAGE" scripts/memory-search-lab
docker volume create "$LAB_VOLUME"
docker run --rm -it --init --name "$LAB_CONTAINER" --platform linux/amd64 \
  --network none --cpus 2 --memory 6g --memory-swap 6g \
  --mount "type=bind,src=$LAB_CODE,dst=/work,readonly" \
  --mount "type=bind,src=$LAB_CASE,dst=/var/sen/instance" \
  --mount "type=bind,src=$MODEL_DIR,dst=/model,readonly" \
  --mount "type=volume,src=$LAB_VOLUME,dst=/qdrant/storage" \
  --workdir /work "$LAB_IMAGE"
```

For the Qdrant arm, start the server from that shell with the qualification
limits of one search, optimization, and indexing thread each. Retain its log in
the private case directory.

```sh
(cd /qdrant && QDRANT__SERVICE__HOST=127.0.0.1 \
  QDRANT__TELEMETRY_DISABLED=true \
  QDRANT__STORAGE__PERFORMANCE__MAX_SEARCH_THREADS=1 \
  QDRANT__STORAGE__OPTIMIZERS__MAX_OPTIMIZATION_THREADS=1 \
  QDRANT__STORAGE__HNSW_INDEX__MAX_INDEXING_THREADS=1 exec ./qdrant) \
  > /var/sen/instance/qdrant.log 2>&1 &
qdrant_pid=$!
```

Confirm `http://127.0.0.1:6333/readyz` returns success, then run the evaluator
in the same shell against that loopback URL. Use a fresh container per arm and
leave Qdrant stopped for the exhaustive baseline. Record Lace's publication
readiness separately from Qdrant startup. On cgroup v2, save
`/sys/fs/cgroup/memory.peak`, `memory.events`, and `cpu.stat` before exiting.
Stop the server with `kill -TERM "$qdrant_pid"` and `wait "$qdrant_pid"`. Reuse
the owned Linux volume when measuring a restart, and remove it after the run.

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
