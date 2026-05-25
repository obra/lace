# Working-Memory Compaction for a Persistent Multi-User Agent Persona

**Codex handoff report**  
**Prepared:** 2026-05-25  
**Scope:** One persistent model conversation/context for one coherent agent persona, receiving messages from many users. Core memory and archival memory are assumed to exist separately or to be built later. This report focuses on **how to trim, rewrite, or compact the live chain of user messages, assistant messages, and occasional tool traces** when the working context approaches its limit.

---

## Executive thesis

Do **not** implement this as:

```text
"Summarize the conversation so far."
```

Implement it as a small working-memory operating system:

```text
SYSTEM / DEVELOPER PERSONA
+ optional durable core memory snippets
+ canonical WORKING_MEMORY_COMPACT capsule
+ active participant/speaker roster
+ recent semantic micro-checkpoints
+ ephemeral tool-result handles and digests
+ recent verbatim transcript tail
+ current user message
```

The compacted state should be **typed, inspectable, diffable, critic-checkable, and behaviorally evaluated** against the full transcript. It is not durable memory. It is the agent persona's **live conversational state**.

The compact should preserve:

- who said what;
- the current live topic and unresolved user intent;
- commitments, promises, decisions, constraints, and open questions;
- user corrections and assistant repairs;
- relationship/emotional state, rapport, frustration, and running jokes;
- uncertainty and superseded assumptions;
- exact language where wording matters;
- tool-result handles and short digests, not raw bulky results;
- negative state: what not to infer, remember, generalize, or leak.

The compact should aggressively remove:

- redundant back-and-forth;
- stale or resolved details that no longer influence behavior;
- raw tool output that can be re-fetched;
- generic pleasantries that do not affect rapport;
- local facts that should not become durable or global;
- ambiguous "the user..." phrasing in a multi-user context.

The best current design is:

```text
canonical transcript log
+ proactive semantic checkpoints
+ ephemeral tool-result clearing
+ global typed compaction at threshold
+ recent verbatim tail
+ compact critic
+ periodic rebuild from transcript
+ behavioral-equivalence evals
```

---

## 1. Problem framing

The system is designed to feel like one coherent employee/team-mate. All users interact with one shared agent persona through a chat-like surface. Tasks may be handled by ephemeral subagents, but the main continuity problem is the primary chat chain.

The target invariant is:

> After compaction, the agent should continue as if it still had the relevant parts of the full transcript, while using far fewer context tokens.

This is not the same as long-term memory extraction. Core memory and archival memory are separate systems. This report concerns **working-memory compaction**: the bounded, live context that the next model call sees.

### 1.1 Why this is hard

A long multi-user transcript contains several kinds of state intermixed:

- raw content;
- user identity and attribution;
- local participant preferences;
- current task state;
- social/relationship state;
- assistant mistakes and repairs;
- tool traces;
- obsolete hypotheses;
- commitments;
- jokes and style;
- implicit context from the last few turns.

A generic summary tends to flatten these into a plausible narrative. That is dangerous: it erases repairs, merges users, hardens uncertainty into fact, and loses the local relationship texture that makes the agent feel continuous.

### 1.2 The key architectural distinction

Do not confuse:

```text
persona identity continuity
```

with:

```text
single unbounded transcript continuity
```

The persona may remain one coherent entity while the active context is carefully rewritten. The transcript remains canonical and auditable; the compact is a lossy working state.

---

## 2. Current commercial state of the art

### 2.1 OpenAI: server-side and standalone compaction

OpenAI's current Responses API documentation describes compaction as a way to support long-running interactions by reducing context size while preserving state needed for future turns. It supports server-side compaction via context management and standalone compaction via `/responses/compact`.

Relevant links:

- OpenAI compaction guide: https://developers.openai.com/api/docs/guides/compaction
- OpenAI compact endpoint reference: https://developers.openai.com/api/reference/resources/responses/methods/compact/

Important implication:

- Provider-native compaction is useful and should be tested.
- However, the provider-native compact can be opaque/provider-specific.
- For this product, the canonical compact should be human-readable, schema-governed, auditable, and eval-tested.

Recommended posture:

```text
provider-native compaction = optional optimization / fallback / baseline
typed working-memory compact = canonical state used for product behavior
canonical transcript = source of truth
```

### 2.2 Anthropic: compaction, context editing, and tool-result clearing

Anthropic distinguishes multiple context-management primitives:

- compaction: summarize/replace older context;
- tool-result clearing: drop old re-fetchable tool payloads while preserving that the call happened;
- memory: external structured note-taking or file-backed state.

Relevant links:

- Anthropic compaction docs: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic context editing docs: https://platform.claude.com/docs/en/build-with-claude/context-editing
- Anthropic context-engineering cookbook: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
- Anthropic engineering post on effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Important implication:

- Your proposed "ephemeral tool call" primitive is aligned with real market practice.
- Tool-result clearing should be separate from transcript compaction.
- Compaction is not only about token caps; it is also about keeping the active context focused and performant.

### 2.3 LangChain / LangGraph: trim, delete, summarize, custom state

LangChain documents short-term memory as part of agent state and describes practical options including trimming, deleting, summarizing, and custom strategies.

Relevant links:

- LangChain short-term memory docs: https://docs.langchain.com/oss/python/langchain/short-term-memory
- LangChain context engineering docs: https://docs.langchain.com/oss/python/langchain/context-engineering
- LangChain context engineering blog: https://www.langchain.com/blog/context-engineering-for-agents

Important implication:

- A good runtime should treat compaction as an explicit pre-model state transformation.
- A custom strategy is appropriate here because the product needs persona continuity, speaker attribution, repairs, and multi-user scoping.

### 2.4 Inspect AI: compaction as interchangeable strategies

Inspect AI documents multiple compaction strategies, including native, summary, edit, and trim compaction.

Relevant link:

- Inspect AI compaction docs: https://inspect.aisi.org.uk/compaction.html

Important implication:

- "Compaction" is not one algorithm.
- The implementation should expose pluggable strategies:
  - trim;
  - summary;
  - typed summary;
  - edit/clear;
  - native provider compaction;
  - hybrid.

### 2.5 Claude Code and coding-agent practice

Claude Code exposes practical context management: subagents run in separate contexts, `/compact` or auto-compaction preserves important information, and file/tool-heavy side work is isolated from the main conversation.

Relevant links:

- Claude Code context window docs: https://code.claude.com/docs/en/context-window
- Claude Code subagents docs: https://code.claude.com/docs/en/sub-agents
- Claude Code best practices: https://code.claude.com/docs/en/best-practices

Important implication:

- Keep noisy work out of the main persona context where possible.
- Side tasks can return summaries/metadata rather than raw logs.
- In your system, ephemeral subagents handle many tasks already; therefore the main compaction problem is mainly chat continuity and occasional tool traces.

### 2.6 Letta / MemGPT / Mem0 / Zep

These are more about long-term memory than transcript compaction, but they inform architecture.

Relevant links:

- Letta compaction: https://docs.letta.com/guides/core-concepts/messages/compaction/
- MemGPT paper: https://arxiv.org/abs/2310.08560
- Mem0 paper: https://arxiv.org/abs/2504.19413
- Zep paper: https://arxiv.org/abs/2501.13956
- Graphiti repository: https://github.com/getzep/graphiti

Important implication:

- Transcript compaction should not carry the entire memory burden.
- Maintain separate layers:
  - live working memory;
  - core memory;
  - archival memory;
  - canonical transcript/event log.

---

## 3. Academic research foundations

### 3.1 Long context is not reliable memory

