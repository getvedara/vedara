import * as vscode from 'vscode';
import type { ChatMessageParam } from '../ollamaClient';

export interface SelectionRange {
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
}

export interface EditorContext {
  filePath: string;
  relativePath: string;
  languageId: string;
  selectedText: string;
  selectionRange?: SelectionRange;
  cursorLine?: number;
  totalLines?: number;
  /** Full text of the active document. */
  fileText?: string;
}

export type QuickActionType = 'explain' | 'refactor' | 'generateTests' | 'fix';

export interface QuickActionPrompt {
  action: QuickActionType;
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Extracts structured editor context from the active VS Code text editor.
 */
export function getEditorContext(editor?: vscode.TextEditor): EditorContext | undefined {
  if (!editor || !editor.document) {
    return undefined;
  }

  const document = editor.document;
  const filePath = document.fileName || 'untitled';
  let relativePath = filePath;

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    const rootPath = folders[0].uri.fsPath;
    if (filePath.startsWith(rootPath)) {
      relativePath = filePath.substring(rootPath.length).replace(/^[/\\]+/, '').replace(/\\/g, '/');
    }
  }

  const selection = editor.selection;
  const hasSelection = selection && !selection.isEmpty;
  const selectedText = hasSelection ? document.getText(selection) : '';

  const selectionRange: SelectionRange | undefined = selection
    ? {
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1,
        startChar: selection.start.character + 1,
        endChar: selection.end.character + 1,
      }
    : undefined;

  const cursorLine = selection ? selection.active.line + 1 : undefined;

  let fileText: string | undefined;
  try {
    fileText = document.getText();
  } catch {
    fileText = undefined;
  }

  return {
    filePath,
    relativePath,
    languageId: document.languageId || 'plaintext',
    selectedText,
    selectionRange,
    cursorLine,
    totalLines: document.lineCount,
    fileText,
  };
}

/**
 * System prompt: grounding rules plus the SEARCH/REPLACE format for edits.
 */
export const FRUGAL_SYSTEM_PROMPT = `You are Vedara, a coding assistant running locally on the user's machine.

Grounding:
- Work only from the code shown to you in this conversation. The current file is included with the user's latest message.
- If the answer depends on a file, function or library you haven't been shown, say so and ask for it. Don't guess.
- Never invent function names, file paths, settings or APIs.
- Keep answers short and specific to the user's code.

How to answer:
1. Answer questions, explanations and general chat directly in markdown.
2. Show new code (code that doesn't change an existing file) in a normal markdown code block.
3. When the user asks to change existing code in the current file, reply with SEARCH/REPLACE blocks so the change can be applied:

FILE: <relative_path>
<<<<<<< SEARCH
[exact lines from existing file]
=======
[replacement lines]
>>>>>>> REPLACE

SEARCH rules:
- Copy the lines exactly as they appear in the file, and include enough surrounding lines that they match only one place.
- To insert new code, put the neighbouring existing lines in SEARCH and repeat them in REPLACE together with the new code. Never leave SEARCH empty for an existing file.
- Never use SEARCH/REPLACE blocks for questions, explanations or new code.`;

/**
 * System prompt for requests that never change the file (explain, generate tests). It leaves out the
 * edit format: small models that are shown it use it for everything, even for new test files.
 */
export const ANSWER_SYSTEM_PROMPT = `You are Vedara, a coding assistant running locally on the user's machine.

Grounding:
- Work only from the code shown to you in this conversation. The current file is included with the user's latest message.
- If the answer depends on a file, function or library you haven't been shown, say so and ask for it. Don't guess.
- Never invent function names, file paths, settings or APIs.

Answer in markdown. Put code in normal markdown code blocks.`;

/** Most characters of the current file sent with a message (about 4,000 tokens of code). */
export const MAX_FILE_CONTEXT_CHARS = 12_000;

/** Most characters of earlier conversation sent with a message (about 2,000 tokens). */
export const MAX_HISTORY_CHARS = 6_000;

/**
 * Describes the current file for the model: the whole file when it is small enough, otherwise
 * the lines around the selection or cursor, labelled with their range so the model knows the
 * rest exists. The selection, if any, is repeated so the model knows what "this" refers to.
 */
export function buildFileContext(context: EditorContext, maxChars = MAX_FILE_CONTEXT_CHARS): string | undefined {
  // Plain \n line endings: models echo a stray \r from Windows files into their answers otherwise.
  const text = context.fileText?.replace(/\r\n/g, '\n');
  if (text === undefined || !text.trim()) return undefined;

  const lang = context.languageId || 'plaintext';
  const path = context.relativePath || context.filePath;
  const lines = text.split(/\r?\n/);
  let header: string;
  let body: string;

  if (text.length <= maxChars) {
    header = `Current file: ${path} (${lines.length} lines)`;
    body = text;
  } else {
    const sel = context.selectionRange;
    const center = Math.min(
      lines.length,
      Math.max(1, sel ? Math.round((sel.startLine + sel.endLine) / 2) : (context.cursorLine ?? 1))
    );
    // Grow a window of whole lines around the center until the budget is used.
    let start = center;
    let end = center;
    let used = lines[center - 1].length + 1;
    while (start > 1 || end < lines.length) {
      const before = start > 1 ? lines[start - 2].length + 1 : Infinity;
      const after = end < lines.length ? lines[end].length + 1 : Infinity;
      const next = Math.min(before, after);
      if (used + next > maxChars) break;
      used += next;
      if (before <= after) start--;
      else end++;
    }
    header = `Current file: ${path}, lines ${start}-${end} of ${lines.length} (the rest of the file is not shown)`;
    body = lines.slice(start - 1, end).join('\n');
  }

  let out = `${header}:\n\`\`\`${lang}\n${body}\n\`\`\``;
  if (context.selectedText && context.selectionRange) {
    const { startLine, endLine } = context.selectionRange;
    out += `\n\nThe user has selected lines ${startLine}-${endLine}:\n\`\`\`${lang}\n${context.selectedText}\n\`\`\``;
  } else if (context.cursorLine) {
    out += `\n\nThe cursor is on line ${context.cursorLine}.`;
  }
  return out;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Builds the message list for Ollama's /api/chat: the system prompt, as much recent conversation
 * as fits in `maxHistoryChars` (oldest turns are dropped first, in user/assistant pairs), and the
 * new user message with the current file attached.
 */
export function buildChatMessages(options: {
  history: ChatTurn[];
  userText: string;
  fileContext?: string;
  systemPrompt?: string;
  maxHistoryChars?: number;
}): ChatMessageParam[] {
  const budget = options.maxHistoryChars ?? MAX_HISTORY_CHARS;
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = options.history.length - 1; i >= 0; i--) {
    const turn = options.history[i];
    if (used + turn.content.length > budget) break;
    kept.unshift(turn);
    used += turn.content.length;
  }
  // Don't start the window with an assistant reply whose question was dropped.
  while (kept.length > 0 && kept[0].role === 'assistant') kept.shift();

  const user = options.fileContext ? `${options.fileContext}\n\n${options.userText.trim()}` : options.userText.trim();
  return [
    { role: 'system', content: options.systemPrompt ?? FRUGAL_SYSTEM_PROMPT },
    ...kept,
    { role: 'user', content: user },
  ];
}

