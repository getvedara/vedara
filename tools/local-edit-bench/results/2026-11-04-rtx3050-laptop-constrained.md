# Local Edit Bench — rtx3050-laptop-constrained — 2026-11-04

> **Note:** Results were collected by runs with different hardware or Ollama versions; see the provenance table.

## Results by model × edit format

| Model | Quant | Format | Tasks | Applied (1st try) | Applied (≤ retries) | Check passed | Median prompt tok | Median completion tok | Median wall time | Median TTFT |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| qwen2.5-coder:1.5b | Q4_K_M | anchored-json | 44 | 92.4% (122/132) | 92.4% (122/132) | 6.8% (9/132) | 671 | 83 | 1.90 s | 0.54 s |
| qwen2.5-coder:1.5b | Q4_K_M | search-replace | 44 | 79.5% (105/132) | 79.5% (105/132) | 32.6% (43/132) | 475 | 196 | 4.42 s | 0.57 s |
| qwen2.5-coder:1.5b | Q4_K_M | search-replace-json | 44 | 59.8% (79/132) | 59.8% (79/132) | 9.1% (12/132) | 509 | 116 | 2.32 s | 0.51 s |

## Long files (≥ 300 lines, near-duplicate code)

| Model | Format | Tasks | Applied | Check passed |
|---|---|---:|---:|---:|
| qwen2.5-coder:1.5b | anchored-json | 7 | 95.2% (20/21) | 0.0% (0/21) |
| qwen2.5-coder:1.5b | search-replace | 7 | 71.4% (15/21) | 57.1% (12/21) |
| qwen2.5-coder:1.5b | search-replace-json | 7 | 38.1% (8/21) | 0.0% (0/21) |

## Check pass rate by language

| Model | Format | TypeScript | Python | Rust | Go |
|---|---|---:|---:|---:|---:|
| qwen2.5-coder:1.5b | anchored-json | 7.1% (3/42) | 7.1% (3/42) | 0.0% (0/24) | 12.5% (3/24) |
| qwen2.5-coder:1.5b | search-replace | 28.6% (12/42) | 23.8% (10/42) | 37.5% (9/24) | 50.0% (12/24) |
| qwen2.5-coder:1.5b | search-replace-json | 7.1% (3/42) | 14.3% (6/42) | 0.0% (0/24) | 12.5% (3/24) |

## Run-to-run variation

Each task was run several times with identical settings. Rates above are pooled over all repeats.

| Model | Format | Repeats | Check passed per repeat | Range | Tasks passed every time / sometimes / never |
|---|---|---:|---|---:|---:|
| qwen2.5-coder:1.5b | anchored-json | 3 | 6.8%, 6.8%, 6.8% | 6.8–6.8% | 3 / 0 / 41 |
| qwen2.5-coder:1.5b | search-replace | 3 | 31.8%, 31.8%, 34.1% | 31.8–34.1% | 14 / 1 / 29 |
| qwen2.5-coder:1.5b | search-replace-json | 3 | 9.1%, 9.1%, 9.1% | 9.1–9.1% | 4 / 0 / 40 |

Results where prompt + output filled the context window (possible truncation): 1.

## Setup

### Run `2026-10-22T05-57-37-468Z-3c2c16`

| | |
|---|---|
| Started | 2026-10-22T05:57:37.469Z |
| Host label | rtx3050-laptop-advisory-hints |
| OS | Windows 11 Pro (Windows_NT 10.0.26300) |
| Arch | x64 |
| CPU | 13th Gen Intel(R) Core(TM) i7-1355U (12 logical cores) |
| RAM | 15.7 GiB |
| GPU | NVIDIA GeForce RTX 3050 4GB Laptop GPU (4096 MiB, driver 592.82) |
| Ollama | 0.30.11 |
| Endpoint | loopback |
| Models | qwen2.5-coder:1.5b (1.5B, Q4_K_M, digest d7372fd82851) |
| Formats | search-replace, search-replace-hinted |
| Tasks | 44 |
| Corpus hash | ae51188b8514b80e |
| Sampling | temperature 0, seed 42, num_ctx 32768, max retries 1, repeats 1 |
| Prompt version | 1 |
| Bench | v0.1.0 @ 2c88b869821e4ccd561775dfc6ca80524a458185 |
| Node | v20.20.0 |

### Run `2026-10-22T08-07-48-062Z-236ebb`