**Lost in the Middle** shows that models do not use long contexts uniformly. Performance often improves when relevant information appears near the beginning or end and degrades when information is buried in the middle.

Relevant links:

- Paper page: https://aclanthology.org/2024.tacl-1.9/
- arXiv: https://arxiv.org/abs/2307.03172

Design implication:

```text
Compaction is not just compression.
Compaction is reshaping: move high-signal state to a position and form the model can use.
```

### 3.2 Recursive summarization

**Recursively Summarizing Enables Long-Term Dialogue Memory** proposes generating memory summaries from small dialogue contexts and recursively updating them using the previous memory plus new dialogue.

Relevant link:

- https://arxiv.org/abs/2308.15022

Design implication:

- Recursive compaction is plausible and useful.
- But recursive summaries can drift.
- Keep the canonical transcript and periodically rebuild from source.

### 3.3 ReSum and periodic context summarization

**ReSum** proposes periodic summarization of growing interaction histories into compact reasoning states for long-horizon agents.

Relevant links:

- arXiv HTML: https://arxiv.org/html/2509.13313v2
- OpenReview: https://openreview.net/forum?id=PjIK38mwKm

Design implication:

- Your idea of "summarize recent history while it is fresh" is promising.
- Use semantic episodes rather than raw turn counts.
- The agent may request checkpoints, but the runtime should validate and perform them.

### 3.4 Prompt compression

Prompt compression work distinguishes:

- hard prompt compression: remove/paraphrase tokens or spans;
- soft prompt compression: encode content into latent/special tokens or compressed representations.

Relevant links:

- Prompt compression survey: https://arxiv.org/abs/2410.12388
- LongLLMLingua: https://arxiv.org/abs/2310.06839

Design implication:

- Prompt compression is useful background for cost and density.
- But the canonical compact for this system should be natural-language/structured and inspectable.
- Opaque token compression may be an optimization, not the product's canonical state.

### 3.5 Agent reflection and synthesized memory

**Generative Agents** used observations, reflection, and planning to produce believable behavior. **Reflexion** used verbal feedback/reflections as an episodic memory buffer.

Relevant links:

- Generative Agents: https://arxiv.org/abs/2304.03442
- Reflexion: https://arxiv.org/abs/2303.11366

Design implication:

- Synthetic text state can change future behavior.
- Therefore compacted working memory must be treated as powerful behavioral control state, not inert summary.

### 3.6 Long-term conversational memory benchmarks

Relevant benchmarks:

- **LoCoMo**: long-term conversations grounded in personas and temporal event graphs; evaluates QA, event summarization, and multimodal dialogue generation.
  - Paper: https://arxiv.org/abs/2402.17753
  - Project: https://snap-research.github.io/locomo/
- **BEAM**: very long coherent dialogues up to 10M tokens with diverse memory probes.
  - OpenReview: https://openreview.net/forum?id=y59hf5lrMn
  - GitHub: https://github.com/mohammadtavakoli78/BEAM
- **MemoryAgentBench**: evaluates memory agents across accurate retrieval, test-time learning, long-range understanding, and selective forgetting/conflict handling.
  - arXiv: https://arxiv.org/abs/2507.05257
  - GitHub: https://github.com/HUST-AI-HYZ/MemoryAgentBench

Design implication:

- Public benchmarks are useful inspiration, but this product needs custom evals for:
  - persona continuity;
  - multi-user attribution;
  - assistant repair preservation;
  - emotional state continuity;
  - tool-result refetch;
  - compaction drift.

---

## 4. Core design principles

### Principle 1: The compact is working memory, not truth

The canonical transcript is truth. The compact is a lossy active-state projection.

### Principle 2: The compact must be inspectable

Do not rely only on opaque provider-native compaction. The canonical compact should be readable, diffable, and critic-checkable.

### Principle 3: Recent turns stay raw

The most recent turns contain live references, tone, repairs, and user intent. Keep a recent verbatim tail.

### Principle 4: Preserve corrections and repairs

A correction is more valuable than many facts. It prevents repeated failure.

Bad compact:

```text
The system is platform-agnostic.
```

Better compact:

```text
The assistant initially over-indexed on Slack. The user corrected that the system is not Slack-specific. Preserve platform-agnostic framing and do not assume channel/thread/DM semantics.
```

### Principle 5: Preserve speaker attribution aggressively

In a multi-user shared persona, "the user" is often a bug.

Bad:

```text
The user prefers concise updates.
```

Better:

```text
Alice prefers concise planning updates. Do not infer this preference applies to Bob.
```

### Principle 6: Tool outputs are not conversation

Large tool results should not remain in the live chat context indefinitely. Replace them with digest + handle + refetch instruction.

### Principle 7: The agent may request compaction, but the runtime owns it

The main agent can notice salience. It should not unilaterally rewrite its own history.

### Principle 8: Rebuild periodically

Recursive compaction is cheap; canonical rebuild is hygiene.

### Principle 9: Evaluate behavior, not aesthetics

A compact that "looks good" can still change the agent's behavior. Compare full-transcript behavior to compacted-context behavior.

### Principle 10: Include negative state

The compact should explicitly track:

- do not infer;
- do not generalize;
- do not treat as durable;
- do not leak;
- stale/superseded assumptions.

---

## 5. Target architecture

### 5.1 High-level runtime

```text
          ┌────────────────────────┐
          │ Incoming event          │
          │ user/assistant/tool     │
          └───────────┬────────────┘
                      │
                      ▼
          ┌────────────────────────┐
          │ Append canonical log    │
          └───────────┬────────────┘
                      │
                      ▼
          ┌────────────────────────┐
          │ Event classifier        │
          │ correction? decision?   │
          │ tool result? boundary?  │
          └─────┬─────────┬────────┘
                │         │
                │         ├──────────────────────┐
                │                                ▼
                │                    ┌────────────────────────┐
                │                    │ Tool result manager     │
                │                    │ digest + TTL + handle   │
                │                    └────────────────────────┘
                │
                ▼
    ┌────────────────────────┐
    │ Checkpoint planner      │
    │ semantic boundary?      │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │ Micro-checkpoint        │
    │ compactor + critic      │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │ Context budget monitor  │
    └───────────┬────────────┘
                │ threshold
                ▼
    ┌────────────────────────┐
    │ Global compactor        │
    │ typed compact + critic  │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │ Context assembler       │
    │ compact + tail + current│
    └────────────────────────┘
```

### 5.2 Active context shape

```text
[System/developer persona]
[Optional core memory snippets]
[Working-memory compact]
[Active participants / speaker roster]
[Recent micro-checkpoints since last global compact]
[Tool-result handles and digests]
[Recent verbatim tail]
[Current user message]
```

### 5.3 Storage layers

```text
canonical_transcript_log:
  append-only, auditable, source of truth

working_memory_compact:
  current typed compact replacing old transcript prefix

micro_checkpoints:
  short semantic snapshots generated at boundaries

tool_result_store:
  raw tool payloads and/or external pointers

tool_result_handles:
  compact in-context references to cleared results

core_memory:
  separate durable identity/facts/preferences layer

archival_memory:
  separate long-term retrieval layer
```

---

## 6. Data model

The following TypeScript-like interfaces are implementation guidance for Codex.

### 6.1 Canonical event

```ts
export type EventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "tool_result_cleared"
  | "micro_checkpoint"
  | "global_compaction"
  | "system_event";

export interface TranscriptEvent {
  id: string;
  type: EventType;
  createdAt: string; // ISO timestamp
  speakerId?: string;
  speakerDisplayName?: string;
  sourceSurface?: string;
  visibilityScope?: "global_persona" | "team" | "project" | "user_private" | "unknown";
  parentEventIds?: string[];
  content: string;
  tokenCount?: number;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}
```

