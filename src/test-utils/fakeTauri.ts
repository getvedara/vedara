import { expect, vi } from 'vitest';

type EventHandler = (event: { payload: unknown }) => void;

const listeners = new Map<string, Set<EventHandler>>();

/**
 * In-memory stand-in for the Tauri IPC bridge. Tests route `@tauri-apps/api/core` and
 * `@tauri-apps/api/event` here with `vi.mock`, script `invoke`, and emit backend events.
 */
export const fakeTauri = {
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),

  /** Delivers a backend event to every `listen` handler registered for it. */
  emit(event: string, payload: unknown): void {
    for (const handler of [...(listeners.get(event) ?? [])]) {
      handler({ payload });
    }
  },

  /** Number of event handlers still registered (leak check). */
  listenerCount(): number {
    let count = 0;
    for (const handlers of listeners.values()) count += handlers.size;
    return count;
  },

  /** Waits until `command` is invoked and returns the request id it was given. */
  async requestIdFor(command: string): Promise<string> {
    await vi.waitFor(() => {
      expect(fakeTauri.invoke.mock.calls.some(([name]) => name === command)).toBe(true);
    });
    const call = fakeTauri.invoke.mock.calls.find(([name]) => name === command)!;
    return call[1]!.requestId as string;
  },

  /** Makes the frontend detect a Tauri runtime and clears recorded state. */
  install(): void {
    fakeTauri.invoke.mockReset();
    listeners.clear();
    (globalThis as { isTauri?: boolean }).isTauri = true;
  },

  uninstall(): void {
    delete (globalThis as { isTauri?: boolean }).isTauri;
    listeners.clear();
  },
};

export const fakeTauriCore = {
  invoke: (command: string, args?: Record<string, unknown>) => fakeTauri.invoke(command, args),
};

export const fakeTauriEvent = {
  listen: async (event: string, handler: EventHandler) => {
    const handlers = listeners.get(event) ?? new Set<EventHandler>();
    handlers.add(handler);
    listeners.set(event, handlers);
    return () => {
      handlers.delete(handler);
    };
  },
};
