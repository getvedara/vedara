use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InferencePriority {
    Abort = 0,
    Autocomplete = 1,
    Chat = 2,
    Background = 3,
}

impl InferencePriority {
    pub fn rank(&self) -> u8 {
        match self {
            InferencePriority::Abort => 0,
            InferencePriority::Autocomplete => 1,
            InferencePriority::Chat => 2,
            InferencePriority::Background => 3,
        }
    }

    /// Whether a newly admitted request of priority `self` should cancel an in-flight
    /// request of `active_priority`.
    ///
    /// Autocomplete only preempts Background work: a chat answer the user is reading must
    /// survive them typing in the editor (Ollama serves both concurrently).
    pub fn should_preempt(&self, active_priority: InferencePriority) -> bool {
        match self {
            InferencePriority::Abort => true,
            InferencePriority::Autocomplete => active_priority == InferencePriority::Background,
            InferencePriority::Chat => active_priority == InferencePriority::Background,
            InferencePriority::Background => false,
        }
    }
}

/// Why an in-flight request was cancelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    /// The user (or the frontend on their behalf) stopped the request.
    Aborted,
    /// A higher-priority request was admitted.
    Preempted,
}

struct ActiveExecution {
    priority: InferencePriority,
    cancel_tx: oneshot::Sender<CancelReason>,
}

/// Preemption arbiter for in-flight inference requests.
///
/// Every running request is tracked by id until it finishes, so concurrent requests
/// (e.g. a chat stream plus autocomplete) each keep their own cancellation channel.
#[derive(Clone, Default)]
pub struct InferenceQueue {
    active: Arc<Mutex<HashMap<String, ActiveExecution>>>,
}

impl InferenceQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers `id` as running and cancels every in-flight request it preempts.
    ///
    /// Returns the receiver that resolves when `id` itself is cancelled, and the ids of
    /// the requests that were preempted.
    pub async fn admit(
        &self,
        id: &str,
        priority: InferencePriority,
    ) -> (oneshot::Receiver<CancelReason>, Vec<String>) {
        let mut active = self.active.lock().await;

        let preempted: Vec<String> = active
            .iter()
            .filter(|(other_id, exec)| {
                other_id.as_str() != id && priority.should_preempt(exec.priority)
            })
            .map(|(other_id, _)| other_id.clone())
            .collect();
        for other_id in &preempted {
            if let Some(exec) = active.remove(other_id) {
                let _ = exec.cancel_tx.send(CancelReason::Preempted);
            }
        }

        let (cancel_tx, cancel_rx) = oneshot::channel();
        active.insert(
            id.to_string(),
            ActiveExecution {
                priority,
                cancel_tx,
            },
        );

        (cancel_rx, preempted)
    }

    /// Cancels an in-flight request. Returns false if `id` is not running.
    pub async fn cancel(&self, id: &str, reason: CancelReason) -> bool {
        let mut active = self.active.lock().await;
        match active.remove(id) {
            Some(exec) => {
                let _ = exec.cancel_tx.send(reason);
                true
            }
            None => false,
        }
    }

    /// Removes a request that ran to completion (or failed) without being cancelled.
    pub async fn finish(&self, id: &str) {
        self.active.lock().await.remove(id);
    }

    /// Priority of the in-flight request `id`, if it is running.
    pub async fn active_priority(&self, id: &str) -> Option<InferencePriority> {
        self.active.lock().await.get(id).map(|exec| exec.priority)
    }

    /// Number of in-flight requests.
    pub async fn len(&self) -> usize {
        self.active.lock().await.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.len().await == 0
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_preemption_matrix() {
        use InferencePriority::*;
        assert!(Autocomplete.should_preempt(Background));
        assert!(!Autocomplete.should_preempt(Chat));
        assert!(!Autocomplete.should_preempt(Autocomplete));
        assert!(Chat.should_preempt(Background));
        assert!(!Chat.should_preempt(Chat));
        assert!(!Chat.should_preempt(Autocomplete));
        assert!(!Background.should_preempt(Background));
        assert!(Abort.should_preempt(Chat));
    }

    #[tokio::test]
    async fn test_autocomplete_preempts_background() {
        let queue = InferenceQueue::new();
        let (bg_rx, _) = queue
            .admit("bg_active", InferencePriority::Background)
            .await;

        let (_auto_rx, preempted) = queue
            .admit("auto_hot", InferencePriority::Autocomplete)
            .await;

        assert_eq!(preempted, vec!["bg_active".to_string()]);
        assert_eq!(bg_rx.await, Ok(CancelReason::Preempted));
        assert_eq!(queue.active_priority("bg_active").await, None);
    }

    #[tokio::test]
    async fn test_autocomplete_does_not_preempt_chat() {
        let queue = InferenceQueue::new();
        let (mut chat_rx, _) = queue.admit("chat_active", InferencePriority::Chat).await;

        // The user types while the chat answer streams: several autocomplete requests
        // start and finish.
        for i in 0..3 {
            let id = format!("auto_{i}");
            let (_rx, preempted) = queue.admit(&id, InferencePriority::Autocomplete).await;
            assert!(
                preempted.is_empty(),
                "Autocomplete must not preempt in-flight chat"
            );
            queue.finish(&id).await;
        }

        // The chat's cancellation channel is untouched: no signal, sender not dropped.
        assert_eq!(chat_rx.try_recv(), Err(oneshot::error::TryRecvError::Empty));
        assert_eq!(
            queue.active_priority("chat_active").await,
            Some(InferencePriority::Chat)
        );
    }

    #[tokio::test]
    async fn test_background_does_not_preempt_chat() {
        let queue = InferenceQueue::new();
        let (mut chat_rx, _) = queue.admit("chat_active", InferencePriority::Chat).await;

        let (_bg_rx, preempted) = queue.admit("bg_job", InferencePriority::Background).await;

        assert!(
            preempted.is_empty(),
            "Background must NOT preempt active chat"
        );
        assert_eq!(chat_rx.try_recv(), Err(oneshot::error::TryRecvError::Empty));
    }

    #[tokio::test]
    async fn test_cancel_and_finish_release_requests() {
        let queue = InferenceQueue::new();
        let (rx, _) = queue.admit("req_1", InferencePriority::Chat).await;
        let (_rx2, _) = queue.admit("req_2", InferencePriority::Autocomplete).await;
        assert_eq!(queue.len().await, 2);

        assert!(queue.cancel("req_1", CancelReason::Aborted).await);
        assert_eq!(rx.await, Ok(CancelReason::Aborted));
        assert!(!queue.cancel("req_1", CancelReason::Aborted).await);

        queue.finish("req_2").await;
        assert!(
            queue.is_empty().await,
            "finished requests must not accumulate"
        );
    }
}
