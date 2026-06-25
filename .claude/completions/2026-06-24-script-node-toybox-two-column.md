# Script Node Toybox Two Column Layout

## Summary

- Updated Dirty Talk / Script Toybox so the first row mirrors Setup-style left/right columns.
- Left column is `Load Prompt`; right column is `Wildcards`.
- Kept `Booru Tags` as a separate full-width row below the two-column controls.
- Added Script-specific Toybox CSS so the compact row does not inherit oversized Talent-column padding.

## Verification

- Ran `node --check web\jsdirtybirds_prompt.js`.
- Restarted ComfyUI because the existing browser session had cached the old JS module.
- Confirmed the live server served the updated JS and CSS.
- Reloaded `http://127.0.0.1:8188/` and verified in the live UI with a screenshot.
- Confirmed DOM metrics: left and right buttons fit their columns without overflow.
