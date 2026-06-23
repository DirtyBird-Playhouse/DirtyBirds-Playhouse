# Quick Start Commands

ComfyUI custom-node suite. No build step for Python; JS is served directly from
`web/` (WEB_DIRECTORY in `__init__.py`).

---

## Develop / test loop

1. Edit the node in the LIVE install dir (the one ComfyUI loads from - see
   `.claude/COMMON_MISTAKES.md` #1).
2. Restart or reload ComfyUI so it re-imports Python and re-serves `web/`.
3. Exercise the node in the browser UI and confirm with a screenshot.

No bundler: `web/*.js` are plain ES modules registered via
`app.registerExtension(...)`. Refresh the browser to pick up JS changes after a
ComfyUI reload.

## Useful commands

```bash
# Find which node a display name maps to
grep -n "DISPLAY_NAME" __init__.py dirtybirds_*.py

# List all registered classes
grep -n "NODE_CLASS_MAPPINGS" dirtybirds_*.py

# Wildcard engine test run: see memory [[wildcard-engine-variables]]
```

## Verification

- Use the `verify-node` skill to prove a change works in the live app.
- Never report a fix as done from server-side or static inspection alone.

## Dependencies

- Python deps: `requirements.txt`
- Local LLM: LM Studio (OpenAI-compatible endpoint), not llama.cpp CLI.
- SAM3 model: `My_AI_Tools\models\sam3\sam3.pt`

---

**Last Updated**: 2026-06-22
