# Start known Anthropic models without catalog discovery

Jesse requested separate, evidence-backed repairs for startup, publication
timeouts and a historical live-turn stall. The root agent owns this design; Sol
implements it and two independent Sol agents review it.

## Evidence and scope

The incident log contains a 255.083-second interval between starting an
Anthropic model-list lookup and its failure. Those shared log records carry no
turn or process identifier, so they do not establish the cause of the entire
orphan turn or its reported CPU use. Separately, source inspection establishes
that `createProviderFromInstanceAndModel` awaits model discovery even when the
requested exact Anthropic model ID already has complete shipped metadata.

A private measurement of the retained root history took 0.454 seconds to load,
2.539 seconds for a projection-cache miss, 0.0047 seconds for a same-map cache
hit, and 0.540 seconds for the first injection-tail read. These observations
omit live contention, orphan repair and provider setup. They do not justify
changing the injection reader as a fix for that historical incident.

## Small change

In `ProviderRegistry.createProviderFromInstanceAndModel`, use the effective
local catalog directly when the provider is `anthropic` and that catalog
contains the exact requested model ID. This is the shipped catalog unless a user
has supplied a same-ID catalog override. Otherwise retain the existing dynamic
discovery and alias-resolution path. Model listing and explicit refresh still
discover models. Other providers retain their existing routing and model
filtering.

The local metadata already takes precedence for known models, and the existing
fallback already permits these exact IDs when discovery fails or omits them.
This removes an unnecessary network dependency from inference; it does not
introduce a timeout, retry, background refresh, cache layer, API, configuration
option or compatibility mode.

## Implementation and proof

1. Add a failing real-process regression using a loopback Anthropic fixture. Its
   model-list endpoint is held open; its message endpoint can deliver a valid
   response. A known exact model must make the message request and deliver the
   answer without discovery. Fail on an observed model-list request rather than
   depending on a latency threshold. Clean up any held connection
   deterministically.
2. Preserve a control in which an unknown or aliased model still uses dynamic
   discovery, and verify explicit listing/refresh still queries the endpoint.
   Update stale-catalog tests to assert the new known-model contract while
   retaining coverage for shipped metadata and discovery failure.
3. Make the small registry change, update the relevant evergreen provider
   documentation, and run focused provider/real-process tests and typecheck.
   Save red and green output. Normal git hooks remain enabled.
4. Obtain two independent reviews. Run the full suite and hosted CI before
   merging this separate PR. Do not deploy Ada or broaden the Reeve pilot.

Expected files: `packages/agent/src/providers/registry.ts`, focused provider
tests, the existing real-process provider test file, and the relevant evergreen
provider documentation. No unrelated transcript or memory changes belong here.

## Scheduling

The transcript catch-up PR owns the shared machine's heavy-test slot until its
isolated Linux full suite finishes. The implementer may inspect and edit while
it runs, but must obtain the slot from the root before building or running
tests. No helper scripts: use existing fixtures or the shared tool catalog.
Preserve all prior runs and report the historical live-turn root cause as
unresolved.
