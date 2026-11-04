# Local Edit Bench

How reliably do **local** models turn an instruction into a code edit that applies cleanly and works?
Local Edit Bench measures that for any model served by [Ollama](https://ollama.com), across the edit
formats coding tools actually use, on hardware you own. Every number it produces comes from a run on a
real machine, with that machine's hardware, Ollama version, model digest and quantization recorded next to it.

It is a standalone harness inside the Vedara repo. It does not depend on the app, except that the
SEARCH/REPLACE format is parsed and applied by Vedara's shared diff engine
([extensions/vscode/src/diff/frugalDiffEngine.ts](../../extensions/vscode/src/diff/frugalDiffEngine.ts)),
imported read-only. The VS Code extension and the desktop app use the same engine, so that format's
scores describe the code users run.

## What is measured

For each **model × edit format × task**:

| Field | Meaning |
|---|---|
| Applied (1st try) | The first response parsed and every hunk/file applied cleanly. |
| Applied (≤ retries) | Same, after at most `--retries` repair rounds. In each round the applier's error message is sent back to the model. |
| Check passed | The edited files pass the task's automated check. An edit that never applied counts as failed. |
| Prompt / completion tokens | Ollama's `prompt_eval_count` / `eval_count`, summed over attempts. |
| Wall time | Client-side, from request to final streamed chunk, summed over attempts. |
| TTFT | Client-side time to the first non-empty streamed chunk of the first attempt. |

The report breaks this down by model × format, by long files (≥ 300 lines), and by language.

### Edit formats

| Id | The model must reply with… | Applied by |
|---|---|---|
| `whole` | `FILE: <path>` + the complete new file in a fenced block | this harness |
| `search-replace` | `FILE: <path>` + `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` blocks | Vedara's frugal-diff parser |
| `search-replace-hinted` | same, with `(line N)` hints; the file is shown with a line-number gutter | Vedara's frugal-diff parser |
| `udiff` | a unified diff (`--- a/` / `+++ b/` / `@@`) | the minimal applier in [src/formats/unifiedDiff.ts](src/formats/unifiedDiff.ts) |
| `search-replace-json` | `{"edits": [{"file", "search", "replace"}]}`, held to a JSON schema by the server (Ollama `format`) | Vedara's frugal-diff engine |
| `anchored-json` | `{"edits": [{"file", "first_line", "last_line", "replace"}]}`; the anchors are an enum of the file's own `N \| text` lines, so the model cannot misquote code | [src/formats/structured.ts](src/formats/structured.ts) |

The two JSON formats test constrained decoding. On the 2026-11-04 run
([results](results/2026-11-04-rtx3050-laptop-constrained.md)), `anchored-json` applied 92.4% of edits
but only 6.8% passed, against 32.6% for plain `search-replace`: under the schema the 1.5B model wrote
short, one-line edits (median 83 completion tokens against 196) and stopped before covering the change.

The exact prompts are in [src/formats/index.ts](src/formats/index.ts) and [src/formats/structured.ts](src/formats/structured.ts). They are versioned
(`PROMPT_VERSION`), and that version is part of every result's cache key.

The unified-diff applier is deliberately small and its leniency is fixed. It ignores the counts in `@@`
headers. It finds each hunk by an exact match of its context and removed lines, and when several places
match it picks the one closest to the stated line number (like GNU patch's offset search, with no fuzz).
If nothing matches exactly, it falls back to ignoring trailing whitespace. A hunk interrupted by a line
that isn't diff syntax is reported as malformed rather than silently truncated.

### Task corpus

[tasks/](tasks/) holds small, self-contained edit tasks in TypeScript, Python, Rust and Go, written for
this benchmark: renames, bug fixes, added parameters, multi-hunk refactors, features and two-file
changes. Several are long files (300–1600 lines) full of near-duplicate code, which makes it hard to
anchor an edit in the right place. Those long tasks are produced by
[scripts/gen-long-tasks.ts](scripts/gen-long-tasks.ts), and the output is committed. List the corpus
with `npm run list`.

Each task directory contains:

```
task.json      id, language, difficulty, kind, instruction, files, check
before/        the files the model sees
after/         a reference solution (never shown to the model)
check/         the check program (not shown to the model)
```

How a task is checked:

- **TypeScript**: `check.ts`, run with tsx. It imports the edited module and asserts on its behaviour.
- **Python**: `check.py`, run with `python -E -s`.
- **Rust**: `check.rs`, built with `rustc --edition 2021 --test` and then run.
- **Go**: compared token by token with the reference solution after stripping whitespace and comments
  (no Go toolchain is assumed). Go instructions are written so that exactly one result is correct.

`npm run verify-corpus` checks every task. The reference solution must pass, the original files must
fail, and the ideal response in every format must reproduce the reference exactly. Run it after adding
or changing a task.

## Running it

Requirements: Node ≥ 20, Ollama with at least one model pulled. Python 3 and `rustc` are needed for
their languages' checks. If one is missing, those checks are reported as *skipped* and left out of pass
rates; they are never counted as passing.

```bash
cd tools/local-edit-bench
npm install
```

```bash
npx tsx src/cli.ts run --models qwen2.5-coder:1.5b,qwen2.5-coder:7b --host-label my-laptop
```

From the repo root, the same thing is available as `npm run bench:edit -- --models … --host-label …`.

This writes `results/<date>-<host-label>.md`, a `.json` with the summary and per-task records, and a
`.raw.jsonl` that also holds every raw model response. Useful options (see `--help`):

| Option | Default | |
|---|---|---|
| `--formats` | all six | e.g. `--formats whole,udiff` |
| `--tasks` | all | id substrings or a language: `--tasks rust,ts-long` |
| `--num-ctx` | 32768 | sent explicitly as `options.num_ctx`; results that fill the window are flagged |
| `--seed` | 42 | temperature is always 0 |
| `--retries` | 1 | repair rounds after a failed apply |
| `--repeats` | 1 | run every task N times; use 3 or more for numbers you publish (see below) |
| `--endpoint` | `http://localhost:11434` | non-loopback endpoints are refused unless `--allow-remote` |
| `--cache` | `.cache/results.jsonl` | finished results are reused, so an interrupted run resumes |
| `--host-label` | the hostname | goes into the report file name; set it if your hostname is personal |

The model is warmed up with the same `num_ctx` before the first timed task, so load time doesn't count.
If no Ollama answers, or a model isn't pulled, the runner says so and exits without writing anything.

**Repeats.** Even at temperature 0 with a fixed seed, Ollama doesn't always give the same answer twice:
in two runs of `qwen2.5-coder:1.5b` on the same machine, 9 of 44 SEARCH/REPLACE answers differed and the
pass rate moved from 40.9% to 31.8%. A single run is one sample, so for anything you publish, run at
least three times:

```bash
npx tsx src/cli.ts run --models qwen2.5-coder:7b --formats search-replace,whole --repeats 3 --host-label my-laptop
```

Rates are then pooled over all repeats, and the report adds a *Run-to-run variation* section with each
repeat's pass rate, the range, and how many tasks passed every time, some of the time, or never. Report
the range. Repeat 0 uses the same cache key as a single run, so adding `--repeats 3` to an earlier run
only runs the two extra repeats.

**Run sessions separately for published numbers.** Repeats inside one run understate the variation. On the
same laptop, three back-to-back repeats of `qwen2.5-coder:1.5b` scored 31.8%, 31.8% and 34.1% (one task
flipped), while a run the day before scored 40.9%. What differs between sessions isn't recorded, but how
much of the model and its context Ollama places on the GPU versus the CPU is a likely cause. So:

1. Run each session from a fresh Ollama: quit it (including the tray app), start it again, then run the
   bench. Keep other GPU work off the machine.
2. Give each session its own cache and label, so its results stay separate:

   ```bash
   npx tsx src/cli.ts run --models qwen2.5-coder:7b --formats search-replace --repeats 3 \
     --cache .cache/session-1.jsonl --host-label my-laptop-session-1
   ```

3. Do at least two sessions, ideally on different days, and publish each session's pass rate together
   with the range across sessions, not one pooled number.

**Dry run** (no model, used by the tests and CI): `npx tsx src/cli.ts run --dry-run` uses a stub that
returns the ideal edit, and `--dry-run=garbage` uses one that returns nonsense. Reports go to
`.cache/dry-run/` and are labelled as dry runs.

**Tests**: `npm test` (vitest) covers the task loader, the unified-diff applier, the format appliers,
report generation from a fixture, the loopback guard, and the dry-run pipeline.

## Submitting results

1. Run on a clean checkout. The bench's git SHA is recorded, with `-dirty` if `tools/local-edit-bench`
   has local changes.
2. Commit the three files from `results/` (`.md`, `.json`, `.raw.jsonl`) and open a pull request. Don't
   edit them by hand. The report can be regenerated from the raw file, and reviewers may do that.
3. Say in the PR anything the provenance table can't capture: other load on the machine, a non-default
   Ollama setting (`OLLAMA_FLASH_ATTENTION`, `OLLAMA_KV_CACHE_TYPE`, …), or laptop power mode.

Results are only comparable when they share a corpus hash and prompt version. Both are printed in every
report.

## Limitations

- **Small corpus.** A few dozen tasks: a difference of one or two tasks is noise. Rates are always
  shown with their counts.
- **Temperature 0, one sample per repeat.** This measures each model's greedy answer, not a
  distribution. Ollama isn't bit-for-bit deterministic even with a fixed seed, so single runs can differ
  by several tasks (see *Repeats* above). Use `--repeats` and report the range.
- **Vendor quantizations.** A tag scores as the quantization it ships with (recorded per result). The
  same weights at another quantization can score differently.
- **Fixed prompts.** Prompts aren't tuned per model; a model with a strong preference for one format
  may be under-served by another.
- **Go is checked by comparison, not by running code.** An equivalent but differently written Go edit
  fails. The Go instructions are written so that this is unlikely, but it is not impossible.
- **Timings are this machine's.** They depend on GPU/CPU, drivers, Ollama version, context size and
  background load. Compare latency only within one report.
