use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::mcp::transport::StdioTransport;
use crate::mcp::types::{
    ClientCapabilities, ClientInfo, InitializeParams, InitializeResult, ListToolsResult,
    McpServerConfig, McpServerStatus, McpToolDefinition, ServerCapabilities, ServerInfo,
    ServerState, ToolCallParams, ToolCallResult, LATEST_PROTOCOL_VERSION,
};

pub struct McpClient {
    pub name: String,
    pub config: McpServerConfig,
    transport: Arc<StdioTransport>,
    state: Arc<RwLock<ServerState>>,
    server_info: Arc<RwLock<Option<ServerInfo>>>,
    server_capabilities: Arc<RwLock<Option<ServerCapabilities>>>,
    tools: Arc<RwLock<Vec<McpToolDefinition>>>,
    start_time: Instant,
    last_error: Arc<RwLock<Option<String>>>,
}

impl McpClient {
    /// Spawns the MCP server child process and completes the protocol handshake.
    pub async fn connect(config: McpServerConfig) -> Result<Arc<Self>, String> {
        let name = config.name.clone();
        let transport = StdioTransport::spawn(
            &config.command,
            &config.args,
            config.env.as_ref(),
            config.working_dir.as_deref(),
        )
        .await
        .map_err(|e| format!("Failed to spawn MCP server '{}': {}", name, e))?;

        let client = Arc::new(Self {
            name: name.clone(),
            config,
            transport: Arc::new(transport),
            state: Arc::new(RwLock::new(ServerState::Starting)),
            server_info: Arc::new(RwLock::new(None)),
            server_capabilities: Arc::new(RwLock::new(None)),
            tools: Arc::new(RwLock::new(Vec::new())),
            start_time: Instant::now(),
            last_error: Arc::new(RwLock::new(None)),
        });

        // Execute MCP initialization handshake
        match client.initialize_handshake().await {
            Ok(_) => {
                *client.state.write().await = ServerState::Running;
                // Discover tools immediately upon successful handshake
                let _ = client.refresh_tools().await;
                Ok(client)
            }
            Err(e) => {
                *client.state.write().await = ServerState::Error;
                *client.last_error.write().await = Some(e.clone());
                let _ = client.transport.close().await;
                Err(format!("MCP handshake failed for server '{}': {}", name, e))
            }
        }
    }

    /// Performs the initialize -> notifications/initialized MCP handshake.
    async fn initialize_handshake(&self) -> Result<(), String> {
        let init_params = InitializeParams {
            protocol_version: LATEST_PROTOCOL_VERSION.to_string(),
            capabilities: ClientCapabilities::default(),
            client_info: ClientInfo {
                name: "Vedara".to_string(),
                version: "1.0.0".to_string(),
            },
        };

        let params_val = serde_json::to_value(&init_params)
            .map_err(|e| format!("Failed to serialize initialize params: {}", e))?;

        let resp_val = self
            .transport
            .send_request("initialize", Some(params_val), Duration::from_secs(15))
            .await?;

        let init_result: InitializeResult = serde_json::from_value(resp_val)
            .map_err(|e| format!("Invalid initialize response from MCP server: {}", e))?;

        *self.server_info.write().await = Some(init_result.server_info);
        *self.server_capabilities.write().await = Some(init_result.capabilities);

        // Send notifications/initialized
        self.transport
            .send_notification("notifications/initialized", None)
            .await?;

        Ok(())
    }

    /// Queries the server's available tools via `tools/list` and caches them.
    pub async fn refresh_tools(&self) -> Result<Vec<McpToolDefinition>, String> {
        let resp_val = self
            .transport
            .send_request("tools/list", Some(serde_json::json!({})), Duration::from_secs(15))
            .await?;

        let list_result: ListToolsResult = serde_json::from_value(resp_val)
            .map_err(|e| format!("Failed to parse tools/list result: {}", e))?;

        let mut enriched_tools = list_result.tools;
        for tool in &mut enriched_tools {
            tool.server_name = Some(self.name.clone());
        }

        *self.tools.write().await = enriched_tools.clone();
        Ok(enriched_tools)
    }

    /// Returns currently discovered tools for this server.
    pub async fn list_tools(&self) -> Vec<McpToolDefinition> {
        self.tools.read().await.clone()
    }

    /// Executes a tool call on this MCP server.
    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: Option<serde_json::Value>,
    ) -> Result<ToolCallResult, String> {
        // Verify tool is registered
        let available_tools = self.tools.read().await;
        let tool_exists = available_tools.iter().any(|t| t.name == tool_name);
        if !tool_exists {
            return Err(format!(
                "Tool '{}' not found on MCP server '{}'",
                tool_name, self.name
            ));
        }

        let params = ToolCallParams {
            name: tool_name.to_string(),
            arguments,
        };

        let params_val = serde_json::to_value(&params)
            .map_err(|e| format!("Failed to serialize tool call params: {}", e))?;

        let resp_val = self
            .transport
            .send_request("tools/call", Some(params_val), Duration::from_secs(60))
            .await?;

        let result: ToolCallResult = serde_json::from_value(resp_val)
            .map_err(|e| format!("Failed to parse tools/call result: {}", e))?;

        Ok(result)
    }

    /// Sends a ping request to verify server responsiveness.
    pub async fn ping(&self) -> Result<(), String> {
        self.transport
            .send_request("ping", None, Duration::from_secs(5))
            .await
            .map(|_| ())
    }

    /// Retrieves current server status and telemetry.
    pub async fn get_status(&self) -> McpServerStatus {
        let state = self.state.read().await.clone();
        let tool_count = self.tools.read().await.len();
        let server_version = self
            .server_info
            .read()
            .await
            .as_ref()
            .map(|i| format!("{} v{}", i.name, i.version));
        let error_message = self.last_error.read().await.clone();
        let uptime_secs = self.start_time.elapsed().as_secs();

        McpServerStatus {
            name: self.name.clone(),
            state,
            tool_count,
            server_version,
            error_message,
            uptime_secs,
        }
    }

    /// Gracefully closes the MCP server process.
    pub async fn shutdown(&self) -> Result<(), String> {
        *self.state.write().await = ServerState::Stopped;
        self.transport.close().await
    }
}
