export type CommandCategory =
  | 'File'
  | 'View'
  | 'AI Assistant'
  | 'Git'
  | 'Terminal'
  | 'Settings'
  | 'Preferences'
  | 'Help'
  | 'Plugins'
  | (string & {});


export interface PaletteCommand {
  id: string;
  title: string;
  category: CommandCategory;
  description?: string;
  shortcut?: string;
  keywords?: string[];
  icon?: string;
  handler: () => void | Promise<void>;
}

export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
  matchedIndices: number[];
}

export interface PaletteFileItem {
  name: string;
  relPath: string;
  isRecent?: boolean;
}
