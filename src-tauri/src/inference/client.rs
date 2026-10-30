use super::queue::{CancelReason, InferencePriority, InferenceQueue};
use super::swapper::{HardwareTierInfo, ModelResidency, ModelSwapper};
use crate::security::network_guard::{is_loopback_host, validate_network_target};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex};

/// Loopback connects either succeed or are refused almost immediately.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Bound on non-streaming calls (health checks, evictions).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Smallest context window we ever ask Ollama for.
const MIN_NUM_CTX: u32 = 2048;
/// Token cap for inline autocomplete: the editor only shows a short continuation.
const AUTOCOMPLETE_NUM_PREDICT: i32 = 128;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompletionRequest {
    pub model: String,
    pub prompt: String,
    /// Text after the cursor. When set, Ollama fills in the middle using the model's own
    /// FIM template (`prompt` is the text before the cursor).
    #[serde(default)]
    pub suffix: Option<String>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub stop_tokens: Vec<String>,
    pub keep_alive: Option<String>,
    pub priority: Option<InferencePriority>,
    /// Explicit context window; defaults to the hardware sentinel's clamped budget.
    #[serde(default)]
    pub num_ctx: Option<u32>,
    #[serde(default)]
    pub num_predict: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

/// A conversation sent to Ollama's `/api/chat`, which applies the model's own chat template.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatTurn>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub stop_tokens: Vec<String>,
    pub keep_alive: Option<String>,
    pub priority: Option<InferencePriority>,
    #[serde(default)]
    pub num_ctx: Option<u32>,
    #[serde(default)]
    pub num_predict: Option<i32>,
}

fn default_temperature() -> f32 {
    0.2
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelInfo {
    pub name: String,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InferenceHealth {
    pub online: bool,
    pub endpoint: String,
    pub models: Vec<ModelInfo>,
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModelTagItem>,
}

#[derive(Deserialize, Debug)]
struct OllamaModelTagItem {
    name: String,
    size: Option<u64>,
    modified_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmTokenEvent {
    pub request_id: String,
    pub token: String,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmDoneEvent {
    pub request_id: String,
    pub total_duration: Option<u64>,
    pub eval_count: Option<u32>,
    pub eval_duration: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StreamErrorKind {
    /// Ollama or the connection failed.
    Error,
    /// Stopped through `abort_completion`.
    Aborted,
    /// Cancelled because a higher-priority request was admitted.
    Preempted,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmErrorEvent {
    pub request_id: String,
    pub error: String,
    pub kind: StreamErrorKind,
}

/// Destination of a request's stream events. The app emits them as Tauri events
/// (`llm-token:{id}`, `llm-done:{id}`, `llm-error:{id}`); tests record them.
pub trait StreamSink: Send + Sync + 'static {
    fn token(&self, event: LlmTokenEvent);
    fn done(&self, event: LlmDoneEvent);
    fn error(&self, event: LlmErrorEvent);
}

impl<R: tauri::Runtime> StreamSink for tauri::Window<R> {
    fn token(&self, event: LlmTokenEvent) {
        let _ = self.emit(&format!("llm-token:{}", event.request_id), event);
    }

    fn done(&self, event: LlmDoneEvent) {
        let _ = self.emit(&format!("llm-done:{}", event.request_id), event);
    }

    fn error(&self, event: LlmErrorEvent) {
        let _ = self.emit(&format!("llm-error:{}", event.request_id), event);
    }
}

/// One NDJSON record from `/api/generate` or `/api/chat`.
#[derive(Deserialize, Debug)]
struct OllamaStreamChunk {
    /// Token from `/api/generate`.
    response: Option<String>,
    /// Token from `/api/chat`.
    message: Option<OllamaChatDelta>,
    #[serde(default)]
    done: bool,
    error: Option<String>,
    total_duration: Option<u64>,
    eval_count: Option<u32>,
    eval_duration: Option<u64>,
}

#[derive(Deserialize, Debug)]
struct OllamaChatDelta {
    #[serde(default)]
    content: String,
}

/// Splits a byte stream into newline-delimited records.
///
/// Raw bytes are buffered until a newline arrives, so a multibyte UTF-8 character split
/// across two network chunks is decoded intact (0x0A never occurs inside a multibyte
/// sequence).
#[derive(Default)]
pub(crate) struct NdjsonLines {
    buf: Vec<u8>,
}

impl NdjsonLines {
    /// Appends `bytes` and returns every record completed by them.
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        // Bytes already buffered contain no newline, so only the new ones need scanning.
        let mut scan_from = self.buf.len();
        self.buf.extend_from_slice(bytes);

        let mut records = Vec::new();
        let mut record_start = 0;
        while let Some(offset) = self.buf[scan_from..].iter().position(|&b| b == b'\n') {
            let newline = scan_from + offset;
            records.push(self.buf[record_start..newline].to_vec());
            record_start = newline + 1;
            scan_from = record_start;
        }
        self.buf.drain(..record_start);
        records
    }

    /// Returns the trailing record when the stream ends without a final newline.
    pub(crate) fn finish(&mut self) -> Option<Vec<u8>> {
        let rest = std::mem::take(&mut self.buf);
        (!rest.iter().all(u8::is_ascii_whitespace)).then_some(rest)
    }
}

/// Forwards the token in one NDJSON record and returns the final stats once Ollama
/// reports `done`.
fn handle_record<S: StreamSink>(
    sink: &S,
    request_id: &str,
    record: &[u8],
) -> Result<Option<LlmDoneEvent>, String> {
    if record.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let Ok(chunk) = serde_json::from_slice::<OllamaStreamChunk>(record) else {
        return Ok(None);
    };
    if let Some(error) = chunk.error {
        return Err(error);
    }

    let token = chunk
        .response
        .or_else(|| chunk.message.map(|m| m.content))
        .unwrap_or_default();
    if !token.is_empty() {
        sink.token(LlmTokenEvent {
            request_id: request_id.to_string(),
            token,
            done: chunk.done,
        });
    }

    Ok(chunk.done.then(|| LlmDoneEvent {
        request_id: request_id.to_string(),
        total_duration: chunk.total_duration,
        eval_count: chunk.eval_count,
        eval_duration: chunk.eval_duration,
    }))
}

/// Builds the error message for a non-2xx Ollama response, including Ollama's own
/// `{"error": ...}` text (e.g. "model 'x' not found").
async fn http_error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = tokio::time::timeout(Duration::from_secs(5), resp.text())
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| body.trim().chars().take(300).collect());

    if detail.is_empty() {
        format!("Ollama returned HTTP {}", status)
    } else {
        format!("Ollama returned HTTP {}: {}", status, detail)
    }
}

/// Normalizes an Ollama endpoint and refuses anything that is not a loopback HTTP(S) URL.
pub fn ensure_loopback_endpoint(endpoint: &str) -> Result<String, String> {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let normalized = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed) // airgap-allow: scheme prefix for an endpoint validated as loopback below
    };

    let status = validate_network_target(&normalized)?;
    if !status.allowed {
        return Err(format!(
            "Refusing inference endpoint '{}': {}",
            normalized, status.reason
        ));
    }

    // Re-check with the URL parser reqwest itself uses, so a parser differential (a
    // backslash before `@127.0.0.1` in the authority) cannot smuggle a remote host past
    // the guard.
    let url = reqwest::Url::parse(&normalized)
        .map_err(|e| format!("Invalid inference endpoint '{}': {}", normalized, e))?;
    let host = url.host_str().unwrap_or_default();
    if !matches!(url.scheme(), "http" | "https") || !is_loopback_host(host) {
        return Err(format!(
            "Refusing inference endpoint '{}': only loopback HTTP endpoints are allowed",
            normalized
        ));
    }

    Ok(normalized)
}

