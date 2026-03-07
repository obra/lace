"""Tests for lace_trajectory.py — ATIF v1.7 trajectory converter."""

import json
import os
import tempfile
from pathlib import Path

import pytest

from lace_trajectory import _build_steps, _extract_text, convert_lace_to_atif


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_state_dir(tmp_path, events, meta=None):
    """Create a minimal lace state directory structure for testing.

    Returns the state_dir path.
    """
    session_id = "sess_test-1234"
    session_dir = tmp_path / "state" / "agent-sessions" / session_id
    session_dir.mkdir(parents=True)

    # Write events.jsonl
    events_path = session_dir / "events.jsonl"
    with open(events_path, "w") as f:
        for event in events:
            f.write(json.dumps(event) + "\n")

    # Write meta.json
    if meta is None:
        meta = {"sessionId": session_id, "workDir": "/app", "created": "2026-01-01T00:00:00Z"}
    with open(session_dir / "meta.json", "w") as f:
        json.dump(meta, f)

    return tmp_path / "state"


def _make_multi_session_state_dir(tmp_path, sessions):
    """Create a state directory with multiple sessions for delegation tests.

    Args:
        tmp_path: pytest tmp_path fixture.
        sessions: List of (session_id, created_timestamp, events_list) tuples.

    Returns the state_dir path.
    """
    state_dir = tmp_path / "state"
    sessions_dir = state_dir / "agent-sessions"

    for session_id, created, events in sessions:
        session_dir = sessions_dir / session_id
        session_dir.mkdir(parents=True)

        with open(session_dir / "events.jsonl", "w") as f:
            for event in events:
                f.write(json.dumps(event) + "\n")

        meta = {"sessionId": session_id, "workDir": "/app", "created": created}
        with open(session_dir / "meta.json", "w") as f:
            json.dump(meta, f)

    return state_dir


def _run_convert(tmp_path, events, meta=None, model="test-model", provider="test",
                  persona=None, reasoning_effort=None, state_json=None):
    """Run convert_lace_to_atif and return the parsed trajectory dict."""
    state_dir = _make_state_dir(tmp_path, events, meta)
    # Optionally write state.json in the session dir
    if state_json is not None:
        session_dirs = list((state_dir / "agent-sessions").iterdir())
        for sd in session_dirs:
            with open(sd / "state.json", "w") as f:
                json.dump(state_json, f)
    output_dir = tmp_path / "output"
    convert_lace_to_atif(state_dir, output_dir, model=model, provider=provider,
                          persona=persona, reasoning_effort=reasoning_effort)
    trajectory_path = output_dir / "trajectory.json"
    assert trajectory_path.is_file(), "trajectory.json was not created"
    with open(trajectory_path) as f:
        return json.load(f)


def _validate_with_harbor(trajectory_dict):
    """Validate a trajectory dict against harbor's Pydantic models.

    Imports harbor's Trajectory model and validates the dict.
    Raises AssertionError if validation fails.
    """
    try:
        from harbor.models.trajectories import Trajectory
        Trajectory(**trajectory_dict)
    except ImportError:
        pytest.skip("harbor package not installed — skipping Pydantic validation")


# ---------------------------------------------------------------------------
# Event factories
# ---------------------------------------------------------------------------

def _context_injected(seq=1, text="System prompt text"):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:01Z",
        "type": "context_injected",
        "data": {"content": [{"type": "text", "text": text}]},
    }


def _prompt(seq=2, text="User instruction"):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:02Z",
        "type": "prompt",
        "data": {"content": [{"type": "text", "text": text}]},
    }


def _turn_start(seq=3, turn_id="turn_1", turn_seq=1):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:03Z",
        "type": "turn_start",
        "data": {},
        "turnId": turn_id,
        "turnSeq": turn_seq,
    }


def _message(seq=4, text="Agent says hello", turn_id="turn_1", turn_seq=2):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:04Z",
        "type": "message",
        "data": {"content": [{"type": "text", "text": text}]},
        "turnId": turn_id,
        "turnSeq": turn_seq,
    }


def _tool_use(seq=5, call_id="call_abc", name="bash", input_args=None,
              result_text="done", turn_id="turn_1", turn_seq=3):
    if input_args is None:
        input_args = {"command": "echo hi"}
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:05Z",
        "type": "tool_use",
        "data": {
            "toolCallId": call_id,
            "name": name,
            "kind": "execute",
            "input": input_args,
            "result": {
                "outcome": "completed",
                "content": [{"type": "text", "text": result_text}],
            },
        },
        "turnId": turn_id,
        "turnSeq": turn_seq,
    }


def _job_started(seq=6, job_id="job_xyz", job_type="bash",
                 command="pytest", description="run tests", turn_id="turn_1", turn_seq=4):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:06Z",
        "type": "job_started",
        "data": {
            "jobId": job_id,
            "jobType": job_type,
            "description": description,
            "command": command,
        },
        "turnId": turn_id,
        "turnSeq": turn_seq,
    }