### 6.2 Event classification

```ts
export interface EventClassification {
  eventId: string;
  labels: Array<
    | "normal_chat"
    | "user_correction"
    | "assistant_repair"
    | "decision"
    | "commitment"
    | "open_question"
    | "relationship_signal"
    | "style_preference"
    | "tool_result_large"
    | "tool_result_refetchable"
    | "privacy_sensitive"
    | "possible_checkpoint_boundary"
  >;
  confidence: number;
  rationale: string;
}
```

### 6.3 Working-memory compact

```ts
export interface WorkingMemoryCompact {
  compactId: string;
  generatedAt: string;
  replacesEventIds: string[];
  sourceStartEventId: string;
  sourceEndEventId: string;
  recentTailStartsAtEventId: string;
  schemaVersion: string;

  purpose: string;

  currentLiveSituation: {
    topic: string;
    immediateUserIntent: string;
    unresolvedQuestion?: string;
    expectedNextResponseShape?: string;
  };

  participants: ParticipantState[];

  agentSelfContinuity: {
    roleAsEnacted: string;
    toneAsEnacted: string;
    behavioralCommitments: string[];
    priorMistakesOrRepairs: AgentRepair[];
    assumptionsExplicitlyAbandoned: string[];
  };

  commitmentsAndObligations: CommitmentState[];
  decisionsAndResolvedPoints: DecisionState[];
  openQuestionsAndUncertainties: OpenQuestionState[];
  userCorrections: UserCorrectionState[];

  emotionalAndRelationshipContext: {
    rapport?: string;
    frustrationOrTrustSignals?: string[];
    humorOrRunningJokes?: string[];
    sensitivityNotes?: string[];
  };

  importantChronology: ChronologyItem[];
  exactLanguageToPreserve: ExactSnippet[];
  toolState: ToolResultRef[];
  doNotInfer: DoNotInferRule[];

  criticStatus?: {
    status: "unchecked" | "pass" | "fail" | "patched";
    checkedAt?: string;
    notes?: string[];
  };
}
```

### 6.4 Supporting types

```ts
export interface ParticipantState {
  speakerId: string;
  displayName?: string;
  roleInConversation?: string;
  localContext: string[];
  preferencesObservedInThisSession: string[];
  correctionsGiven: string[];
  doNotGeneralizeToOtherUsers: string[];
}

export interface AgentRepair {
  sourceEventIds: string[];
  originalMistakeOrBadAssumption: string;
  correctionOrRepair: string;
  mustNotRepeat: string;
}

export interface CommitmentState {
  sourceEventIds: string[];
  commitment: string;
  madeBy: string;
  madeTo?: string;
  status: "open" | "done" | "superseded" | "cancelled" | "unknown";
  dueAt?: string;
  confidence: number;
}

export interface DecisionState {
  sourceEventIds: string[];
  decision: string;
  establishedBy?: string;
  rationale?: string;
  supersedes?: string[];
  confidence: number;
}

export interface OpenQuestionState {
  sourceEventIds: string[];
  question: string;
  whyItMatters?: string;
  currentHypotheses?: string[];
  whatWouldResolveIt?: string;
}

export interface UserCorrectionState {
  sourceEventIds: string[];
  speakerId?: string;
  originalBadAssumption: string;
  correctedUnderstanding: string;
  failureToAvoid: string;
}

export interface ChronologyItem {
  sourceEventIds: string[];
  event: string;
  importance: "high" | "medium" | "low";
}

export interface ExactSnippet {
  sourceEventIds: string[];
  speakerId?: string;
  quote: string;
  whyExactWordsMatter: string;
}

export interface DoNotInferRule {
  sourceEventIds: string[];
  rule: string;
  reason: string;
}

export interface ToolResultRef {
  id: string;
  toolName: string;
  toolCallEventId: string;
  toolResultEventId: string;
  originalCall: Record<string, unknown>;
  createdAt: string;
  visibilityScope?: string;
  reFetchPolicy: "safe_to_refetch" | "refetch_may_change" | "non_refetchable" | "unknown";
  refetchInstruction?: string;
  contentHash?: string;
  compactDigest: string;
  whenToRefetch: string;
  rawResultStatus: "present_in_context" | "cleared_from_context" | "stored_externally" | "unavailable";
}
```

### 6.5 Micro-checkpoint

```ts
export type CheckpointType =
  | "completed_topic"
  | "decision"
  | "user_correction"
  | "agent_repair"
  | "relationship_context"
  | "tool_result_processed"
  | "open_question_handoff";

export interface MicroCheckpoint {
  checkpointId: string;
  type: CheckpointType;
  generatedAt: string;
  sourceEventIds: string[];
  stateChange: string;
  speakerAttribution: Record<string, string>;
  mustPreserve: string[];
  mayDiscard: string[];
  doNotInfer: string[];
  relatedToolResultRefs?: string[];
  criticStatus?: "unchecked" | "pass" | "fail" | "patched";
}
```

---

## 7. Active context assembly policy

### 7.1 Budget split

Start with this configurable budget split:

```text
System/developer/persona instructions: 5–15%
Working-memory compact:                10–25%
Core memory snippets, if any:            5–15%
Micro-checkpoints/tool handles:          5–15%
Recent verbatim tail:                   25–45%
Free generation/reasoning headroom:      15–30%
```

### 7.2 Recent verbatim tail

Start with a policy like:

```ts
export interface RecentTailPolicy {
  minTurns: number;         // e.g. 10
  maxTurns: number;         // e.g. 30
  minTokens: number;        // e.g. 8_000
  maxTokens: number;        // e.g. 20_000
  neverCompactUnresolvedExchange: true;
  preserveUserCorrectionsUntilAcknowledged: true;
}
```

Recommended starting point:

```text
Keep the last 10–30 turns or 8k–20k tokens verbatim.
Never compact the current unresolved exchange.
Never compact a correction before it has been acknowledged and stabilized.
```

### 7.3 Thresholds

Use multiple thresholds:

```ts
export interface CompactionThresholds {
  warnAtContextUsagePct: number;        // e.g. 0.55
  opportunisticCheckpointPct: number;   // e.g. 0.65
  globalCompactPct: number;             // e.g. 0.75
  emergencyCompactPct: number;          // e.g. 0.90
}
```

Recommendation:

- Do micro-checkpoints opportunistically.
- Do global compaction before emergency.
- Leave headroom for model output and tool use.

### 7.4 Ordering

Recommended active context order:

```text
1. Stable system/developer/persona instructions.
2. Working-memory compact.
3. Active participant roster.
4. Relevant micro-checkpoints not already merged.
5. Tool-result handles.
6. Recent verbatim tail.
7. Current user message.
```

Rationale:

- Important compact state appears near the beginning.
- Recent raw state appears near the end.
- This avoids burying critical facts in the middle.

---

## 8. Compaction triggers

### 8.1 Global compaction triggers

Trigger global compaction when any of these are true:

```text
- active context exceeds configured token threshold;
- recent tail has grown beyond max;
- too many micro-checkpoints have accumulated;
- many tool-result handles/digests are in context;
- the old prefix is stale and distracting;
- runtime requests periodic hygiene rebuild.
```

### 8.2 Micro-checkpoint triggers

Create or request micro-checkpoints at semantic boundaries:

```text
completed_topic
decision
user_correction
agent_repair
relationship_context
tool_result_processed
open_question_handoff
```

Avoid raw "last N turns" as the conceptual unit. Turns are just UI artifacts. The right unit is an episode that changed conversational state.

### 8.3 Agent-requested compaction

Expose a tool to the main agent, but make it advisory:

