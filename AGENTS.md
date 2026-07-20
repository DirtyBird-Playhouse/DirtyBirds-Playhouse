# DirtyBirds Playhouse — Codex Project Instructions

## Shared UI architecture

All DirtyBirds nodes must use the centralized UI system in `web/db_shared.js` and the shared theme in `web/css/style.css`.

- Do not create buttons, text areas, inputs, or selectors directly in individual node modules.
- Use the shared component constructors, sizing controller, design tokens, two-column layout, and common node width.
- Keep node-specific UI code limited to content and behavior.
- Do not introduce local fonts, colors, control dimensions, or competing resize logic.
- Preserve the regression test that rejects direct form-control construction in node modules.
- Treat `C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse` as the source workspace. The live ComfyUI custom-node folder is a symbolic link to it, so edits belong only in this source workspace.