def _job_finished(seq=7, job_id="job_xyz", outcome="completed", exit_code=0):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:07Z",
        "type": "job_finished",
        "data": {
            "jobId": job_id,
            "outcome": outcome,
            "exitCode": exit_code,
        },
    }


def _turn_end(seq=8, turn_id="turn_1", turn_seq=5, usage=None):
    data = {"stopReason": "end_turn"}
    if usage is not None:
        data["usage"] = usage
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:08Z",
        "type": "turn_end",
        "data": data,
        "turnId": turn_id,
        "turnSeq": turn_seq,
    }


def _job_session_assigned(seq=7, job_id="job_xyz", subagent_session_id="sess_sub-1"):
    return {
        "eventSeq": seq,
        "timestamp": "2026-01-01T00:00:07Z",
        "type": "job_session_assigned",
        "data": {
            "jobId": job_id,
            "subagentSessionId": subagent_session_id,
        },
    }


# ---------------------------------------------------------------------------
# Tests: _extract_text
# ---------------------------------------------------------------------------

class TestExtractText:
    def test_basic(self):
        parts = [{"type": "text", "text": "hello"}, {"type": "text", "text": "world"}]
        assert _extract_text(parts) == "hello\nworld"

    def test_empty_list(self):
        assert _extract_text([]) == ""

    def test_none(self):
        assert _extract_text(None) == ""

    def test_non_text_parts_skipped(self):
        parts = [{"type": "image", "url": "..."}, {"type": "text", "text": "only this"}]
        assert _extract_text(parts) == "only this"

    def test_missing_text_field(self):
        parts = [{"type": "text"}]
        assert _extract_text(parts) == ""


# ---------------------------------------------------------------------------
# Tests: _build_steps
# ---------------------------------------------------------------------------