```json
{
  "name": "request_working_memory_checkpoint",
  "description": "Request that a recently completed exchange be compacted into a working-memory checkpoint. Use only after a meaningful boundary: decision, correction, agent repair, completed topic, processed tool result, or relationship/persona update.",
  "parameters": {
    "boundary_type": {
      "type": "string",
      "enum": [
        "completed_topic",
        "decision",
        "user_correction",
        "agent_repair",
        "relationship_context",
        "tool_result_processed",
        "open_question_handoff"
      ]
    },
    "turn_range": {
      "type": "object",
      "properties": {
        "start_event_id": {"type": "string"},
        "end_event_id": {"type": "string"}
      },
      "required": ["start_event_id", "end_event_id"]
    },
    "why_preserve": {"type": "string"},
    "must_preserve": {
      "type": "array",
      "items": {"type": "string"}
    },
    "may_discard": {
      "type": "array",
      "items": {"type": "string"}
    }
  }
}
```

Runtime rules:

```text
- Validate event range.
- Validate semantic boundary.
- Do not let agent directly mutate compact.
- Run separate compactor.
- Run critic.
- Store checkpoint separately.
```

### 8.4 Tool-result clearing triggers

Classify every tool result when it enters context:

```text
small and conversationally relevant
large and re-fetchable
large and non-refetchable
exact evidence needed
generated artifact
failed tool call
sensitive/noisy content
time-varying result
expensive to re-fetch
```

Start with policy:

```text
Large + re-fetchable:
  keep raw for 1–3 turns or until topic boundary,
  then replace with digest + handle.

Large + non-refetchable:
  compact carefully,
  do not simply clear.

Exact quote/evidence needed:
  preserve exact quote/excerpt + source + handle.

Time-varying:
  preserve timestamp and warn refetch may differ.
```

Agent-facing advisory tool:

```json
{
  "name": "mark_tool_result_ephemeral",
  "description": "Request that a large tool result be replaced after a short retention period by a compact digest and a refetch handle.",
  "parameters": {
    "tool_call_id": {"type": "string"},
    "reason": {
      "type": "string",
      "enum": [
        "large_refetchable_output",
        "processed_into_answer",
        "only_needed_temporarily",
        "contains_sensitive_or_noisy_content"
      ]
    },
    "minimum_digest": {"type": "string"},
    "refetch_instruction": {"type": "string"},
    "retain_for_turns": {"type": "integer"}
  }
}
```

---

## 9. Prompt library

These prompts are intentionally written as operational prompts. They should be versioned and eval-tested.

### 9.1 Global working-memory compactor prompt

```text
You are the Working-Memory Compactor for a persistent multi-user agent persona.

Your job is to replace older transcript events with a compact, high-recall working-memory capsule. This capsule is not long-term memory. It is the live conversational state needed for the same agent persona to continue naturally after raw events are removed.

You are not the assistant persona. Do not answer the user. Do not call tools. Do not create durable memory. Output only the requested schema.

Preserve:
- current live topic and unresolved user intent
- speaker attribution: who said what
- commitments, obligations, deadlines, and promised follow-ups
- user corrections and assistant repairs
- decisions, constraints, and rationale
- uncertainty, conflicts, stale assumptions, and superseded claims
- emotional/relationship context, tone, rapport, frustration, humor
- exact phrases when wording matters
- tool calls/results only as digests, handles, and refetch instructions
- "do not infer" boundaries and privacy/scope notes

Do not:
- convert uncertain claims into certain facts
- merge multiple users into "the user"
- erase assistant mistakes if remembering the repair prevents repetition
- promote local preferences into global durable memory
- preserve irrelevant chit-chat unless it affects rapport/personality continuity
- include raw bulky tool outputs when a digest and refetch handle suffice
- discard open commitments
- discard recent unresolved context
- write any prose outside the schema

Required output sections:
1. current_live_situation
2. participants
3. agent_self_continuity
4. commitments_and_obligations
5. decisions_and_resolved_points
6. open_questions_and_uncertainties
7. user_corrections
8. emotional_and_relationship_context
9. important_chronology
10. exact_language_to_preserve
11. tool_state
12. do_not_infer
13. recent_tail_boundary

Use source event IDs wherever possible.
If something is uncertain, mark it uncertain.
If a claim was superseded, mark what superseded it.
If exact wording matters, preserve the exact words.
```

### 9.2 Micro-checkpoint compactor prompt

```text
You are creating a local working-memory checkpoint for a recently completed exchange.

The checkpoint should be short, typed, and high-signal. It will help a future global compactor preserve important conversational state.

You are not writing durable memory. You are not answering the user. You are not allowed to generalize one participant's preference to all participants.

Classify the exchange as one of:
- completed_topic
- decision
- user_correction
- agent_repair
- relationship_context
- tool_result_processed
- open_question_handoff

Preserve:
- what changed in the conversation state
- who said what
- what the agent must remember to avoid repeating a mistake
- any commitment or unresolved question
- any tone/relationship signal
- any exact wording that matters
- any tool result that was processed, with a handle if raw output can be cleared

Do not summarize unrelated details.
Do not write durable memory.
Do not flatten speaker attribution.
Do not treat unresolved issues as resolved.

Output:
checkpoint_id:
type:
source_event_ids:
state_change:
speaker_attribution:
must_preserve:
may_discard:
do_not_infer:
related_tool_result_refs:
```

Example micro-checkpoint:

```yaml
checkpoint:
  type: user_correction
  source_event_ids: [evt_118, evt_119]
  state_change: >
    The user clarified that the system is not Slack-specific. The architecture
    should be framed as a platform-agnostic shared agent persona with one model
    conversation/context.
  speaker_attribution:
    user_abc: "Clarified that Slack is not the actual scope."
  must_preserve:
    - Do not assume channel/thread/DM semantics.
    - Focus on compacting the live chain of user and assistant messages.
    - Core and archival memory are separate and out of scope for the MVP.
  may_discard:
    - Earlier wording that framed the problem as Slack-specific.
  do_not_infer:
    - Do not infer that no other ingress surfaces exist.
```

### 9.3 Ephemeral tool-result digest prompt

```text
You are replacing a bulky tool result with a compact in-context handle.

Preserve only what the main agent needs to continue:
- what tool was called
- why it was called
- what result mattered
- conclusions already drawn from it
- exact snippets if exact wording matters
- refetch command/instruction
- whether refetch may differ
- source/provenance/timestamp
- when the agent should refetch

Do not keep raw tables, full documents, search dumps, logs, or irrelevant snippets.
Do not drop information that is non-refetchable, safety-relevant, or needed for audit.
Do not invent source details.

Output:
tool_result_ref:
  id:
  tool_name:
  original_call:
  created_at:
  source_event_ids:
  visibility_scope:
  re_fetch_policy:
  refetch_instruction:
  content_hash:
  compact_digest:
  when_to_refetch:
  raw_result_status:
```

Example:

```yaml
tool_result_ref:
  id: toolres_abc123
  tool_name: web_search
  original_call:
    query: "OpenAI Responses API compaction docs"
  created_at: "2026-05-25T..."
  source_event_ids: [evt_204, evt_205]
  visibility_scope: "global_persona"
  re_fetch_policy: "refetch_may_change"
  refetch_instruction: >
    Re-run the same web search or open the OpenAI compaction guide if exact API
    parameters are needed.
  content_hash: "sha256:..."
  compact_digest: >
    OpenAI supports compaction for long-running conversations, including
    server-side and standalone compaction in the Responses API.
  when_to_refetch: >
    Refetch if implementation details, parameter names, or current availability
    are needed.
  raw_result_status: "cleared_from_context"
```

