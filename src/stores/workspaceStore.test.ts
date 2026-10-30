import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, toWorkspaceAbsolute, toWorkspaceRelative } from './workspaceStore';

describe('workspace path helpers', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ root: null, name: null, recent: [], error: null });
  });

  it('leaves paths unchanged (slash-normalized) when no folder is open', () => {
    expect(toWorkspaceRelative('src\\main.rs')).toBe('src/main.rs');
    expect(toWorkspaceAbsolute('src/main.rs')).toBe('src/main.rs');
  });

  it('converts between absolute and workspace-relative paths', () => {
    useWorkspaceStore.setState({ root: 'D:/projects/demo', name: 'demo' });

    expect(toWorkspaceRelative('D:/projects/demo/src/main.rs')).toBe('src/main.rs');
    expect(toWorkspaceRelative('D:\\projects\\demo\\src\\main.rs')).toBe('src/main.rs');
    expect(toWorkspaceAbsolute('src/main.rs')).toBe('D:/projects/demo/src/main.rs');
    expect(toWorkspaceAbsolute('./README.md')).toBe('D:/projects/demo/README.md');

    // Absolute paths pass through; a sibling sharing the prefix is not inside the root.
    expect(toWorkspaceAbsolute('D:/other/file.ts')).toBe('D:/other/file.ts');
    expect(toWorkspaceRelative('D:/projects/demo-evil/x.ts')).toBe('D:/projects/demo-evil/x.ts');
  });

  it('works with POSIX roots', () => {
    useWorkspaceStore.setState({ root: '/home/me/app', name: 'app' });
    expect(toWorkspaceRelative('/home/me/app/lib/a.py')).toBe('lib/a.py');
    expect(toWorkspaceAbsolute('lib/a.py')).toBe('/home/me/app/lib/a.py');
  });

  it('explains that opening folders needs the desktop app in the browser preview', async () => {
    const ok = await useWorkspaceStore.getState().openFolderDialog();
    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().error).toContain('desktop app');
  });
});