class TestBuildSteps:
    def test_empty_events(self):
        assert _build_steps([]) == []

    def test_system_prompt_only(self):
        steps = _build_steps([_context_injected()])
        assert len(steps) == 1
        assert steps[0]["step_id"] == 1
        assert steps[0]["source"] == "system"
        assert steps[0]["message"] == "System prompt text"
        assert steps[0]["timestamp"] == "2026-01-01T00:00:01Z"

    def test_user_prompt(self):
        steps = _build_steps([_prompt()])
        assert len(steps) == 1
        assert steps[0]["source"] == "user"
        assert steps[0]["message"] == "User instruction"

    def test_single_tool_call_turn(self):
        events = [
            _turn_start(seq=1),
            _message(seq=2, text="Let me run a command"),
            _tool_use(seq=3, call_id="call_1", name="bash",
                      input_args={"command": "ls"}, result_text="file.txt"),
            _turn_end(seq=4),
        ]
        steps = _build_steps(events)
        assert len(steps) == 1
        step = steps[0]
        assert step["step_id"] == 1
        assert step["source"] == "agent"
        assert step["message"] == "Let me run a command"
        assert len(step["tool_calls"]) == 1
        assert step["tool_calls"][0]["tool_call_id"] == "call_1"
        assert step["tool_calls"][0]["function_name"] == "bash"
        assert step["tool_calls"][0]["arguments"] == {"command": "ls"}
        assert len(step["observation"]["results"]) == 1
        assert step["observation"]["results"][0]["source_call_id"] == "call_1"
        assert step["observation"]["results"][0]["content"] == "file.txt"

    def test_multiple_tool_calls_in_one_turn(self):
        """Each tool_use becomes its own agent step."""
        events = [
            _turn_start(seq=1),
            _tool_use(seq=2, call_id="call_1", name="bash",
                      input_args={"command": "ls"}, result_text="output1"),
            _tool_use(seq=3, call_id="call_2", name="file_read",
                      input_args={"path": "/app/f.txt"}, result_text="output2"),
            _tool_use(seq=4, call_id="call_3", name="ripgrep_search",
                      input_args={"pattern": "foo"}, result_text="output3"),
            _turn_end(seq=5),
        ]
        steps = _build_steps(events)
        assert len(steps) == 3
        for i, call_id in enumerate(["call_1", "call_2", "call_3"]):
            assert steps[i]["step_id"] == i + 1
            assert steps[i]["source"] == "agent"
            assert len(steps[i]["tool_calls"]) == 1
            assert steps[i]["tool_calls"][0]["tool_call_id"] == call_id
            assert steps[i]["observation"]["results"][0]["source_call_id"] == call_id

    def test_turn_with_message_only(self):
        events = [
            _turn_start(seq=1),
            _message(seq=2, text="I have completed the task."),
            _turn_end(seq=3),
        ]
        steps = _build_steps(events)
        assert len(steps) == 1
        step = steps[0]
        assert step["message"] == "I have completed the task."
        assert "tool_calls" not in step
        assert "observation" not in step

    def test_turn_with_empty_message(self):
        events = [
            _turn_start(seq=1),
            _message(seq=2, text=""),
            _tool_use(seq=3, call_id="call_1"),
            _turn_end(seq=4),
        ]
        steps = _build_steps(events)
        assert len(steps) == 1
        # Empty message text still produces empty string
        assert steps[0]["message"] == ""

    def test_job_started_and_finished(self):
        events = [
            _turn_start(seq=1),
            _message(seq=2, text="Running tests"),
            _job_started(seq=3, job_id="job_1", job_type="bash",
                         command="pytest", description="run tests"),
            _job_finished(seq=4, job_id="job_1", outcome="completed", exit_code=0),
            _turn_end(seq=5),
        ]
        steps = _build_steps(events)
        assert len(steps) == 1
        step = steps[0]
        # Job should appear as a tool call
        assert len(step["tool_calls"]) == 1
        assert step["tool_calls"][0]["tool_call_id"] == "job_1"
        assert step["tool_calls"][0]["function_name"] == "bash"
        assert step["tool_calls"][0]["arguments"]["command"] == "pytest"
        assert step["tool_calls"][0]["arguments"]["description"] == "run tests"
        # Job result should appear in observation
        assert len(step["observation"]["results"]) == 1
        assert step["observation"]["results"][0]["source_call_id"] == "job_1"
        assert step["observation"]["results"][0]["content"] == "Job completed (exit code: 0)"

    def test_job_finished_failed(self):
        events = [
            _turn_start(seq=1),
            _job_started(seq=2, job_id="job_fail"),
            _job_finished(seq=3, job_id="job_fail", outcome="failed", exit_code=1),
            _turn_end(seq=4),
        ]
        steps = _build_steps(events)
        result = steps[0]["observation"]["results"][0]
        assert result["content"] == "Job failed (exit code: 1)"

    def test_job_finished_no_exit_code(self):
        events = [
            _turn_start(seq=1),
            _job_started(seq=2, job_id="job_no_exit"),
            {
                "eventSeq": 3, "timestamp": "2026-01-01T00:00:07Z",
                "type": "job_finished",
                "data": {"jobId": "job_no_exit", "outcome": "cancelled"},
            },
            _turn_end(seq=4),
        ]
        steps = _build_steps(events)
        result = steps[0]["observation"]["results"][0]
        assert result["content"] == "Job cancelled"

    def test_multiple_turns_sequential_ids(self):
        events = [
            _context_injected(seq=1),
            _prompt(seq=2),
            _turn_start(seq=3, turn_id="turn_1"),
            _message(seq=4, text="First response"),
            _tool_use(seq=5, call_id="call_a", turn_id="turn_1"),
            _turn_end(seq=6, turn_id="turn_1"),
            _turn_start(seq=7, turn_id="turn_2"),
            _message(seq=8, text="Second response", turn_id="turn_2"),
            _turn_end(seq=9, turn_id="turn_2"),
        ]
        steps = _build_steps(events)
        assert len(steps) == 4
        for i, step in enumerate(steps):
            assert step["step_id"] == i + 1, f"Step {i} has wrong step_id"
        assert steps[0]["source"] == "system"
        assert steps[1]["source"] == "user"
        assert steps[2]["source"] == "agent"
        assert steps[3]["source"] == "agent"

    def test_messages_attached_to_following_tool_call(self):
        """Each message attaches to the next tool_use step; trailing messages
        get their own step."""
        events = [
            _turn_start(seq=1),
            _message(seq=2, text="Part 1"),
            _tool_use(seq=3, call_id="call_1"),
            _message(seq=4, text="Part 2"),
            _tool_use(seq=5, call_id="call_2"),
            _message(seq=6, text="Part 3"),
            _turn_end(seq=7),
        ]
        steps = _build_steps(events)
        assert len(steps) == 3
        assert steps[0]["message"] == "Part 1"
        assert steps[0]["tool_calls"][0]["tool_call_id"] == "call_1"
        assert steps[1]["message"] == "Part 2"
        assert steps[1]["tool_calls"][0]["tool_call_id"] == "call_2"
        assert steps[2]["message"] == "Part 3"
        assert "tool_calls" not in steps[2]

    def test_turn_without_turn_end_flushed(self):
        """A trailing turn without turn_end should still be emitted."""
        events = [
            _turn_start(seq=1),
            _message(seq=2, text="Incomplete turn"),
            _tool_use(seq=3, call_id="call_1"),
        ]
        steps = _build_steps(events)
        assert len(steps) == 1
        assert steps[0]["source"] == "agent"

    def test_turn_end_usage_attached_to_last_agent_step(self):
        """Usage from turn_end event should be attached to last agent step."""
        usage = {"inputTokens": 5000, "outputTokens": 200, "costUsd": 0.05}
        events = [
            _turn_start(seq=1),
            _tool_use(seq=2, call_id="call_1", name="bash",
                      input_args={"command": "ls"}, result_text="files"),
            _tool_use(seq=3, call_id="call_2", name="file_read",
                      input_args={"path": "/app/f.txt"}, result_text="content"),
            _turn_end(seq=4, usage=usage),
        ]
        steps = _build_steps(events)
        assert len(steps) == 2
        # Usage should be on the last step only
        assert "usage" not in steps[0]
        assert steps[1]["usage"] == {
            "input_tokens": 5000,
            "output_tokens": 200,
            "cost_usd": 0.05,
        }

    def test_turn_end_without_usage_no_usage_field(self):
        """Turn end without usage data should not add usage to steps."""
        events = [
            _turn_start(seq=1),
            _tool_use(seq=2, call_id="call_1"),
            _turn_end(seq=3),
        ]
        steps = _build_steps(events)
        assert "usage" not in steps[0]

    def test_unknown_event_types_skipped(self):
        events = [
            {"eventSeq": 1, "timestamp": "2026-01-01T00:00:00Z", "type": "some_future_type", "data": {}},
            _context_injected(seq=2),
        ]
        steps = _build_steps(events)
        assert len(steps) == 1
        assert steps[0]["source"] == "system"

    def test_tool_use_with_content_parts(self):
        """Content with multiple text parts should be joined."""
        events = [
            _turn_start(seq=1),
            {
                "eventSeq": 2,
                "timestamp": "2026-01-01T00:00:05Z",
                "type": "tool_use",
                "data": {
                    "toolCallId": "call_multi",
                    "name": "bash",
                    "kind": "execute",
                    "input": {"command": "ls"},
                    "result": {
                        "outcome": "completed",
                        "content": [
                            {"type": "text", "text": "line1"},
                            {"type": "text", "text": "line2"},
                        ],
                    },
                },
                "turnId": "turn_1",
                "turnSeq": 2,
            },
            _turn_end(seq=3),
        ]
        steps = _build_steps(events)
        assert steps[0]["observation"]["results"][0]["content"] == "line1\nline2"