fn keep_alive_json(keep_alive: Option<&str>) -> Value {
    match keep_alive {
        Some("-1") => json!(-1),
        Some(s) => json!(s),
        None => json!("5m"),
    }
}

fn ollama_options(
    temperature: f32,
    stop: &[String],
    num_ctx: u32,
    num_predict: Option<i32>,
) -> Value {
    let mut options = json!({
        "temperature": temperature,
        "num_ctx": num_ctx,
    });
    // An explicit `stop` list replaces the model's own stop sequences, so only send one
    // when the caller asked for it.
    if !stop.is_empty() {
        options["stop"] = json!(stop);
    }
    if let Some(n) = num_predict {
        options["num_predict"] = json!(n);
    }
    options
}

/// Request body for `/api/generate`.
pub(crate) fn generate_body(req: &CompletionRequest, num_ctx: u32) -> Value {
    let num_predict = req.num_predict.or_else(|| {
        (req.priority == Some(InferencePriority::Autocomplete)).then_some(AUTOCOMPLETE_NUM_PREDICT)
    });

    let mut body = json!({
        "model": req.model,
        "prompt": req.prompt,
        "stream": true,
        "options": ollama_options(req.temperature, &req.stop_tokens, num_ctx, num_predict),
        "keep_alive": keep_alive_json(req.keep_alive.as_deref()),
    });
    if let Some(suffix) = &req.suffix {
        // Ollama only switches to the FIM template for a non-empty suffix; at end of file
        // an empty one would turn the code prefix into a chat message.
        body["suffix"] = json!(if suffix.is_empty() {
            "\n"
        } else {
            suffix.as_str()
        });
    }
    body
}

/// Request body for `/api/chat`.
pub(crate) fn chat_body(req: &ChatRequest, num_ctx: u32) -> Value {
    json!({
        "model": req.model,
        "messages": req.messages,
        "stream": true,
        "options": ollama_options(req.temperature, &req.stop_tokens, num_ctx, req.num_predict),
        "keep_alive": keep_alive_json(req.keep_alive.as_deref()),
    })
}

/// Per-phase bounds on a token stream. A whole-request timeout would cut off long or
/// reasoning generations, so the stream is only bounded while it is silent.
#[derive(Clone, Copy, Debug)]
pub struct StreamTimeouts {
    /// Ollama sends response headers only once the model is loaded and the prompt is
    /// evaluated, which can take minutes for a cold 14B model or a large @codebase
    /// prompt on CPU.
    pub first_byte: Duration,
    /// Longest silence tolerated between two streamed chunks.
    pub idle: Duration,
}

impl Default for StreamTimeouts {
    fn default() -> Self {
        Self {
            first_byte: Duration::from_secs(600),
            idle: Duration::from_secs(120),
        }
    }
}

/// A validated request ready to be streamed.
struct StreamJob {
    request_id: String,
    priority: InferencePriority,
    model: String,
    keep_alive: Option<String>,
    endpoint: String,
    path: &'static str,
    body: Value,
}

fn build_client(total_timeout: Option<Duration>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        // Ollama is local: never route through a system proxy or follow a redirect that
        // could take the request off the machine.
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none());
    if let Some(timeout) = total_timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().unwrap_or_default()
}

