import { InferencePriority } from './inference';

export type TaskType =
  | 'autocomplete'
  | 'fast_edit'
  | 'reasoning'
  | 'terminal_fix'
  | 'general_chat';

export interface TaskRouteDecision {
  task_type: TaskType;
  model_name: string;
  temperature: number;
  keep_alive: string;
  priority: InferencePriority;
  max_tokens: number;
  rationale: string;
}

export interface ModelRouterConfig {
  auto_route: boolean;
  autocomplete_model: string;
  edit_model: string;
  reasoning_model: string;
  terminal_fix_model: string;
  general_chat_model: string;
}
