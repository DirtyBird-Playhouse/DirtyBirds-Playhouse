# Quick Start Commands

ComfyUI custom-node suite. No build step for Python; JavaScript is served
directly from `web/` through `WEB_DIRECTORY` in `__init__.py`.

---

## Develop / test loop

1. Confirm the live ComfyUI install path before editing.
2. Edit the node files in the directory ComfyUI actually loads.
3. Restart or reload ComfyUI so Python and `web/` extension files refresh.
4. Exercise the node in the browser UI and confirm with a screenshot.

For this workspace, the live install is usually:

```text
C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI\custom_nodes\DirtyBirds-Playhouse
```

Verify whether that path is a symlink/junction to this workspace before
declaring a UI change complete.

## Useful commands

```bash
# Find which node a display name maps to
rg "DISPLAY_NAME" __init__.py dirtybirds_*.py nodes

# List all registered classes
rg "NODE_CLASS_MAPPINGS" __init__.py dirtybirds_*.py nodes

# Check JS syntax after web extension edits
node --check web/jsdirtybirds_prompt.js
```

## Verification

- Use the `verify-node` skill after Python or `web/*.js` node changes.
- Never report a fix as done from server-side or static inspection alone.
- Reload or restart ComfyUI, then verify in the live browser with screenshot
  evidence.

## Dependencies

- Python deps: `requirements.txt`
- Local LLM: LM Studio OpenAI-compatible endpoint, not llama.cpp CLI.
- Shared JS helpers and palette: `web/db_shared.js`

---

**Last Updated**: 2026-06-24
