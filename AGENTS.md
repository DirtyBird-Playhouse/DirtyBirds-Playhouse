# DirtyBirds Playhouse — Codex Project Instructions

## Shared UI architecture

All DirtyBirds nodes must use the centralized UI system in `web/db_shared.js` and the shared theme in `web/css/style.css`.

- Do not create buttons, text areas, inputs, or selectors directly in individual node modules.
- Use the shared component constructors, sizing controller, design tokens, two-column layout, and common node width.
- Keep node-specific UI code limited to content and behavior.
- Do not introduce local fonts, colors, control dimensions, or competing resize logic.
- Preserve the regression test that rejects direct form-control construction in node modules.
- Treat `C:\Users\mpick\My_AI_Tools\Projects\DirtyBirds-Playhouse` as the source workspace. The live ComfyUI custom-node folder is a symbolic link to it, so edits belong only in this source workspace.

## Error log

### E-002 — Face-restore blend used tensors on different devices

- Date: 2026-09-03
- Error: The Finish node blended the original CPU image with a CodeFormer result on `cuda:0`, causing `torch.lerp` to raise a device-mismatch RuntimeError.
- Cause: The face-detail blend assumed `FaceRestoreManager.restore()` returned a tensor on the input image's device, but the manager returns its result on ComfyUI's model device.
- Correction: Move the original blend source to the restored tensor's device and dtype before calling `torch.lerp`, and cover placement normalization with a regression test.
- Prevention rule: Before combining tensors returned by model-backed helpers with caller-owned tensors, explicitly normalize device and dtype and test that boundary.
