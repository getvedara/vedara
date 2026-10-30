import { applyHunks, parseFrugalDiff } from '../../../../extensions/vscode/src/diff/frugalDiffEngine.ts';
import { hunkNew, hunkOld, renderUnifiedDiff, uniqueHunks } from '../diff.ts';
import type { ApplyResult, FormatId, Task } from '../types.ts';
import { applyUnifiedDiff, parseUnifiedDiff, stripPathPrefix, UdiffParseError, type UdiffFilePatch } from './unifiedDiff.ts';

export const ALL_FORMATS: FormatId[] = ['whole', 'search-replace', 'search-replace-hinted', 'udiff'];

/** Bump when any prompt text changes; part of the result cache key. */
export const PROMPT_VERSION = 1;

const LANG_FENCE: Record<Task['language'], string> = {
  typescript: 'ts',
  python: 'python',
  rust: 'rust',
  go: 'go',
};

const COMMON_RULES = `You are a precise code-editing assistant. You will be given an instruction and one or more source files.
Make exactly the change the instruction asks for and nothing else: keep unrelated code, comments and formatting unchanged.
Reply with the edit only, in the format below. Do not explain.`;

const SYSTEM_PROMPTS: Record<FormatId, string> = {
  whole: `${COMMON_RULES}

FORMAT: whole file.
For every file you change, output a line \`FILE: <path>\` followed by the complete new contents of that file in a fenced code block.
Do not output files you do not change. Never abbreviate or elide code with comments like "... rest unchanged".

Example:
FILE: greet.py
\`\`\`python
def greet(name):
    return "Hello, " + name + "!"
\`\`\``,

  'search-replace': `${COMMON_RULES}

FORMAT: SEARCH/REPLACE blocks.
For each change, output a line \`FILE: <path>\` followed by one or more blocks:
<<<<<<< SEARCH
<lines copied exactly from the current file>
=======
<the lines that replace them>
>>>>>>> REPLACE
The SEARCH section must match the file exactly, character for character, including indentation, and must match only one place in the file:
include enough surrounding lines to make it unique. Keep blocks small. Use several blocks for changes in different places.

Example:
FILE: greet.py
<<<<<<< SEARCH
def greet(name):
    return "Hello " + name
=======
def greet(name):
    return "Hello, " + name + "!"
>>>>>>> REPLACE`,

  'search-replace-hinted': `${COMMON_RULES}

FORMAT: SEARCH/REPLACE blocks with line hints.
Files are shown with a line-number gutter like \`  12 | code\`. The gutter is NOT part of the file: never copy it into your reply.
For each change, output a line \`FILE: <path>\` followed by one or more blocks:
<<<<<<< SEARCH (line <N>)
<lines copied exactly from the current file, without the gutter>
=======
<the lines that replace them>
>>>>>>> REPLACE
<N> is the line number of the first SEARCH line. The SEARCH section must match the file exactly, including indentation.
Keep blocks small. Use several blocks for changes in different places.

Example:
FILE: greet.py
<<<<<<< SEARCH (line 1)
def greet(name):
    return "Hello " + name
=======
def greet(name):
    return "Hello, " + name + "!"
>>>>>>> REPLACE`,

  udiff: `${COMMON_RULES}

FORMAT: unified diff.
Output a unified diff (like \`diff -u\` or \`git diff\`) with \`--- a/<path>\` and \`+++ b/<path>\` headers for each file and \`@@ -start,count +start,count @@\` hunk headers.
Context lines start with a space, removed lines with \`-\`, added lines with \`+\`. Include about three lines of unchanged context around each change.

Example:
--- a/greet.py
+++ b/greet.py
@@ -1,2 +1,2 @@
 def greet(name):
-    return "Hello " + name
+    return "Hello, " + name + "!"`,
};

export function systemPrompt(format: FormatId): string {
  return SYSTEM_PROMPTS[format];
}

function withGutter(content: string): string {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width)} | ${l}`).join('\n');
}

export function userPrompt(task: Task, format: FormatId): string {
  const fence = LANG_FENCE[task.language];
  const files = task.files
    .map((f) => {
      const body = format === 'search-replace-hinted' ? withGutter(task.before[f]) : task.before[f].replace(/\n$/, '');
      return `FILE: ${f}\n\`\`\`${fence}\n${body}\n\`\`\``;
    })
    .join('\n\n');
  return `Instruction:\n${task.instruction}\n\n${files}\n\nReply with the edit in the required format only.`;
}

export function retryPrompt(error: string): string {
  return `Your edit could not be applied: ${error}\nReply again with the complete edit, in the required format only.`;
}

