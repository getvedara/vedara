import { describe, it, expect, beforeEach, vi } from 'vitest';

// Run the desktop code paths: the backend is "present", and its replies are scripted per test.
const backend = vi.hoisted(() => ({
  handlers: {} as Record<string, (args: any) => unknown>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (cmd: string, args: any) => {
    const handler = backend.handlers[cmd];
    if (!handler) throw new Error(`unexpected command ${cmd}`);
    return handler(args);
  },
}));

import { useDiffReviewStore } from './diffReviewStore';
import { useEditorStore } from './editorStore';
import { applyRepairDiffs, executeDiagnosticRepair } from '../features/terminal/diagnosticRepair';
import type { FileDiff } from '../types/diff';

const ORIGINAL = 'export const answer = 41;\n';
const diff: FileDiff = {
  filePath: 'src/answer.ts',
  hunks: [{ id: 'h1', search: 'export const answer = 41;', replace: 'export const answer = 42;' }],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('desktop write failures are surfaced', () => {
  beforeEach(() => {
    useEditorStore.getState().closeAllFiles();
    useDiffReviewStore.getState().closeReview();
    backend.handlers = {
      create_checkpoint: () => ({ id: 'cp1', commitHash: 'abc1234' }),
      read_file_content: () => ORIGINAL,
      write_file_content: () => {
        throw 'Blocked by workspace policy (.vedara/rules.yaml): Write prohibited';
      },
    };
  });

  it('diff review reports a rejected write and stays open', async () => {
    const review = useDiffReviewStore.getState();
    await review.openReview([diff]);
    useDiffReviewStore.getState().acceptAll();

    const ok = await useDiffReviewStore.getState().applyAccepted();
    const state = useDiffReviewStore.getState();
    expect(ok).toBe(false);
    expect(state.isOpen).toBe(true);
    expect(state.applyError).toContain('src/answer.ts');
    expect(state.applyError).toContain('Blocked by workspace policy');
  });

  it('diff review refuses to write a file it could not read', async () => {
    const writes: string[] = [];
    backend.handlers.read_file_content = () => {
      throw 'Path is outside the workspace folder';
    };
    backend.handlers.write_file_content = (args) => {
      writes.push(args.path);
    };

    await useDiffReviewStore.getState().openReview([diff]);
    useDiffReviewStore.getState().acceptAll();
    const ok = await useDiffReviewStore.getState().applyAccepted();

    expect(ok).toBe(false);
    expect(writes).toEqual([]);
    expect(useDiffReviewStore.getState().applyError).toContain('could not read the original file');
  });

  it('diff review writes and closes when the backend accepts', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    backend.handlers.write_file_content = (args) => {
      writes.push(args);
    };

    await useDiffReviewStore.getState().openReview([diff]);
    useDiffReviewStore.getState().acceptAll();
    const ok = await useDiffReviewStore.getState().applyAccepted();

    expect(ok).toBe(true);
    expect(useDiffReviewStore.getState().isOpen).toBe(false);
    expect(writes).toEqual([{ path: 'src/answer.ts', content: 'export const answer = 42;\n' }]);
  });

  it('repair apply reports a rejected write and leaves the buffer untouched', async () => {
    const bufId = useEditorStore.getState().openFile('src/answer.ts', ORIGINAL);

    const res = await applyRepairDiffs([diff]);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Failed to write src/answer.ts');
    expect(useEditorStore.getState().buffers[bufId].content).toBe(ORIGINAL);
  });

  it('repair apply does not treat an unreadable file as empty', async () => {
    const writes: string[] = [];
    backend.handlers.read_file_content = () => {
      throw 'Access is denied';
    };
    backend.handlers.write_file_content = (args) => {
      writes.push(args.path);
    };

    const res = await applyRepairDiffs([diff]);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Could not read src/answer.ts');
    expect(writes).toEqual([]);
  });

  it('repair inference refuses to run on an unreadable file', async () => {
    backend.handlers.read_file_content = () => {
      throw 'Access is denied';
    };
    await expect(
      executeDiagnosticRepair({
        id: 'r1',
        filePath: 'src/answer.ts',
        errorMessage: 'type error',
      } as any)
    ).rejects.toThrow('Could not read src/answer.ts');
  });

  it('editor save keeps the buffer dirty and reports the error when the write fails', async () => {
    const id = useEditorStore.getState().openFile('src/answer.ts', ORIGINAL);
    useEditorStore.getState().updateContent(id, 'changed');

    useEditorStore.getState().saveFile(id);
    await flush();
    await flush();

    const state = useEditorStore.getState();
    expect(state.buffers[id].isDirty).toBe(true);
    expect(state.fileError?.filePath).toBe('src/answer.ts');
    expect(state.fileError?.message).toContain('Blocked by workspace policy');
  });

  it('editor save marks the buffer clean only after the write succeeds', async () => {
    backend.handlers.write_file_content = () => undefined;
    backend.handlers.sync_bm25_file_changes = () => ({});
    backend.handlers.get_bm25_index_status = () => ({
      is_indexed: true,
      indexed_files_count: 1,
      total_tokens: 1,
      unique_terms_count: 1,
      last_updated_ms: 0,
    });
    const id = useEditorStore.getState().openFile('src/answer.ts', ORIGINAL);
    useEditorStore.getState().updateContent(id, 'changed');

    useEditorStore.getState().saveFile(id);
    expect(useEditorStore.getState().buffers[id].isDirty).toBe(true);
    await flush();
    await flush();

    expect(useEditorStore.getState().buffers[id].isDirty).toBe(false);
    expect(useEditorStore.getState().fileError).toBeNull();
  });
});
