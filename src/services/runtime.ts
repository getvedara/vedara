import { isTauri } from '@tauri-apps/api/core';

/**
 * True inside the Vedara desktop shell, false in the browser preview and tests.
 * Use it to tell "no backend available" (fallbacks are fine) apart from
 * "the backend refused or failed" (which must be surfaced to the user).
 */
export function isDesktopRuntime(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
