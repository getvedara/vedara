import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import './monacoWorkers';
import { registerVedaraTheme, THEME_NAME } from './monacoTheme';
import { registerInlineCompletionProvider } from '../../features/autocomplete/inlineProvider';
import { bindModelDiagnostics } from '../../features/diagnostics/monacoBridge';
import { registerLspLanguageFeatures, queryAndSyncLspDiagnostics } from '../../features/diagnostics/lspMonacoBridge';
import { sendLspDidOpen, sendLspDidChange } from '../../features/lsp/lspClient';
import { useEditorStore } from '../../stores/editorStore';
import { usePaletteStore } from '../../stores/paletteStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

interface MonacoEditorProps {
  bufferId: string | null;
}

export const MonacoEditor: React.FC<MonacoEditorProps> = ({ bufferId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsMapRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());

  const { 
    buffers, 
    updateContent, 
    updateCursor, 
    saveFile, 
    closeFile,
    setSplitDirection 
  } = useEditorStore();

  const buffer = bufferId ? buffers[bufferId] : null;

  // Initialize Theme, Inline Completions, and Editor instance once
  useEffect(() => {
    registerVedaraTheme();

    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      theme: THEME_NAME,
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      renderLineHighlight: 'all',
      scrollBeyondLastLine: false,
      minimap: { enabled: true, maxColumn: 80, renderCharacters: false },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      inlineSuggest: {
        enabled: true,
        mode: 'prefix',
      },
      suggestOnTriggerCharacters: true,
      tabCompletion: 'on',
    });

    editorRef.current = editor;

    // Register Qwen 2.5 Coder resident inline autocomplete provider
    const inlineDisposables = registerInlineCompletionProvider();

    // Register Native LSP Hover and Definition providers
    const lspDisposables = registerLspLanguageFeatures();

    // Register IDE Keyboard Shortcuts directly in Monaco
    // Ctrl+S: Save File
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const activeId = useEditorStore.getState().activeBufferId;
      if (activeId) {
        saveFile(activeId);
      }
    });

    // Ctrl+W: Close Tab
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      const activeId = useEditorStore.getState().activeBufferId;
      if (activeId) {
        closeFile(activeId);
      }
    });

    // Ctrl+\: Toggle Split View
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () => {
      const currentSplit = useEditorStore.getState().splitDirection;
      setSplitDirection(currentSplit === 'vertical' ? 'none' : 'vertical');
    });

    // Ctrl+Shift+P / F1: Command Palette
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      usePaletteStore.getState().open('commands');
    });
    editor.addCommand(monaco.KeyCode.F1, () => {
      usePaletteStore.getState().open('commands');
    });

    // Ctrl+P: Quick Open Files
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      usePaletteStore.getState().open('files');
    });

    // Ctrl+K Ctrl+O: Open Folder (Monaco owns Ctrl+K chords while it has focus)
    editor.addCommand(
      monaco.KeyMod.chord(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO
      ),
      () => {
        void useWorkspaceStore.getState().openFolderDialog();
      }
    );

    // Track Cursor Position
    const cursorListener = editor.onDidChangeCursorPosition((e) => {
      const activeId = useEditorStore.getState().activeBufferId;
      if (activeId) {
        updateCursor(activeId, e.position.lineNumber, e.position.column);
      }
    });

    // Auto-layout on resize
    const resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      inlineDisposables.forEach((d) => d.dispose());
      lspDisposables.forEach((d) => d.dispose());
      cursorListener.dispose();
      resizeObserver.disconnect();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Update or switch Monaco Model when bufferId changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (!buffer) {
      editor.setModel(null);
      return;
    }

    let uri: monaco.Uri;
    try {
      uri = monaco.Uri.file(buffer.filePath);
    } catch {
      uri = monaco.Uri.parse(`inmemory://workspace/${buffer.id}/${encodeURIComponent(buffer.fileName)}`);
    }

    let model = monaco.editor.getModel(uri);

    if (!model) {
      try {
        model = monaco.editor.createModel(buffer.content, buffer.language, uri);
      } catch {
        model = monaco.editor.createModel(buffer.content, buffer.language);
      }
      modelsMapRef.current.set(buffer.id, model);
    } else {
      if (model.getValue() !== buffer.content && !buffer.isDirty) {
        model.setValue(buffer.content);
      }
      monaco.editor.setModelLanguage(model, buffer.language);
    }

    editor.setModel(model);
    editor.layout();

    // Bind real-time diagnostics / compiler squiggles to Monaco model
    const unbindDiagnostics = bindModelDiagnostics(model, buffer.filePath);

    // Notify LSP of open document & query initial diagnostics
    sendLspDidOpen(buffer.language, buffer.filePath, buffer.content).catch(() => {});
    queryAndSyncLspDiagnostics(buffer.language, buffer.filePath, model).catch(() => {});

    // Sync content edits from Monaco to Zustand and LSP
    let diagDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const contentListener = model.onDidChangeContent(() => {
      if (editor.getModel() === model) {
        const val = model.getValue();
        updateContent(buffer.id, val);
        sendLspDidChange(buffer.language, buffer.filePath, val).catch(() => {});

        if (diagDebounceTimer) clearTimeout(diagDebounceTimer);
        diagDebounceTimer = setTimeout(() => {
          queryAndSyncLspDiagnostics(buffer.language, buffer.filePath, model).catch(() => {});
        }, 500);
      }
    });

    return () => {
      if (diagDebounceTimer) clearTimeout(diagDebounceTimer);
      unbindDiagnostics();
      contentListener.dispose();
    };
  }, [bufferId, buffer?.filePath, buffer?.language]);

  // Sync cursor position and reveal target line in center
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !buffer?.cursorPosition) return;

    const currentPos = editor.getPosition();
    if (
      !currentPos ||
      currentPos.lineNumber !== buffer.cursorPosition.line ||
      currentPos.column !== buffer.cursorPosition.column
    ) {
      editor.setPosition({
        lineNumber: buffer.cursorPosition.line,
        column: buffer.cursorPosition.column,
      });
      editor.revealLineInCenter(buffer.cursorPosition.line);
    }
  }, [bufferId, buffer?.cursorPosition?.line, buffer?.cursorPosition?.column]);

  return (
    <div className="h-full w-full relative overflow-hidden bg-ide-editor">
      <div 
        ref={containerRef} 
        className={`h-full w-full ${!buffer ? 'opacity-0 pointer-events-none' : ''}`} 
      />
      {!buffer && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-ide-textMuted bg-ide-editor select-none">
          <p className="text-sm">No open files</p>
          <p className="text-xs text-ide-textMuted/70 mt-1">Open a file from the Explorer or press Ctrl+P</p>
        </div>
      )}
    </div>
  );
};
