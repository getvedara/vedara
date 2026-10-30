import { DiagnosticRepairRequest, DiagnosticRepairResult } from '../../types/repair';
import { FileDiff } from '../../types/diff';
import { parseFrugalDiffClient, applyHunksClient } from '../diff/frugalDiff';
import { routeTask } from '../router/taskRouter';
import { streamCompletion } from '../../services/inference';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { createCheckpoint } from '../git/checkpoint';
import { errorMessage, isDesktopRuntime } from '../../services/runtime';

/**
 * Extracts a centered code window around the error line.
 */
export function extractContextWindow(
  content: string,
  targetLine?: number,
  windowRadius = 40
): { snippet: string; startLine: number; endLine: number } {
  if (!content) {
    return { snippet: '', startLine: 1, endLine: 1 };
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= 120 || !targetLine) {
    return {
      snippet: content,
      startLine: 1,
      endLine: lines.length,
    };
  }

  const startLine = Math.max(1, targetLine - windowRadius);
  const endLine = Math.min(lines.length, targetLine + windowRadius);
  const slice = lines.slice(startLine - 1, endLine);

  return {
    snippet: slice.join('\n'),
    startLine,
    endLine,
  };
}

/**
 * Builds the strict instruction prompt for surgical diagnostic repair.
 */
export function buildDiagnosticRepairPrompt(
  request: DiagnosticRepairRequest,
  fileContent: string
): string {
  const { snippet, startLine } = extractContextWindow(fileContent, request.line);

  let iterationSection = '';
  if (request.iteration && request.iteration > 1) {
    iterationSection =
      `ITERATIVE REPAIR ATTEMPT ${request.iteration} of ${request.maxIterations || 3}:\n` +
      `The previous repair attempt did not completely fix the problem. The compiler reported:\n` +
      (request.previousErrors && request.previousErrors.length > 0
        ? request.previousErrors.map((e) => `- ${e}`).join('\n') + '\n'
        : '- Errors still persist.\n') +
      `Carefully evaluate why the previous change was insufficient and provide a corrected, revised search/replace block.\n\n`;
  }

  return (
    `You are Vedara's automated code repair engine running 100% offline and air-gapped.\n` +
    `Diagnose and repair the following compiler/test diagnostic with minimum changes.\n\n` +
    iterationSection +
    `File: ${request.filePath}${request.line ? `:${request.line}` : ''}${request.column ? `:${request.column}` : ''}\n` +
    `Tool: ${request.tool || 'compiler'}\n` +
    `Error Code: ${request.errorCode || 'UNKNOWN'}\n` +
    `Error Message: ${request.errorMessage}\n\n` +
    (request.contextSnippet ? `Diagnostic Context Trace:\n\`\`\`\n${request.contextSnippet}\n\`\`\`\n\n` : '') +
    `Source Code Window (starting at line ${startLine}):\n\`\`\`\n${snippet}\n\`\`\`\n\n` +
    `INSTRUCTIONS:\n` +
    `1. Provide a 1-2 sentence root-cause diagnosis.\n` +
    `2. Output a surgical, frugal search/replace diff block to resolve the error:\n` +
    `FILE: ${request.filePath}\n` +
    `<<<<<<< SEARCH\n` +
    `<exact lines from the source code to replace>\n` +
    `=======\n` +
    `<corrected replacement code>\n` +
    `>>>>>>> REPLACE\n\n` +
    `The SEARCH lines must be copied exactly and must match only one place in the file; include surrounding lines if needed. ` +
    `Never leave SEARCH empty.\n` +
    `Do NOT wrap the search/replace block in additional markdown diff fences. Keep changes minimal and deterministic.`
  );
}

/**
 * Splits LLM output into human-readable explanation and parsed FileDiff structures.
 */
export function extractExplanationAndDiff(
  llmOutput: string
): { explanation: string; diffs: FileDiff[] } {
  const diffs = parseFrugalDiffClient(llmOutput);

  let explanation = '';
  const searchIdx = llmOutput.indexOf('<<<<<<< SEARCH');
  const fileIdx = llmOutput.indexOf('FILE:');

  const cutIdx = fileIdx !== -1 && fileIdx < (searchIdx !== -1 ? searchIdx : Infinity)
    ? fileIdx
    : searchIdx;

  if (cutIdx > 0) {
    explanation = llmOutput.slice(0, cutIdx).trim();
  } else if (cutIdx === -1) {
    explanation = llmOutput.trim();
  } else {
    explanation = 'Surgical diff generated to resolve compiler error.';
  }

  return { explanation, diffs };
}

/**
 * Executes end-to-end diagnostic repair with model routing and streaming tokens.
 */
