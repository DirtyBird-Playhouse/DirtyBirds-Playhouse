# Prompt Muse Writer

## Summary
- Converted Muse from image-captioning to text-only prompt writing.
- Removed image, endpoint, system prompt, style, and model controls from the node contract/UI.
- Renamed the display name to `Prompt Muse - The Writer`.
- Added a Setup-style left/right panel with LM Studio prompt selection, LM Studio status, temperature, max token control, and request text.
- Added `user-files` symbolic link to `C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse_User`.
- Added `/dirtybirds/muse-prompts` for prompt files under `user-files/LM Studio`.

## Verification
- Confirmed live install path is the symlinked DirtyBirds workspace.
- Ran `python -m py_compile nodes/muse/__init__.py`.
- Ran `node --check web/jsdirtybirds_muse.js`.
- Started one clean ComfyUI instance and verified `object_info/DirtyBirdsMuse` has no image, endpoint, system, style, or model inputs.
- Verified the live ComfyUI node renders the new split UI, shows `LM Studio: ready`, and opens the `LM Studio Prompts` flyout.
- Stopped the ComfyUI verification process afterward and confirmed port 8188 was clear.
