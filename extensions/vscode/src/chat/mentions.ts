/**
 * `@file` mentions in chat: the user types `@` and picks a file, and that file is sent to the model
 * with the message, next to the open file. Without this the chat only ever sees the open file.
 */

export interface MentionedFile {
  path: string;
  languageId: string;
  text: string;
}

/** Folders never offered or searched: dependencies, build output, version control. */
export const MENTION_EXCLUDE = '**/{node_modules,.git,out,dist,build,target,.next,.venv,venv,__pycache__}/**';

/**
 * The `@path` tokens in a message, in order, without duplicates or trailing punctuation. Code
 * blocks are skipped: decorators like `@app.route` aren't mentions.
 */
export function extractMentions(text: string): string[] {
  const found: string[] = [];
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const m of prose.matchAll(/(?:^|\s)@([\w./\\-]+)/g)) {
    const token = m[1].replace(/[.,;:!?)]+$/, '').replace(/\\/g, '/');
    if (token && /[\w]/.test(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * The workspace file a mention means: the path itself, else a file whose path ends with it
 * (`@store.ts`, `@chat/store.ts`), the shortest such path when there are several.
 */
export function chooseMention(token: string, candidates: string[]): string | undefined {
  const want = token.replace(/^\.\//, '').toLowerCase();
  const exact = candidates.find((c) => c.toLowerCase() === want);
  if (exact) return exact;
  const ending = candidates.filter((c) => c.toLowerCase().endsWith('/' + want));
  return ending.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/**
 * The mentioned files as the model sees them, within `maxChars` in total. A file that doesn't fit
 * is cut at a line break and labelled, so the model knows the rest exists.
 */
export function buildMentionContext(files: MentionedFile[], maxChars: number): string | undefined {
  if (files.length === 0) return undefined;
  const each = Math.floor(maxChars / files.length);
  return files
    .map((f) => {
      const text = f.text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
      const lines = text.split('\n').length;
      let body = text;
      let header = `File mentioned by the user: ${f.path} (${lines} line${lines === 1 ? '' : 's'})`;
      if (text.length > each) {
        const cut = text.lastIndexOf('\n', each);
        body = text.slice(0, cut > 0 ? cut : each);
        header = `File mentioned by the user: ${f.path}, lines 1-${body.split('\n').length} of ${lines} (the rest is not shown)`;
      }
      return `${header}:\n\`\`\`${f.languageId || 'plaintext'}\n${body}\n\`\`\``;
    })
    .join('\n\n');
}