### 9.4 Compact critic prompt

```text
You are auditing a working-memory compact against the source transcript span.

You are not the assistant persona. Do not answer the user. Your job is to find compaction errors.

Check for:
1. Missing commitments.
2. Missing user corrections.
3. Missing assistant mistakes or repairs.
4. Lost speaker attribution.
5. Over-generalization from one user to all users.
6. Uncertain claims made certain.
7. Stale claims not marked stale or superseded.
8. Lost emotional/relationship context.
9. Exact wording that should have been preserved.
10. Tool results cleared without sufficient digest/refetch handle.
11. User-private or scoped information promoted to broader scope.
12. Content that should be forgotten but was preserved.
13. Active unresolved questions incorrectly marked resolved.
14. Current live topic omitted or distorted.

Return:
status: PASS | FAIL
critical_omissions:
unsafe_or_wrong_inclusions:
speaker_attribution_errors:
uncertainty_errors:
tool_state_errors:
suggested_patch:
confidence:
```

### 9.5 Compact patch prompt

```text
You are patching a working-memory compact after critic review.

Inputs:
- original compact
- critic findings
- relevant source transcript excerpts

Rules:
- Apply only necessary corrections.
- Preserve the schema.
- Do not add unsupported details.
- Keep source event IDs.
- Mark uncertainty explicitly.
- Do not make the compact substantially longer unless required for safety or continuity.

Output the revised compact only.
```

### 9.6 Behavioral-equivalence judge prompt

```text
You are evaluating whether a compacted-context assistant response preserves the behavior of a full-transcript assistant response.

You will receive:
- the user probe
- response A generated with full transcript
- response B generated with compact + recent tail
- relevant expected state, if available

Score B relative to A on:
1. factual continuity
2. commitment preservation
3. speaker attribution
4. current task continuity
5. personality/tone continuity
6. uncertainty handling
7. privacy/scope boundaries
8. correction/repair preservation
9. emotional/relationship continuity
10. overall behavioral equivalence

Use:
5 = behaviorally equivalent or better
4 = minor harmless omission
3 = useful but noticeable degradation
2 = important missing state
1 = dangerous or identity-breaking failure

Return:
scores:
critical_differences:
regressions:
acceptable_differences:
overall_score:
pass: true|false
```

### 9.7 Event classifier prompt

```text
Classify the following transcript event for working-memory management.

Labels:
- normal_chat
- user_correction
- assistant_repair
- decision
- commitment
- open_question
- relationship_signal
- style_preference
- tool_result_large
- tool_result_refetchable
- privacy_sensitive
- possible_checkpoint_boundary

Rules:
- Prefer high recall for corrections, commitments, decisions, and privacy.
- Do not infer durable memory.
- If multiple users are present, preserve speaker attribution.
- Mark uncertainty if classification is weak.

Return:
event_id:
labels:
confidence:
rationale:
suggested_runtime_action:
```

---

## 10. Algorithms

### 10.1 Main event loop

```ts
async function handleEvent(event: TranscriptEvent) {
  await transcriptLog.append(event);

  const classification = await classifyEvent(event);
  await eventIndex.storeClassification(classification);

  if (classification.labels.includes("tool_result_large")) {
    await toolResultManager.maybeCreateDigestAndScheduleClear(event, classification);
  }

  if (classification.labels.includes("possible_checkpoint_boundary")) {
    await checkpointPlanner.maybeCreateCheckpoint(event);
  }

  const contextState = await contextBudget.measureActiveContext();

  if (contextState.usagePct >= thresholds.globalCompactPct) {
    await compactionManager.runGlobalCompaction({
      reason: "token_threshold",
      mode: "rolling"
    });
  }

  if (shouldRunPeriodicRebuild()) {
    await compactionManager.runGlobalCompaction({
      reason: "periodic_rebuild",
      mode: "rebuild_from_canonical_log"
    });
  }
}
```

### 10.2 Global compaction

```ts
async function runGlobalCompaction(args: {
  reason: string;
  mode: "rolling" | "rebuild_from_canonical_log";
}) {
  const tailBoundary = await chooseRecentTailBoundary();

  const sourceEvents =
    args.mode === "rolling"
      ? await getEventsSinceLastCompactUntil(tailBoundary)
      : await getCanonicalEventsUntil(tailBoundary);

  const priorCompact =
    args.mode === "rolling"
      ? await compactStore.getCurrent()
      : undefined;

  const checkpoints = await checkpointStore.getUnmergedBefore(tailBoundary);
  const toolRefs = await toolResultStore.getActiveRefsBefore(tailBoundary);

  const draftCompact = await compactor.generate({
    priorCompact,
    sourceEvents,
    checkpoints,
    toolRefs,
    tailBoundary
  });

  const critic = await compactCritic.audit({
    compact: draftCompact,
    sourceEvents,
    checkpoints,
    toolRefs
  });

  const finalCompact =
    critic.status === "PASS"
      ? draftCompact
      : await compactor.patch({ draftCompact, critic, sourceEvents });

  await compactStore.save(finalCompact);
  await transcriptLog.append({
    id: newId(),
    type: "global_compaction",
    createdAt: now(),
    content: JSON.stringify(finalCompact),
    metadata: {
      reason: args.reason,
      mode: args.mode,
      sourceStartEventId: sourceEvents[0]?.id,
      sourceEndEventId: sourceEvents[sourceEvents.length - 1]?.id,
      tailBoundaryEventId: tailBoundary.eventId
    }
  });

  await checkpointStore.markMerged(finalCompact);
}
```

### 10.3 Context assembly

```ts
async function assembleContext(currentUserEvent: TranscriptEvent): Promise<ModelMessage[]> {
  const system = await loadSystemPersona();
  const coreMemory = await maybeLoadCoreMemorySnippets(currentUserEvent);
  const compact = await compactStore.getCurrent();
  const participantRoster = await participantStateStore.getActiveRoster();
  const checkpoints = await checkpointStore.getRecentUnmerged();
  const toolRefs = await toolResultStore.getActiveRefs();
  const recentTail = await transcriptLog.getRecentTail({
    minTurns: 10,
    maxTokens: 20_000,
    neverCompactUnresolvedExchange: true
  });

  return renderModelMessages({
    system,
    coreMemory,
    compact,
    participantRoster,
    checkpoints,
    toolRefs,
    recentTail,
    currentUserEvent
  });
}
```

### 10.4 Tool-result clearing

```ts
async function maybeCreateDigestAndScheduleClear(
  toolResultEvent: TranscriptEvent,
  classification: EventClassification
) {
  const isLarge = classification.labels.includes("tool_result_large");
  const isRefetchable = classification.labels.includes("tool_result_refetchable");

  if (!isLarge) return;

  if (isRefetchable) {
    const ref = await toolResultDigester.createRef(toolResultEvent);
    await toolResultStore.saveRef(ref);
    await toolResultStore.scheduleClear({
      toolResultEventId: toolResultEvent.id,
      retainForTurns: 2,
      clearAtTopicBoundary: true
    });
  } else {
    const compacted = await toolResultDigester.compactNonRefetchable(toolResultEvent);
    await toolResultStore.saveCompactedResult(compacted);
  }
}
```

---

## 11. The canonical working-memory compact template

Use this as the rendered text if not using JSON. JSON/YAML is better for machine validation, but this is easier for the model to read.