/**
 * What an assistant reply looks like in the history sent back to the model: each SEARCH/REPLACE
 * edit becomes a one-line note and stray edit markers are dropped. Small models copy patterns from
 * earlier replies, including broken edits, and the current file is attached to every message
 * anyway, so the old edit text adds nothing but a template to copy.
 */
export function compactAssistantReply(text: string): string {
  const withNotes = text.replace(
    /(?:^[ \t]*FILE:[ \t]*(\S[^\r\n]*)\r?\n)?[ \t]*<{7}[ \t]*SEARCH[\s\S]*?>{7}[ \t]*REPLACE[^\r\n]*/gim,
    (_m, file: string | undefined) => `(Proposed an edit${file ? ` to ${file.trim()}` : ''}.)`
  );
  return withNotes
    .split(/\r?\n/)
    .filter((line) => !/<{7}|>{7}|^\s*={7}\s*$|^\s*(SEARCH|REPLACE)\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CODE_WORDS =
  /\b(this|that|it|its|these|those|here|there|same|other|again|also|instead|code|file|line|lines|function|functions|method|class|variable|type|types|import|export|loop|return|bug|bugs|error|errors|crash|crashes|fail|fails|broken|wrong|why|how|does|explain|test|tests|review|improve|optimi[sz]e|summari[sz]e|document|comment|refactor)\b/i;

/**
 * True when a message is plausibly about the open file: it names something in the file or uses a
 * word that points at code. Small models answer an unrelated question ("2+2?") by pasting the
 * attached file back, so the file is only attached when it's likely to be needed.
 */
export function refersToCode(text: string, fileText = ''): boolean {
  if (CODE_WORDS.test(text) || EDIT_VERBS.test(text) || /[`{}();=<>]/.test(text)) return true;
  const identifiers = new Set(fileText.match(/[A-Za-z_$][\w$]{2,}/g) ?? []);
  return (text.match(/[A-Za-z_$][\w$]{2,}/g) ?? []).some((word) => identifiers.has(word));
}

const EDIT_VERBS =
  /\b(add|change|fix|refactor|rename|remove|delete|replace|update|implement|rewrite|modify|convert|move|extract|edit|make)\b/i;

/** True when a message reads like a request to change code (used to explain a missing edit block). */
export function looksLikeEditRequest(text: string): boolean {
  return EDIT_VERBS.test(text);
}

/** True when a reply contains at least one SEARCH/REPLACE block the chat can preview and apply. */
export function hasEditBlock(text: string): boolean {
  return /<{7}\s*SEARCH[\s\S]*?={7}[\s\S]*?>{7}\s*REPLACE/.test(text);
}

/**
 * Builds the user message for an editor quick action (explain, refactor, generate tests, fix).
 */
export function buildQuickActionPrompt(
  action: QuickActionType,
  selectedCode: string,
  filePath = 'active_file',
  languageId = 'typescript'
): QuickActionPrompt {
  const codeBlock = `\`\`\`${languageId}\n${selectedCode}\n\`\`\``;
  let userPrompt = '';

  switch (action) {
    case 'explain':
      userPrompt = `Explain this ${languageId} code from '${filePath}': what it does, its key assumptions and anything that could go wrong.\n\n${codeBlock}`;
      break;

    case 'refactor':
      userPrompt = `Refactor this ${languageId} code from '${filePath}' for readability and best practices, without changing its behaviour. Reply with SEARCH/REPLACE blocks for '${filePath}'.\n\n${codeBlock}`;
      break;

    case 'generateTests':
      userPrompt = `Write unit tests for this ${languageId} code from '${filePath}'. Cover normal cases, edge cases and errors. Put the tests in a new code block.\n\n${codeBlock}`;
      break;

    case 'fix':
      userPrompt = `Find bugs, crashes on edge cases and logic errors in this ${languageId} code from '${filePath}', and fix them with SEARCH/REPLACE blocks for '${filePath}'. If you find no bugs, say so.\n\n${codeBlock}`;
      break;
  }

  const changesFile = action === 'refactor' || action === 'fix';
  return { action, systemPrompt: changesFile ? FRUGAL_SYSTEM_PROMPT : ANSWER_SYSTEM_PROMPT, userPrompt };
}
