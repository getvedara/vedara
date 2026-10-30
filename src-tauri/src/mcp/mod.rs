pub mod client;
pub mod manager;
pub mod transport;
pub mod types;

use std::sync::Arc;

pub use client::McpClient;
pub use manager::McpManager;
pub use transport::StdioTransport;
pub use types::*;

pub type McpManagerRef = Arc<McpManager>;

/// Initializes the global MCP manager state for Tauri.
pub fn create_mcp_state() -> McpManagerRef {
    Arc::new(McpManager::new())
}

#[tauri::command]
pub async fn start_mcp_server(
    state: tauri::State<'_, McpManagerRef>,
    config: McpServerConfig,
) -> Result<McpServerStatus, String> {
    state.start_server(config).await
}

#[tauri::command]
pub async fn stop_mcp_server(
    state: tauri::State<'_, McpManagerRef>,
    name: String,
) -> Result<(), String> {
    state.stop_server(&name).await
}

#[tauri::command]
pub async fn list_mcp_servers(
    state: tauri::State<'_, McpManagerRef>,
) -> Result<Vec<McpServerStatus>, String> {
    Ok(state.list_servers().await)
}

#[tauri::command]
pub async fn list_mcp_tools(
    state: tauri::State<'_, McpManagerRef>,
    server_name: Option<String>,
) -> Result<Vec<McpToolDefinition>, String> {
    Ok(state.list_tools(server_name.as_deref()).await)
}

#[tauri::command]
pub async fn call_mcp_tool(
    state: tauri::State<'_, McpManagerRef>,
    server_name: String,
    tool_name: String,
    arguments: Option<serde_json::Value>,
) -> Result<ToolCallResult, String> {
    state.call_tool(&server_name, &tool_name, arguments).await
}

#[tauri::command]
pub async fn get_mcp_server_status(
    state: tauri::State<'_, McpManagerRef>,
    name: String,
) -> Result<McpServerStatus, String> {
    state.get_server_status(&name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jsonrpc_request_response_serialization() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 42,
            method: "tools/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let json = serde_json::to_string(&req).expect("Failed to serialize request");
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"id\":42"));
        assert!(json.contains("\"method\":\"tools/list\""));

        let resp_json = r#"{"jsonrpc":"2.0","id":42,"result":{"tools":[]}}"#;
        let resp: JsonRpcResponse = serde_json::from_str(resp_json).expect("Failed to parse response");
        assert_eq!(resp.id, Some(42));
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_mcp_initialize_params_and_result_schema() {
        let params = InitializeParams {
            protocol_version: LATEST_PROTOCOL_VERSION.to_string(),
            capabilities: ClientCapabilities {
                roots: Some(serde_json::json!({"listChanged": true})),
                sampling: None,
            },
            client_info: ClientInfo {
                name: "Vedara".to_string(),
                version: "1.0.0".to_string(),
            },
        };

        let json = serde_json::to_string(&params).expect("Failed to serialize InitializeParams");
        assert!(json.contains("\"protocolVersion\":\"2024-11-05\""));
        assert!(json.contains("\"clientInfo\":{\"name\":\"Vedara\",\"version\":\"1.0.0\"}"));

        let mock_server_resp = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": { "listChanged": true },
                "resources": { "subscribe": true }
            },
            "serverInfo": {
                "name": "sqlite-mcp",
                "version": "1.0.0"
            }
        });

        let init_result: InitializeResult =
            serde_json::from_value(mock_server_resp).expect("Failed to parse InitializeResult");
        assert_eq!(init_result.protocol_version, "2024-11-05");
        assert_eq!(init_result.server_info.name, "sqlite-mcp");
        assert!(init_result.capabilities.tools.is_some());
    }

    #[test]
    fn test_mcp_tool_definition_and_execution_result() {
        let tool = McpToolDefinition {
            name: "execute_sql".to_string(),
            description: "Executes a SELECT query on the SQLite database".to_string(),
            input_schema: ToolInputSchema {
                schema_type: "object".to_string(),
                properties: Some(serde_json::json!({
                    "query": { "type": "string", "description": "The SQL query" }
                })),
                required: Some(vec!["query".to_string()]),
                description: Some("Input parameters for execute_sql".to_string()),
            },
            server_name: Some("sqlite-server".to_string()),
        };

        let json = serde_json::to_string(&tool).expect("Failed to serialize McpToolDefinition");
        assert!(json.contains("\"name\":\"execute_sql\""));
        assert!(json.contains("\"serverName\":\"sqlite-server\""));
        assert!(json.contains("\"inputSchema\""));

        let result = ToolCallResult {
            content: vec![McpContent {
                content_type: "text".to_string(),
                text: Some("[{\"id\":1,\"name\":\"test\"}]".to_string()),
                data: None,
                mime_type: None,
            }],
            is_error: false,
        };

        let res_json = serde_json::to_string(&result).expect("Failed to serialize ToolCallResult");
        assert!(res_json.contains("\"isError\":false"));
        assert!(res_json.contains("\"text\":\"[{\\\"id\\\":1,\\\"name\\\":\\\"test\\\"}]\""));
    }

    #[test]
    fn test_mcp_manager_lifecycle() {
        let manager = McpManager::new();
        let rt = tokio::runtime::Runtime::new().unwrap();

        rt.block_on(async {
            let servers = manager.list_servers().await;
            assert!(servers.is_empty());

            let tools = manager.list_tools(None).await;
            assert!(tools.is_empty());
        });
    }
}
