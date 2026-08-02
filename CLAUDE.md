# DirtyBirds Playhouse — Claude Project Instructions

This is the **source workspace** for the DirtyBirds-Playhouse ComfyUI custom-node package.

## Working with Michael

- Not a coder. Plain language, one recommendation, no tracebacks/jargon.

## Setup / test

```
pip install -r requirements.txt
python -m pytest -q
```

Launch ComfyUI with this node via `Start_ComfyUI.bat`. Smoke-test via the run-dirtybirds-playhouse skill.

## Layout

- `nodes\` — node implementations · `web\` — UI (see rule below) · `tests\` + `pytest.ini`
- `user-files\` — bundled wildcards/styles · `__init__.py` — node registration

## Shared UI architecture

All DirtyBirds nodes must use the centralized UI system in `web/db_shared.js` and the shared theme in `web/css/style.css`.

- Do not create buttons, text areas, inputs, or selectors directly in individual node modules.
- Use the shared component constructors, sizing controller, design tokens, two-column layout, and common node width.
- Keep node-specific UI code limited to content and behavior.
- Do not introduce local fonts, colors, control dimensions, or competing resize logic.
- Preserve the regression test that rejects direct form-control construction in node modules.
- Treat `C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse` as the source workspace. The live ComfyUI custom-node folder is a symbolic link to it, so edits belong only in this source workspace.
