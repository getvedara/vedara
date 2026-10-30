export interface FileNode {
  path: string;
  name: string;
  is_dir: boolean;
  children?: FileNode[];
  git_status?: 'modified' | 'untracked' | 'staged';
}
