"""Convert lace events.jsonl session logs to ATIF v1.7 trajectory format.

Reads lace's event-sourced session log and produces a trajectory.json file
compatible with harbor's dashboard and trajectory validator.

v1.7 additions over v1.6:
  - Per-step token usage from enriched turn_end events
  - Agent metadata: persona, config (reasoning_effort)
  - Final metrics: total tokens and cost from state.json

Usage as CLI:
    python lace_trajectory.py <state_dir> <output_dir> [--model MODEL] [--provider PROVIDER]

Usage as library:
    from lace_trajectory import convert_lace_to_atif
    convert_lace_to_atif(state_dir, output_dir, model="gpt-5.2-codex", provider="openai")
"""

import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _extract_text(content_parts):
    """Concatenate text from an array of content parts.

    Args:
        content_parts: List of {type, text, ...} dicts from lace events.

    Returns:
        Concatenated text string, or empty string if no text parts found.
    """
    if not content_parts or not isinstance(content_parts, list):
        return ""
    texts = []
    for part in content_parts:
        if isinstance(part, dict) and part.get("type") == "text":
            text = part.get("text", "")
            if text:
                texts.append(text)
    return "\n".join(texts)


def _build_steps(events, subagent_events=None):
    """Convert a list of lace events into ATIF steps.

    Each tool_use becomes its own agent step (one step per tool call), matching
    the granular structure that harbor's dashboard expects. Any agent message
    text preceding a tool call is attached to that step. Trailing messages
    after the last tool call in a turn get their own step.

    When a job_session_assigned event is encountered and subagent_events
    contains events for that session, the subagent's events are recursively
    converted to steps and inlined at that point in the trajectory.

    When a turn_end event includes usage data, it is attached to the last
    agent step emitted during that turn.

    Args:
        events: List of event dicts from a single session's events.jsonl.
        subagent_events: Dict mapping session ID to list of events for that
            session. Used to inline subagent steps at delegation points.

    Returns:
        List of ATIF step dicts (step_ids assigned sequentially starting from 1).
    """
    if subagent_events is None:
        subagent_events = {}

    steps = []
    step_counter = 0

    # State for accumulating within an agent turn
    in_turn = False
    turn_timestamp = None
    pending_messages = []  # agent message texts before the next tool_use
    turn_start_step_index = None  # index of first step in current turn

    def _emit_step(source, message="", timestamp=None,
                   tool_calls=None, observation=None):
        nonlocal step_counter
        step_counter += 1
        step = {
            "step_id": step_counter,
            "source": source,
            "message": message,
        }
        if timestamp:
            step["timestamp"] = timestamp
        if tool_calls:
            step["tool_calls"] = tool_calls
        if observation:
            step["observation"] = observation
        steps.append(step)

    def _inline_subagent_steps(sub_steps):
        """Add subagent steps to the trajectory, renumbering step_ids."""
        nonlocal step_counter
        for sub_step in sub_steps:
            step_counter += 1
            sub_step["step_id"] = step_counter
            steps.append(sub_step)

    for event in events:
        event_type = event.get("type")
        data = event.get("data", {})
        timestamp = event.get("timestamp")

        if event_type == "context_injected":
            _emit_step("system", _extract_text(data.get("content", [])),
                        timestamp)

        elif event_type == "prompt":
            _emit_step("user", _extract_text(data.get("content", [])),
                        timestamp)

        elif event_type == "turn_start":
            in_turn = True
            turn_timestamp = timestamp
            pending_messages = []
            turn_start_step_index = len(steps)

        elif event_type == "message":
            if in_turn:
                text = _extract_text(data.get("content", []))
                if text:
                    pending_messages.append(text)

        elif event_type == "tool_use":
            if in_turn:
                # Emit one agent step per tool call, with any preceding
                # message text attached.
                message_text = "\n".join(pending_messages)
                pending_messages = []

                tool_call_id = data.get("toolCallId", "")
                tool_call = {
                    "tool_call_id": tool_call_id,
                    "function_name": data.get("name", "unknown"),
                    "arguments": data.get("input", {}),
                }

                obs = None
                result = data.get("result")
                if result:
                    content_text = _extract_text(result.get("content", []))
                    obs = {"results": [{
                        "source_call_id": tool_call_id,
                        "content": content_text,
                    }]}

                _emit_step("agent", message_text,
                           timestamp or turn_timestamp,
                           [tool_call], obs)

        elif event_type == "job_started":
            if in_turn:
                message_text = "\n".join(pending_messages)
                pending_messages = []
                job_id = data.get("jobId", "")
                arguments = {}
                if data.get("command"):
                    arguments["command"] = data["command"]
                if data.get("description"):
                    arguments["description"] = data["description"]
                _emit_step("agent", message_text,
                           timestamp or turn_timestamp,
                           [{"tool_call_id": job_id,
                             "function_name": data.get("jobType", "job"),
                             "arguments": arguments}])

        elif event_type == "job_session_assigned":
            sub_session_id = data.get("subagentSessionId", "")
            if sub_session_id in subagent_events:
                sub_steps = _build_steps(
                    subagent_events[sub_session_id], subagent_events
                )
                _inline_subagent_steps(sub_steps)
            elif sub_session_id:
                logger.warning(
                    "Subagent session %s not found in state directory",
                    sub_session_id,
                )

        elif event_type == "job_finished":
            if in_turn:
                job_id = data.get("jobId", "")
                outcome = data.get("outcome", "unknown")
                exit_code = data.get("exitCode")
                content = (f"Job {outcome} (exit code: {exit_code})"
                           if exit_code is not None else f"Job {outcome}")
                # Attach observation to the step that started this job.
                for s in reversed(steps):
                    for tc in s.get("tool_calls", []):
                        if tc.get("tool_call_id") == job_id:
                            if "observation" not in s:
                                s["observation"] = {"results": []}
                            s["observation"]["results"].append({
                                "source_call_id": job_id,
                                "content": content,
                            })
                            break
                    else:
                        continue
                    break

        elif event_type == "turn_end":
            # Emit any trailing messages as a final agent step.
            if in_turn and pending_messages:
                _emit_step("agent", "\n".join(pending_messages),
                           turn_timestamp)

            # Attach turn usage to the last agent step in this turn.
            usage = data.get("usage")
            if usage and turn_start_step_index is not None:
                for s in reversed(steps[turn_start_step_index:]):
                    if s.get("source") == "agent":
                        s["usage"] = {
                            "input_tokens": usage.get("inputTokens", 0),
                            "output_tokens": usage.get("outputTokens", 0),
                            "cost_usd": usage.get("costUsd", 0),
                        }
                        break

            in_turn = False
            turn_timestamp = None
            pending_messages = []
            turn_start_step_index = None

        else:
            logger.debug("Skipping unknown event type: %s", event_type)

    # Flush trailing turn if turn_end was missing.
    if in_turn and pending_messages:
        _emit_step("agent", "\n".join(pending_messages), turn_timestamp)

    return steps