```text
<working_memory_compact>
Generated at: ...
Replaces transcript events: ...
Recent verbatim tail starts at event: ...
This compact is live working memory, not durable long-term memory.
It preserves the conversational state needed for the same agent persona to continue naturally.

1. Current live situation
- What is being discussed now:
- What the user is asking for:
- What remains unresolved:
- What the next assistant response should likely do:

2. Participants and attribution
For each participant:
- Speaker ID / display name:
- Role in this conversation:
- Important things they said:
- Local preferences or corrections:
- Do not generalize beyond:

3. Agent self-continuity
- How the agent has been acting:
- Tone/style currently established:
- Commitments about behavior:
- Mistakes made and repairs performed:
- Assumptions explicitly abandoned:

4. Commitments and obligations
- Commitment:
- Made by:
- Made to:
- Status:
- Source events:
- Must preserve exactly? yes/no

5. Decisions and resolved conclusions
- Decision/conclusion:
- Who established it:
- Evidence/rationale:
- Supersedes:
- Confidence:

6. Open questions and uncertainties
- Question:
- Current hypotheses:
- What would resolve it:
- Whether to ask, infer, or research:

7. Corrections and anti-repetition rules
- User corrected:
- Assistant must now understand:
- Failure to avoid:

8. Emotional and relational state
- Rapport:
- Friction/frustration:
- Humor/running jokes:
- Sensitivities:

9. Important chronology
- Concise event list with source events.

10. Exact snippets worth preserving
- Speaker:
- Exact text:
- Why exact wording matters:

11. Tool state
- Tool call:
- Result digest:
- Refetch handle:
- Whether raw result was cleared:
- Whether result may have changed:

12. Do not infer / do not remember as durable fact
- Items that should remain local, uncertain, private, or discarded.

13. Recent tail boundary
- The raw transcript continues from event ...
</working_memory_compact>
```

---

## 12. What works

### 12.1 Typed compaction capsules

Structured compacts outperform freeform summaries for this use case because they force the model to preserve state classes that generic summarizers drop.

Especially important fields:

```text
participants
commitments
user corrections
agent repairs
open questions
emotional state
tool handles
do_not_infer
```

### 12.2 Recent verbatim tail

Keep recent turns raw. Summaries are worst near the live edge of the conversation because tone, pronouns, and unresolved references are dense.

### 12.3 Semantic micro-checkpoints

The user-proposed "summarize recent history while fresh" idea is strong. Implement it as semantic checkpointing, not arbitrary last-N summarization.

Strong checkpoint types:

```text
user_correction
agent_repair
decision
tool_result_processed
relationship_context
open_question_handoff
completed_topic
```

### 12.4 Ephemeral tool-result handles

This is a high-confidence MVP feature. It saves tokens while preserving recoverability.

### 12.5 Separate compaction role/call

Best practice is to separate compaction from the main persona as a runtime operation.

Important nuance:

```text
separate compaction role/call: yes
separate underlying model: optional
```

Use strong models for global compaction. Use cheaper models for tool digests and simple micro-checkpoints if evals pass.

### 12.6 Compact critic

Use a critic pass to catch lost commitments, lost corrections, merged users, and uncertainty hardening.

### 12.7 Periodic rebuild

Rolling compaction is efficient but drift-prone. Rebuild from canonical transcript periodically.

---

## 13. What fails

### 13.1 Freeform "summarize conversation so far"

Common failures:

- drops who said what;
- erases assistant mistakes;
- treats corrections as generic facts;
- collapses many users into "the user";
- converts uncertainty to certainty;
- loses emotional state;
- over-preserves stale or irrelevant details;
- discards exact language.

### 13.2 Oldest-message trimming as the primary mechanism

This deletes the origins of commitments and repairs. It is acceptable only for known-low-value content.

### 13.3 Undifferentiated vector retrieval

Vector retrieval can recover old content, but it does not maintain the agent's current conversational self. It also struggles with authority, contradiction, and recency.

### 13.4 Opaque provider compaction as the only state

Opaque compaction is not inspectable enough for an employee-like persona. It may be an optimization, not the canonical product state.

### 13.5 Tool clearing without digest/refetch handle

A placeholder like "tool result removed" is insufficient. The agent needs a digest, provenance, and refetch instruction.

### 13.6 Treating many users as one user

"The user wants..." is dangerous in a shared multi-user persona. Use speaker IDs and scoping.

---

## 14. Evaluation plan

### 14.1 Primary eval: behavioral equivalence

For each test transcript:

```text
A = model response with full transcript
B = model response with compact + recent tail
Judge whether B preserves the same behavior.
```

Score dimensions:

```text
- factual continuity
- commitment preservation
- speaker attribution
- current task continuity
- tone/personality continuity
- uncertainty handling
- privacy/scope boundaries
- correction/repair preservation
- emotional/relationship continuity
- overall behavioral equivalence
```

Rubric:

```text
5 = behaviorally equivalent or better
4 = minor harmless omission
3 = useful but noticeable degradation
2 = important missing state
1 = dangerous or identity-breaking failure
```

### 14.2 Probe categories

| Probe | What it tests |
|---|---|
| Commitment recall | Does the agent remember what it promised? |
| Correction recall | Does it avoid repeating a corrected mistake? |
| Speaker attribution | Does it know who said what? |
| Multi-user boundary | Does it avoid applying Alice's preference to Bob? |
| Live-topic continuity | Does it answer the unresolved current question? |
| Emotional continuity | Does it preserve rapport, apology, frustration, humor? |
| Persona continuity | Does it sound like the same teammate? |
| Tool refetch | Can it recover cleared tool details when needed? |
| Staleness | Does recent info override old compacted info? |
| Uncertainty | Does it preserve "maybe" vs "known"? |
| Privacy | Does it avoid leaking scoped/local context? |
| Compaction drift | Does behavior degrade after repeated compactions? |

### 14.3 Synthetic transcript generator

Generate adversarial transcripts containing:

```text
- 3–10 participants;
- changing preferences;
- agent mistakes and user corrections;
- commitments spread far apart;
- tool calls with large outputs;
- stale facts later superseded;
- emotional repair events;
- running jokes;
- private/local facts;
- ambiguous pronouns;
- topic switches and returns.
```

### 14.4 Evaluation datasets to build

Build internal datasets:

1. **Correction-preservation set**
   - Transcript contains an assistant bad assumption and user correction.
   - Probe asks a similar question later.
   - Failure: agent repeats old assumption.

2. **Multi-user attribution set**
   - Alice and Bob give conflicting preferences.
   - Probe asks agent to act for Bob.
   - Failure: agent applies Alice's preference to Bob.

3. **Commitment set**
   - Agent promises to follow a response style or preserve a constraint.
   - Probe tests whether it remembers.

4. **Relationship-state set**
   - User is frustrated; assistant repairs.
   - Probe tests whether tone remains calibrated.

5. **Tool-clear refetch set**
   - Tool result was cleared.
   - Probe asks for exact detail not in digest.
   - Expected: agent refetches rather than hallucinating.

6. **Uncertainty set**
   - Transcript contains uncertain claim later partially resolved.
   - Probe tests whether uncertainty is preserved.

7. **Drift set**
   - Repeated compactions over many synthetic episodes.
   - Probe after 5, 10, 20 compaction cycles.

### 14.5 Metrics

Track:

```text
compact_token_count
raw_tokens_replaced
compression_ratio
critic_fail_rate
patch_rate
behavioral_equivalence_score
commitment_recall_score
correction_recall_score
speaker_attribution_score
privacy_violation_rate
tool_refetch_success_rate
unnecessary_refetch_rate
latency_added_ms
cost_added
drift_after_n_compactions
```

---

## 15. MVP experiments

### Experiment 1: Compaction baselines

Compare:

