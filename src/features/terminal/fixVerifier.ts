import { CompilerTool } from '../../types/terminal';
import { VerificationResult } from '../../types/repair';
import { parseAllTerminalErrors, stripAnsi } from './errorCapture';
import { restoreCheckpoint } from '../git/checkpoint';
import { useEditorStore } from '../../stores/editorStore';

/**
 * Infers the best command to re-run and verify a compilation/test diagnostic fix.
 */
export function inferReRunCommand(
  tool?: CompilerTool | string,
  filePath?: string,
  customCmd?: string
): string {
  if (customCmd && customCmd.trim()) {
    return customCmd.trim();
  }

  const normalizedTool = tool?.toLowerCase();
  if (normalizedTool === 'cargo') {
    return 'cargo test';
  }
  if (normalizedTool === 'tsc') {
    return 'npx tsc --noEmit';
  }
  if (normalizedTool === 'pytest') {
    return filePath ? `pytest ${filePath}` : 'pytest';
  }
  if (normalizedTool === 'npm') {
    return 'npm test';
  }
  if (normalizedTool === 'python') {
    return filePath ? `python ${filePath}` : 'python -m pytest';
  }
  if (normalizedTool === 'go') {
    return 'go test ./...';
  }

  // File extension fallback heuristics
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'rs':
        return 'cargo test';
      case 'ts':
      case 'tsx':
        return 'npx tsc --noEmit';
      case 'js':
      case 'jsx':
        return 'npm test';
      case 'py':
        return 'pytest';
      case 'go':
        return 'go test ./...';
    }
  }

  return 'npm test';
}

/**
 * Dispatches a command directly to the active PTY session via Tauri IPC.
 */
export async function executeTerminalCommand(
  sessionId: string,
  command: string
): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_terminal_input', {
      id: sessionId,
      data: command + '\r\n',
    });
    return true;
  } catch {
    // In browser dev mode, dispatch synthetic event if available
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(`terminal-data-${sessionId}`, `\r\n$ ${command}\r\n`);
    } catch {
      // Ignored in purely headless environments
    }
    return false;
  }
}

/**
 * Analyzes terminal output stream text to determine if build/tests passed or failed.
 */
export function evaluateVerificationOutput(
  output: string,
  _tool?: CompilerTool | string,
  targetErrorCode?: string
): { passed: boolean; message: string } {
  const stripped = stripAnsi(output);
  if (!stripped.trim()) {
    return {
      passed: false,
      message: 'No output received from terminal execution.',
    };
  }

  const parsedErrors = parseAllTerminalErrors(stripped);

  // If a specific error code was being fixed, check if that exact error still exists
  if (targetErrorCode && targetErrorCode !== 'UNKNOWN') {
    const matchingTarget = parsedErrors.find((e) => e.errorCode === targetErrorCode);
    if (matchingTarget) {
      return {
        passed: false,
        message: `Compiler diagnostic ${targetErrorCode} still persists.`,
      };
    }
  }

  // Framework success signatures
  const rustSuccess =
    /test result: ok\./i.test(stripped) ||
    (/Finished `?(test|dev|release|check)`?/i.test(stripped) && !/error\[E\d+\]/i.test(stripped));
  const tsSuccess =
    /Found 0 errors/i.test(stripped) ||
    (/built in/i.test(stripped) && !/error TS\d+/i.test(stripped));
  const pytestSuccess =
    /===.*passed.*in/i.test(stripped) ||
    (/\d+ passed/i.test(stripped) && !/FAILED/i.test(stripped));
  const goSuccess =
    /PASS/i.test(stripped) ||
    (/ok\s+[\w./]+/i.test(stripped) && !/FAIL/i.test(stripped));
  const npmSuccess =
    /Tests:.*passed/i.test(stripped) ||
    (/Test Suites:.*passed/i.test(stripped) && !/npm ERR!/i.test(stripped));

  if (rustSuccess || tsSuccess || pytestSuccess || goSuccess || npmSuccess) {
    return {
      passed: true,
      message: 'Build & tests passed cleanly with 0 errors.',
    };
  }

  // If any compiler/linter error is found
  if (parsedErrors.length > 0) {
    return {
      passed: false,
      message: `Verification detected ${parsedErrors.length} compiler/test error(s).`,
    };
  }

  // Check explicit failure keywords
  const hasFailureMarker =
    /error\[E\d+\]/i.test(stripped) ||
    /error TS\d+/i.test(stripped) ||
    /FAIL\s+/i.test(stripped) ||
    /FAILED\s+/i.test(stripped) ||
    /Traceback \(most recent call last\)/i.test(stripped) ||
    /npm ERR!/i.test(stripped);

  if (hasFailureMarker) {
    return {
      passed: false,
      message: 'Command output contains compilation or test failure indicators.',
    };
  }

  return {
    passed: true,
    message: 'Command finished without detecting compiler errors.',
  };
}

