use lace_tui::app::config_panels::maybe_autoconfigure_from_connections;
use lace_tui::app::reducer::Outbound;
use lace_tui::app::AppState;
use serde_json::json;

#[test]
fn autoconfigure_uses_last_connection_and_model_when_present() {
    let mut state = AppState::new_with_paths(None, None);
    state.session_id = Some("sess_1".to_string());
    state.prefs.last_connection_id = Some("conn-1".to_string());
    state.prefs.last_model_id = Some("model-a".to_string());

    let result = Some(json!({
        "connections": [
            { "connectionId": "conn-1", "credentialState": "missing" },
            { "connectionId": "conn-2", "credentialState": "needs_input" }
        ]
    }));

    let out = maybe_autoconfigure_from_connections(&mut state, &result);
    assert_eq!(out.len(), 2);
    match &out[0] {
        Outbound::JsonRpcRequest { method, params, .. } => {
            assert_eq!(method, "ent/session/configure");
            let obj = params.as_ref().unwrap().as_object().unwrap();
            assert_eq!(obj.get("connectionId").unwrap().as_str().unwrap(), "conn-1");
            assert!(obj.get("modelId").is_none());
        }
        _ => panic!("expected request"),
    }
    match &out[1] {
        Outbound::JsonRpcRequest { method, params, .. } => {
            assert_eq!(method, "session/set_config_option");
            let obj = params.as_ref().unwrap().as_object().unwrap();
            assert_eq!(obj.get("configId").unwrap().as_str().unwrap(), "model");
            assert_eq!(obj.get("value").unwrap().as_str().unwrap(), "model-a");
        }
        _ => panic!("expected request"),
    }
}

#[test]
fn autoconfigure_skips_when_connection_missing() {
    let mut state = AppState::new_with_paths(None, None);
    state.prefs.last_connection_id = Some("conn-1".to_string());
    state.prefs.last_model_id = Some("model-a".to_string());

    let result = Some(json!({
        "connections": [
            { "connectionId": "conn-2", "credentialState": "ready" }
        ]
    }));

    let out = maybe_autoconfigure_from_connections(&mut state, &result);
    assert!(out.is_empty());
}