export async function executeDiagnosticRepair(
  request: DiagnosticRepairRequest,
  onToken?: (delta: string) => void
): Promise<DiagnosticRepairResult> {
  // 1. Gather file content from open buffer or disk
  let fileContent = '';
  const editorBuffers = useEditorStore.getState().buffers;
  const normPath = request.filePath.replace(/\\/g, '/');

  const matchedBuf = Object.values(editorBuffers).find((b) => {
    const p = b.filePath.replace(/\\/g, '/');
    return p === normPath || p.endsWith('/' + normPath) || normPath.endsWith('/' + p);
  });

  if (matchedBuf) {
    fileContent = matchedBuf.content;
  } else {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      fileContent = await invoke<string>('read_file_content', { path: request.filePath });
    } catch (err) {
      // Never prompt the model with made-up content for a real file.
      if (isDesktopRuntime()) {
        throw new Error(`Could not read ${request.filePath}: ${errorMessage(err)}`);
      }
      // Browser mock fallback
      fileContent = `// File: ${request.filePath}\nexport function example() {\n  return 42;\n}\n`;
    }
  }

  // 2. Build targeted repair prompt
  const prompt = buildDiagnosticRepairPrompt(request, fileContent);

  // 3. Dynamic route decision
  const routeDecision = await routeTask('terminal_fix', prompt);

  // 4. Stream completion
  let accumulated = '';
  await new Promise<void>((resolve, reject) => {
    streamCompletion(
      {
        model: routeDecision.model_name,
        prompt,
        temperature: 0.1,
        priority: 'chat',
        keep_alive: routeDecision.keep_alive,
      },
      {
        onToken: (tokenDelta) => {
          accumulated += tokenDelta;
          if (onToken) {
            onToken(tokenDelta);
          }
        },
        onDone: () => resolve(),
        onError: (message) => reject(new Error(message)),
      },
      useSettingsStore.getState().settings.ollamaEndpoint
    );
  });

  const { explanation, diffs } = extractExplanationAndDiff(accumulated);

  return {
    requestId: request.id,
    fullContent: accumulated,
    diffs,
    explanation,
    modelUsed: routeDecision.model_name,
  };
}

/**
 * Applies the generated diffs directly to the workspace with shadow git snapshot safety.
 */
export async function applyRepairDiffs(
  diffs: FileDiff[],
  summary = 'AI Auto-Fix compiler diagnostic'
): Promise<{ success: boolean; error?: string; checkpointId?: string }> {
  if (!diffs || diffs.length === 0) {
    return { success: false, error: 'No diff hunks to apply' };
  }

  // 1. Create safety shadow checkpoint before touching files
  let checkpointId: string | undefined;
  try {
    const cp = await createCheckpoint(summary);
    if (cp) {
      checkpointId = cp.id || cp.commitHash;
    }
  } catch {
    // Continue even if git is not initialized
  }

  const editorStore = useEditorStore.getState();
  const desktop = isDesktopRuntime();
  const written: string[] = [];
  const failure = (error: string) => ({
    success: false,
    error: written.length > 0 ? `${error} (already written: ${written.join(', ')})` : error,
    checkpointId,
  });

  for (const fileDiff of diffs) {
    let currentContent = '';
    const normPath = fileDiff.filePath.replace(/\\/g, '/');
    const matchedBuf = Object.values(editorStore.buffers).find((b) => {
      const p = b.filePath.replace(/\\/g, '/');
      return p === normPath || p.endsWith('/' + normPath) || normPath.endsWith('/' + p);
    });

    if (matchedBuf) {
      currentContent = matchedBuf.content;
    } else {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        currentContent = await invoke<string>('read_file_content', { path: fileDiff.filePath });
      } catch (err) {
        // An unreadable file is not an empty one: applying against '' would clobber it.
        if (desktop) {
          return failure(`Could not read ${fileDiff.filePath}: ${errorMessage(err)}`);
        }
        currentContent = '';
      }
    }

    const applicationResult = applyHunksClient(currentContent, fileDiff.hunks);
    if (!applicationResult.allApplied && applicationResult.hunkResults.every((h) => !h.success)) {
      return failure(`Failed to match diff anchors in ${fileDiff.filePath}`);
    }

    // Persist to disk in the desktop shell before touching the buffer.
    if (desktop) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('write_file_content', {
          path: fileDiff.filePath,
          content: applicationResult.modifiedContent,
        });
      } catch (err) {
        return failure(`Failed to write ${fileDiff.filePath}: ${errorMessage(err)}`);
      }
    }
    written.push(fileDiff.filePath);

    // Update in-memory buffer
    editorStore.updateFileContentByPath(fileDiff.filePath, applicationResult.modifiedContent);
  }

  return { success: true, checkpointId };
}
