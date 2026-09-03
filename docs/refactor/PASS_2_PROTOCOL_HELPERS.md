# Pass 2 — OpenAI-compatible protocol helpers

Completed: 2026-09-01

## Refactor boundary

This pass centralizes wire-format mechanics shared by Prompt Enhance, Booru
vision captioning, and Image Loader captioning. It does not unify provider
policy: endpoints, prompts, model defaults, authentication requirements,
throttling, retries, caching, and user-facing error messages remain owned by
their existing modules.

## Changes

| Current behavior | Structural improvement | Validation |
| --- | --- | --- |
| Prompt Enhance and Booru independently removed `<think>` blocks and Markdown fences with identical code | Move completion cleanup to `nodes/_openai_compat.py`; retain `_clean_completion` module facades | Table-driven cleanup tests and existing integration source contracts |
| Booru and Image Loader independently decoded string and multipart message content with slightly different policies | Share the decoder with explicit `reasoning_fallback` and `strip` options that preserve each caller's behavior | String, multipart, whitespace, and opt-in reasoning tests |
| Prompt Enhance and Booru independently queried `/models`, filtered records, and selected the first ID | Share ordered model listing and first-model resolution while callers retain their default endpoint and error text | Mocked request URL, authorization, timeout, filtering, ordering, and empty-list tests |
| Prompt Enhance's model-list route repeated the same discovery request | Delegate the route to the shared model-list function without changing its JSON response | Pass 0 route snapshot and focused UI tests |

## Stable surfaces

- Node registration, input/output order, return types, and display names are
  unchanged.
- All HTTP routes and server/browser events are unchanged.
- Prompt Enhance still uses its existing endpoint and LM Studio error wording.
- Booru still falls back to `reasoning_content`; Image Loader still does not.
- NVIDIA/OpenAI-host retry, caching, throttling, and optional-key behavior are
  unchanged.
- Local JoyCaption loading and unloading are outside this helper.

## Validation commands

```powershell
ruff check nodes tests/test_openai_compat.py --select F401,F841,F811,F821
python -m pytest -q tests/test_openai_compat.py tests/test_refactor_baseline.py tests/test_image_loader.py tests/test_prompt_builder_ui_contract.py
python -m pytest -q
```

The pre-existing Prompt Enhance source assertion expects
`http://127.0.0.1:1234/v1`, while the current implementation contains
`http://localhost:1234/v1`. This pass preserves the implementation rather than
mixing an endpoint behavior change into protocol extraction.