```text
A. Last-N messages only
B. Freeform "summarize conversation so far"
C. Provider-native compaction only
D. Typed working-memory compact only
E. Typed compact + recent verbatim tail
F. Typed compact + recent tail + micro-checkpoints
G. Typed compact + recent tail + micro-checkpoints + ephemeral tool handles
```

Expected outcome:

```text
E/F/G should dominate B/C on persona continuity, correction preservation, and multi-user attribution.
```

### Experiment 2: Micro-checkpoints vs threshold-only compaction

Conditions:

```text
1. Wait until threshold, then compact.
2. Create semantic checkpoints throughout, then compact.
3. Create checkpoints but do not include them in global compact.
```

Measure:

```text
- correction preservation
- decision preservation
- emotional context preservation
- compact length
- critic failure rate
```

Hypothesis:

```text
Semantic checkpoints improve high-value recall and reduce global compactor omissions.
```

### Experiment 3: Tool-result TTLs

Try:

```text
raw tool result retained for 0 turns
raw tool result retained for 1 turn
raw tool result retained for 3 turns
raw tool result retained until topic boundary
raw tool result retained until token pressure
```

Measure:

```text
token savings
answer quality
refetch success
unnecessary refetches
lost exact evidence
```

Hypothesis:

```text
1–3 turns plus topic-boundary clearing is best for most re-fetchable tools.
```

### Experiment 4: Recursive vs rebuilt compact

Compare:

```text
old compact + new chunk -> new compact
```

against:

```text
canonical transcript prefix -> rebuilt compact
```

Measure drift after:

```text
5 compactions
10 compactions
20 compactions
```

Expected outcome:

```text
Recursive is cheaper and faster; periodic rebuild catches drift.
```

### Experiment 5: Multi-user attribution stress

Create transcripts where users disagree, correct one another, and reveal scoped/private information.

Expected compact language:

```text
Alice said X.
Bob said Y.
Do not generalize Alice's preference to Bob.
```

Failure language:

```text
The user wants X.
```

---

## 16. Recommended implementation plan

### Phase 0: Instrumentation

Build:

```text
- canonical transcript event log
- token counting and context budget monitor
- active context assembler
- event IDs everywhere
- source-event references in messages/tool calls
```

Deliverables:

```text
src/context/EventLog.ts
src/context/TokenBudget.ts
src/context/ContextAssembler.ts
```

### Phase 1: Typed global compact

Build:

```text
- WorkingMemoryCompact schema
- global compactor prompt
- compact renderer
- compaction threshold trigger
- recent verbatim tail policy
```

Deliverables:

```text
src/compaction/WorkingMemoryCompact.ts
src/compaction/GlobalCompactor.ts
src/compaction/prompts/globalCompactorPrompt.ts
src/compaction/RecentTailPolicy.ts
```

### Phase 2: Compact critic

Build:

```text
- critic prompt
- patch prompt
- critic failure logs
- compact diff view
```

Deliverables:

```text
src/compaction/CompactCritic.ts
src/compaction/prompts/compactCriticPrompt.ts
src/compaction/prompts/compactPatchPrompt.ts
```

### Phase 3: Ephemeral tool-result clearing

Build:

```text
- tool-result classifier
- tool digest schema
- TTL clearing
- refetch handles
- refetch-on-demand behavior
```

Deliverables:

```text
src/tools/ToolResultManager.ts
src/tools/ToolResultRef.ts
src/tools/prompts/toolResultDigestPrompt.ts
```

### Phase 4: Semantic micro-checkpoints

Build:

```text
- agent-facing request_working_memory_checkpoint tool
- runtime validation
- checkpoint compactor
- checkpoint critic
- global compact merge behavior
```

Deliverables:

```text
src/checkpoints/MicroCheckpoint.ts
src/checkpoints/CheckpointPlanner.ts
src/checkpoints/CheckpointCompactor.ts
src/checkpoints/prompts/microCheckpointPrompt.ts
```

### Phase 5: Eval harness

Build:

```text
- full-transcript vs compacted-context A/B harness
- judge prompt
- synthetic transcript generator
- metrics dashboard
```

Deliverables:

```text
src/evals/BehavioralEquivalenceEval.ts
src/evals/SyntheticTranscriptGenerator.ts
src/evals/prompts/behavioralEquivalenceJudgePrompt.ts
```

### Phase 6: Rebuild and drift detection

Build:

```text
- periodic rebuild from canonical transcript
- compact-vs-rebuild diff
- drift alerts
```

Deliverables:

```text
src/compaction/CompactRebuilder.ts
src/compaction/CompactDriftDetector.ts
```

---

## 17. Suggested module layout

```text
src/
  context/
    EventLog.ts
    ContextAssembler.ts
    TokenBudget.ts
    RecentTailPolicy.ts
    ActiveContextRenderer.ts

  compaction/
    WorkingMemoryCompact.ts
    GlobalCompactor.ts
    CompactCritic.ts
    CompactRebuilder.ts
    CompactDriftDetector.ts
    prompts/
      globalCompactorPrompt.ts
      compactCriticPrompt.ts
      compactPatchPrompt.ts

  checkpoints/
    MicroCheckpoint.ts
    CheckpointPlanner.ts
    CheckpointCompactor.ts
    CheckpointValidator.ts
    prompts/
      microCheckpointPrompt.ts

  tools/
    ToolResultManager.ts
    ToolResultRef.ts
    ToolResultDigester.ts
    ToolResultRefetcher.ts
    prompts/
      toolResultDigestPrompt.ts

  classifiers/
    EventClassifier.ts
    prompts/
      eventClassifierPrompt.ts

  evals/
    BehavioralEquivalenceEval.ts
    SyntheticTranscriptGenerator.ts
    ProbeSuites.ts
    Metrics.ts
    prompts/
      behavioralEquivalenceJudgePrompt.ts

  providers/
    NativeCompactionProvider.ts
    OpenAICompactionProvider.ts
    AnthropicCompactionProvider.ts
    ModelCompactionProvider.ts

  persistence/
    CompactStore.ts
    CheckpointStore.ts
    ToolResultStore.ts
    TranscriptStore.ts
```

---

## 18. Build checklist for Codex

### Must implement first

- [ ] Append-only canonical transcript log with event IDs.
- [ ] WorkingMemoryCompact schema.
- [ ] Context assembler: system + compact + checkpoints + tool refs + recent tail + current message.
- [ ] Global compactor prompt and model call.
- [ ] Recent verbatim tail selection.
- [ ] Compact critic prompt and model call.
- [ ] Token budget monitor.
- [ ] Metrics for compact size and compression ratio.

### Should implement next

- [ ] ToolResultRef schema.
- [ ] Tool-result digest prompt.
- [ ] TTL clearing for large re-fetchable tool results.
- [ ] Refetch-on-demand policy.
- [ ] Agent-facing `mark_tool_result_ephemeral` request tool.

### Then implement

- [ ] MicroCheckpoint schema.
- [ ] Agent-facing `request_working_memory_checkpoint` request tool.
- [ ] Checkpoint validation and compaction.
- [ ] Global compact merge of micro-checkpoints.

### Evals

- [ ] Behavioral-equivalence judge.
- [ ] Synthetic transcript generator.
- [ ] Probe suites for corrections, commitments, multi-user attribution, tool refetch, emotional continuity.
- [ ] Drift evaluation after repeated compaction.

---

## 19. Practical choices and defaults

### 19.1 Model choices

Use separate compaction **role/call**. Underlying model may vary.

Recommended defaults:

| Operation | Suggested model tier |
|---|---|
| Tool-result digest | cheap/mid model |
| Micro-checkpoint | cheap/mid model, unless high-risk |
| Global compact | same tier as main model or one tier below only after evals |
| Compact critic | same tier as global compact |
| Periodic rebuild | strong model |