# ---------------------------------------------------------------------------
# Tests: convert_lace_to_atif (integration)
# ---------------------------------------------------------------------------

class TestConvertLaceToAtif:
    def test_minimal_trajectory(self, tmp_path):
        """System prompt only produces a valid trajectory."""
        traj = _run_convert(tmp_path, [_context_injected()])
        assert traj["schema_version"] == "ATIF-v1.6"
        assert traj["session_id"] == "sess_test-1234"
        assert traj["agent"]["name"] == "lace"
        assert traj["agent"]["version"] == "0.1.0"
        assert traj["agent"]["model_name"] == "test/test-model"
        assert len(traj["steps"]) == 1
        assert traj["final_metrics"]["total_steps"] == 1
        _validate_with_harbor(traj)

    def test_full_conversation(self, tmp_path):
        """System + user + agent turn produces valid sequential steps."""
        events = [
            _context_injected(seq=1),
            _prompt(seq=2),
            _turn_start(seq=3),
            _message(seq=4, text="Working on it"),
            _tool_use(seq=5, call_id="call_1"),
            _turn_end(seq=6),
        ]
        traj = _run_convert(tmp_path, events)
        assert len(traj["steps"]) == 3
        assert traj["steps"][0]["source"] == "system"
        assert traj["steps"][1]["source"] == "user"
        assert traj["steps"][2]["source"] == "agent"
        assert traj["final_metrics"]["total_steps"] == 3
        _validate_with_harbor(traj)

    def test_model_name_construction(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()],
                            model="gpt-5.2-codex", provider="openai")
        assert traj["agent"]["model_name"] == "openai/gpt-5.2-codex"

    def test_model_without_provider(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()],
                            model="gpt-5.2-codex", provider=None)
        assert traj["agent"]["model_name"] == "gpt-5.2-codex"

    def test_no_model(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()],
                            model=None, provider=None)
        assert "model_name" not in traj["agent"]
        _validate_with_harbor(traj)

    def test_session_id_from_meta(self, tmp_path):
        meta = {"sessionId": "sess_custom-id", "workDir": "/app", "created": "2026-01-01T00:00:00Z"}
        traj = _run_convert(tmp_path, [_context_injected()], meta=meta)
        assert traj["session_id"] == "sess_custom-id"

    def test_missing_meta_uses_dir_name(self, tmp_path):
        """If meta.json is missing, session_id falls back to directory name."""
        session_id = "sess_test-1234"
        session_dir = tmp_path / "state" / "agent-sessions" / session_id
        session_dir.mkdir(parents=True)
        with open(session_dir / "events.jsonl", "w") as f:
            f.write(json.dumps(_context_injected()) + "\n")
        # No meta.json written

        output_dir = tmp_path / "output"
        convert_lace_to_atif(tmp_path / "state", output_dir, model="m", provider="p")
        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)
        assert traj["session_id"] == session_id

    def test_output_dir_created(self, tmp_path):
        """Output directory is created if it doesn't exist."""
        state_dir = _make_state_dir(tmp_path, [_context_injected()])
        output_dir = tmp_path / "deep" / "nested" / "output"
        assert not output_dir.exists()
        convert_lace_to_atif(state_dir, output_dir, model="m", provider="p")
        assert (output_dir / "trajectory.json").is_file()

    def test_no_events_produces_no_output(self, tmp_path):
        """Empty events file produces no trajectory (graceful)."""
        state_dir = _make_state_dir(tmp_path, [])
        output_dir = tmp_path / "output"
        convert_lace_to_atif(state_dir, output_dir)
        assert not (output_dir / "trajectory.json").exists()

    def test_no_session_dir_warns(self, tmp_path, caplog):
        """Missing agent-sessions directory logs warning."""
        state_dir = tmp_path / "empty-state"
        state_dir.mkdir()
        output_dir = tmp_path / "output"
        import logging
        with caplog.at_level(logging.WARNING):
            convert_lace_to_atif(state_dir, output_dir)
        assert "No agent-sessions directory" in caplog.text

    def test_malformed_event_line_skipped(self, tmp_path):
        """Malformed JSON lines are skipped with warning."""
        session_dir = tmp_path / "state" / "agent-sessions" / "sess_test-1234"
        session_dir.mkdir(parents=True)
        with open(session_dir / "meta.json", "w") as f:
            json.dump({"sessionId": "sess_test-1234"}, f)
        with open(session_dir / "events.jsonl", "w") as f:
            f.write(json.dumps(_context_injected()) + "\n")
            f.write("NOT VALID JSON\n")
            f.write(json.dumps(_prompt()) + "\n")

        output_dir = tmp_path / "output"
        convert_lace_to_atif(tmp_path / "state", output_dir, model="m", provider="p")
        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)
        # Should have 2 steps (skipped the bad line)
        assert len(traj["steps"]) == 2
        _validate_with_harbor(traj)

    def test_tool_calls_and_jobs_together(self, tmp_path):
        """Tool calls and jobs each become separate steps."""
        events = [
            _turn_start(seq=1),
            _tool_use(seq=2, call_id="call_1", name="bash",
                      input_args={"command": "ls"}, result_text="files"),
            _job_started(seq=3, job_id="job_1", command="pytest"),
            _job_finished(seq=4, job_id="job_1", outcome="completed", exit_code=0),
            _tool_use(seq=5, call_id="call_2", name="file_read",
                      input_args={"path": "/app/x"}, result_text="content"),
            _turn_end(seq=6),
        ]
        traj = _run_convert(tmp_path, events)
        assert len(traj["steps"]) == 3
        # Step 1: tool call
        assert traj["steps"][0]["tool_calls"][0]["tool_call_id"] == "call_1"
        # Step 2: job
        assert traj["steps"][1]["tool_calls"][0]["tool_call_id"] == "job_1"
        assert traj["steps"][1]["observation"]["results"][0]["content"] == "Job completed (exit code: 0)"
        # Step 3: tool call
        assert traj["steps"][2]["tool_calls"][0]["tool_call_id"] == "call_2"
        _validate_with_harbor(traj)

    def test_no_none_values_in_output(self, tmp_path):
        """Output JSON should not contain null values at the top level."""
        traj = _run_convert(tmp_path, [_context_injected()])
        # Check no None values in root
        for key, value in traj.items():
            assert value is not None, f"Root key '{key}' is None"

    def test_persona_in_agent_metadata(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()], persona="benchmark-h20")
        assert traj["agent"]["persona"] == "benchmark-h20"

    def test_no_persona_omits_field(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()])
        assert "persona" not in traj["agent"]

    def test_reasoning_effort_in_config(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()], reasoning_effort="high")
        assert traj["agent"]["config"]["reasoning_effort"] == "high"

    def test_no_reasoning_effort_omits_config(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()])
        assert "config" not in traj["agent"]

    def test_state_json_final_metrics(self, tmp_path):
        """Final metrics should include cost and tokens from state.json."""
        state = {
            "sessionCostUsd": 0.42,
            "tokenUsage": {"totalInputTokens": 10000, "totalOutputTokens": 500},
        }
        traj = _run_convert(tmp_path, [_context_injected()], state_json=state)
        assert traj["final_metrics"]["total_cost_usd"] == 0.42
        assert traj["final_metrics"]["total_input_tokens"] == 10000
        assert traj["final_metrics"]["total_output_tokens"] == 500

    def test_no_state_json_omits_cost(self, tmp_path):
        traj = _run_convert(tmp_path, [_context_injected()])
        assert "total_cost_usd" not in traj["final_metrics"]
        assert "total_input_tokens" not in traj["final_metrics"]


