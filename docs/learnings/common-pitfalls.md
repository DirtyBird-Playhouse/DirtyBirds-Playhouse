# Common Pitfalls (anti-patterns)

Stack-specific anti-patterns for a ComfyUI Python + JS node suite. For the
incident-style critical list, see `.claude/COMMON_MISTAKES.md`; this file is the
"don't write it this way" reference.

## Python backend

- Assuming batch size 1. IMAGE is `[B, H, W, C]`; loop or vectorize over B.
- Hardcoding `.cuda()` / device. Use the input tensor's device.
- Returning a bare value instead of a tuple from FUNCTION. Nodes must return a
  tuple matching RETURN_TYPES, e.g. `return (image,)`.
- Wrong tensor range/dtype. IMAGE is float32 in 0-1, not uint8 0-255.
- Renaming INPUT_TYPES keys or RETURN_NAMES. Breaks saved workflows.
- Heavy work at import time. Modules are imported on ComfyUI start; do expensive
  loads inside the node method or lazily.
- SAM3 importing a venv `sam` package. Keep it self-contained.

## JS web extensions

- Using `window.prompt()`/`alert()`/`confirm()`. Blocked on ComfyUI desktop.
- Re-implementing the token palette or widget classes instead of using
  `web/db_shared.js`.
- DOM widgets that ignore width-sync/clip, so they overflow or get cut off.
- Patching the wrong node: always guard `if (nodeData.name !== "DB_...") return;`.
- Editing JS and not refreshing the browser after the ComfyUI reload.

## Process

- Editing the dev copy, not the live install (junction).
- Reporting done from static inspection instead of a live screenshot.
- Touching `master.yaml` or `user_files/` - hard banned.
