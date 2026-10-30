import { describe, it, expect, beforeEach } from 'vitest';
import { parseMarkdownParts } from './MarkdownMessage';
import { parseFrugalDiffClient } from '../../features/diff/frugalDiff';
import { useDiffReviewStore, getHunkKey } from '../../stores/diffReviewStore';
import { useEditorStore } from '../../stores/editorStore';

describe('MarkdownMessage Diff Integration & In-Editor Insertion', () => {
  beforeEach(() => {
    useDiffReviewStore.getState().closeReview();
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      savedSnapshots: {},
    });
  });

  it('correctly parses diff code blocks from markdown responses', () => {
    const rawMarkdown = `I found an issue with the port configuration. Here is the fix:

\`\`\`diff
FILE: src/config.ts
<<<<<<< SEARCH (line 10)
const PORT = 3000;
=======
const PORT = 8080;
>>>>>>> REPLACE
\`\`\`

Let me know if you would like any further changes.`;

    const parts = parseMarkdownParts(rawMarkdown);
    expect(parts).toHaveLength(3);
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('code');

    const codePart = parts[1] as { type: 'code'; language: string; code: string };
    expect(codePart.language).toBe('diff');
    expect(codePart.code).toContain('<<<<<<< SEARCH');

    // Verify diff extraction
    const diffs = parseFrugalDiffClient(codePart.code);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('src/config.ts');
    expect(diffs[0].hunks).toHaveLength(1);
    expect(diffs[0].hunks[0].lineHint).toBe(10);
  });

  it('routes diff from chat code block directly into DiffReviewStore with active buffer resolution', async () => {
    // 1. Setup an active buffer in Monaco Editor
    const bufId = useEditorStore.getState().openFile(
      'src/server.ts',
      'import express from "express";\nconst PORT = 3000;\nconst app = express();\n'
    );
    expect(useEditorStore.getState().activeBufferId).toBe(bufId);

    // 2. Chat response emits a diff without an explicit FILE: header (e.g. focused on the active file)
    const diffCode = `<<<<<<< SEARCH (line 2)
const PORT = 3000;
=======
const PORT = 5000;
>>>>>>> REPLACE`;

    let parsedDiffs = parseFrugalDiffClient(diffCode);
    expect(parsedDiffs).toHaveLength(1);
    expect(parsedDiffs[0].filePath).toBe('untitled');

    // 3. Fallback resolution to active editor buffer path
    const activeBuf = useEditorStore.getState().buffers[bufId];
    parsedDiffs = parsedDiffs.map((d) => {
      if ((d.filePath === 'untitled' || !d.filePath) && activeBuf) {
        return { ...d, filePath: activeBuf.filePath };
      }
      return d;
    });

    expect(parsedDiffs[0].filePath).toBe('src/server.ts');

    // 4. Open diff review
    await useDiffReviewStore.getState().openReview(parsedDiffs);
    expect(useDiffReviewStore.getState().isOpen).toBe(true);

    // 5. User accepts the hunk and applies
    useDiffReviewStore.getState().acceptHunk('hunk-1');
    expect(useDiffReviewStore.getState().hunkDecisions[getHunkKey('src/server.ts', 'hunk-1')]).toBe('accepted');

    const success = await useDiffReviewStore.getState().applyAccepted();
    expect(success).toBe(true);

    // 6. Verify active editor buffer was updated in-memory
    const updatedBuf = useEditorStore.getState().buffers[bufId];
    expect(updatedBuf.content).toBe('import express from "express";\nconst PORT = 5000;\nconst app = express();\n');
    expect(updatedBuf.isDirty).toBe(false);
  });

  it('handles multi-file diffs in a single code block', async () => {
    const rawDiff = `
FILE: src/index.ts
<<<<<<< SEARCH (line 1)
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

FILE: src/utils.ts
<<<<<<< SEARCH (line 5)
export const b = 2;
=======
export const b = 20;
>>>>>>> REPLACE
`;
    const diffs = parseFrugalDiffClient(rawDiff);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].filePath).toBe('src/index.ts');
    expect(diffs[1].filePath).toBe('src/utils.ts');

    // Open in review store
    await useDiffReviewStore.getState().openReview(diffs);
    expect(useDiffReviewStore.getState().isOpen).toBe(true);
    expect(useDiffReviewStore.getState().diffs).toHaveLength(2);
  });
});
