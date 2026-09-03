# DirtyBirds Playhouse — Codex Project Instructions

## Shared UI architecture

All DirtyBirds nodes must use the centralized UI system in `web/db_shared.js` and the shared theme in `web/css/style.css`.

- Do not create buttons, text areas, inputs, or selectors directly in individual node modules.
- Use the shared component constructors, sizing controller, design tokens, two-column layout, and common node width.
- Keep node-specific UI code limited to content and behavior.
- Do not introduce local fonts, colors, control dimensions, or competing resize logic.
- Preserve the regression test that rejects direct form-control construction in node modules.
- Treat `C:\Users\mpick\My_AI_Tools\Projects\DirtyBirds-Playhouse` as the source workspace. The live ComfyUI custom-node folder is a symbolic link to it, so edits belong only in this source workspace.

## Sampler batch integrity

- Cycler entries may resolve random Loader dimensions independently. Before the Sampler creates one picker/output batch, collate mixed BCHW latents and BHWC images with `nodes/sampler/batch_collation.py`; preserve content by center-padding rather than resizing.
- Keep `tests/test_sampler_mixed_dimensions.py` as the focused platform for mixed-resolution regressions, including the reported 144-versus-176 latent-width case.

## Image captioning

- Image Loader owns NVIDIA vision captioning; Prompt Builder must remain free of image-caption controls.
- Captioning is off by default. Single mode captions the loaded image; batch-folder mode captions supported images case-insensitively, writes adjacent UTF-8 `.txt` sidecars, may skip existing sidecars, and uses the first folder image as the loader output when no separate source is selected.
- Keep caption backends in `nodes/image/captioning.py`. Local JoyCaption Beta One is the default and downloads through Transformers on first use; default to 4-bit loading and unload after the run to fit the 16 GB GPU and return VRAM to ComfyUI. Also support NVIDIA's hosted endpoint and user-configured OpenAI-compatible vision hosts; host API keys are optional for local servers. Use `NVIDIA_API_KEY` when the NVIDIA password field is empty, preserve content caching and remote request throttling, and keep `caption` plus `all_captions` as additive outputs after `image` and `mask`.
- The complete JoyCaption Beta One snapshot `ebf414ea497a020da0f82df3913e5b6cb8e9663a` is present in the shared Hugging Face cache; all 17 files were checksum-verified. The ComfyUI venv has `bitsandbytes` 0.50.2, and real 4-bit local inference was verified on this machine.

## Error log

### E-002 — Face-restore blend used tensors on different devices

- Date: 2026-09-03
- Error: The Finish node blended the original CPU image with a CodeFormer result on `cuda:0`, causing `torch.lerp` to raise a device-mismatch RuntimeError.
- Cause: The face-detail blend assumed `FaceRestoreManager.restore()` returned a tensor on the input image's device, but the manager returns its result on ComfyUI's model device.
- Correction: Move the original blend source to the restored tensor's device and dtype before calling `torch.lerp`, and cover placement normalization with a regression test.
- Prevention rule: Before combining tensors returned by model-backed helpers with caller-owned tensors, explicitly normalize device and dtype and test that boundary.
