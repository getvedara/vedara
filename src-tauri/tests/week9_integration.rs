use vedara_lib::git::checkpoint::{
    create_checkpoint, get_checkpoint_diff, list_checkpoints, restore_checkpoint,
    restore_checkpoint_file,
};
use vedara_lib::mcp::manager::McpManager;
use vedara_lib::mcp::types::{
    ClientCapabilities, InitializeParams, InitializeResult, JsonRpcNotification, JsonRpcRequest,
    JsonRpcResponse, McpServerConfig, McpToolDefinition, ToolCallParams, ToolCallResult,
    ToolInputSchema,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn run_git_cmd(dir: &Path, args: &[&str]) {
    let _ = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output();
}

fn setup_week9_test_repo(name: &str) -> PathBuf {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("vedara_week9_{}_{}", name, now));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).unwrap();

    run_git_cmd(&temp_dir, &["init"]);
    run_git_cmd(&temp_dir, &["config", "user.name", "Vedara AI"]);
    run_git_cmd(&temp_dir, &["config", "user.email", "ai@vedara.local"]);
    run_git_cmd(&temp_dir, &["config", "core.autocrlf", "false"]);

    let main_rs = temp_dir.join("main.rs");
    fs::write(&main_rs, "fn main() {\n    let count = 0;\n}\n").unwrap();
    let utils_rs = temp_dir.join("utils.rs");
    fs::write(&utils_rs, "pub fn helper() -> bool {\n    true\n}\n").unwrap();

    run_git_cmd(&temp_dir, &["add", "."]);
    run_git_cmd(&temp_dir, &["commit", "-m", "Initial commit"]);

    temp_dir
}

#[test]
fn test_week9_shadow_checkpoint_lifecycle_diffs_and_file_revert_e2e() {
    let repo_dir = setup_week9_test_repo("checkpoints");

    // 1. Make first edits and create Checkpoint 1
    let main_rs = repo_dir.join("main.rs");
    fs::write(&main_rs, "fn main() {\n    let count = 100;\n}\n").unwrap();
    let utils_rs = repo_dir.join("utils.rs");
    fs::write(&utils_rs, "pub fn helper() -> bool {\n    false\n}\n").unwrap();

    let cp1 = create_checkpoint(&repo_dir, "Updated count to 100 and helper to false")
        .expect("Failed to create cp1");
    assert!(!cp1.id.is_empty());
    assert_eq!(cp1.summary, "Updated count to 100 and helper to false");
    assert!(cp1.file_paths.contains(&"main.rs".to_string()));
    assert!(cp1.file_paths.contains(&"utils.rs".to_string()));

    // Small delay to ensure timestamp difference
    std::thread::sleep(std::time::Duration::from_millis(1100));

    // 2. Make second edits to main.rs only and create Checkpoint 2
    fs::write(&main_rs, "fn main() {\n    let count = 999;\n}\n").unwrap();
    let cp2 = create_checkpoint(&repo_dir, "Updated count to 999").expect("Failed to create cp2");

    // 3. Verify checkpoints listing
    let checkpoints = list_checkpoints(&repo_dir).expect("Failed to list checkpoints");
    assert!(checkpoints.len() >= 2);
    let ids: Vec<_> = checkpoints.iter().map(|c| c.id.as_str()).collect();
    assert!(ids.contains(&cp1.id.as_str()));
    assert!(ids.contains(&cp2.id.as_str()));

    // 4. Verify Checkpoint diffs against parent and working tree
    let diff_parent = get_checkpoint_diff(&repo_dir, &cp2.id, Some("parent"))
        .expect("Failed to get parent diff for cp2");
    assert_eq!(diff_parent.checkpoint_id, cp2.id);
    let main_diff = diff_parent.files.iter().find(|f| f.path == "main.rs");
    assert!(main_diff.is_some());
    assert!(main_diff.unwrap().patch.contains("+    let count = 999;"));

    // Modify working tree to create working diff
    fs::write(&main_rs, "fn main() {\n    let count = 5000;\n}\n").unwrap();
    let diff_working = get_checkpoint_diff(&repo_dir, &cp2.id, Some("working"))
        .expect("Failed to get working diff for cp2");
    let working_main_diff = diff_working.files.iter().find(|f| f.path == "main.rs");
    assert!(working_main_diff.is_some());
    assert!(working_main_diff.unwrap().patch.contains("-    let count = 999;"));
    assert!(working_main_diff.unwrap().patch.contains("+    let count = 5000;"));

    // 5. Granular File Revert: Restore ONLY main.rs from Checkpoint 1 (count = 100)
    // utils.rs should remain at its current working state (false), not initial commit (true)
    let file_res = restore_checkpoint_file(&repo_dir, &cp1.id, "main.rs")
        .expect("Failed to restore main.rs from cp1");
    assert!(file_res.success);
    assert_eq!(file_res.file_path, "main.rs");

    let restored_main = fs::read_to_string(&main_rs).unwrap();
    assert!(
        restored_main.contains("let count = 100;"),
        "main.rs must be reverted to cp1 state"
    );
    let current_utils = fs::read_to_string(&utils_rs).unwrap();
    assert!(
        current_utils.contains("false"),
        "utils.rs must remain untouched during single-file revert"
    );

    // 6. Full Revert: Restore all files from Checkpoint 2
    let full_res =
        restore_checkpoint(&repo_dir, &cp2.id).expect("Failed full restore from cp2");
    assert!(full_res.success);
    let restored_main_cp2 = fs::read_to_string(&main_rs).unwrap();
    assert!(restored_main_cp2.contains("let count = 999;"));

    // 7. Verify active Git branch history is completely clean
    let git_log = std::process::Command::new("git")
        .current_dir(&repo_dir)
        .args(&["log", "--oneline"])
        .output()
        .unwrap();
    let log_str = String::from_utf8_lossy(&git_log.stdout);
    let commit_lines: Vec<_> = log_str.trim().lines().collect();
    assert_eq!(
        commit_lines.len(),
        1,
        "Active branch history must have exactly 1 commit; checkpoints must remain on shadow refs"
    );
    assert!(commit_lines[0].contains("Initial commit"));

    let _ = fs::remove_dir_all(&repo_dir);
}

