mod common;

use lace_tui::protocol::bootstrap::bootstrap_session;

#[test]
fn bootstraps_initialize_and_session_new() {
    let (workdir, mut transport) = common::spawn_node_fixture("fake-agent-streaming.mjs");
    let session_id = bootstrap_session(&transport, workdir.path(), None).unwrap();
    assert_eq!(session_id, "sess_test");

    let _ = transport.child.kill();
    let _ = transport.child.wait();
}
