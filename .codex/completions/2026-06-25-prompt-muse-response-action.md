# Prompt Muse Response Action

## Summary
- Removed Prompt Muse positive and negative output sockets.
- Kept Prompt Muse executable by marking it as an output node.
- Added backend UI payload `db_muse_response` with parsed positive/negative response text.
- Added LM Response display and Send to Dirty Talk button in the Prompt Muse UI.
- Added frontend cleanup for stale saved-node `image` input and old positive/negative outputs.

## Verification
- Ran `python -m py_compile nodes/muse/__init__.py`.
- Ran `node --check web/jsdirtybirds_muse.js`.
- Verified live `/object_info/DirtyBirdsMuse` has no outputs and no image input.
- Verified live ComfyUI node shows LM Response and Send to Dirty Talk, with no positive/negative sockets or image input.
- Stopped the ComfyUI verification process and confirmed port 8188 was clear.