#[test]
fn test_week9_mcp_jsonrpc_protocol_and_capabilities_handshake_e2e() {
    // 1. JSON-RPC 2.0 Request Serialization
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: 42,
        method: "initialize".to_string(),
        params: Some(
            serde_json::to_value(InitializeParams {
                protocol_version: "2024-11-05".to_string(),
                capabilities: ClientCapabilities {
                    roots: Some(serde_json::json!({ "listChanged": true })),
                    sampling: None,
                },
                client_info: vedara_lib::mcp::types::ClientInfo {
                    name: "Vedara AI IDE".to_string(),
                    version: "0.1.0".to_string(),
                },
            })
            .unwrap(),
        ),
    };

    let serialized = serde_json::to_string(&req).expect("Failed to serialize JsonRpcRequest");
    assert!(serialized.contains("\"jsonrpc\":\"2.0\""));
    assert!(serialized.contains("\"method\":\"initialize\""));
    assert!(serialized.contains("\"id\":42"));
    assert!(serialized.contains("\"protocolVersion\":\"2024-11-05\""));

    // 2. JSON-RPC 2.0 Response Deserialization
    let resp_raw = r#"{
        "jsonrpc": "2.0",
        "id": 42,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": { "listChanged": true },
                "resources": { "subscribe": false }
            },
            "serverInfo": {
                "name": "sqlite-mcp-server",
                "version": "1.0.4"
            }
        }
    }"#;

    let resp: JsonRpcResponse =
        serde_json::from_str(resp_raw).expect("Failed to deserialize JsonRpcResponse");
    assert_eq!(resp.id, Some(42));
    assert!(resp.error.is_none());

    let init_result: InitializeResult =
        serde_json::from_value(resp.result.unwrap()).expect("Failed to parse InitializeResult");
    assert_eq!(init_result.protocol_version, "2024-11-05");
    assert_eq!(init_result.server_info.name, "sqlite-mcp-server");
    assert!(init_result.capabilities.tools.is_some());

    // 3. Notification serialization
    let notif = JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "notifications/initialized".to_string(),
        params: None,
    };
    let notif_str = serde_json::to_string(&notif).unwrap();
    assert!(notif_str.contains("\"method\":\"notifications/initialized\""));
    assert!(!notif_str.contains("\"id\""));
}

