/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    // Session worktrees under .claude/worktrees/ hold full repo copies; don't run their tests twice.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