def _read_events(events_path):
    """Read events from a JSONL file, skipping malformed lines.

    Returns a list of parsed event dicts.
    """
    events = []
    with open(events_path, "r") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError as e:
                logger.warning("Skipping malformed event at line %d: %s",
                               line_num, e)
    return events


def _read_session_state(session_dir):
    """Read state.json from a session directory for final metrics.

    Returns a dict with sessionCostUsd and tokenUsage, or empty dict.
    """
    state_path = session_dir / "state.json"
    if not state_path.is_file():
        return {}
    try:
        with open(state_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Could not read state.json: %s", e)
        return {}


def _find_parent_session(session_dirs):
    """Identify the parent session among multiple session directories.

    The parent session is the one with the earliest 'created' timestamp
    in its meta.json. Falls back to directory name sort if meta.json is
    missing or unparseable.

    Returns (parent_dir, other_dirs) tuple.
    """
    # Read created timestamps from meta.json for each session
    sessions_with_times = []
    for d in session_dirs:
        meta_path = d / "meta.json"
        created = None
        if meta_path.is_file():
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                created = meta.get("created")
            except (json.JSONDecodeError, OSError):
                pass
        sessions_with_times.append((d, created or ""))

    # Sort by created timestamp (earliest first), with fallback to dir name
    sessions_with_times.sort(key=lambda x: (x[1], x[0].name))

    parent_dir = sessions_with_times[0][0]
    other_dirs = [d for d, _ in sessions_with_times[1:]]
    return parent_dir, other_dirs


def convert_lace_to_atif(state_dir, output_dir, model=None, provider=None,
                          persona=None, reasoning_effort=None):
    """Convert lace session events to an ATIF v1.7 trajectory file.

    When delegation (subagents) is used, the state directory will contain
    multiple session directories. The parent session is identified by the
    earliest creation timestamp. Subagent sessions are inlined at the point
    where they were spawned (at the job_session_assigned event in the parent).

    Args:
        state_dir: Path to the lace state directory containing agent-sessions/.
        output_dir: Path where trajectory.json will be written.
        model: Model name (e.g. "gpt-5.2-codex"). Used in agent metadata.
        provider: Provider name (e.g. "openai"). Used in agent metadata.
        persona: Persona name (e.g. "benchmark-h20"). Stored in agent metadata.
        reasoning_effort: Reasoning effort level (e.g. "high"). Stored in config.
    """
    state_dir = Path(state_dir)
    output_dir = Path(output_dir)

    # Find the session directories
    sessions_dir = state_dir / "agent-sessions"
    if not sessions_dir.is_dir():
        logger.warning("No agent-sessions directory found in %s", state_dir)
        return

    session_dirs = [d for d in sessions_dir.iterdir() if d.is_dir()]
    if not session_dirs:
        logger.warning("No session directories found in %s", sessions_dir)
        return

    # Identify parent session (earliest created) and read all sessions
    parent_dir, other_dirs = _find_parent_session(session_dirs)

    # Read parent meta.json for session_id
    meta_path = parent_dir / "meta.json"
    session_id = parent_dir.name  # fallback
    if meta_path.is_file():
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
            session_id = meta.get("sessionId", session_id)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Could not read meta.json: %s", e)

    # Read parent events
    events_path = parent_dir / "events.jsonl"
    if not events_path.is_file():
        logger.warning("No events.jsonl found at %s", events_path)
        return

    events = _read_events(events_path)
    if not events:
        logger.warning("No events found in %s", events_path)
        return

    # Read session state for final metrics
    session_state = _read_session_state(parent_dir)

    # Read subagent session events, keyed by session ID
    subagent_events = {}
    for d in other_dirs:
        sub_events_path = d / "events.jsonl"
        if sub_events_path.is_file():
            sub_id = d.name
            # Prefer sessionId from meta.json
            sub_meta_path = d / "meta.json"
            if sub_meta_path.is_file():
                try:
                    with open(sub_meta_path, "r") as f:
                        sub_meta = json.load(f)
                    sub_id = sub_meta.get("sessionId", sub_id)
                except (json.JSONDecodeError, OSError):
                    pass
            subagent_events[sub_id] = _read_events(sub_events_path)

    if subagent_events:
        logger.info("Found %d subagent session(s): %s",
                     len(subagent_events),
                     ", ".join(sorted(subagent_events.keys())))

    # Build ATIF steps (inlining subagent events at delegation points)
    steps = _build_steps(events, subagent_events)
    if not steps:
        logger.warning("No steps produced from events")
        return

    # Build model_name for agent metadata
    model_name = None
    if provider and model:
        model_name = f"{provider}/{model}"
    elif model:
        model_name = model

    # Assemble agent metadata
    agent_info = {
        "name": "lace",
        "version": "0.1.0",
    }
    if model_name:
        agent_info["model_name"] = model_name
    if persona:
        agent_info["persona"] = persona

    # Build config from available metadata
    config = {}
    if reasoning_effort:
        config["reasoning_effort"] = reasoning_effort
    if config:
        agent_info["config"] = config

    # Build final metrics from session state
    final_metrics = {
        "total_steps": len(steps),
    }
    token_usage = session_state.get("tokenUsage")
    if token_usage:
        final_metrics["total_input_tokens"] = token_usage.get("totalInputTokens", 0)
        final_metrics["total_output_tokens"] = token_usage.get("totalOutputTokens", 0)
    cost = session_state.get("sessionCostUsd")
    if cost is not None:
        final_metrics["total_cost_usd"] = cost

    # Assemble trajectory
    trajectory = {
        "schema_version": "ATIF-v1.6",
        "session_id": session_id,
        "agent": agent_info,
        "steps": steps,
        "final_metrics": final_metrics,
    }

    # Write output
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "trajectory.json"
    with open(output_path, "w") as f:
        json.dump(trajectory, f, indent=2)

    logger.info("Wrote ATIF trajectory to %s (%d steps)", output_path, len(steps))


def main():
    """CLI entrypoint."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Convert lace events.jsonl to ATIF v1.7 trajectory format"
    )
    parser.add_argument("state_dir", help="Path to lace state directory")
    parser.add_argument("output_dir", help="Path to write trajectory.json")
    parser.add_argument("--model", default=None, help="Model name (e.g. gpt-5.2-codex)")
    parser.add_argument("--provider", default=None, help="Provider name (e.g. openai)")
    parser.add_argument("--persona", default=None, help="Persona name (e.g. benchmark-h20)")
    parser.add_argument("--reasoning-effort", default=None, help="Reasoning effort level")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    convert_lace_to_atif(args.state_dir, args.output_dir, args.model, args.provider,
                          args.persona, args.reasoning_effort)


if __name__ == "__main__":
    main()
