# Dirty Talk Foreplay Styling

## Summary

- Updated Dirty Talk (`web/jsdirtybirds_prompt.js`) to match the DirtyBirds Foreplay width, section-label, compact-control, and seed-row styling patterns.
- Added shared stylesheet rules in `web/css/style.css` for Foreplay-like prompt textareas and prompt control wrappers.
- Confirmed the live install path is `C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI\custom_nodes\DirtyBirds-Playhouse`, a symbolic link to this workspace.

## Verification

- Ran `node --check web/jsdirtybirds_prompt.js`.
- Reloaded ComfyUI at `http://127.0.0.1:8188/`.
- Added `Dirty Talk — The Script` in the live UI and confirmed the title bar, section labels, textareas, seed row, and Toybox buttons render in the shared DirtyBirds/Foreplay style without clipping.
- Checked browser logs for DirtyBirds-specific errors; none were present.
