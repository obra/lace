# Subagent Conversation Feature Specification

**Goal:** Enable parent agent to have back-and-forth conversation with subagents.

**Architecture:** Subagent outputs question and stops. Parent sees output, resumes with answer using `delegate(resume=jobId, prompt=answer)`.

---

## Current State

Everything we need already exists:

1. **`delegate.resume`** - resumes a job's session with a new prompt
2. **Job output** - parent can read via streaming or `job_output` tool
3. **Job notifications** - parent gets notified when jobs complete

---

## What's Missing

1. **Notifications don't show enough context** - parent should see the question
2. **Prompts don't explain this** - agents don't know they can converse with subagents

---

## Implementation

### Task 1: Enhanced Job Notifications

**Files:**
- Modify: `packages/agent/src/jobs/job-notifications.ts`
- Modify: `packages/agent/src/jobs/format-notification.ts`

Include last 5-10 lines of output in completion notifications:

```
[JOB COMPLETED] job_abc123

Recent output:
> I need to know which database to use.
> Should I use PostgreSQL or SQLite for this project?

To continue: delegate(resume="job_abc123", prompt="your response")
```

---

### Task 2: Update delegate Tool Description

**Files:**
- Modify: `packages/agent/src/tools/implementations/delegate.ts`

Update description to explain conversation flow:

```typescript
description = `Spawn a subagent to handle a task autonomously.

Parameters:
- prompt: The task or message for the subagent (required)
- description: Label shown in job listings (optional)
- background: Return immediately with jobId (default: false)
- resume: JobId of a previous job to continue its conversation

**Conversing with subagents:**
Use resume to continue a conversation with a completed subagent.
If a subagent asked a question, respond with:
  delegate(resume="<jobId>", prompt="your answer")

The subagent's session is preserved - it will see your response
as a continuation of the conversation.`;
```

---

### Task 3: Update System Prompts

**Files:**
- Modify: `packages/agent/config/agent-personas/sections/delegation.md`

Add guidance:

```markdown
## Conversing with Subagents

Subagents can ask questions. The conversation flow:

1. Subagent outputs a question and completes
2. You see the question in the job notification
3. You respond: `delegate(resume="<jobId>", prompt="your answer")`
4. Subagent resumes with your answer in context

**For subagents:** If you need input from the parent, clearly state
your question and stop. The parent can resume you with the answer.
```

---

## Flow

```
Parent: delegate(prompt="do X")
Subagent: (works...) outputs "Which DB?" → stops
Parent: (notification shows "Which DB?")
Parent: delegate(resume=jobId, prompt="PostgreSQL")
Subagent: (resumes, continues with answer)
```

---

## Summary

- **No new tools** - existing delegate handles everything
- **Better notifications** - include recent output
- **Better prompts** - explain the conversation pattern

The mechanism exists. We're just documenting it.
