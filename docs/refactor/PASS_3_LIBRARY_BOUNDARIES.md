# Pass 3 — loader library boundaries

Completed: 2026-09-01

## Refactor boundary

`library_backend.py` remains the route and metadata-orchestration facade. This
pass extracts two responsibilities that have independent failure modes and no
dependency on ComfyUI node schemas:

- `library_store.py`: best-effort JSON settings/cache persistence;
- `civitai_client.py`: hashing, lookup, URL parsing, model-page URLs, preview
  downloads, model download resolution, and streamed downloads.

Metadata precedence, LoRA Manager lookup, local sidecars, preview selection,
folder-path access, bulk behavior, and HTTP routes remain in the facade.

## Changes

| Current behavior | Structural improvement | Validation |
| --- | --- | --- |
| Settings and metadata cache repeated tolerant JSON load/save blocks | Use two configured `JsonStore` instances while retaining `_load_settings`, `_save_settings`, `_load_cache`, and `_save_cache` facades | Missing, invalid, UTF-8 round-trip, indentation, and non-fatal save tests |
| Hashing and Civitai transport were interleaved with metadata merging and routes | Move transport to `civitai_client.py`; re-export the former private helper names from `library_backend.py` | Hash, URL parsing, model URL, primary-file selection, auth/request, and Pass 0 route tests |
| Download resolution selected a primary file, then first file, and synthesized URL/name fallbacks | Preserve that selection order in the client module | Mocked version response tests |
| Civitai direct-download URLs matched both `/models/` regexes | Preserve the existing `(model_id, version_id)` overlap rather than silently changing parsing | Parameterized URL-shape characterization |

## Stable surfaces

- `resolve_lora_filename`, `get_lora_meta`, and `get_embedding_meta` remain in
  `library_backend.py`.
- All `/dirtybirds/*` route methods and paths remain unchanged.
- Cache version, filenames, JSON formats, preview locations, timeouts, user
  agent, token headers, and error/fallback behavior remain unchanged.
- The facade retains its former underscore-prefixed helper names for internal
  callers and tests.
- No cache, settings, preview, model, or untracked generated files were deleted.

## Deferred boundary

Local metadata normalization and preview resolution remain coupled to the
metadata precedence algorithm. Splitting those safely needs fixture-backed
examples for sidecar-versus-header-versus-LoRA-Manager-versus-Civitai priority;
that work should be a later focused pass rather than folded into transport
extraction.

## Validation commands

```powershell
ruff check nodes/loader tests/test_library_backend_boundaries.py --select F401,F841,F811,F821
python -m pytest -q tests/test_library_backend_boundaries.py tests/test_refactor_baseline.py tests/test_prompt_builder_ui_contract.py
python -m pytest -q
```
