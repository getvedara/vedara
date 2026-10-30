import { applyHunks, parseFrugalDiff } from '../../../extensions/vscode/src/diff/frugalDiffEngine';

// The diff engine is shared with the VS Code extension and Local Edit Bench; see frugalDiffEngine.ts.
// Writes go through the workspace-confined `write_file_content` command, which applies the
// .vedara/rules.yaml policy in the Rust backend.
export {
  cleanFilePath,
  extractLineHint,
  LINE_HINT_TOLERANCE,
  pickCandidateByHint,
} from '../../../extensions/vscode/src/diff/frugalDiffEngine';

/** Parses SEARCH/REPLACE blocks from model output. */
export const parseFrugalDiffClient = parseFrugalDiff;

/** Applies hunks to file content. */
export const applyHunksClient = applyHunks;