#[derive(Clone)]
pub struct InferenceManager {
    /// Client for bounded request/response calls (health checks, evictions).
    client: reqwest::Client,
    /// Client for token streams, bounded per phase by `timeouts` instead of as a whole.
    stream_client: reqwest::Client,
    pub default_endpoint: String,
    pub queue: Arc<InferenceQueue>,
    pub swapper: Arc<ModelSwapper>,
    /// `num_ctx` each model was first used with this session. Changing it makes Ollama
    /// reload the model, so it stays fixed until the model is evicted.
    context_sizes: Arc<Mutex<HashMap<String, u32>>>,
    timeouts: StreamTimeouts,
}

impl Default for InferenceManager {
    fn default() -> Self {
        Self::new(None)
    }
}

impl InferenceManager {
    pub fn new(default_endpoint: Option<String>) -> Self {
        Self::with_swapper(default_endpoint, ModelSwapper::default())
    }

    pub fn with_swapper(default_endpoint: Option<String>, swapper: ModelSwapper) -> Self {
        Self {
            client: build_client(Some(REQUEST_TIMEOUT)),
            stream_client: build_client(None),
            default_endpoint: default_endpoint
                .unwrap_or_else(|| "http://localhost:11434".to_string()),
            queue: Arc::new(InferenceQueue::new()),
            swapper: Arc::new(swapper),
            context_sizes: Arc::new(Mutex::new(HashMap::new())),
            timeouts: StreamTimeouts::default(),
        }
    }

    pub fn with_timeouts(mut self, timeouts: StreamTimeouts) -> Self {
        self.timeouts = timeouts;
        self
    }

    /// Picks the endpoint for a request and enforces the loopback-only network policy.
    fn resolve_endpoint(&self, endpoint_override: Option<String>) -> Result<String, String> {
        let endpoint = endpoint_override
            .filter(|e| !e.trim().is_empty())
            .unwrap_or_else(|| self.default_endpoint.clone());
        ensure_loopback_endpoint(&endpoint)
    }

