export type EditorTheme = 'vedara-dark' | 'vs-dark' | 'light';
export type WordWrapSetting = 'on' | 'off' | 'wordWrapColumn';

export interface VedaraSettings {
  ollamaEndpoint: string;
  autocompleteModel: string;
  chatModel: string;
  editModel: string;
  reasoningModel: string;
  autoModelRouter: boolean;
  tabSize: number;
  fontSize: number;
  theme: EditorTheme;
  wordWrap: WordWrapSetting;
  formatOnSave: boolean;
  isFirstRun: boolean;
  telemetryDisabled: boolean; // Always true for 100% air-gap
}

export const DEFAULT_SETTINGS: VedaraSettings = {
  ollamaEndpoint: 'http://localhost:11434',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  chatModel: 'qwen2.5-coder:7b',
  editModel: 'qwen2.5-coder:7b',
  reasoningModel: 'qwen2.5-coder:7b',
  autoModelRouter: true,
  tabSize: 2,
  fontSize: 14,
  theme: 'vedara-dark',
  wordWrap: 'on',
  formatOnSave: true,
  isFirstRun: true,
  telemetryDisabled: true,
};