# ---------------------------------------------------------------------------
# Tests: Real data validation
# ---------------------------------------------------------------------------

@pytest.fixture
def real_events_path():
    """Path to real test events.jsonl, skips if not available."""
    path = Path("/tmp/test-events.jsonl")
    if not path.is_file():
        pytest.skip("Real test data not available at /tmp/test-events.jsonl")
    return path


@pytest.fixture
def real_meta_path():
    """Path to real test meta.json, skips if not available."""
    path = Path("/tmp/test-meta.json")
    if not path.is_file():
        pytest.skip("Real test data not available at /tmp/test-meta.json")
    return path


# ---------------------------------------------------------------------------
# Tests: Multi-session (delegation) support
# ---------------------------------------------------------------------------

class TestMultiSession:
    def test_parent_with_one_subagent(self, tmp_path):
        """Parent session delegates to one subagent; trajectory includes both."""
        parent_events = [
            _context_injected(seq=1, text="System prompt"),
            _prompt(seq=2, text="Do the task"),
            _turn_start(seq=3),
            _message(seq=4, text="Let me work on this"),
            _tool_use(seq=5, call_id="call_1", name="bash",
                      input_args={"command": "ls"}, result_text="files"),
            _message(seq=6, text="Now delegating review"),
            _job_started(seq=7, job_id="job_review", job_type="delegate",
                         command="Review the solution", description="Subagent"),
            _job_session_assigned(seq=8, job_id="job_review",
                                  subagent_session_id="sess_sub-1"),
            _job_finished(seq=9, job_id="job_review", outcome="completed",
                          exit_code=None),
            _message(seq=10, text="Review complete, finishing up"),
            _turn_end(seq=11),
        ]
        sub_events = [
            _context_injected(seq=1, text="Reviewer prompt"),
            _prompt(seq=2, text="Review the code"),
            _turn_start(seq=3),
            _message(seq=4, text="Checking the solution"),
            _tool_use(seq=5, call_id="sub_call_1", name="file_read",
                      input_args={"path": "/app/out.html"}, result_text="<html>..."),
            _message(seq=6, text="Looks good"),
            _turn_end(seq=7),
        ]
        sessions = [
            ("sess_parent", "2026-01-01T00:00:00Z", parent_events),
            ("sess_sub-1", "2026-01-01T00:00:07Z", sub_events),
        ]
        state_dir = _make_multi_session_state_dir(tmp_path, sessions)
        output_dir = tmp_path / "output"
        convert_lace_to_atif(state_dir, output_dir, model="test-model", provider="test")

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        # Should have steps from both parent and subagent
        # Parent: system + user + bash_tool + delegate_job_start
        # Subagent: system + user + file_read + trailing_message
        # Parent continues: trailing message + job_finished observation
        sources = [s["source"] for s in traj["steps"]]
        assert "system" in sources
        assert "user" in sources
        assert "agent" in sources

        # The subagent's file_read tool call should appear in the trajectory
        all_tool_names = []
        for step in traj["steps"]:
            for tc in step.get("tool_calls", []):
                all_tool_names.append(tc["function_name"])
        assert "bash" in all_tool_names, "Parent bash call missing"
        assert "file_read" in all_tool_names, "Subagent file_read call missing"

        # Step IDs should be sequential
        for i, step in enumerate(traj["steps"]):
            assert step["step_id"] == i + 1

        # session_id should be from the parent session
        assert traj["session_id"] == "sess_parent"

    def test_parent_with_multiple_subagents(self, tmp_path):
        """Parent delegates to multiple subagents sequentially."""
        parent_events = [
            _context_injected(seq=1, text="System prompt"),
            _prompt(seq=2, text="Do the task"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="call_1", name="bash",
                      input_args={"command": "echo hi"}, result_text="hi"),
            # First delegation
            _job_started(seq=5, job_id="job_r1", job_type="delegate",
                         command="Review 1", description="Reviewer 1"),
            _job_session_assigned(seq=6, job_id="job_r1",
                                  subagent_session_id="sess_sub-1"),
            _job_finished(seq=7, job_id="job_r1", outcome="completed",
                          exit_code=None),
            # Second delegation
            _job_started(seq=8, job_id="job_r2", job_type="delegate",
                         command="Review 2", description="Reviewer 2"),
            _job_session_assigned(seq=9, job_id="job_r2",
                                  subagent_session_id="sess_sub-2"),
            _job_finished(seq=10, job_id="job_r2", outcome="completed",
                          exit_code=None),
            _message(seq=11, text="Done"),
            _turn_end(seq=12),
        ]
        sub1_events = [
            _context_injected(seq=1, text="Reviewer 1 prompt"),
            _prompt(seq=2, text="Review 1"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="sub1_call", name="bash",
                      input_args={"command": "cat /app/f.txt"},
                      result_text="contents1"),
            _turn_end(seq=5),
        ]
        sub2_events = [
            _context_injected(seq=1, text="Reviewer 2 prompt"),
            _prompt(seq=2, text="Review 2"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="sub2_call", name="file_read",
                      input_args={"path": "/app/g.txt"},
                      result_text="contents2"),
            _turn_end(seq=5),
        ]
        sessions = [
            ("sess_parent", "2026-01-01T00:00:00Z", parent_events),
            ("sess_sub-1", "2026-01-01T00:00:05Z", sub1_events),
            ("sess_sub-2", "2026-01-01T00:00:08Z", sub2_events),
        ]
        state_dir = _make_multi_session_state_dir(tmp_path, sessions)
        output_dir = tmp_path / "output"
        convert_lace_to_atif(state_dir, output_dir, model="m", provider="p")

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        # All three sessions' tool calls should appear
        all_tool_call_ids = []
        for step in traj["steps"]:
            for tc in step.get("tool_calls", []):
                all_tool_call_ids.append(tc["tool_call_id"])
        assert "call_1" in all_tool_call_ids, "Parent tool call missing"
        assert "sub1_call" in all_tool_call_ids, "Subagent 1 tool call missing"
        assert "sub2_call" in all_tool_call_ids, "Subagent 2 tool call missing"

        # Step IDs sequential
        for i, step in enumerate(traj["steps"]):
            assert step["step_id"] == i + 1

    def test_single_session_still_works(self, tmp_path):
        """A single session (no delegation) still works correctly."""
        events = [
            _context_injected(seq=1),
            _prompt(seq=2),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="call_1"),
            _turn_end(seq=5),
        ]
        sessions = [
            ("sess_only", "2026-01-01T00:00:00Z", events),
        ]
        state_dir = _make_multi_session_state_dir(tmp_path, sessions)
        output_dir = tmp_path / "output"
        convert_lace_to_atif(state_dir, output_dir, model="m", provider="p")

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        assert traj["session_id"] == "sess_only"
        assert len(traj["steps"]) == 3

    def test_parent_identified_by_earliest_created(self, tmp_path):
        """Parent session is identified by earliest 'created' timestamp,
        not by alphabetical directory order."""
        # Create directories in reverse alphabetical order from creation time
        parent_events = [
            _context_injected(seq=1, text="Parent system prompt"),
            _prompt(seq=2, text="Do task"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="parent_call", name="bash",
                      input_args={"command": "echo parent"}, result_text="parent"),
            _turn_end(seq=5),
        ]
        sub_events = [
            _context_injected(seq=1, text="Sub system prompt"),
            _prompt(seq=2, text="Review"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="sub_call", name="bash",
                      input_args={"command": "echo sub"}, result_text="sub"),
            _turn_end(seq=5),
        ]
        # "sess_zzz" sorts after "sess_aaa" alphabetically, but is created first
        sessions = [
            ("sess_zzz_parent", "2026-01-01T00:00:00Z", parent_events),
            ("sess_aaa_sub", "2026-01-01T00:05:00Z", sub_events),
        ]
        state_dir = _make_multi_session_state_dir(tmp_path, sessions)
        output_dir = tmp_path / "output"
        convert_lace_to_atif(state_dir, output_dir, model="m", provider="p")

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        # Should use parent session's ID
        assert traj["session_id"] == "sess_zzz_parent"

    def test_subagent_steps_appear_between_delegation_events(self, tmp_path):
        """Subagent steps should appear after the delegate job_started step
        and before the parent's post-delegation steps."""
        parent_events = [
            _context_injected(seq=1, text="System"),
            _prompt(seq=2, text="Task"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="before_delegate", name="bash",
                      input_args={"command": "echo before"},
                      result_text="before"),
            _job_started(seq=5, job_id="job_del", job_type="delegate",
                         command="Review it", description="Sub"),
            _job_session_assigned(seq=6, job_id="job_del",
                                  subagent_session_id="sess_sub"),
            _job_finished(seq=7, job_id="job_del", outcome="completed",
                          exit_code=None),
            _tool_use(seq=8, call_id="after_delegate", name="bash",
                      input_args={"command": "echo after"},
                      result_text="after"),
            _turn_end(seq=9),
        ]
        sub_events = [
            _context_injected(seq=1, text="Sub system"),
            _prompt(seq=2, text="Sub task"),
            _turn_start(seq=3),
            _tool_use(seq=4, call_id="sub_tool", name="file_read",
                      input_args={"path": "/app/x"}, result_text="x"),
            _turn_end(seq=5),
        ]
        sessions = [
            ("sess_parent", "2026-01-01T00:00:00Z", parent_events),
            ("sess_sub", "2026-01-01T00:00:05Z", sub_events),
        ]
        state_dir = _make_multi_session_state_dir(tmp_path, sessions)
        output_dir = tmp_path / "output"
        convert_lace_to_atif(state_dir, output_dir, model="m", provider="p")

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        # Find positions of key tool calls
        tool_call_order = []
        for step in traj["steps"]:
            for tc in step.get("tool_calls", []):
                tool_call_order.append(tc["tool_call_id"])

        before_idx = tool_call_order.index("before_delegate")
        sub_idx = tool_call_order.index("sub_tool")
        after_idx = tool_call_order.index("after_delegate")

        assert before_idx < sub_idx < after_idx, (
            f"Expected before({before_idx}) < sub({sub_idx}) < after({after_idx})"
        )

    def test_missing_subagent_session_logs_warning(self, tmp_path, caplog):
        """If job_session_assigned references a missing session, log warning."""
        parent_events = [
            _context_injected(seq=1, text="System"),
            _prompt(seq=2, text="Task"),
            _turn_start(seq=3),
            _job_started(seq=4, job_id="job_del", job_type="delegate",
                         command="Review", description="Sub"),
            _job_session_assigned(seq=5, job_id="job_del",
                                  subagent_session_id="sess_nonexistent"),
            _job_finished(seq=6, job_id="job_del", outcome="completed",
                          exit_code=None),
            _turn_end(seq=7),
        ]
        sessions = [
            ("sess_parent", "2026-01-01T00:00:00Z", parent_events),
        ]
        state_dir = _make_multi_session_state_dir(tmp_path, sessions)
        output_dir = tmp_path / "output"
        import logging
        with caplog.at_level(logging.WARNING):
            convert_lace_to_atif(state_dir, output_dir, model="m", provider="p")
        assert "sess_nonexistent" in caplog.text

        # Should still produce output (parent events only)
        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)
        assert len(traj["steps"]) > 0


