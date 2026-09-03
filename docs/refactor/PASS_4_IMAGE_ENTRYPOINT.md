# Pass 4 — thin Image Loader entrypoint

Completed: 2026-09-01

## Refactor boundary

The Image Loader entry module now owns its ComfyUI schema, orchestration,
caption-provider selection, change detection, validation, and node registration.
`image/processing.py` owns source loading, bounded remote reads, social-preview
resolution, latent-safe resizing, sharpening, and PIL-to-tensor conversion.

## Changes

| Current behavior | Structural improvement | Validation |
| --- | --- | --- |
| URL, webpage, local-path, input-picker, resize, sharpen, and tensor helpers lived above the node class | Move them to a dependency-light processing module | Existing direct URL, OG-image, resize, alpha-mask, sharpening, and image tensor tests |
| The node called underscore-prefixed helpers from its own module | Re-export only the four helpers used by node orchestration/tests, keeping call sites and monkeypatch seams stable | Image Loader focused suite |
| Captioning, SAM3, image processing, schema, and orchestration shared one entry file | Leave captioning and SAM3 in their existing modules and give image processing its own boundary | Pass 0 node schema snapshot and registration source checks |

## Stable surfaces

- `DirtyBirdsLoadImage` registration, display name, ordered inputs, ordered
  outputs, `FUNCTION`, and category are unchanged.
- Source precedence remains URL/local override, input-directory name, then
  annotated upload-picker path.
- Remote timeout, 50 MB limit, headers, OG/Twitter metadata handling, and URL
  joining are unchanged.
- Resize rounding, no-upscale default, sharpening parameters, alpha handling,
  animated-frame filtering, IMAGE layout, and MASK semantics are unchanged.
- Captioning defaults, sidecars, caching, providers, and unload behavior are
  outside this extraction.

## Validation commands

```powershell
ruff check nodes/image tests/test_image_loader.py --select F401,F841,F811,F821
python -m pytest -q tests/test_image_loader.py tests/test_refactor_baseline.py tests/test_prompt_builder_ui_contract.py
python -m pytest -q
```
