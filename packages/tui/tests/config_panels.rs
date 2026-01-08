use lace_tui::app::config_panels::{
    apply_model_toggle_result, handle_models_list, maybe_autoconfigure_from_connections, ModelItem,
    ModelsPanelState,
};
use lace_tui::app::reducer::Outbound;
use lace_tui::app::AppState;
use serde_json::json;

#[test]
fn autoconfigure_uses_last_connection_and_model_when_present() {
    let mut state = AppState::new_with_paths(None, None);
    state.prefs.last_connection_id = Some("conn-1".to_string());
    state.prefs.last_model_id = Some("model-a".to_string());

    let result = Some(json!({
        "connections": [
            { "connectionId": "conn-1", "credentialState": "missing" },
            { "connectionId": "conn-2", "credentialState": "needs_input" }
        ]
    }));

    let out = maybe_autoconfigure_from_connections(&mut state, &result);
    assert_eq!(out.len(), 1);
    match &out[0] {
        Outbound::JsonRpcRequest { method, params, .. } => {
            assert_eq!(method, "ent/session/configure");
            let obj = params.as_ref().unwrap().as_object().unwrap();
            assert_eq!(obj.get("connectionId").unwrap().as_str().unwrap(), "conn-1");
            assert_eq!(obj.get("modelId").unwrap().as_str().unwrap(), "model-a");
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

#[test]
fn models_list_sets_disabled_flag() {
    let mut state = AppState::new_with_paths(None, None);
    state.models_panel.open = true;
    let result = Some(json!({
        "providerId": "openai",
        "connectionId": "conn-1",
        "models": [
            { "modelId": "gpt-4o", "name": "GPT-4o" },
            { "modelId": "gpt-3.5", "name": "GPT-3.5", "disabled": true }
        ]
    }));
    handle_models_list(&mut state, &result, None);
    assert_eq!(state.models_panel.models.len(), 2);
    assert!(!state.models_panel.models[0].disabled);
    assert!(state.models_panel.models[1].disabled);
}

#[test]
fn apply_model_toggle_result_marks_disabled() {
    let mut state = AppState::new_with_paths(None, None);
    state.models_panel = ModelsPanelState {
        open: true,
        loading: false,
        error: None,
        provider_id: Some("openai".to_string()),
        connection_id: Some("c".to_string()),
        models: vec![
            ModelItem {
                model_id: "a".to_string(),
                name: "A".to_string(),
                disabled: false,
            },
            ModelItem {
                model_id: "b".to_string(),
                name: "B".to_string(),
                disabled: false,
            },
        ],
        selected: 0,
    };

    let result = Some(json!({ "providerId": "openai", "enabled": ["a"], "disabled": ["b"] }));
    apply_model_toggle_result(&mut state, &result);
    assert!(!state.models_panel.models[0].disabled);
    assert!(state.models_panel.models[1].disabled);
}
