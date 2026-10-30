use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::mcp::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};

type PendingMap = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<serde_json::Value, String>>>>>;

pub struct StdioTransport {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingMap,
    next_id: AtomicI64,
    child: Arc<Mutex<Child>>,
    stderr_logs: Arc<Mutex<Vec<String>>>,
}

impl StdioTransport {
    /// Spawns a child process and initializes stdio communication pipelines.
    pub async fn spawn(
        command: &str,
        args: &[String],
        env: Option<&HashMap<String, String>>,
        working_dir: Option<&str>,
    ) -> Result<Self, String> {
        let mut cmd = Command::new(command);
        cmd.args(args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        if let Some(envs) = env {
            for (k, v) in envs {
                cmd.env(k, v);
            }
        }

        if let Some(cwd) = working_dir {
            cmd.current_dir(cwd);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP process '{}': {}", command, e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture stdin for MCP child process".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout for MCP child process".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr for MCP child process".to_string())?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let stderr_logs = Arc::new(Mutex::new(Vec::new()));

        // Background stdout reader task
        let pending_clone = pending.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(trimmed) {
                    if let Some(id) = resp.id {
                        let mut map = pending_clone.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            if let Some(err) = resp.error {
                                let _ = tx.send(Err(err.message));
                            } else {
                                let _ = tx.send(Ok(resp.result.unwrap_or(serde_json::Value::Null)));
                            }
                        }
                    }
                }
            }
        });

        // Background stderr reader task
        let stderr_clone = stderr_logs.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let mut logs = stderr_clone.lock().await;
                if logs.len() > 100 {
                    logs.remove(0);
                }
                logs.push(line);
            }
        });

        Ok(Self {
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            next_id: AtomicI64::new(1),
            child: Arc::new(Mutex::new(child)),
            stderr_logs,
        })
    }

    /// Sends a JSON-RPC request and awaits the corresponding response with a timeout.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
        timeout_duration: Duration,
    ) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };

        let json_line = serde_json::to_string(&req)
            .map_err(|e| format!("Failed to serialize JSON-RPC request: {}", e))?
            + "\n";

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        // Write to stdin
        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(json_line.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to MCP stdin: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush MCP stdin: {}", e))?;
        }

        // Await response with timeout
        match tokio::time::timeout(timeout_duration, rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err(format!(
                "MCP transport channel closed before response received for request {}",
                id
            )),
            Err(_) => {
                let mut map = self.pending.lock().await;
                map.remove(&id);
                Err(format!(
                    "MCP request '{}' (id: {}) timed out after {:?}",
                    method, id, timeout_duration
                ))
            }
        }
    }

    /// Sends a one-way notification without waiting for a response.
    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };

        let json_line = serde_json::to_string(&notif)
            .map_err(|e| format!("Failed to serialize JSON-RPC notification: {}", e))?
            + "\n";

        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(json_line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to MCP stdin: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush MCP stdin: {}", e))?;

        Ok(())
    }

    /// Fetches the recent stderr logs for diagnostics.
    pub async fn get_recent_stderr(&self) -> Vec<String> {
        self.stderr_logs.lock().await.clone()
    }

    /// Terminates the child process and cleans up pending requests.
    pub async fn close(&self) -> Result<(), String> {
        // Clear pending requests
        {
            let mut map = self.pending.lock().await;
            for (_, tx) in map.drain() {
                let _ = tx.send(Err("MCP transport closed".to_string()));
            }
        }

        // Kill child process
        let mut child = self.child.lock().await;
        let _ = child.kill().await;

        Ok(())
    }
}
