use crate::app::{PermissionOption, PermissionRequest};
use crate::app::reducer::AppEvent;
use serde_json::Value;

pub fn decode_session_update(params: &Value) -> Vec<AppEvent> {
  let mut out = Vec::new();
  decode_session_update_inner(params, &mut out, None);
  out
}

fn decode_session_update_inner(params: &Value, out: &mut Vec<AppEvent>, job_id: Option<String>) {
  let Some(obj) = params.as_object() else { return };
  let Some(t) = obj.get("type").and_then(|v| v.as_str()) else { return };

  let turn_id = obj
    .get("turnId")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let turn_seq = obj.get("turnSeq").and_then(|v| v.as_i64());

  match t {
    "text_delta" => {
      if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
        out.push(AppEvent::TextDelta {
          text: text.to_string(),
        });
      }
    }
    "turn_end" => {
      let stop_reason = obj
        .get("data")
        .and_then(|d| d.get("stopReason"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
      out.push(AppEvent::TurnEnd { stop_reason });
    }
    "tool_use" => {
      let tool_call_id = obj.get("toolCallId").and_then(|v| v.as_str());
      let input = obj.get("input");
      if let (Some(tool_call_id), Some(input)) = (tool_call_id, input) {
        let name = obj.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
        let kind = obj.get("kind").and_then(|v| v.as_str()).map(|s| s.to_string());
        let status = obj.get("status").and_then(|v| v.as_str()).map(|s| s.to_string());
        let result = obj.get("result").cloned();
        out.push(AppEvent::ToolUse {
          tool_call_id: tool_call_id.to_string(),
          name,
          kind,
          status,
          input: input.clone(),
          result,
          job_id: job_id.clone(),
          turn_id,
          turn_seq,
        });
      }
    }
    "job_update" => {
      let job_id = obj
        .get("jobId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(job_id);
      if let Some(inner) = obj.get("update") {
        decode_session_update_inner(inner, out, job_id);
      }
    }
    "job_started" => {
      if let Some(job_id) = obj.get("jobId").and_then(|v| v.as_str()) {
        let job_type = obj.get("jobType").and_then(|v| v.as_str()).map(|s| s.to_string());
        out.push(AppEvent::JobStarted {
          job_id: job_id.to_string(),
          job_type,
        });
      }
    }
    "job_finished" => {
      if let Some(job_id) = obj.get("jobId").and_then(|v| v.as_str()) {
        let outcome = obj.get("outcome").and_then(|v| v.as_str()).map(|s| s.to_string());
        out.push(AppEvent::JobFinished {
          job_id: job_id.to_string(),
          outcome,
        });
      }
    }
    _ => {}
  }
}

pub fn decode_permission_request(id: Value, params: &Value) -> PermissionRequest {
  let obj = params.as_object();

  let tool = obj.and_then(|o| o.get("tool")).and_then(|v| v.as_str()).map(|s| s.to_string());
  let kind = obj.and_then(|o| o.get("kind")).and_then(|v| v.as_str()).map(|s| s.to_string());
  let resource = obj
    .and_then(|o| o.get("resource"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let tool_call_id = obj
    .and_then(|o| o.get("toolCallId"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let turn_id = obj
    .and_then(|o| o.get("turnId"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let turn_seq = obj.and_then(|o| o.get("turnSeq")).and_then(|v| v.as_i64());
  let job_id = obj
    .and_then(|o| o.get("jobId"))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());

  let options = obj
    .and_then(|o| o.get("options"))
    .and_then(|v| v.as_array())
    .map(|arr| {
      arr
        .iter()
        .filter_map(|o| {
          let option_id = o.get("optionId")?.as_str()?.to_string();
          let label = o
            .get("label")
            .and_then(|v| v.as_str())
            .unwrap_or(&option_id)
            .to_string();
          Some(PermissionOption { option_id, label })
        })
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  PermissionRequest {
    id,
    tool,
    kind,
    resource,
    tool_call_id,
    turn_id,
    turn_seq,
    job_id,
    options,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn decodes_text_delta_and_turn_end() {
    let events = decode_session_update(&json!({"type":"text_delta","text":"hi"}));
    assert_eq!(events, vec![AppEvent::TextDelta { text: "hi".to_string() }]);

    let events = decode_session_update(&json!({"type":"turn_end","data":{"stopReason":"end_turn"}}));
    assert_eq!(
      events,
      vec![AppEvent::TurnEnd { stop_reason: Some("end_turn".to_string()) }]
    );
  }

  #[test]
  fn decodes_tool_use_and_job_update_wrapper() {
    let events = decode_session_update(&json!({
      "type":"tool_use",
      "toolCallId":"tool_1",
      "name":"shell.exec",
      "status":"awaiting_permission",
      "input": {"command":"echo hi"}
    }));
    assert_eq!(
      events,
      vec![AppEvent::ToolUse {
        tool_call_id: "tool_1".to_string(),
        name: Some("shell.exec".to_string()),
        kind: None,
        status: Some("awaiting_permission".to_string()),
        input: json!({"command":"echo hi"}),
        result: None,
        job_id: None,
        turn_id: None,
        turn_seq: None,
      }]
    );

    let events = decode_session_update(&json!({
      "type":"job_update",
      "jobId":"job_1",
      "update": {"type":"text_delta","text":"ok"}
    }));
    assert_eq!(events, vec![AppEvent::TextDelta { text: "ok".to_string() }]);
  }

  #[test]
  fn decodes_permission_request_options() {
    let req = decode_permission_request(
      json!("a_1"),
      &json!({
        "tool":"shell.exec",
        "kind":"execute",
        "resource":"echo hi",
        "toolCallId":"tool_1",
        "turnId":"turn_1",
        "turnSeq":1,
        "options":[{"optionId":"allow","label":"Allow"},{"optionId":"deny","label":"Deny"}]
      }),
    );

    assert_eq!(req.id, json!("a_1"));
    assert_eq!(req.tool.as_deref(), Some("shell.exec"));
    assert_eq!(req.options.len(), 2);
    assert_eq!(req.options[0].option_id, "allow");
  }
}