    pub async fn check_health(&self, endpoint_override: Option<String>) -> InferenceHealth {
        let endpoint = match self.resolve_endpoint(endpoint_override.clone()) {
            Ok(endpoint) => endpoint,
            Err(err) => {
                return InferenceHealth {
                    online: false,
                    endpoint: endpoint_override.unwrap_or_else(|| self.default_endpoint.clone()),
                    models: Vec::new(),
                    error: Some(err),
                }
            }
        };
        let url = format!("{}/api/tags", endpoint);

        match self.client.get(&url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.json::<OllamaTagsResponse>().await {
                        Ok(tags) => {
                            let models = tags
                                .models
                                .into_iter()
                                .map(|m| ModelInfo {
                                    name: m.name,
                                    size: m.size,
                                    modified_at: m.modified_at,
                                })
                                .collect();
                            InferenceHealth {
                                online: true,
                                endpoint,
                                models,
                                error: None,
                            }
                        }
                        Err(err) => InferenceHealth {
                            online: false,
                            endpoint,
                            models: Vec::new(),
                            error: Some(format!("Failed to parse models response: {}", err)),
                        },
                    }
                } else {
                    InferenceHealth {
                        online: false,
                        endpoint,
                        models: Vec::new(),
                        error: Some(format!("Ollama server returned status: {}", resp.status())),
                    }
                }
            }
            Err(err) => InferenceHealth {
                online: false,
                endpoint,
                models: Vec::new(),
                error: Some(format!("Ollama offline or unreachable: {}", err)),
            },
        }
    }

    /// Stops an in-flight request. Returns false if it is not running.
    pub async fn abort_completion(&self, request_id: &str) -> bool {
        self.queue.cancel(request_id, CancelReason::Aborted).await
    }

    /// Context window for `model`: an explicit request value, else the window the model
    /// was first loaded with this session, else `budget` (only awaited in that case).
    pub async fn resolve_num_ctx(
        &self,
        model: &str,
        requested: Option<u32>,
        budget: impl Future<Output = usize>,
    ) -> u32 {
        if let Some(n) = requested {
            return n.max(MIN_NUM_CTX);
        }
        if let Some(&n) = self.context_sizes.lock().await.get(model) {
            return n;
        }
        let n = u32::try_from(budget.await)
            .unwrap_or(u32::MAX)
            .max(MIN_NUM_CTX);
        *self
            .context_sizes
            .lock()
            .await
            .entry(model.to_string())
            .or_insert(n)
    }

    /// Starts streaming a `/api/generate` completion and returns as soon as the request is
    /// registered (so it can be aborted). Tokens, completion and failures are reported
    /// through `sink`; only invalid requests are returned as errors.
    pub async fn start_completion<S: StreamSink>(
        &self,
        sink: S,
        request_id: String,
        req: CompletionRequest,
        endpoint_override: Option<String>,
        context_budget: impl Future<Output = usize>,
    ) -> Result<(), String> {
        let endpoint = self.resolve_endpoint(endpoint_override)?;
        let num_ctx = self
            .resolve_num_ctx(&req.model, req.num_ctx, context_budget)
            .await;
        let body = generate_body(&req, num_ctx);
        self.launch(
            sink,
            StreamJob {
                request_id,
                priority: req.priority.unwrap_or(InferencePriority::Chat),
                model: req.model,
                keep_alive: req.keep_alive,
                endpoint,
                path: "/api/generate",
                body,
            },
        )
        .await
    }

    /// Starts streaming a `/api/chat` conversation; see `start_completion`.
    pub async fn start_chat<S: StreamSink>(
        &self,
        sink: S,
        request_id: String,
        req: ChatRequest,
        endpoint_override: Option<String>,
        context_budget: impl Future<Output = usize>,
    ) -> Result<(), String> {
        let endpoint = self.resolve_endpoint(endpoint_override)?;
        let num_ctx = self
            .resolve_num_ctx(&req.model, req.num_ctx, context_budget)
            .await;
        let body = chat_body(&req, num_ctx);
        self.launch(
            sink,
            StreamJob {
                request_id,
                priority: req.priority.unwrap_or(InferencePriority::Chat),
                model: req.model,
                keep_alive: req.keep_alive,
                endpoint,
                path: "/api/chat",
                body,
            },
        )
        .await
    }

    /// Registers the job with the preemption queue and streams it in the background.
    async fn launch<S: StreamSink>(&self, sink: S, job: StreamJob) -> Result<(), String> {
        let (cancel_rx, _preempted) = self.queue.admit(&job.request_id, job.priority).await;
        let manager = self.clone();
        tauri::async_runtime::spawn(async move { manager.run(sink, job, cancel_rx).await });
        Ok(())
    }

    async fn run<S: StreamSink>(
        &self,
        sink: S,
        job: StreamJob,
        cancel_rx: oneshot::Receiver<CancelReason>,
    ) {
        self.swapper
            .record_activity(&job.model, job.keep_alive.clone())
            .await;

        // Cancellation drops the in-flight HTTP request, which closes the connection and
        // makes Ollama stop generating.
        let outcome = tokio::select! {
            biased;
            reason = cancel_rx => Err(match reason {
                Ok(CancelReason::Preempted) => (
                    StreamErrorKind::Preempted,
                    "Generation was interrupted by a higher-priority request".to_string(),
                ),
                _ => (StreamErrorKind::Aborted, "Generation stopped".to_string()),
            }),
            result = self.pump(&sink, &job) => result.map_err(|e| (StreamErrorKind::Error, e)),
        };

        self.queue.finish(&job.request_id).await;
        match outcome {
            Ok(done) => sink.done(done),
            Err((kind, error)) => sink.error(LlmErrorEvent {
                request_id: job.request_id,
                error,
                kind,
            }),
        }
    }

    /// Sends the request and forwards its tokens until Ollama reports `done`.
    async fn pump<S: StreamSink>(&self, sink: &S, job: &StreamJob) -> Result<LlmDoneEvent, String> {
        let _ = self
            .swapper
            .prepare_for_model(&job.endpoint, &self.client, &job.model)
            .await;

        let send = self
            .stream_client
            .post(format!("{}{}", job.endpoint, job.path))
            .json(&job.body)
            .send();
        let resp = tokio::time::timeout(self.timeouts.first_byte, send)
            .await
            .map_err(|_| {
                format!(
                    "Ollama did not start responding within {}s (model load or prompt evaluation took too long)",
                    self.timeouts.first_byte.as_secs()
                )
            })?
            .map_err(|e| format!("Failed to connect to Ollama at {}: {}", job.endpoint, e))?;
        if !resp.status().is_success() {
            return Err(http_error_message(resp).await);
        }

        let mut stream = resp.bytes_stream();
        let mut lines = NdjsonLines::default();
        loop {
            let next = tokio::time::timeout(self.timeouts.idle, stream.next())
                .await
                .map_err(|_| {
                    format!(
                        "Ollama stopped streaming for {}s",
                        self.timeouts.idle.as_secs()
                    )
                })?;
            let ended = next.is_none();
            let records = match next {
                Some(Ok(bytes)) => lines.push(&bytes),
                Some(Err(err)) => return Err(format!("Error reading inference stream: {}", err)),
                None => lines.finish().into_iter().collect(),
            };
            for record in records {
                if let Some(done) = handle_record(sink, &job.request_id, &record)? {
                    return Ok(done);
                }
            }
            if ended {
                return Err("Ollama closed the stream before the response finished".to_string());
            }
        }
    }

    pub fn get_hardware_tier(&self) -> HardwareTierInfo {
        self.swapper.tier_info.clone()
    }

    pub async fn get_model_residency(&self) -> Vec<ModelResidency> {
        self.swapper.get_residency().await
    }

    pub async fn evict_model(
        &self,
        model: &str,
        endpoint_override: Option<String>,
    ) -> Result<(), String> {
        let endpoint = self.resolve_endpoint(endpoint_override)?;
        self.context_sizes.lock().await.remove(model);
        self.swapper
            .evict_model(&endpoint, &self.client, model)
            .await
    }

    pub async fn evict_idle_models(&self, endpoint_override: Option<String>) -> Vec<String> {
        let Ok(endpoint) = self.resolve_endpoint(endpoint_override) else {
            return Vec::new();
        };
        let evicted = self
            .swapper
            .evict_idle_models(&endpoint, &self.client)
            .await;
        let mut sizes = self.context_sizes.lock().await;
        for model in &evicted {
            sizes.remove(model);
        }
        evicted
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::inference::swapper::classify_hardware_tier;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::mpsc;

    // Refused-endpoint fixtures: the tests assert nothing ever connects to them.
    const LAN_ENDPOINT: &str = "http://192.168.1.20:11434"; // airgap-allow: refused-endpoint test fixture
    const CLOUD_ENDPOINT: &str = "https://api.example.com"; // airgap-allow: refused-endpoint test fixture
    const PRIVATE_ENDPOINT: &str = "http://10.0.0.5:11434"; // airgap-allow: refused-endpoint test fixture
    /// The network guard's own parser sees 127.0.0.1 here; reqwest would connect to evil.example.
    const SMUGGLED_ENDPOINT: &str = "http://evil.example\\@127.0.0.1:11434"; // airgap-allow: refused-endpoint test fixture

    #[derive(Debug, Clone, PartialEq)]
    enum Event {
        Token(String),
        Done,
        Error(StreamErrorKind, String),
    }

    #[derive(Clone)]
    struct RecordingSink(mpsc::UnboundedSender<(String, Event)>);

    impl StreamSink for RecordingSink {
        fn token(&self, e: LlmTokenEvent) {
            let _ = self.0.send((e.request_id, Event::Token(e.token)));
        }
        fn done(&self, e: LlmDoneEvent) {
            let _ = self.0.send((e.request_id, Event::Done));
        }
        fn error(&self, e: LlmErrorEvent) {
            let _ = self.0.send((e.request_id, Event::Error(e.kind, e.error)));
        }
    }

    fn recording_sink() -> (RecordingSink, mpsc::UnboundedReceiver<(String, Event)>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (RecordingSink(tx), rx)
    }

    async fn next_event(rx: &mut mpsc::UnboundedReceiver<(String, Event)>) -> (String, Event) {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("timed out waiting for a stream event")
            .expect("sink closed")
    }

    /// Collects one request's events until it finishes (done or error).
    async fn collect_until_end(
        rx: &mut mpsc::UnboundedReceiver<(String, Event)>,
        request_id: &str,
    ) -> (String, Event) {
        let mut text = String::new();
        loop {
            let (id, event) = next_event(rx).await;
            if id != request_id {
                continue;
            }
            match event {
                Event::Token(t) => text.push_str(&t),
                end => return (text, end),
            }
        }
    }

    fn test_manager(endpoint: &str) -> InferenceManager {
        // Tier 1 makes `prepare_for_model` a no-op, so tests make no eviction calls.
        InferenceManager::with_swapper(
            Some(endpoint.to_string()),
            ModelSwapper::new(classify_hardware_tier(Some(16_384), 32_768)),
        )
    }

    fn completion(model: &str, priority: InferencePriority) -> CompletionRequest {
        CompletionRequest {
            model: model.to_string(),
            prompt: "fn main() {".to_string(),
            suffix: None,
            temperature: 0.1,
            stop_tokens: Vec::new(),
            keep_alive: None,
            priority: Some(priority),
            num_ctx: None,
            num_predict: None,
        }
    }

    fn chat(model: &str) -> ChatRequest {
        ChatRequest {
            model: model.to_string(),
            messages: vec![
                ChatTurn {
                    role: "system".to_string(),
                    content: "You are terse.".to_string(),
                },
                ChatTurn {
                    role: "user".to_string(),
                    content: "Explain lifetimes".to_string(),
                },
            ],
            temperature: 0.2,
            stop_tokens: Vec::new(),
            keep_alive: None,
            priority: Some(InferencePriority::Chat),
            num_ctx: None,
            num_predict: None,
        }
    }

    // ---- Fake Ollama server -------------------------------------------------------

    /// Scripted reply of the fake Ollama server.
    enum Reply {
        /// 200 NDJSON body written in separate network writes, `gap` apart, then closed
        /// (or held open when `hang` is set).
        Chunks {
            parts: Vec<Vec<u8>>,
            gap: Duration,
            hang: bool,
        },
        /// One token every `gap` until the client disconnects.
        Endless {
            gap: Duration,
        },
        Status(u16, String),
    }

    type Script = dyn Fn(&str, &Value) -> Reply + Send + Sync;

    struct FakeOllama {
        endpoint: String,
        requests: Arc<Mutex<Vec<(String, Value)>>>,
    }

    async fn fake_ollama(
        script: impl Fn(&str, &Value) -> Reply + Send + Sync + 'static,
    ) -> FakeOllama {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap()); // airgap-allow: fake Ollama bound to 127.0.0.1
        let requests = Arc::new(Mutex::new(Vec::new()));
        let script: Arc<Script> = Arc::new(script);
        let log = requests.clone();
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                let script = script.clone();
                let log = log.clone();
                tokio::spawn(async move { serve(socket, script, log).await });
            }
        });
        FakeOllama { endpoint, requests }
    }

    async fn read_request(socket: &mut TcpStream) -> Option<(String, Value)> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = socket.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..n]);
            let Some(header_end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
                continue;
            };
            let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
            let content_length = head
                .lines()
                .find_map(|line| {
                    let (key, value) = line.split_once(':')?;
                    key.trim()
                        .eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            let body_start = header_end + 4;
            while buf.len() < body_start + content_length {
                let n = socket.read(&mut chunk).await.ok()?;
                if n == 0 {
                    return None;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            let path = head.split_whitespace().nth(1)?.to_string();
            let body = serde_json::from_slice(&buf[body_start..body_start + content_length])
                .unwrap_or(Value::Null);
            return Some((path, body));
        }
    }

    async fn serve(
        mut socket: TcpStream,
        script: Arc<Script>,
        log: Arc<Mutex<Vec<(String, Value)>>>,
    ) {
        let Some((path, body)) = read_request(&mut socket).await else {
            return;
        };
        let reply = script(&path, &body);
        log.lock().await.push((path, body));

        const STREAM_HEAD: &[u8] =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n";
        match reply {
            Reply::Status(code, body) => {
                let resp = format!(
                    "HTTP/1.1 {} Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    code,
                    body.len(),
                    body
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            }
            Reply::Chunks { parts, gap, hang } => {
                let _ = socket.write_all(STREAM_HEAD).await;
                for part in parts {
                    if socket.write_all(&part).await.is_err() || socket.flush().await.is_err() {
                        return;
                    }
                    tokio::time::sleep(gap).await;
                }
                if hang {
                    let mut sink = [0u8; 64];
                    let _ = socket.read(&mut sink).await;
                }
            }
            Reply::Endless { gap } => {
                let _ = socket.write_all(STREAM_HEAD).await;
                for i in 0u64.. {
                    let line = format!("{{\"response\":\"t{} \",\"done\":false}}\n", i);
                    if socket.write_all(line.as_bytes()).await.is_err()
                        || socket.flush().await.is_err()
                    {
                        return;
                    }
                    tokio::time::sleep(gap).await;
                }
            }
        }
    }

    fn ndjson(records: &[Value]) -> Vec<u8> {
        records
            .iter()
            .map(|r| format!("{}\n", r))
            .collect::<String>()
            .into_bytes()
    }

    // ---- Unit tests -----------------------------------------------------------------

    #[tokio::test]
    async fn test_inference_manager_creation() {
        let mgr = InferenceManager::new(Some("http://127.0.0.1:11434".to_string()));
        assert_eq!(mgr.default_endpoint, "http://127.0.0.1:11434");
    }

    #[tokio::test]
    async fn test_health_check_offline_handling() {
        let mgr = InferenceManager::new(Some("http://127.0.0.1:99999".to_string()));
        let health = mgr.check_health(None).await;
        assert!(!health.online);
        assert!(health.error.is_some());
    }

    #[test]
    fn test_ndjson_lines_keeps_multibyte_char_split_across_chunks() {
        let line = "{\"response\":\"h\u{e9}llo \u{1F980} w\u{f6}rld\",\"done\":false}\n";
        let bytes = line.as_bytes();
        // Split inside the 4-byte crab emoji.
        let crab_start = line.find('\u{1F980}').unwrap();
        let (first, second) = bytes.split_at(crab_start + 2);
        assert!(
            std::str::from_utf8(first).is_err(),
            "split must land mid-character"
        );

        let mut lines = NdjsonLines::default();
        assert!(lines.push(first).is_empty());
        let records = lines.push(second);
        assert_eq!(records.len(), 1);

        let chunk: OllamaStreamChunk = serde_json::from_slice(&records[0]).unwrap();
        assert_eq!(
            chunk.response.as_deref(),
            Some("h\u{e9}llo \u{1F980} w\u{f6}rld")
        );
        assert!(lines.finish().is_none());
    }

    #[test]
    fn test_ndjson_lines_handles_many_records_per_chunk_and_trailing_record() {
        let mut lines = NdjsonLines::default();
        let records = lines.push(b"{\"a\":1}\n\n{\"b\":2}\n{\"c\"");
        assert_eq!(
            records,
            vec![b"{\"a\":1}".to_vec(), Vec::new(), b"{\"b\":2}".to_vec()]
        );
        assert!(lines.push(b":3}").is_empty());
        assert_eq!(lines.finish(), Some(b"{\"c\":3}".to_vec()));
    }

    #[test]
    fn test_generate_body_uses_native_fim_suffix_and_context_window() {
        let mut req = completion("qwen2.5-coder:1.5b", InferencePriority::Autocomplete);
        req.prompt = "fn add(a: i32, b: i32) -> i32 {\n    ".to_string();
        req.suffix = Some("\n}".to_string());
        req.stop_tokens = vec!["\n\n\n".to_string()];

        let body = generate_body(&req, 8192);
        assert_eq!(body["prompt"], "fn add(a: i32, b: i32) -> i32 {\n    ");
        assert_eq!(body["suffix"], "\n}");
        assert!(body.get("raw").is_none());
        assert!(!body["prompt"].as_str().unwrap().contains("<|fim_prefix|>"));
        assert_eq!(body["options"]["num_ctx"], 8192);
        assert_eq!(body["options"]["num_predict"], AUTOCOMPLETE_NUM_PREDICT);
        assert_eq!(body["options"]["stop"], json!(["\n\n\n"]));

        // At end of file the suffix is empty; it must still select the FIM template.
        req.suffix = Some(String::new());
        assert_eq!(generate_body(&req, 8192)["suffix"], "\n");
    }

    #[test]
    fn test_generate_body_without_fim_or_cap_for_chat_priority() {
        let body = generate_body(&completion("m", InferencePriority::Chat), 4096);
        assert!(body.get("suffix").is_none());
        assert!(body["options"].get("num_predict").is_none());
        // No explicit stop list: keep the model's own stop sequences.
        assert!(body["options"].get("stop").is_none());
        assert_eq!(body["options"]["num_ctx"], 4096);
    }

    #[test]
    fn test_chat_body_sends_messages_not_a_templated_prompt() {
        let body = chat_body(&chat("llama3.1:8b"), 16_384);
        assert!(body.get("prompt").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "Explain lifetimes");
        assert_eq!(body["options"]["num_ctx"], 16_384);
        assert!(body["options"].get("stop").is_none());
    }

    #[tokio::test]
    async fn test_num_ctx_is_pinned_per_model() {
        let mgr = test_manager("http://127.0.0.1:11434");
        assert_eq!(mgr.resolve_num_ctx("a", None, async { 8192 }).await, 8192);
        // A later budget change must not resize (and so reload) the loaded model.
        assert_eq!(
            mgr.resolve_num_ctx("a", None, async { panic!("budget must not be recomputed") })
                .await,
            8192
        );
        assert_eq!(
            mgr.resolve_num_ctx("b", None, async { 512 }).await,
            MIN_NUM_CTX
        );
        assert_eq!(
            mgr.resolve_num_ctx("a", Some(4096), async { 0 }).await,
            4096
        );
    }

    #[test]
    fn test_ensure_loopback_endpoint() {
        assert_eq!(
            ensure_loopback_endpoint("http://localhost:11434/").unwrap(),
            "http://localhost:11434"
        );
        assert_eq!(
            ensure_loopback_endpoint("127.0.0.1:11434").unwrap(),
            "http://127.0.0.1:11434"
        );
        assert!(ensure_loopback_endpoint("http://[::1]:11434").is_ok());
        assert!(ensure_loopback_endpoint(LAN_ENDPOINT).is_err());
        assert!(ensure_loopback_endpoint(CLOUD_ENDPOINT).is_err());
        assert!(ensure_loopback_endpoint("ws://127.0.0.1:11434").is_err());
        assert!(ensure_loopback_endpoint(SMUGGLED_ENDPOINT).is_err());
    }

    // ---- End-to-end tests against the fake Ollama server ----------------------------

    #[tokio::test]
    async fn test_start_returns_before_stream_finishes_and_abort_stops_it() {
        let server = fake_ollama(|_, _| Reply::Endless {
            gap: Duration::from_millis(10),
        })
        .await;
        let mgr = test_manager(&server.endpoint);
        let (sink, mut rx) = recording_sink();

        // The stream never ends, so this only returns if starting does not wait for it.
        tokio::time::timeout(
            Duration::from_secs(2),
            mgr.start_completion(
                sink,
                "req_1".to_string(),
                completion("m", InferencePriority::Chat),
                None,
                async { 8192 },
            ),
        )
        .await
        .expect("start_completion must return while the stream is still running")
        .unwrap();

        assert!(matches!(next_event(&mut rx).await.1, Event::Token(_)));
        assert!(mgr.abort_completion("req_1").await);

        let (_, end) = collect_until_end(&mut rx, "req_1").await;
        assert_eq!(
            end,
            Event::Error(StreamErrorKind::Aborted, "Generation stopped".to_string())
        );
        // Nothing is delivered after the abort.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(rx.try_recv().is_err());
        assert!(mgr.queue.is_empty().await);
    }

    #[tokio::test]
    async fn test_autocomplete_does_not_cut_off_streaming_chat() {
        let server = fake_ollama(|path, _| match path {
            "/api/chat" => Reply::Endless {
                gap: Duration::from_millis(10),
            },
            _ => Reply::Chunks {
                parts: vec![ndjson(&[
                    json!({"response": "x + 1", "done": false}),
                    json!({"response": "", "done": true, "eval_count": 3}),
                ])],
                gap: Duration::ZERO,
                hang: false,
            },
        })
        .await;
        let mgr = test_manager(&server.endpoint);
        let (sink, mut rx) = recording_sink();

        mgr.start_chat(sink.clone(), "chat".to_string(), chat("m"), None, async {
            8192
        })
        .await
        .unwrap();
        assert_eq!(next_event(&mut rx).await.0, "chat");

        // The user types: three autocomplete requests run to completion meanwhile.
        for i in 0..3 {
            let id = format!("auto_{i}");
            let mut req = completion("m", InferencePriority::Autocomplete);
            req.suffix = Some("\n}".to_string());
            mgr.start_completion(sink.clone(), id.clone(), req, None, async { 8192 })
                .await
                .unwrap();
            let (text, end) = collect_until_end(&mut rx, &id).await;
            assert_eq!((text.as_str(), end), ("x + 1", Event::Done));
        }

        // The chat answer is still streaming.
        for _ in 0..3 {
            loop {
                let (id, event) = next_event(&mut rx).await;
                if id == "chat" {
                    assert!(
                        matches!(event, Event::Token(_)),
                        "chat was cut off: {event:?}"
                    );
                    break;
                }
            }
        }
        assert!(mgr.abort_completion("chat").await);
    }

    #[tokio::test]
    async fn test_multibyte_char_split_across_network_chunks() {
        let stream = ndjson(&[
            json!({"response": "h\u{e9}llo \u{1F980}", "done": false}),
            json!({"response": " w\u{f6}rld", "done": false}),
            json!({"response": "", "done": true, "eval_count": 2, "eval_duration": 1_000_000}),
        ]);
        let crab = stream
            .windows(4)
            .position(|w| w == "\u{1F980}".as_bytes())
            .unwrap();
        let parts = vec![stream[..crab + 1].to_vec(), stream[crab + 1..].to_vec()];
        let server = fake_ollama(move |_, _| Reply::Chunks {
            parts: parts.clone(),
            gap: Duration::from_millis(30),
            hang: false,
        })
        .await;
        let mgr = test_manager(&server.endpoint);
        let (sink, mut rx) = recording_sink();

        mgr.start_completion(
            sink,
            "r".to_string(),
            completion("m", InferencePriority::Chat),
            None,
            async { 8192 },
        )
        .await
        .unwrap();
        let (text, end) = collect_until_end(&mut rx, "r").await;
        assert_eq!(text, "h\u{e9}llo \u{1F980} w\u{f6}rld");
        assert_eq!(end, Event::Done);
    }

    #[tokio::test]
    async fn test_missing_model_reports_ollama_error_without_tokens() {
        let server = fake_ollama(|_, _| {
            Reply::Status(
                404,
                r#"{"error":"model \"nope:7b\" not found, try pulling it first"}"#.to_string(),
            )
        })
        .await;
        let mgr = test_manager(&server.endpoint);
        let (sink, mut rx) = recording_sink();

        mgr.start_chat(sink, "r".to_string(), chat("nope:7b"), None, async { 8192 })
            .await
            .unwrap();
        let (text, end) = collect_until_end(&mut rx, "r").await;
        assert_eq!(text, "");
        match end {
            Event::Error(StreamErrorKind::Error, msg) => {
                assert!(msg.contains("404") && msg.contains("not found"), "{msg}")
            }
            other => panic!("expected an error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_mid_stream_error_record_is_reported() {
        let server = fake_ollama(|_, _| Reply::Chunks {
            parts: vec![ndjson(&[
                json!({"response": "partial", "done": false}),
                json!({"error": "llama runner process has terminated"}),
            ])],
            gap: Duration::ZERO,
            hang: false,
        })
        .await;
        let mgr = test_manager(&server.endpoint);
        let (sink, mut rx) = recording_sink();

        mgr.start_completion(
            sink,
            "r".to_string(),
            completion("m", InferencePriority::Chat),
            None,
            async { 8192 },
        )
        .await
        .unwrap();
        let (text, end) = collect_until_end(&mut rx, "r").await;
        assert_eq!(text, "partial");
        assert_eq!(
            end,
            Event::Error(
                StreamErrorKind::Error,
                "llama runner process has terminated".to_string()
            )
        );
    }

    #[tokio::test]
    async fn test_idle_stream_times_out_but_long_streams_do_not() {
        let server = fake_ollama(|path, _| match path {
            // Stalls after one token.
            "/api/generate" => Reply::Chunks {
                parts: vec![ndjson(&[json!({"response": "a", "done": false})])],
                gap: Duration::ZERO,
                hang: true,
            },
            // Runs for ~4x the idle timeout, but never goes quiet for long.
            _ => Reply::Chunks {
                parts: (0..20)
                    .map(|i| ndjson(&[json!({"message": {"content": "."}, "done": i == 19})]))
                    .collect(),
                gap: Duration::from_millis(40),
                hang: false,
            },
        })
        .await;
        let mgr = test_manager(&server.endpoint).with_timeouts(StreamTimeouts {
            first_byte: Duration::from_secs(5),
            idle: Duration::from_millis(200),
        });
        let (sink, mut rx) = recording_sink();

        mgr.start_chat(sink.clone(), "long".to_string(), chat("m"), None, async {
            8192
        })
        .await
        .unwrap();
        let (text, end) = collect_until_end(&mut rx, "long").await;
        assert_eq!((text.len(), end), (20, Event::Done));

        mgr.start_completion(
            sink,
            "stall".to_string(),
            completion("m", InferencePriority::Chat),
            None,
            async { 8192 },
        )
        .await
        .unwrap();
        let (_, end) = collect_until_end(&mut rx, "stall").await;
        assert!(
            matches!(&end, Event::Error(StreamErrorKind::Error, msg) if msg.contains("stopped streaming")),
            "{end:?}"
        );
    }

    #[tokio::test]
    async fn test_chat_posts_messages_to_api_chat() {
        let server = fake_ollama(|_, _| Reply::Chunks {
            parts: vec![ndjson(&[
                json!({"message": {"role": "assistant", "content": "Borrowing"}, "done": false}),
                json!({"message": {"role": "assistant", "content": ""}, "done": true}),
            ])],
            gap: Duration::ZERO,
            hang: false,
        })
        .await;
        let mgr = test_manager(&server.endpoint);
        let (sink, mut rx) = recording_sink();

        mgr.start_chat(sink, "r".to_string(), chat("llama3.1:8b"), None, async {
            12_288
        })
        .await
        .unwrap();
        assert_eq!(
            collect_until_end(&mut rx, "r").await,
            ("Borrowing".to_string(), Event::Done)
        );

        let requests = server.requests.lock().await;
        let (path, body) = &requests[0];
        assert_eq!(path, "/api/chat");
        assert_eq!(body["messages"][1]["content"], "Explain lifetimes");
        assert_eq!(body["options"]["num_ctx"], 12_288);
    }

    #[tokio::test]
    async fn test_non_loopback_endpoints_are_refused_before_any_request() {
        let server = fake_ollama(|_, _| Reply::Status(500, String::new())).await;
        let mgr = test_manager(&server.endpoint);
        let (sink, _rx) = recording_sink();

        let err = mgr
            .start_completion(
                sink.clone(),
                "r1".to_string(),
                completion("m", InferencePriority::Chat),
                Some(LAN_ENDPOINT.to_string()),
                async { 8192 },
            )
            .await
            .unwrap_err();
        assert!(err.contains("Refusing inference endpoint"), "{err}");

        assert!(mgr
            .start_chat(
                sink,
                "r2".to_string(),
                chat("m"),
                Some(CLOUD_ENDPOINT.to_string()),
                async { 8192 }
            )
            .await
            .is_err());

        let health = mgr.check_health(Some(PRIVATE_ENDPOINT.to_string())).await;
        assert!(!health.online);
        assert!(health.error.unwrap().contains("Refusing"));

        assert!(server.requests.lock().await.is_empty());
        assert!(mgr.queue.is_empty().await);
    }
}
