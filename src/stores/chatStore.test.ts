import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import { fakeTauri } from '../test-utils/fakeTauri';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/fakeTauri')).fakeTauriCore);
vi.mock('@tauri-apps/api/event', async () => (await import('../test-utils/fakeTauri')).fakeTauriEvent);

describe('Chat Store (Zustand)', () => {
  beforeEach(() => {
    // Outside Tauri every backend command fails and callers use their browser fallbacks.
    fakeTauri.invoke.mockRejectedValue(new Error('not running in Tauri'));
    useChatStore.getState().clearMessages();
  });

  it('initializes with default state', () => {
    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.isGenerating).toBe(false);
    expect(state.selectedModel).toBe('qwen2.5-coder:1.5b');
    expect(state.abortFn).toBeNull();
  });

  it('updates selected model', () => {
    useChatStore.getState().setSelectedModel('qwen2.5-coder:7b');
    expect(useChatStore.getState().selectedModel).toBe('qwen2.5-coder:7b');
  });

  it('updates system prompt', () => {
    useChatStore.getState().setSystemPrompt('Custom instruction');
    expect(useChatStore.getState().systemPrompt).toBe('Custom instruction');
  });

  it('does not send empty or whitespace-only messages', async () => {
    await useChatStore.getState().sendMessage('   ');
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().isGenerating).toBe(false);
  });

  it('sends a user message and streams assistant response', async () => {
    const store = useChatStore.getState();
    const sendPromise = store.sendMessage('Write hello world in python');

    // Messages should be populated immediately
    const intermediateMessages = useChatStore.getState().messages;
    expect(intermediateMessages).toHaveLength(2);
    expect(intermediateMessages[0].role).toBe('user');
    expect(intermediateMessages[0].content).toBe('Write hello world in python');
    expect(intermediateMessages[1].role).toBe('assistant');

    await sendPromise;
    await vi.waitFor(
      () => {
        expect(useChatStore.getState().isGenerating).toBe(false);
      },
      { timeout: 1500, interval: 25 }
    );

    const finalMessages = useChatStore.getState().messages;
    expect(finalMessages).toHaveLength(2);
    expect(finalMessages[1].content.length).toBeGreaterThan(0);
  });

  it('stops in-flight generation when stopGeneration is called', async () => {
    const abortMock = vi.fn();
    useChatStore.setState({
      isGenerating: true,
      abortFn: abortMock,
      messages: [
        { id: '1', role: 'user', content: 'test', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'generating...', isStreaming: true, timestamp: 2 },
      ],
    });

    useChatStore.getState().stopGeneration();

    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().isGenerating).toBe(false);
    expect(useChatStore.getState().messages[1].isStreaming).toBe(false);
  });

  it('clears all messages and resets generation state', () => {
    useChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'test', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'reply', timestamp: 2 },
      ],
      genStats: '50 tokens',
    });

    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().genStats).toBeNull();
  });

  it('deletes a single message by id', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg-1', role: 'user', content: 'one', timestamp: 1 },
        { id: 'msg-2', role: 'assistant', content: 'two', timestamp: 2 },
      ],
    });

    useChatStore.getState().deleteMessage('msg-1');
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe('msg-2');
  });

  it('retries last user message', async () => {
    useChatStore.setState({
      messages: [
        { id: 'msg-1', role: 'user', content: 'First question', timestamp: 1 },
        { id: 'msg-2', role: 'assistant', content: 'First answer', timestamp: 2 },
      ],
    });

    await useChatStore.getState().retryLastMessage();
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('First question');
    expect(msgs[1].role).toBe('assistant');
  });

  describe('with the Tauri backend', () => {
    beforeEach(() => {
      fakeTauri.install();
      // Only inference is scripted; routing, policy etc. use their browser fallbacks.
      fakeTauri.invoke.mockImplementation(async (command) => {
        if (command === 'stream_chat' || command === 'abort_completion') return undefined;
        throw new Error(`${command} is not available in this test`);
      });
      const { settings } = useSettingsStore.getState();
      useSettingsStore.setState({ settings: { ...settings, ollamaEndpoint: 'http://127.0.0.1:11500' } });
    });

    afterEach(() => {
      const { settings } = useSettingsStore.getState();
      useSettingsStore.setState({ settings: { ...settings, ollamaEndpoint: 'http://localhost:11434' } });
      fakeTauri.uninstall();
    });

    it('Stop aborts the backend stream mid-generation', async () => {
      await useChatStore.getState().sendMessage('Explain closures');
      const requestId = await fakeTauri.requestIdFor('stream_chat');
      expect(useChatStore.getState().abortFn).not.toBeNull();

      fakeTauri.emit(`llm-token:${requestId}`, { request_id: requestId, token: 'A closure', done: false });
      useChatStore.getState().stopGeneration();
      fakeTauri.emit(`llm-token:${requestId}`, { request_id: requestId, token: ' captures', done: false });

      await vi.waitFor(() =>
        expect(fakeTauri.invoke).toHaveBeenCalledWith('abort_completion', { requestId })
      );
      const assistant = useChatStore.getState().messages[1];
      expect(assistant.content).toBe('A closure');
      expect(assistant.isStreaming).toBe(false);
      expect(useChatStore.getState().isGenerating).toBe(false);
    });

    it('shows a backend error on the assistant message instead of fake output', async () => {
      await useChatStore.getState().sendMessage('hi');
      const requestId = await fakeTauri.requestIdFor('stream_chat');

      fakeTauri.emit(`llm-error:${requestId}`, {
        request_id: requestId,
        error: 'Ollama returned HTTP 404 Not Found: model "qwen2.5-coder:7b" not found',
        kind: 'error',
      });

      const state = useChatStore.getState();
      expect(state.messages[1].error).toContain('model "qwen2.5-coder:7b" not found');
      expect(state.messages[1].content).toBe('');
      expect(state.messages[1].isStreaming).toBe(false);
      expect(state.isGenerating).toBe(false);
      expect(state.abortFn).toBeNull();
    });

    it('shows an unreachable backend as an error and streams nothing', async () => {
      fakeTauri.invoke.mockImplementation(async (command) => {
        if (command === 'stream_chat') throw 'Failed to connect to Ollama at http://127.0.0.1:11500';
        throw new Error(`${command} is not available in this test`);
      });

      await useChatStore.getState().sendMessage('hi');
      await vi.waitFor(() => expect(useChatStore.getState().isGenerating).toBe(false));
      await new Promise((r) => setTimeout(r, 150));

      const assistant = useChatStore.getState().messages[1];
      expect(assistant.error).toContain('Failed to connect to Ollama');
      expect(assistant.content).toBe('');
    });

    it('sends the conversation as chat messages to the configured endpoint', async () => {
      await useChatStore.getState().sendMessage('hello there');
      await fakeTauri.requestIdFor('stream_chat');

      const [, args] = fakeTauri.invoke.mock.calls.find(([command]) => command === 'stream_chat')!;
      const { req, endpoint } = args as {
        req: { messages: { role: string; content: string }[] };
        endpoint: string;
      };
      expect(endpoint).toBe('http://127.0.0.1:11500');
      expect(req.messages[0].role).toBe('system');
      expect(req.messages[req.messages.length - 1]).toEqual({ role: 'user', content: 'hello there' });
      expect(JSON.stringify(req)).not.toContain('<|im_start|>');
    });
  });
});
