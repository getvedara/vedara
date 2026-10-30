export interface SlicedFile {
  file_path: string;
  language: string;
  original_bytes: number;
  sliced_bytes: number;
  original_tokens: number;
  sliced_tokens: number;
  reduction_percent: number;
  skeleton: string;
}

export interface RepoSkeleton {
  workspace_root: string;
  total_files_scanned: number;
  total_files_sliced: number;
  total_original_tokens: number;
  total_sliced_tokens: number;
  overall_reduction_percent: number;
  files: SlicedFile[];
  composite_prompt: string;
}
