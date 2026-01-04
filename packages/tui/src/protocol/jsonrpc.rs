use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboundMessage {
    Request {
        id: Value,
        method: String,
        params: Option<Value>,
    },
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<RpcErrorObject>,
    },
    Notification {
        method: String,
        params: Option<Value>,
    },
}

pub fn parse_inbound(line: &str) -> Result<InboundMessage, String> {
    let value: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
    let obj = value
        .as_object()
        .ok_or_else(|| "JSON-RPC message must be an object".to_string())?;

    let method = obj
        .get("method")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let id = obj.get("id").cloned();

    let params = obj.get("params").cloned();
    let result = obj.get("result").cloned();
    let error = obj
        .get("error")
        .cloned()
        .map(|v| serde_json::from_value::<RpcErrorObject>(v).map_err(|e| e.to_string()))
        .transpose()?;

    match (method, id) {
        (Some(method), Some(id)) => Ok(InboundMessage::Request { id, method, params }),
        (Some(method), None) => Ok(InboundMessage::Notification { method, params }),
        (None, Some(id)) => Ok(InboundMessage::Response { id, result, error }),
        (None, None) => Err("JSON-RPC message must have either method or id".to_string()),
    }
}

pub fn encode_request(id: Value, method: &str, params: Option<Value>) -> String {
    let msg = OutboundRequest {
        jsonrpc: "2.0",
        id,
        method,
        params,
    };
    serde_json::to_string(&msg).expect("serialize JSON-RPC request")
}

pub fn encode_notification(method: &str, params: Option<Value>) -> String {
    let msg = OutboundNotification {
        jsonrpc: "2.0",
        method,
        params,
    };
    serde_json::to_string(&msg).expect("serialize JSON-RPC notification")
}

pub fn encode_response_result(id: Value, result: Value) -> String {
    let msg = OutboundResponseResult {
        jsonrpc: "2.0",
        id,
        result,
    };
    serde_json::to_string(&msg).expect("serialize JSON-RPC response")
}

pub fn encode_response_error(id: Value, error: RpcErrorObject) -> String {
    let msg = OutboundResponseError {
        jsonrpc: "2.0",
        id,
        error,
    };
    serde_json::to_string(&msg).expect("serialize JSON-RPC response error")
}

#[derive(Serialize)]
struct OutboundRequest<'a> {
    jsonrpc: &'static str,
    id: Value,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Serialize)]
struct OutboundNotification<'a> {
    jsonrpc: &'static str,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Serialize)]
struct OutboundResponseResult {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

#[derive(Serialize)]
struct OutboundResponseError {
    jsonrpc: &'static str,
    id: Value,
    error: RpcErrorObject,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_request() {
        let msg =
            parse_inbound(r#"{"jsonrpc":"2.0","id":"c_1","method":"initialize","params":{"a":1}}"#)
                .unwrap();
        assert_eq!(
            msg,
            InboundMessage::Request {
                id: json!("c_1"),
                method: "initialize".to_string(),
                params: Some(json!({"a":1})),
            }
        );
    }

    #[test]
    fn parses_notification() {
        let msg = parse_inbound(
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"type":"turn_end"}}"#,
        )
        .unwrap();
        assert_eq!(
            msg,
            InboundMessage::Notification {
                method: "session/update".to_string(),
                params: Some(json!({"type":"turn_end"})),
            }
        );
    }

    #[test]
    fn parses_response_result() {
        let msg = parse_inbound(r#"{"jsonrpc":"2.0","id":"c_9","result":{"ok":true}}"#).unwrap();
        assert_eq!(
            msg,
            InboundMessage::Response {
                id: json!("c_9"),
                result: Some(json!({"ok":true})),
                error: None,
            }
        );
    }

    #[test]
    fn parses_response_error() {
        let msg =
            parse_inbound(r#"{"jsonrpc":"2.0","id":"c_2","error":{"code":0,"message":"nope"}}"#)
                .unwrap();
        assert_eq!(
            msg,
            InboundMessage::Response {
                id: json!("c_2"),
                result: None,
                error: Some(RpcErrorObject {
                    code: 0,
                    message: "nope".to_string(),
                    data: None,
                }),
            }
        );
    }

    #[test]
    fn encodes_request_round_trip() {
        let encoded = encode_request(
            json!("c_1"),
            "initialize",
            Some(json!({"protocolVersion":"1.0"})),
        );
        let decoded = parse_inbound(&encoded).unwrap();
        assert_eq!(
            decoded,
            InboundMessage::Request {
                id: json!("c_1"),
                method: "initialize".to_string(),
                params: Some(json!({"protocolVersion":"1.0"})),
            }
        );
    }
}