# ---------------------------------------------------------------------------
# Tests: Real data validation
# ---------------------------------------------------------------------------

class TestRealData:
    def test_real_events_produce_valid_trajectory(self, tmp_path, real_events_path, real_meta_path):
        """Convert real events.jsonl and validate against harbor."""
        session_dir = tmp_path / "state" / "agent-sessions" / "sess_real"
        session_dir.mkdir(parents=True)

        import shutil
        shutil.copy(real_events_path, session_dir / "events.jsonl")
        shutil.copy(real_meta_path, session_dir / "meta.json")

        output_dir = tmp_path / "output"
        convert_lace_to_atif(
            tmp_path / "state", output_dir,
            model="gpt-5.2-codex", provider="openai",
        )

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        # Basic structure checks
        assert traj["schema_version"] == "ATIF-v1.6"
        assert traj["agent"]["name"] == "lace"
        assert traj["agent"]["model_name"] == "openai/gpt-5.2-codex"
        assert len(traj["steps"]) > 0

        # Step IDs are sequential
        for i, step in enumerate(traj["steps"]):
            assert step["step_id"] == i + 1

        # Source types are valid
        for step in traj["steps"]:
            assert step["source"] in ("system", "user", "agent")

        # Agent steps with tool_calls have matching observations
        for step in traj["steps"]:
            if "tool_calls" in step and step.get("observation"):
                tc_ids = {tc["tool_call_id"] for tc in step["tool_calls"]}
                for result in step["observation"]["results"]:
                    if result.get("source_call_id"):
                        assert result["source_call_id"] in tc_ids

        _validate_with_harbor(traj)

    def test_real_data_step_count(self, tmp_path, real_events_path, real_meta_path):
        """Real data should produce one step per tool call."""
        session_dir = tmp_path / "state" / "agent-sessions" / "sess_real"
        session_dir.mkdir(parents=True)

        import shutil
        shutil.copy(real_events_path, session_dir / "events.jsonl")
        shutil.copy(real_meta_path, session_dir / "meta.json")

        output_dir = tmp_path / "output"
        convert_lace_to_atif(tmp_path / "state", output_dir)

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        # Should have many steps: system + user + one per tool_use/job
        assert len(traj["steps"]) > 3

    def test_real_data_has_granular_tool_calls(self, tmp_path, real_events_path, real_meta_path):
        """Each agent step should have at most 1 tool call (granular steps)."""
        session_dir = tmp_path / "state" / "agent-sessions" / "sess_real"
        session_dir.mkdir(parents=True)

        import shutil
        shutil.copy(real_events_path, session_dir / "events.jsonl")
        shutil.copy(real_meta_path, session_dir / "meta.json")

        output_dir = tmp_path / "output"
        convert_lace_to_atif(tmp_path / "state", output_dir)

        with open(output_dir / "trajectory.json") as f:
            traj = json.load(f)

        for step in traj["steps"]:
            if step["source"] == "agent" and "tool_calls" in step:
                assert len(step["tool_calls"]) <= 1, (
                    f"Step {step['step_id']} has {len(step['tool_calls'])} tool_calls, "
                    "expected at most 1"
                )
