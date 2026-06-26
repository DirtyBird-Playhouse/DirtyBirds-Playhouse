# Dirty Talk Two Column Layout

## Summary
- Converted Dirty Talk Toybox controls to a left/right split layout.
- Left column contains seed, Load Prompt, and Wildcards.
- Right column contains Image URL Tools, LM status, Booru, Load Image, and Caption.
- Kept Dirty Talk backend inputs/outputs unchanged.

## Verification
- `node --check web/jsdirtybirds_prompt.js` passed.
- Live ComfyUI browser reload confirmed the two-column layout.
- Expanded Image URL Tools live and confirmed the controls remain bounded.
