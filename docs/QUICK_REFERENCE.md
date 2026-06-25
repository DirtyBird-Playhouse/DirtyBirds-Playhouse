# Quick Reference

Fast lookups for the DirtyBirds-Playhouse ComfyUI node suite. For navigation see
`docs/INDEX.md`; for the dev loop see `.codex/QUICK_START.md`.

---

## Session start checklist

1. `.codex/COMMON_MISTAKES.md` (read first)
2. `.codex/QUICK_START.md`
3. `.codex/ARCHITECTURE_MAP.md`
4. Task topic from `docs/INDEX.md`

## Tensor / data contracts

| Type | Shape / form |
|------|--------------|
| IMAGE | `torch.Tensor [B, H, W, C]`, float32, 0-1 |
| MASK | `torch.Tensor [B, H, W]` |
| LATENT | `{"samples": tensor}` |
| CONDITIONING | list of `[tensor, dict]` pairs |

Respect the batch dim; never assume B=1. Honor the input device; don't hardcode
`.cuda()`.

## Node class essentials

```python
@classmethod
def INPUT_TYPES(cls): ...        # {"required": {...}, "optional": {...}}
RETURN_TYPES = (...)             # tuple
RETURN_NAMES = (...)             # optional
FUNCTION = "run"
CATEGORY = "DirtyBirds/..."
```
Export `NODE_CLASS_MAPPINGS` + `NODE_DISPLAY_NAME_MAPPINGS`; merged in `__init__.py`.

## Web extension essentials

```js
import { app } from "../../scripts/app.js";
app.registerExtension({ name, beforeRegisterNodeDef(nodeType, nodeData, app){...} });
```
Shared helpers/palette: `web/db_shared.js`. No `window.prompt()`/`alert()` -
inline DOM + status text.

## Debugging quick tips

- Change has no effect? You edited the dev copy, not the live install (junction).
- JS not updating? Reload ComfyUI, then refresh the browser.
- Workflow won't load? An INPUT/RETURN name was renamed.
- Context overflow on vision? Image resolution too high - fix in LM Studio UI.

## File locations

| Need | Where |
|------|-------|
| Registration / entry | `__init__.py` |
| Node backend | `dirtybirds_<module>.py` |
| Per-node UI | `web/jsdirtybirds_<module>.js` |
| Shared JS | `web/db_shared.js`, `web/jsdirtybirds.js` |
| Wildcard engine | `dirtybirds_wildcard_engine.py` |
| SAM3 model | `My_AI_Tools\models\sam3\sam3.pt` |

## Off-limits

Never read, list, grep, or reference `master.yaml` or `user_files/` (or its
junction target).

---

**Last Updated**: 2026-06-22
