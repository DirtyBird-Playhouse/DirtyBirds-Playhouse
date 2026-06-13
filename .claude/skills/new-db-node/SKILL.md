---
name: new-db-node
description: Scaffold a new DirtyBirds ComfyUI node following the suite's conventions (Python class + __init__ registration + themed JS web extension). Use when the user wants to add/create a new DirtyBirds node.
disable-model-invocation: true
---

# Scaffold a new DirtyBirds node

Create a new node that matches the existing suite. Ask the user for: node key (e.g.
`DirtyBirdsThing`), display name (e.g. "🍑 DirtyBirds Thing — The Tagline"), and a one-line purpose.

## 1. Python — `dirtybirds_<name>.py`
- Define a class with `INPUT_TYPES`, `RETURN_TYPES`/`RETURN_NAMES`, `FUNCTION`, `CATEGORY = "DirtyBirds"`.
- If it needs web API routes, register them with `@PromptServer.instance.routes.get/post("/dirtybirds/...")`.
- End the file with `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`.
- Mirror an existing node (e.g. `dirtybirds_sampler.py`) for style and imports.

## 2. Register in `__init__.py`
- Add `from .dirtybirds_<name> import NODE_CLASS_MAPPINGS as _X_CLASSES, NODE_DISPLAY_NAME_MAPPINGS as _X_NAMES`
  and merge `**_X_CLASSES` / `**_X_NAMES` into the top-level dicts.
- **This step is mandatory** — a node not imported here never loads (this bit the sampler once).

## 3. JS — `web/jsdirtybirds_<name>.js`
Follow the reference style (the Loader and Sampler). Required:
- `import { app } from "../../../scripts/app.js";`
- `import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, makeSectionLabel, nodeInnerW } from "./db_shared.js";`
  then call `ensureStylesheet();`.
- In `beforeRegisterNodeDef`, gate on `nodeData.name === "<NodeKey>"`.
- In `onNodeCreated`: set `node.color/bgcolor = DB_COLOR/DB_BGCOLOR`; build styled DOM widgets via
  `addDOMWidget("customhtml", ...)`; use `hideWidget(name)` to hide native widgets you replace.
- Use the shared CSS classes from `web/css/style.css` (`.db-sel-row`, `.db-slider-row`,
  `.db-talent-columns`/`.db-talent-divider`, `.db-seg`, `.db-preview-panel`, etc.).
- Add a width-sync: set each top-level DOM widget element to `nodeInnerW(node)` on create (double rAF)
  and in an `onResize` override; clamp a sensible min width. Put trailing buttons in their own fixed
  DOM widget so an `overflow:hidden` panel can't clip them.
- Do NOT use `window.prompt()`/`alert()` (blocked in the desktop app) — use inline DOM + status text.

## 4. Verify
- `node --check web/jsdirtybirds_<name>.js` and `python -m py_compile dirtybirds_<name>.py`.
- Remind the user to restart the ComfyUI server (new Python node) and hard-reload.
