use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::workspace::data_dir;

// ---------------------------------------------------------------------------
// Pure Rust FIPS 180-4 SHA-256 Implementation (Zero External Dependencies)
// ---------------------------------------------------------------------------

const K256: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub fn sha256_digest(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, item) in w.iter_mut().enumerate().take(16) {
            let start = i * 4;
            *item = u32::from_be_bytes([chunk[start], chunk[start + 1], chunk[start + 2], chunk[start + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut h_reg = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h_reg.wrapping_add(s1).wrapping_add(ch).wrapping_add(K256[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h_reg = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(h_reg);
    }

    let mut out = [0u8; 32];
    for (i, val) in h.iter().enumerate() {
        let b = val.to_be_bytes();
        out[i * 4..(i + 1) * 4].copy_from_slice(&b);
    }
    out
}

pub fn sha256_hex(data: &[u8]) -> String {
    let digest = sha256_digest(data);
    let mut s = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut s, "{:02x}", b);
    }
    s
}

// ---------------------------------------------------------------------------
// Audit Log Models & Types
// ---------------------------------------------------------------------------

pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum AuditEventType {
    ModelPrompt,
    ModelResponse,
    DiffExecution,
    ToolInvocation,
    CheckpointCreated,
    CheckpointRestored,
    ConfigChanged,
    SecurityViolation,
    PluginLifecycle,
}

impl AuditEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuditEventType::ModelPrompt => "model_prompt",
            AuditEventType::ModelResponse => "model_response",
            AuditEventType::DiffExecution => "diff_execution",
            AuditEventType::ToolInvocation => "tool_invocation",
            AuditEventType::CheckpointCreated => "checkpoint_created",
            AuditEventType::CheckpointRestored => "checkpoint_restored",
            AuditEventType::ConfigChanged => "config_changed",
            AuditEventType::SecurityViolation => "security_violation",
            AuditEventType::PluginLifecycle => "plugin_lifecycle",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "model_prompt" => Some(AuditEventType::ModelPrompt),
            "model_response" => Some(AuditEventType::ModelResponse),
            "diff_execution" => Some(AuditEventType::DiffExecution),
            "tool_invocation" => Some(AuditEventType::ToolInvocation),
            "checkpoint_created" => Some(AuditEventType::CheckpointCreated),
            "checkpoint_restored" => Some(AuditEventType::CheckpointRestored),
            "config_changed" => Some(AuditEventType::ConfigChanged),
            "security_violation" => Some(AuditEventType::SecurityViolation),
            "plugin_lifecycle" => Some(AuditEventType::PluginLifecycle),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum AuditActor {
    User,
    Assistant,
    System,
    Plugin,
}

impl AuditActor {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuditActor::User => "user",
            AuditActor::Assistant => "assistant",
            AuditActor::System => "system",
            AuditActor::Plugin => "plugin",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "user" => Some(AuditActor::User),
            "assistant" => Some(AuditActor::Assistant),
            "system" => Some(AuditActor::System),
            "plugin" => Some(AuditActor::Plugin),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AuditEvent {
    pub id: String,
    pub timestamp_ms: u64,
    pub event_type: AuditEventType,
    pub actor: AuditActor,
    pub payload: String,
    pub prev_hash: String,
    pub record_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AuditQueryFilter {
    pub event_type: Option<String>,
    pub actor: Option<String>,
    pub since_ms: Option<u64>,
    pub until_ms: Option<u64>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub search_query: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AuditIntegrityResult {
    pub is_valid: bool,
    pub total_records: usize,
    pub corrupted_index: Option<usize>,
    pub expected_hash: Option<String>,
    pub actual_hash: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CreateAuditEventInput {
    pub event_type: String,
    pub actor: String,
    pub payload: String,
}

// ---------------------------------------------------------------------------
// Audit Logger Core & Storage Engine
// ---------------------------------------------------------------------------

pub struct AuditLogger {
    events: Vec<AuditEvent>,
    /// `None` until a workspace folder is opened; events are then kept in memory only.
    workspace_root: Option<PathBuf>,
    encryption_key: [u8; 32],
}

pub type AuditLoggerState = Arc<RwLock<AuditLogger>>;

/// Starts in memory; `set_workspace_root` rebinds it to the opened folder.
pub fn create_audit_logger_state() -> AuditLoggerState {
    Arc::new(RwLock::new(AuditLogger::in_memory()))
}

impl AuditLogger {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let root = workspace_root.as_ref().to_path_buf();
        let key = Self::derive_workspace_key(&root);
        let mut logger = Self {
            events: Vec::new(),
            workspace_root: Some(root),
            encryption_key: key,
        };

        // Attempt to load existing log from disk
        let _ = logger.load_from_disk();
        logger
    }

    /// A logger not bound to any folder; nothing is written to disk.
    pub fn in_memory() -> Self {
        Self {
            events: Vec::new(),
            workspace_root: None,
            encryption_key: Self::derive_workspace_key(Path::new("")),
        }
    }

    fn derive_workspace_key(workspace_root: &Path) -> [u8; 32] {
        let path_bytes = workspace_root.to_string_lossy();
        // Pre-rename salt, kept as is: changing it would make existing logs unreadable.
        let salt = b"open-studio-zero-telemetry-audit-key-seed-v1";
        let mut combined = Vec::with_capacity(path_bytes.len() + salt.len());
        combined.extend_from_slice(path_bytes.as_bytes());
        combined.extend_from_slice(salt);
        sha256_digest(&combined)
    }

    pub fn compute_record_hash(
        id: &str,
        timestamp_ms: u64,
        event_type: &AuditEventType,
        actor: &AuditActor,
        payload: &str,
        prev_hash: &str,
    ) -> String {
        let data = format!(
            "{}:{}:{}:{}:{}:{}",
            prev_hash,
            id,
            timestamp_ms,
            event_type.as_str(),
            actor.as_str(),
            payload
        );
        sha256_hex(data.as_bytes())
    }

    pub fn log_event(
        &mut self,
        event_type: AuditEventType,
        actor: AuditActor,
        payload: String,
    ) -> AuditEvent {
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let id = format!("aud_{}_{}", timestamp_ms, self.events.len() + 1);
        let prev_hash = if let Some(last) = self.events.last() {
            last.record_hash.clone()
        } else {
            GENESIS_HASH.to_string()
        };

        let record_hash = Self::compute_record_hash(
            &id,
            timestamp_ms,
            &event_type,
            &actor,
            &payload,
            &prev_hash,
        );

        let event = AuditEvent {
            id,
            timestamp_ms,
            event_type,
            actor,
            payload,
            prev_hash,
            record_hash,
        };

        self.events.push(event.clone());
        let _ = self.save_to_disk();
        event
    }

    pub fn verify_chain_integrity(&self) -> AuditIntegrityResult {
        let mut expected_prev_hash = GENESIS_HASH.to_string();

        for (idx, event) in self.events.iter().enumerate() {
            // Check that prev_hash matches expected predecessor
            if event.prev_hash != expected_prev_hash {
                return AuditIntegrityResult {
                    is_valid: false,
                    total_records: self.events.len(),
                    corrupted_index: Some(idx),
                    expected_hash: Some(expected_prev_hash),
                    actual_hash: Some(event.prev_hash.clone()),
                    message: format!(
                        "Cryptographic hash chain broken at record index {} (ID: {}). Predecessor hash mismatch.",
                        idx, event.id
                    ),
                };
            }

            // Recompute record hash
            let computed_hash = Self::compute_record_hash(
                &event.id,
                event.timestamp_ms,
                &event.event_type,
                &event.actor,
                &event.payload,
                &event.prev_hash,
            );

            if event.record_hash != computed_hash {
                return AuditIntegrityResult {
                    is_valid: false,
                    total_records: self.events.len(),
                    corrupted_index: Some(idx),
                    expected_hash: Some(computed_hash),
                    actual_hash: Some(event.record_hash.clone()),
                    message: format!(
                        "Tampered record detected at index {} (ID: {}). Content does not match signed cryptographic hash.",
                        idx, event.id
                    ),
                };
            }

            expected_prev_hash = event.record_hash.clone();
        }

        AuditIntegrityResult {
            is_valid: true,
            total_records: self.events.len(),
            corrupted_index: None,
            expected_hash: None,
            actual_hash: None,
            message: format!(
                "Audit chain verified: {} tamper-evident records intact with zero corruption.",
                self.events.len()
            ),
        }
    }

    pub fn query_events(&self, filter: &AuditQueryFilter) -> Vec<AuditEvent> {
        let mut matched: Vec<&AuditEvent> = self
            .events
            .iter()
            .filter(|e| {
                if let Some(ref et) = filter.event_type {
                    if !e.event_type.as_str().eq_ignore_ascii_case(et) {
                        return false;
                    }
                }
                if let Some(ref a) = filter.actor {
                    if !e.actor.as_str().eq_ignore_ascii_case(a) {
                        return false;
                    }
                }
                if let Some(since) = filter.since_ms {
                    if e.timestamp_ms < since {
                        return false;
                    }
                }
                if let Some(until) = filter.until_ms {
                    if e.timestamp_ms > until {
                        return false;
                    }
                }
                if let Some(ref q) = filter.search_query {
                    let query_lower = q.to_lowercase();
                    if !e.payload.to_lowercase().contains(&query_lower) && !e.id.to_lowercase().contains(&query_lower) {
                        return false;
                    }
                }
                true
            })
            .collect();

        // Newest first by default
        matched.reverse();

        let offset = filter.offset.unwrap_or(0);
        let limit = filter.limit.unwrap_or(100);

        matched
            .into_iter()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn export_as_sqlite_sql(&self) -> String {
        let mut sql = String::with_capacity(1024 + self.events.len() * 256);
        sql.push_str("-- Vedara Air-Gapped Tamper-Evident Audit Log SQLite Export\n");
        sql.push_str("-- Standard SQLite DDL & Insert Statements\n\n");
        sql.push_str("CREATE TABLE IF NOT EXISTS audit_events (\n");
        sql.push_str("    id TEXT PRIMARY KEY NOT NULL,\n");
        sql.push_str("    timestamp_ms INTEGER NOT NULL,\n");
        sql.push_str("    event_type TEXT NOT NULL,\n");
        sql.push_str("    actor TEXT NOT NULL,\n");
        sql.push_str("    payload TEXT NOT NULL,\n");
        sql.push_str("    prev_hash TEXT NOT NULL,\n");
        sql.push_str("    record_hash TEXT NOT NULL\n");
        sql.push_str(");\n\n");
        sql.push_str("BEGIN TRANSACTION;\n");

        for e in &self.events {
            let escaped_payload = e.payload.replace('\'', "''");
            sql.push_str(&format!(
                "INSERT INTO audit_events (id, timestamp_ms, event_type, actor, payload, prev_hash, record_hash) VALUES ('{}', {}, '{}', '{}', '{}', '{}', '{}');\n",
                e.id,
                e.timestamp_ms,
                e.event_type.as_str(),
                e.actor.as_str(),
                escaped_payload,
                e.prev_hash,
                e.record_hash
            ));
        }

        sql.push_str("COMMIT;\n");
        sql
    }

    fn cipher_transform(&self, data: &[u8]) -> Vec<u8> {
        // Deterministic stream cipher keystream generated via SHA-256 rounds
        let mut out = Vec::with_capacity(data.len());
        let mut counter = 0u64;

        while out.len() < data.len() {
            let mut block_input = [0u8; 40];
            block_input[0..32].copy_from_slice(&self.encryption_key);
            block_input[32..40].copy_from_slice(&counter.to_be_bytes());
            let keystream = sha256_digest(&block_input);

            let remaining = data.len() - out.len();
            let to_take = remaining.min(32);
            let offset = out.len();
            for i in 0..to_take {
                out.push(data[offset + i] ^ keystream[i]);
            }
            counter += 1;
        }

        out
    }

    pub fn save_to_disk(&self) -> Result<(), String> {
        let Some(root) = &self.workspace_root else {
            return Ok(());
        };
        let storage_dir = data_dir::data_dir(root);
        if !storage_dir.exists() {
            fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;
        }

        let file_path = storage_dir.join("audit.enc");
        let serialized = serde_json::to_vec(&self.events).map_err(|e| e.to_string())?;
        let encrypted = self.cipher_transform(&serialized);

        // Header magic OSAUDIT1 (8 bytes) + encrypted payload
        let mut final_data = Vec::with_capacity(8 + encrypted.len());
        final_data.extend_from_slice(b"OSAUDIT1");
        final_data.extend_from_slice(&encrypted);

        fs::write(file_path, final_data).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_from_disk(&mut self) -> Result<usize, String> {
        let Some(root) = &self.workspace_root else {
            return Ok(0);
        };
        // A log from before the rename is moved, not re-created, so its hash chain continues.
        let file_path = data_dir::migrate_legacy_file(root, "audit.enc").map_err(|e| e.to_string())?;
        if !file_path.exists() {
            return Ok(0);
        }

        let raw_data = fs::read(file_path).map_err(|e| e.to_string())?;
        if raw_data.len() < 8 || &raw_data[0..8] != b"OSAUDIT1" {
            return Err("Invalid or unencrypted audit log header".to_string());
        }

        let encrypted = &raw_data[8..];
        let decrypted = self.cipher_transform(encrypted);
        let events: Vec<AuditEvent> = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;
        let count = events.len();
        self.events = events;
        Ok(count)
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Tauri IPC Bridge Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn log_audit_event_cmd(
    state: tauri::State<'_, AuditLoggerState>,
    input: CreateAuditEventInput,
) -> Result<AuditEvent, String> {
    let event_type = AuditEventType::from_str(&input.event_type)
        .ok_or_else(|| format!("Invalid audit event type: '{}'", input.event_type))?;
    let actor = AuditActor::from_str(&input.actor)
        .ok_or_else(|| format!("Invalid audit actor: '{}'", input.actor))?;

    let mut logger = state.write().await;
    let event = logger.log_event(event_type, actor, input.payload);
    Ok(event)
}

#[tauri::command]
pub async fn query_audit_log_cmd(
    state: tauri::State<'_, AuditLoggerState>,
    filter: Option<AuditQueryFilter>,
) -> Result<Vec<AuditEvent>, String> {
    let logger = state.read().await;
    let filter = filter.unwrap_or_default();
    Ok(logger.query_events(&filter))
}

#[tauri::command]
pub async fn verify_audit_log_integrity_cmd(
    state: tauri::State<'_, AuditLoggerState>,
) -> Result<AuditIntegrityResult, String> {
    let logger = state.read().await;
    Ok(logger.verify_chain_integrity())
}

#[tauri::command]
pub async fn export_audit_log_sql_cmd(
    state: tauri::State<'_, AuditLoggerState>,
    destination_path: Option<String>,
) -> Result<String, String> {
    let logger = state.read().await;
    let sql = logger.export_as_sqlite_sql();

    if let Some(dest) = destination_path {
        fs::write(&dest, &sql).map_err(|e| format!("Failed to write SQLite dump to {}: {}", dest, e))?;
    }

    Ok(sql)
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_known_vector() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn test_audit_logger_genesis_and_chaining() {
        let temp_dir = std::env::temp_dir().join("os_audit_test_chain");
        let _ = fs::remove_dir_all(&temp_dir);

        let mut logger = AuditLogger::new(&temp_dir);
        assert_eq!(logger.len(), 0);

        // Log 1st event
        let e1 = logger.log_event(
            AuditEventType::ModelPrompt,
            AuditActor::User,
            "{\"prompt\":\"Write quicksort in Rust\",\"tokens\":5}".to_string(),
        );
        assert_eq!(e1.prev_hash, GENESIS_HASH);
        assert!(!e1.record_hash.is_empty());

        // Log 2nd event
        let e2 = logger.log_event(
            AuditEventType::DiffExecution,
            AuditActor::Assistant,
            "{\"file\":\"src/sort.rs\",\"hunks\":1}".to_string(),
        );
        assert_eq!(e2.prev_hash, e1.record_hash);

        // Log 3rd event
        let e3 = logger.log_event(
            AuditEventType::CheckpointCreated,
            AuditActor::System,
            "{\"checkpoint\":\"ckpt_1001\"}".to_string(),
        );
        assert_eq!(e3.prev_hash, e2.record_hash);

        // Verify chain integrity
        let integrity = logger.verify_chain_integrity();
        assert!(integrity.is_valid);
        assert_eq!(integrity.total_records, 3);
        assert!(integrity.corrupted_index.is_none());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_audit_logger_detects_tampering() {
        let temp_dir = std::env::temp_dir().join("os_audit_test_tamper");
        let _ = fs::remove_dir_all(&temp_dir);

        let mut logger = AuditLogger::new(&temp_dir);

        logger.log_event(
            AuditEventType::ModelPrompt,
            AuditActor::User,
            "Original payload 1".to_string(),
        );
        logger.log_event(
            AuditEventType::ModelResponse,
            AuditActor::Assistant,
            "Original payload 2".to_string(),
        );
        logger.log_event(
            AuditEventType::ToolInvocation,
            AuditActor::System,
            "Original payload 3".to_string(),
        );

        // Intentionally tamper with record #1 (second event)
        logger.events[1].payload = "Tampered malicious payload".to_string();

        let result = logger.verify_chain_integrity();
        assert!(!result.is_valid);
        assert_eq!(result.corrupted_index, Some(1));
        assert!(result.message.contains("Tampered record detected at index 1"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_audit_logger_query_filtering() {
        let temp_dir = std::env::temp_dir().join("os_audit_test_query");
        let _ = fs::remove_dir_all(&temp_dir);

        let mut logger = AuditLogger::new(&temp_dir);
        logger.log_event(AuditEventType::ModelPrompt, AuditActor::User, "Hello AI".to_string());
        logger.log_event(AuditEventType::ModelResponse, AuditActor::Assistant, "Hello User".to_string());
        logger.log_event(AuditEventType::SecurityViolation, AuditActor::System, "Blocked external IP".to_string());

        let filter = AuditQueryFilter {
            event_type: Some("security_violation".to_string()),
            ..Default::default()
        };
        let results = logger.query_events(&filter);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].event_type, AuditEventType::SecurityViolation);

        let user_filter = AuditQueryFilter {
            actor: Some("user".to_string()),
            ..Default::default()
        };
        let user_results = logger.query_events(&user_filter);
        assert_eq!(user_results.len(), 1);
        assert_eq!(user_results[0].actor, AuditActor::User);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_sqlite_sql_export_generation() {
        let temp_dir = std::env::temp_dir().join("os_audit_test_sql");
        let _ = fs::remove_dir_all(&temp_dir);

        let mut logger = AuditLogger::new(&temp_dir);
        logger.log_event(
            AuditEventType::DiffExecution,
            AuditActor::Assistant,
            "{\"applied\":true,\"file\":\"src/main.rs\"}".to_string(),
        );

        let sql = logger.export_as_sqlite_sql();
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS audit_events"));
        assert!(sql.contains("INSERT INTO audit_events"));
        assert!(sql.contains("diff_execution"));
        assert!(sql.contains("assistant"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_encryption_at_rest_roundtrip() {
        let temp_dir = std::env::temp_dir().join("os_audit_test_enc");
        let _ = fs::remove_dir_all(&temp_dir);

        {
            let mut logger = AuditLogger::new(&temp_dir);
            logger.log_event(AuditEventType::ModelPrompt, AuditActor::User, "Secret code".to_string());
            logger.log_event(AuditEventType::ConfigChanged, AuditActor::User, "Updated theme".to_string());
            assert_eq!(logger.len(), 2);
        }

        // Verify disk file is encrypted (starts with OSAUDIT1 and does not contain raw text)
        let enc_path = temp_dir.join(".vedara").join("audit.enc");
        assert!(enc_path.exists());
        let raw_bytes = fs::read(&enc_path).unwrap();
        assert_eq!(&raw_bytes[0..8], b"OSAUDIT1");
        let raw_string = String::from_utf8_lossy(&raw_bytes);
        assert!(!raw_string.contains("Secret code"));

        // Reload from disk in a fresh logger instance
        let reloaded = AuditLogger::new(&temp_dir);
        assert_eq!(reloaded.len(), 2);
        let integrity = reloaded.verify_chain_integrity();
        assert!(integrity.is_valid);
        assert_eq!(reloaded.events[0].payload, "Secret code");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn legacy_audit_log_is_moved_into_new_folder() {
        let temp_dir = std::env::temp_dir().join("os_audit_test_legacy");
        let _ = fs::remove_dir_all(&temp_dir);

        {
            let mut logger = AuditLogger::new(&temp_dir);
            logger.log_event(AuditEventType::ConfigChanged, AuditActor::User, "Before rename".to_string());
        }
        // Simulate a log written by a pre-rename build.
        let legacy_dir = temp_dir.join(".openstudio");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::rename(temp_dir.join(".vedara").join("audit.enc"), legacy_dir.join("audit.enc")).unwrap();

        let mut reloaded = AuditLogger::new(&temp_dir);
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded.events[0].payload, "Before rename");
        assert!(!legacy_dir.join("audit.enc").exists());
        assert!(temp_dir.join(".vedara").join("audit.enc").exists());

        reloaded.log_event(AuditEventType::ConfigChanged, AuditActor::User, "After rename".to_string());
        assert!(AuditLogger::new(&temp_dir).verify_chain_integrity().is_valid);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
