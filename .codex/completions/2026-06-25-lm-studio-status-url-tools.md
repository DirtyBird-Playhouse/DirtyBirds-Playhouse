# LM Studio Status URL Tools

## Summary
- Removed the Dirty Talk URL Tools model picker UI.
- Added inline LM Studio status text that reports ready/offline from the local LM Studio endpoint.
- Updated Booru and Caption buttons to use the same DirtyBirds button styling as the surrounding controls.
- Let URL captioning resolve the served LM Studio model from `/models` when no model is provided by the UI.

## Verification
- Confirmed live ComfyUI install path is `C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI\custom_nodes\DirtyBirds-Playhouse`, a symlink to this workspace.
- Ran `node --check web/jsdirtybirds_prompt.js`.
- Ran `node --check web/jsdirtybirds_saveprompt.js`.
- Ran `python -m py_compile nodes/booru/__init__.py`.
- Restarted ComfyUI from `C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI`.
- Refreshed the live ComfyUI UI after restart and verified the open Dirty Talk URL Tools panel shows `LM Studio: ready`, only `Booru` and `Caption` action buttons, and no model selector.
