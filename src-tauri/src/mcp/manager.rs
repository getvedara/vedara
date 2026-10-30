use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::mcp::client::McpClient;
use crate::mcp::types::{
    McpServerConfig, McpServerStatus, McpToolDefinition, ToolCallResult,
};

pub struct McpManager {
    servers: Arc<RwLock<HashMap<String, Arc<McpClient>>>>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Starts and connects a new MCP server.
    pub async fn start_server(&self, config: McpServerConfig) -> Result<McpServerStatus, String> {
        let name = config.name.clone();

        // Check if already running
        {
            let map = self.servers.read().await;
            if map.contains_key(&name) {
                return Err(format!("MCP server '{}' is already running", name));
            }
        }

        let client = McpClient::connect(config).await?;
        let status = client.get_status().await;

        let mut map = self.servers.write().await;
        map.insert(name, client);

        Ok(status)
    }

    /// Stops and terminates a running MCP server.
    pub async fn stop_server(&self, name: &str) -> Result<(), String> {
        let client = {
            let mut map = self.servers.write().await;
            map.remove(name)
                .ok_or_else(|| format!("MCP server '{}' is not running", name))?
        };

        client.shutdown().await
    }

    /// Lists statuses of all active MCP servers.
    pub async fn list_servers(&self) -> Vec<McpServerStatus> {
        let map = self.servers.read().await;
        let mut statuses = Vec::new();
        for client in map.values() {
            statuses.push(client.get_status().await);
        }
        statuses.sort_by(|a, b| a.name.cmp(&b.name));
        statuses
    }

    /// Queries all tools across all running servers, or for a specific server.
    pub async fn list_tools(&self, server_name: Option<&str>) -> Vec<McpToolDefinition> {
        let map = self.servers.read().await;
        let mut all_tools = Vec::new();

        if let Some(name) = server_name {
            if let Some(client) = map.get(name) {
                all_tools.extend(client.list_tools().await);
            }
        } else {
            for client in map.values() {
                all_tools.extend(client.list_tools().await);
            }
        }

        all_tools.sort_by(|a, b| a.name.cmp(&b.name));
        all_tools
    }

    /// Dispatches a tool call to the designated MCP server.
    pub async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: Option<serde_json::Value>,
    ) -> Result<ToolCallResult, String> {
        let client = {
            let map = self.servers.read().await;
            map.get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not found", server_name))?
        };

        client.call_tool(tool_name, arguments).await
    }

    /// Retrieves status for a specific server by name.
    pub async fn get_server_status(&self, name: &str) -> Result<McpServerStatus, String> {
        let map = self.servers.read().await;
        let client = map
            .get(name)
            .ok_or_else(|| format!("MCP server '{}' is not running", name))?;
        Ok(client.get_status().await)
    }
}