| | |
|---|---|
| Started | 2026-10-22T08:07:48.063Z |
| Host label | rtx3050-laptop-repeats |
| OS | Windows 11 Pro (Windows_NT 10.0.26300) |
| Arch | x64 |
| CPU | 13th Gen Intel(R) Core(TM) i7-1355U (12 logical cores) |
| RAM | 15.7 GiB |
| GPU | NVIDIA GeForce RTX 3050 4GB Laptop GPU (4096 MiB, driver 592.82) |
| Ollama | 0.30.11 |
| Endpoint | loopback |
| Models | qwen2.5-coder:1.5b (1.5B, Q4_K_M, digest d7372fd82851) |
| Formats | search-replace |
| Tasks | 44 |
| Corpus hash | ae51188b8514b80e |
| Sampling | temperature 0, seed 42, num_ctx 32768, max retries 1, repeats 3 |
| Prompt version | 1 |
| Bench | v0.1.0 @ 29cc975655142e45ce084f4c31a1dd1be6248d8a |
| Node | v20.20.0 |

### Run `2026-11-04T16-53-14-504Z-d54555`

| | |
|---|---|
| Started | 2026-11-04T16:53:14.505Z |
| Host label | rtx3050-laptop-constrained |
| OS | Windows 11 Pro (Windows_NT 10.0.26300) |
| Arch | x64 |
| CPU | 13th Gen Intel(R) Core(TM) i7-1355U (12 logical cores) |
| RAM | 15.7 GiB |
| GPU | NVIDIA GeForce RTX 3050 4GB Laptop GPU (4096 MiB, driver 610.91) |
| Ollama | 0.30.11 |
| Endpoint | loopback |
| Models | qwen2.5-coder:1.5b (1.5B, Q4_K_M, digest d7372fd82851) |
| Formats | search-replace, search-replace-json, anchored-json |
| Tasks | 44 |
| Corpus hash | ae51188b8514b80e |
| Sampling | temperature 0, seed 42, num_ctx 32768, max retries 1, repeats 3 |
| Prompt version | 1 |
| Bench | v0.1.0 @ d66ee481840d4105c337bcf2dd7894598180c295-dirty |
| Node | v20.20.0 |

## Methodology

- Each task is a small, self-contained edit (rename, bug fix, added parameter, multi-hunk refactor, feature, two-file change) on original files written for this benchmark. 7 of the 44 tasks have ≥ 300 lines (longest: 1575) with near-duplicate code to stress anchoring.
- The model receives the instruction and the full file(s) in a single `/api/chat` request with `temperature` 0, a fixed `seed` and an explicit `num_ctx`, and must answer in one edit format:
  - `whole`: the complete new file in a fenced block.
  - `search-replace`: SEARCH/REPLACE blocks under a `FILE:` header, parsed and applied by Vedara's shared diff engine, the same code the VS Code extension runs (exact, then whitespace-insensitive matching, then restoring leading keywords such as `export` that the model left off the first SEARCH line; a line hint only breaks ties between duplicate matches).
  - `search-replace-hinted`: as above, but the file is shown with a line-number gutter and blocks carry a `(line N)` hint.
  - `udiff`: a unified diff, applied by a minimal applier that ignores hunk counts, locates hunks by exact context match (closest to the stated line when ambiguous; trailing-whitespace-insensitive fallback) and applies no fuzz.
- With `--repeats N`, every task is run N times with identical settings; rates are pooled over repeats and the run-to-run variation section shows each repeat and how many tasks passed every time, some of the time, or never.
- **Applied** means the response parsed and every hunk/file applied cleanly. If it did not, the applier error is sent back and the model may retry (at most the configured number of retries); "1st try" counts only the first response.
- **Check passed** means the edited files pass the task's automated check: a test program (TypeScript via tsx, Python, Rust via `rustc --test`) or, for Go tasks, a whitespace- and comment-insensitive token comparison with the reference solution. Failed applications count as failed checks. Checks whose toolchain is missing are reported as skipped and excluded from the denominator.
- Tokens are Ollama's `prompt_eval_count`/`eval_count`, summed over attempts. Wall time is client-side from request to final chunk, summed over attempts. TTFT is client-side time to the first non-empty streamed chunk of the first attempt. The model is warmed up with the same `num_ctx` before the first timed task.
- Per-task records (applier errors, check output) are in the JSON file next to this report; the `.raw.jsonl` file also holds every raw model response.

## Limitations

- Small corpus: differences of a few tasks are within noise. Report rates with their counts.
- Temperature 0 measures one greedy sample per task, not a distribution, yet Ollama is not always bit-for-bit deterministic even with a seed: the same task can pass in one run and fail in the next. Use `--repeats` and report the range, not a single run.
- Quantization is whatever the pulled tag ships (shown above); the same model at another quantization can score differently.
- Prompts are fixed per format and not tuned per model. Timings depend on this machine, its load, and Ollama settings.