export interface VerifyOptions {
  sessionId: string;
  command: string;
  tool?: CompilerTool | string;
  targetErrorCode?: string;
  timeoutMs?: number;
  onChunk?: (chunk: string) => void;
}

/**
 * Runs a verification command in the PTY terminal and monitors the output stream.
 */
export async function verifyFixRun(options: VerifyOptions): Promise<VerificationResult> {
  const {
    sessionId,
    command,
    tool,
    targetErrorCode,
    timeoutMs = 12000,
    onChunk,
  } = options;

  let collectedOutput = '';
  let unlisten: (() => void) | null = null;
  let timer: any = null;
  let checkInterval: any = null;

  try {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen<string>(`terminal-data-${sessionId}`, (event) => {
      collectedOutput += event.payload;
      if (onChunk) {
        onChunk(event.payload);
      }
    });
  } catch {
    // Dev or test environment
  }

  // Trigger command in the session
  await executeTerminalCommand(sessionId, command);

  const result = await new Promise<VerificationResult>((resolve) => {
    checkInterval = setInterval(() => {
      if (!collectedOutput.trim()) return;

      const evaluation = evaluateVerificationOutput(collectedOutput, tool, targetErrorCode);
      const remainingErrors = parseAllTerminalErrors(collectedOutput, sessionId);

      if (evaluation.passed && (collectedOutput.includes('\n') || collectedOutput.length > 30)) {
        clearInterval(checkInterval);
        if (timer) clearTimeout(timer);
        resolve({
          status: 'passed',
          command,
          output: collectedOutput,
          remainingErrors: [],
          message: evaluation.message,
        });
      } else if (!evaluation.passed && remainingErrors.length > 0) {
        clearInterval(checkInterval);
        if (timer) clearTimeout(timer);
        resolve({
          status: 'failed',
          command,
          output: collectedOutput,
          remainingErrors,
          message: evaluation.message,
        });
      }
    }, 300);

    timer = setTimeout(() => {
      clearInterval(checkInterval);
      const remainingErrors = parseAllTerminalErrors(collectedOutput, sessionId);
      const evaluation = evaluateVerificationOutput(collectedOutput, tool, targetErrorCode);

      resolve({
        status: evaluation.passed ? 'passed' : (remainingErrors.length > 0 ? 'failed' : 'timeout'),
        command,
        output: collectedOutput,
        remainingErrors,
        message: evaluation.passed
          ? evaluation.message
          : remainingErrors.length > 0
          ? evaluation.message
          : 'Verification timed out waiting for terminal output.',
      });
    }, timeoutMs);
  });

  if (unlisten) {
    unlisten();
  }

  return result;
}

/**
 * Reverts the workspace files to a pre-repair shadow git checkpoint.
 */
export async function rollbackRepairToCheckpoint(
  checkpointId: string,
  filePath: string
): Promise<{ success: boolean; message: string }> {
  const res = await restoreCheckpoint(checkpointId);
  if (!res || !res.success) {
    return {
      success: false,
      message: res?.message || `Failed to restore checkpoint ${checkpointId}`,
    };
  }

  // Refresh buffer in editor store
  let restoredContent = '';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    restoredContent = await invoke<string>('read_file_content', { path: filePath });
  } catch {
    // In browser/test mode fallback
  }

  if (restoredContent) {
    useEditorStore.getState().updateFileContentByPath(filePath, restoredContent);
  }

  return {
    success: true,
    message: `Workspace rolled back to pre-repair checkpoint ${checkpointId.slice(0, 8)}`,
  };
}