/** Maps a path written by the model onto one of the task's files. */
export function resolvePath(task: Task, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '' || raw === 'untitled') {
    return task.files.length === 1 ? task.files[0] : null;
  }
  const p = stripPathPrefix(raw);
  if (task.files.includes(p)) return p;
  const byBase = task.files.filter((f) => f.split('/').pop() === p.split('/').pop());
  return byBase.length === 1 ? byBase[0] : null;
}

function applyWhole(task: Task, response: string): ApplyResult {
  const lines = response.replace(/\r\n/g, '\n').split('\n');
  const out: Record<string, string> = { ...task.before };
  const seen = new Set<string>();
  let pendingPath: string | null | undefined;
  let blocks = 0;

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*(?:\*\*)?(?:FILE|File|file):\s*(.+?)(?:\*\*)?\s*$/);
    if (header) {
      pendingPath = header[1];
      continue;
    }
    const open = lines[i].match(/^\s*(`{3,})/);
    if (!open) continue;
    const fence = open[1];
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !(lines[j].trim().startsWith(fence) && lines[j].trim().replace(/`/g, '') === '')) {
      body.push(lines[j]);
      j++;
    }
    if (j >= lines.length) return { ok: false, error: 'unterminated code block' };
    i = j;
    blocks++;
    const target = resolvePath(task, pendingPath ?? null);
    if (!target) return { ok: false, error: `could not tell which file a code block belongs to (${pendingPath ?? 'no FILE: header'})` };
    if (seen.has(target)) return { ok: false, error: `file ${target} was output more than once` };
    seen.add(target);
    out[target] = body.join('\n') + '\n';
    pendingPath = undefined;
  }
  if (blocks === 0) return { ok: false, error: 'no fenced code block found' };
  return { ok: true, files: out };
}

function applySearchReplace(task: Task, response: string): ApplyResult {
  const parsed = parseFrugalDiff(response);
  if (parsed.length === 0) return { ok: false, error: 'no SEARCH/REPLACE blocks found' };
  const out: Record<string, string> = { ...task.before };
  for (const fd of parsed) {
    const target = resolvePath(task, fd.filePath);
    if (!target) return { ok: false, error: `unknown file '${fd.filePath}'` };
    const res = applyHunks(out[target], fd.hunks);
    if (!res.allApplied) {
      const failed = res.hunkResults.filter((r) => !r.success).map((r) => `${r.hunkId}: ${r.error}`);
      return { ok: false, error: `in ${target}: ${failed.join('; ')}` };
    }
    out[target] = res.modifiedContent;
  }
  return { ok: true, files: out };
}

function applyUdiff(task: Task, response: string): ApplyResult {
  let patches: UdiffFilePatch[];
  try {
    patches = parseUnifiedDiff(response);
  } catch (err) {
    if (err instanceof UdiffParseError) return { ok: false, error: err.message };
    throw err;
  }
  if (patches.length === 0) return { ok: false, error: 'no unified diff hunks found' };
  const out: Record<string, string> = { ...task.before };
  for (const p of patches) {
    const target = resolvePath(task, p.path);
    if (!target) return { ok: false, error: `unknown file '${p.path ?? '(no header)'}'` };
    const res = applyUnifiedDiff(out[target], p.hunks);
    if (!res.ok) return { ok: false, error: `in ${target}: ${res.error}` };
    out[target] = res.content!;
  }
  return { ok: true, files: out };
}

export function applyResponse(task: Task, format: FormatId, response: string): ApplyResult {
  try {
    switch (format) {
      case 'whole':
        return applyWhole(task, response);
      case 'search-replace':
      case 'search-replace-hinted':
        return applySearchReplace(task, response);
      case 'udiff':
        return applyUdiff(task, response);
    }
  } catch (err) {
    return { ok: false, error: `applier threw: ${(err as Error).message}` };
  }
}

/** The ideal response for a task in a format, built from the reference solution (dry-run / corpus checks). */
export function referenceResponse(task: Task, format: FormatId): string {
  const changed = task.files.filter((f) => task.before[f] !== task.after[f]);
  const fence = LANG_FENCE[task.language];
  switch (format) {
    case 'whole':
      return changed.map((f) => `FILE: ${f}\n\`\`\`${fence}\n${task.after[f].replace(/\n$/, '')}\n\`\`\``).join('\n\n');
    case 'search-replace':
    case 'search-replace-hinted':
      return changed
        .map((f) => {
          const blocks = uniqueHunks(task.before[f], task.after[f]).map((h) => {
            const hint = format === 'search-replace-hinted' ? ` (line ${h.oldStart})` : '';
            return [`<<<<<<< SEARCH${hint}`, ...hunkOld(h), '=======', ...hunkNew(h), '>>>>>>> REPLACE'].join('\n');
          });
          return `FILE: ${f}\n${blocks.join('\n')}`;
        })
        .join('\n\n');
    case 'udiff':
      return changed.map((f) => renderUnifiedDiff(f, task.before[f], task.after[f])).join('');
  }
}
