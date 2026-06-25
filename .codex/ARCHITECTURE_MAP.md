# Architecture Map

DirtyBirds-Playhouse is a ComfyUI custom-node suite for prompt engineering and
image generation. Backend nodes are Python; frontend node layouts are JavaScript
web extensions served from `web/`.

Data flow: Prompt -> Loader encodes conditioning -> Sampler pipe -> output.

---

## Directory structure

```text
DirtyBirds-Playhouse/
├── __init__.py                  # Root ComfyUI registration and WEB_DIRECTORY
├── dirtybirds_*.py              # Legacy/root node modules
├── nodes/                       # Packaged node implementations
├── utils/                       # Shared non-UI utilities
├── web/                         # ComfyUI web extensions
│   ├── db_shared.js             # Shared palette, fetch, DOM helpers
│   ├── jsdirtybirds.js          # Loader/setup node UI
│   ├── jsdirtybirds_prompt.js   # Script/prompt node UI
│   ├── jsdirtybirds_sampler.js  # Sampler/output node UI
│   ├── jsdirtybirds_*.js        # Per-node UI extensions
│   └── css/style.css            # Shared stylesheet
├── docs/                        # Task-specific docs and learnings
└── .codex/                      # Mandatory Codex startup docs
```

## Backend module responsibilities

| Area | Role |
|------|------|
| `nodes/loader` | Checkpoint, VAE, conditioning, loader pipe |
| `nodes/prompt` | Prompt construction and wildcard/dynamic prompt support |
| `nodes/sampler` | Sampling controls, KSampler flow, previews |
| `nodes/image` | Image loading, batch ops, optional segmentation |
| `nodes/muse` | LM Studio-assisted prompt generation |
| `nodes/wardrobe` | LoRA trigger words and wardrobe controls |
| `nodes/pipe` | Pipe routing and bundling |
| `nodes/finalcut` | Final output / picker workflow |
| `utils/wildcard_engine.py` | Wildcard expansion and variable locking |
| `utils/manager.py` | LoRA/Embedding metadata and caching |

Each node package exports `NODE_CLASS_MAPPINGS` and
`NODE_DISPLAY_NAME_MAPPINGS`; root `__init__.py` re-exports them to ComfyUI.

## Frontend conventions

- Register web extensions with `app.registerExtension(...)`.
- Use shared helpers from `web/db_shared.js`.
- Keep node UI in DOM widgets where native ComfyUI row sizing causes layout
  conflicts.
- Use inline DOM/status text instead of `window.prompt()`, `alert()`, or
  `confirm()`.
- After web edits, run `node --check` on touched JS files and verify in the live
  ComfyUI browser.

## Key files

| Need | File |
|------|------|
| Root registration | `__init__.py` |
| Node package registration | `nodes/__init__.py` |
| Shared web helpers | `web/db_shared.js` |
| Loader/setup UI | `web/jsdirtybirds.js` |
| Script/prompt UI | `web/jsdirtybirds_prompt.js` |
| Sampler UI | `web/jsdirtybirds_sampler.js` |
| Shared CSS | `web/css/style.css` |
| Docs index | `docs/INDEX.md` |

---

**Last Updated**: 2026-06-24
