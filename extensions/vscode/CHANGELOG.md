# Changelog

## Unreleased

- **`@` mentions in chat.** Type `@` to pick a workspace file; it's sent to the model with your message,
  next to the open file (the two share the space the open file had, so prompts still fit). Edits can name
  the mentioned file. The answer's footer lists the files read, and a mention that matches no file says
  so. Dependencies and build output (`node_modules`, `dist`, `.git`, …) aren't offered.
- **One edit with separate changes becomes one card per change.** Asked to add `removeUser`, small
  models also "fix" `findUser` in the same edit; now each change has its own card, so you can apply one
  without the other. An edit is only split when every piece stands on its own: brackets balanced, a
  unique match in the file, nothing one piece adds used by another, and the same result as the whole.
- An edit that leaves `{`, `(` or `[` unbalanced (small models sometimes drop a closing `}`) keeps its
  buttons but warns that the code probably won't compile. A `FILE:` line separated from its edit by a
  blank line no longer shows up as stray text with the card labelled "Active Document".
- When a small model types out the file in a code block with an edit in the middle of it, the answer
  shows one edit of just the change (or, if the code isn't the whole file, the code and the edit
  separately) instead of falling apart into plain text.
- **Rollback works after a restart.** Outside a git repository, the last 20 AI edits were kept only in
  memory and lost when VS Code closed; they're now saved with the workspace (edits to unsaved files
  excepted). If a file changed after the edit, **Vedara: Rollback Last Applied Diff** asks before
  overwriting those later changes.
- The "Frugal Diff" commands are now **Vedara: Apply Edit from Selection or Clipboard** and **Vedara:
  Preview Edit from Selection or Clipboard** (same command IDs, so keybindings keep working).

## 0.1.1 (preview)

- While an answer streams, each code block and edit shows as one progress line ("Writing edit to
  userStore.ts… 12 lines") instead of scrolling past. Small models often type out the whole file before
  the edit; the full answer appears when it's done.
- When an answer has an edit, a copy of the whole current file in the same answer is dropped.
- An edit whose SEARCH is the whole file is narrowed to the lines that changed, so the preview shows the
  change rather than the file.
- Edit cards are labelled "Edit" instead of "Frugal Diff", and show the change as a diff (removed lines
  in red, added lines in green) instead of raw SEARCH/REPLACE markers. Long unchanged stretches fold
  to one line.
- When small models split one change over several edits (one opens a `try {`, another adds the
  `} catch`) or write edits that build on each other, the answer's edits are shown as one edit with the
  net change and one Apply; applied one at a time, those broke the code or failed. Complete, separate
  changes keep their own cards, so one can be applied without the rest. An edit that doesn't match the
  current file says so instead of offering an Apply that fails. Headings like "SEARCH/REPLACE blocks for
  the changes:" and stray `FILE:` lines are dropped.
- Code blocks in answers have **Insert into File** and **Copy** buttons. Small models answer "add a
  function…" with new code rather than an edit; Insert puts it at the cursor (on a blank line, after the
  cursor's line, or in place of a selection), checkpointed first so Rollback Last Applied Diff undoes
  it. Shell commands get Copy only.

## 0.1.0 (preview)

First Marketplace release under the name **Vedara** (previously developed as "Open Studio").

- Tab completion through Ollama's native fill-in-the-middle mode.
- OpenAI-compatible model servers (vLLM, llama.cpp `llama-server`, LM Studio) for chat, edits and Tab
  completion, with an optional separate server for Tab and an API key kept in VS Code's secret storage
  (**Vedara: Set Server API Key**).
- Organization policy: a `policy.json` in a machine-wide folder fixes the server and models for everyone
  and blocks every other host. A broken policy blocks all requests instead of being ignored.
- `npm run bundle:offline` builds an offline install bundle: the `.vsix`, an example policy, install
  instructions, optional model files and SHA-256 checksums.
- Chat sidebar with Explain, Refactor, Generate Tests and Fix Bugs actions on selected code.
- Chat remembers the conversation and sees the file you're working on (the whole file when it's small, the
  part around your cursor otherwise), so answers and edits are about your actual code.
- The chat model loads in the background when the chat opens, and "Loading model…" shows if it isn't ready
  yet, so the first answer no longer sits silent. Each answer shows the model and its speed.
- When you ask for a change and the answer has no applicable edit, the chat says so instead of just showing
  no buttons.
- Earlier edits are kept in the conversation as a short note rather than the full edit text, so small models
  stop copying old (sometimes broken) edits into new answers.
- Chat answers stop at 2,048 tokens, so a model stuck repeating itself can't tie up the GPU; the chat says when
  an answer was cut off.
- Edits work on unsaved files (`Untitled-1`) as well as files on disk.
- Edits written loosely by small models are repaired so Preview Diff and Apply Diff still appear: a missing
  `<<<<<<<` marker or `FILE:` line, code fences around each side, or a bare `REPLACE` line. When a model
  answers a change request with the whole updated file instead, the chat turns it into an edit of just the
  lines that changed. Edits that change nothing are dropped, and the chat says so.
- Explain and Generate Unit Tests use a system prompt without the edit format, so small models answer with
  tests in a code block instead of editing your file. Quick actions are remembered as a one-line summary, so
  their instructions don't leak into later answers.
- **Vedara: Recommend Local Models** sizes models by GPU memory (NVIDIA, or Apple Silicon unified memory)
  instead of system RAM, uses one model for both chat and Tab on small GPUs, and warns when the chat model is
  too small for reliable edits.
- New setting `vedara.contextLength` (default 8192 tokens) for chat and Tab completion.
- `SEARCH / REPLACE` edits with side-by-side preview. Blocks that match more than one place, or none, are
  rejected instead of applied in a guessed place.
- Checkpoints: a snapshot of the git workspace before every AI edit, restorable from
  **Vedara: Show Checkpoints**, without touching your branch, `HEAD` or staging area.
- **Vedara: Import Continue Settings** brings over Ollama models from a Continue configuration.
- Experimental next-edit prediction with the open Zeta 2 model, off by default.