### 19.2 Provider-native compaction

Implement a provider abstraction, but do not make provider-native opaque compaction canonical.

```ts
export interface CompactionProvider {
  compact(input: CompactionInput): Promise<CompactionOutput>;
  supportsNativeCompaction(): boolean;
}
```

Use native compaction for:

```text
- baseline comparisons;
- emergency fallback;
- cost/performance experiments;
- non-critical contexts.
```

Use typed compact for:

```text
- canonical state;
- debugging;
- product behavior;
- evals.
```

### 19.3 Tail boundary selection

Prefer semantic boundaries. If not available, use token/turn boundary.

Algorithm sketch:

```text
1. Identify current unresolved exchange.
2. Walk backward until reaching:
   - topic boundary, or
   - acknowledged correction boundary, or
   - max tail tokens.
3. Ensure tail includes:
   - current user message;
   - last assistant response;
   - any message with unresolved pronouns/references;
   - any user correction not yet stabilized.
```

### 19.4 Compact length target

Initial targets:

```text
normal global compact: 2k–8k tokens
large global compact: 8k–16k tokens
micro-checkpoint: 100–500 tokens
tool digest: 50–500 tokens
```

Tune based on context window and evals.

### 19.5 Critic fail policy

```text
if critic fails for missing correction/commitment/privacy:
  patch and re-run critic

if critic fails twice:
  keep larger raw span in recent tail
  raise metric/alert

if emergency token pressure:
  prefer high-recall longer compact over over-compression
```

---

## 20. Risks and mitigations

### Risk: The compact becomes self-authorizing fiction

Mitigation:

```text
- source event IDs
- critic pass
- periodic rebuild
- transcript source of truth
```

### Risk: User content becomes instruction hierarchy

Mitigation:

```text
- compact separates user claims from governing instructions
- never promote user requests into system/developer authority
- include "local/session-only" scope
```

### Risk: Multi-user context leakage

Mitigation:

```text
- speaker IDs everywhere
- visibility scopes
- do_not_generalize rules
- privacy evals
```

### Risk: Assistant hides mistakes through compaction

Mitigation:

```text
- compactor is separate role
- compact must include agent repairs
- critic checks erased mistakes
```

### Risk: Tool result is needed later but was cleared

Mitigation:

```text
- digest + refetch handle
- preserve exact excerpts when needed
- classify non-refetchable results
- keep cache outside context
```

### Risk: Summary drift over recursive compactions

Mitigation:

```text
- canonical transcript log
- periodic rebuild
- compact diff and drift detector
```

### Risk: Too much compact bloat

Mitigation:

```text
- prioritize high-signal categories
- merge obsolete checkpoints
- expire low-value relationship notes
- compression targets
```

---

## 21. Open design questions

These need empirical tuning:

1. How large should the recent verbatim tail be for your main model?
2. What threshold should trigger global compaction?
3. How often should periodic rebuild happen?
4. Should micro-checkpoints be included directly in context or only fed into global compaction?
5. Which tool results are truly re-fetchable?
6. What participant visibility scopes are required for privacy?
7. How often does the main agent request useful checkpoints vs noisy ones?
8. Which model is cost-effective for global compaction without degrading persona continuity?
9. Should the compact be JSON, YAML, or text sections?
10. How much emotional/relationship state is useful before it becomes creepy or stale?

---

## 22. Source bibliography

### Commercial / product documentation

1. OpenAI — Compaction guide  
   https://developers.openai.com/api/docs/guides/compaction

2. OpenAI — Compact a response API reference  
   https://developers.openai.com/api/reference/resources/responses/methods/compact/

3. Anthropic — Claude API compaction docs  
   https://platform.claude.com/docs/en/build-with-claude/compaction

4. Anthropic — Context editing docs  
   https://platform.claude.com/docs/en/build-with-claude/context-editing

5. Anthropic — Context engineering: memory, compaction, and tool clearing  
   https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools

6. Anthropic — Effective context engineering for AI agents  
   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

7. LangChain — Short-term memory docs  
   https://docs.langchain.com/oss/python/langchain/short-term-memory

8. LangChain — Context engineering docs  
   https://docs.langchain.com/oss/python/langchain/context-engineering

9. LangChain — Context Engineering blog  
   https://www.langchain.com/blog/context-engineering-for-agents

10. Inspect AI — Compaction docs  
    https://inspect.aisi.org.uk/compaction.html

11. Claude Code — Context window docs  
    https://code.claude.com/docs/en/context-window

12. Claude Code — Subagents docs  
    https://code.claude.com/docs/en/sub-agents

13. Claude Code — Best practices  
    https://code.claude.com/docs/en/best-practices

14. Letta — Compaction/summarization docs  
    https://docs.letta.com/guides/core-concepts/messages/compaction/

### Academic / research

15. Liu et al. — Lost in the Middle: How Language Models Use Long Contexts  
    https://aclanthology.org/2024.tacl-1.9/  
    https://arxiv.org/abs/2307.03172

16. Wang et al. — Recursively Summarizing Enables Long-Term Dialogue Memory in Large Language Models  
    https://arxiv.org/abs/2308.15022

17. Wu et al. — ReSum: Unlocking Long-Horizon Search Intelligence via Context Summarization  
    https://arxiv.org/html/2509.13313v2  
    https://openreview.net/forum?id=PjIK38mwKm

18. Li et al. — Prompt Compression for Large Language Models: A Survey  
    https://arxiv.org/abs/2410.12388

19. Jiang et al. — LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression  
    https://arxiv.org/abs/2310.06839

20. Park et al. — Generative Agents: Interactive Simulacra of Human Behavior  
    https://arxiv.org/abs/2304.03442

21. Shinn et al. — Reflexion: Language Agents with Verbal Reinforcement Learning  
    https://arxiv.org/abs/2303.11366

22. Maharana et al. — Evaluating Very Long-Term Conversational Memory of LLM Agents / LoCoMo  
    https://arxiv.org/abs/2402.17753  
    https://snap-research.github.io/locomo/

23. Tavakoli et al. — BEAM: Benchmarking and Enhancing Long-Term Memory in LLMs  
    https://openreview.net/forum?id=y59hf5lrMn  
    https://github.com/mohammadtavakoli78/BEAM

24. Hu et al. — MemoryAgentBench / Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions  
    https://arxiv.org/abs/2507.05257  
    https://github.com/HUST-AI-HYZ/MemoryAgentBench

25. Packer et al. — MemGPT: Towards LLMs as Operating Systems  
    https://arxiv.org/abs/2310.08560

26. Chhikara et al. — Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory  
    https://arxiv.org/abs/2504.19413

27. Rasmussen et al. — Zep: A Temporal Knowledge Graph Architecture for Agent Memory  
    https://arxiv.org/abs/2501.13956

28. Graphiti repository  
    https://github.com/getzep/graphiti

---

## 23. One-page implementation summary

Build this:

```text
canonical transcript log
→ event classifier
→ tool-result digester/clearer
→ semantic checkpoint planner
→ global typed compactor
→ compact critic/patcher
→ context assembler
→ behavioral-equivalence eval harness
```

Do not build only this:

```text
if tokens > limit:
  summary = summarize(messages)
  messages = [summary, last_n_messages]
```

The core product insight:

> The compact is not a summary. It is the live, bounded, editable representation of the agent persona's conversational self.

The MVP should prove that:

```text
compact + recent tail
```

produces responses behaviorally equivalent to:

```text
full transcript
```

on custom tests for:

```text
speaker attribution
commitments
corrections
agent repairs
relationship state
tool refetch
uncertainty
privacy boundaries
persona continuity
```