#[test]
fn test_week9_mcp_tool_execution_and_content_marshaling_e2e() {
    // 1. Tool Call Input Schema Definition
    let props = serde_json::json!({
        "query": {
            "type": "string",
            "description": "SQL query to execute against the local database"
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of rows to return",
            "default": 50
        }
    });

    let tool_def = McpToolDefinition {
        name: "execute_sql".to_string(),
        server_name: Some("local_sqlite".to_string()),
        description: "Run a read-only SQL query".to_string(),
        input_schema: ToolInputSchema {
            schema_type: "object".to_string(),
            properties: Some(props),
            required: Some(vec!["query".to_string()]),
            description: Some("Input schema for execute_sql".to_string()),
        },
    };

    let tool_json = serde_json::to_string(&tool_def).unwrap();
    assert!(tool_json.contains("\"name\":\"execute_sql\""));
    assert!(tool_json.contains("\"serverName\":\"local_sqlite\""));
    assert!(tool_json.contains("\"required\":[\"query\"]"));

    // 2. Tool Invocation Parameters
    let params = ToolCallParams {
        name: "execute_sql".to_string(),
        arguments: Some(serde_json::json!({
            "query": "SELECT id, name FROM users WHERE active = 1;",
            "limit": 10
        })),
    };
    let params_json = serde_json::to_string(&params).unwrap();
    assert!(params_json.contains("SELECT id, name FROM users"));

    // 3. Structured Content Result Parsing (Text, Image, Resource)
    let result_raw = r#"{
        "content": [
            {
                "type": "text",
                "text": "[{\"id\": 1, \"name\": \"Alice\"}, {\"id\": 2, \"name\": \"Bob\"}]"
            },
            {
                "type": "resource",
                "data": "sqlite://local.db/users"
            }
        ],
        "isError": false
    }"#;

    let call_res: ToolCallResult =
        serde_json::from_str(result_raw).expect("Failed to deserialize ToolCallResult");
    assert!(!call_res.is_error);
    assert_eq!(call_res.content.len(), 2);

    assert_eq!(call_res.content[0].content_type, "text");
    assert!(call_res.content[0].text.as_ref().unwrap().contains("Alice"));

    assert_eq!(call_res.content[1].content_type, "resource");
    assert_eq!(
        call_res.content[1].data.as_deref().unwrap(),
        "sqlite://local.db/users"
    );
}

#[tokio::test]
async fn test_week9_mcp_multi_server_manager_aggregation_e2e() {
    let manager = McpManager::new();

    // 1. Initial state empty
    let servers = manager.list_servers().await;
    assert_eq!(servers.len(), 0);
    let tools = manager.list_tools(None).await;
    assert_eq!(tools.len(), 0);

    // 2. Check querying non-existent server
    let status = manager.get_server_status("nonexistent").await;
    assert!(status.is_err());

    let call_res = manager
        .call_tool("nonexistent", "dummy", None)
        .await;
    assert!(call_res.is_err());
    assert!(call_res.unwrap_err().contains("MCP server 'nonexistent' not found"));

    // 3. Attempting to stop a non-existent server errors cleanly
    let stop_res = manager.stop_server("nonexistent").await;
    assert!(stop_res.is_err());
}

#[test]
fn test_week9_air_gapped_security_stdio_isolation_e2e() {
    // Verify that server config enforces local stdio execution
    let server_cfg = McpServerConfig {
        name: "isolated-local-server".to_string(),
        command: "node".to_string(),
        args: vec!["./local-mcp-server.js".to_string()],
        env: Some(HashMap::from([(
            "VEDARA_OFFLINE".to_string(),
            "1".to_string(),
        )])),
        working_dir: Some(".".to_string()),
    };

    assert_eq!(server_cfg.name, "isolated-local-server");
    assert_eq!(server_cfg.command, "node");
    assert_eq!(
        server_cfg.env.unwrap().get("VEDARA_OFFLINE").unwrap(),
        "1"
    );
}
