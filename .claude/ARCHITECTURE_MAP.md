# Architecture Map

DirtyBirds-Playhouse: a ComfyUI custom-node suite. Python node backends organized by feature group, plus per-node JavaScript web extensions. Data flow: Prompt -> Loader (encodes) -> Sampler pipe.

---

## Directory Structure

```
DirtyBirds-Playhouse/
├── __init__.py                      # Root aggregator: imports from nodes/, registers NODE_CLASS_MAPPINGS, WEB_DIRECTORY="./web"
├── utils/                           # Shared utility modules (no UI)
│   ├── __init__.py
│   ├── wildcard_engine.py           # Wildcard/[[variable]] register-lock pure logic
│   ├── manager.py                   # LoRA/Embedding metadata caching, Civitai API
│   └── sam3.py                      # SAM3 segmentation (self-contained)
├── nodes/                           # Node packages (one folder per feature group)
│   ├── __init__.py                  # Aggregator: merges all NODE_CLASS_MAPPINGS
│   ├── loader/
│   │   └── __init__.py              # DirtyBirdsLoader (checkpoint, VAE, conditioning)
│   ├── prompt/
│   │   └── __init__.py              # DirtyBirdsPrompt (prompt construction)
│   ├── sampler/
│   │   └── __init__.py              # DirtyBirdsSampler (KSampler)
│   ├── image/
│   │   └── __init__.py              # DirtyBirdsLoadImage (image loading, SAM3)
│   ├── muse/
│   │   └── __init__.py              # DirtyBirdsMuse (LM Studio prompting)
│   ├── pipe/
│   │   └── __init__.py              # DirtyBirdsPipeIn/Out (routing, bundling)
│   ├── wardrobe/
│   │   └── __init__.py              # DirtyBirdsWardrobe (LoRA trigger words)
│   ├── booru/
│   │   └── __init__.py              # DirtyBirdsBooru (tag fetching, side-effect import)
│   ├── finalcut/
│   │   └── __init__.py              # DirtyBirdsFinalCut (interactive picker)
│   └── folders/
│       └── __init__.py              # Folder opener (side-effect import)
├── web/                             # JS web extensions (run in ComfyUI litegraph context)
│   ├── db_shared.js                 # Shared token palette + DOM-widget helpers
│   ├── jsdirtybirds.js              # Loader node UI
│   ├── jsdirtybirds_prompt.js       # Prompt node UI
│   ├── jsdirtybirds_sampler.js      # Sampler node UI
│   ├── jsdirtybirds_muse.js         # Muse node UI
│   ├── jsdirtybirds_image.js        # Image node UI
│   ├── jsdirtybirds_pipe.js         # Pipe In/Out UI
│   ├── jsdirtybirds_wardrobe.js     # Wardrobe UI
│   ├── jsdirtybirds_booru.js        # Booru UI
│   ├── jsdirtybirds_finalcut.js     # Final Cut UI
│   ├── folder_buttons.js            # Folder picker buttons
│   ├── lorastacker.js               # LoRA stacker UI
│   ├── css/
│   │   └── style.css                # Shared stylesheet
│   └── previews/                    # Preview images (generated)
├── .claude/                         # Dev docs (this dir)
└── docs/                            # Extended docs + learnings (load as needed)
```

## Backend module → responsibility

| Module | Role |
|--------|------|
| **nodes/loader** | Encodes prompt/conditioning into the sampler pipe |
| **nodes/prompt** | Prompt construction with wildcard/dynamic-prompt support |
| **nodes/sampler** | Sampling node(s) with preview and seed controls |
| **nodes/image** | Image loading, batch ops, optional SAM3 segmentation |
| **nodes/muse** | LLM-assisted nodes via LM Studio endpoint |
| **nodes/wardrobe** | Wardrobe/outfit nodes, trigger-word emission |
| **nodes/pipe** | Pipe routing/bundling (PipeIn/Out) |
| **nodes/finalcut** | Final compositing/output with interactive picker |
| **nodes/booru** | Booru tag fetching (side-effect import for routes) |
| **nodes/folders** | Folder opener via OS (side-effect import) |
| **utils/manager** | LoRA/Embedding metadata, Civitai API, caching |
| **utils/wildcard_engine** | Pure wildcard expansion + [[var=...]] register-lock logic |
| **utils/sam3** | SAM3 segmentation (self-contained, model at `My_AI_Tools\models\sam3\sam3.pt`) |

Each node package exports `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS` from its `__init__.py`; `nodes/__init__.py` merges them all; root `__init__.py` re-exports to ComfyUI.

## Key file locations

- **Root aggregator**: `__init__.py`
- **Node aggregator**: `nodes/__init__.py`
- **Shared JS conventions**: `web/db_shared.js`, `web/jsdirtybirds.js`
- **Per-node JS**: `web/jsdirtybirds_<module>.js` (e.g., `jsdirtybirds_prompt.js`)
- **Utility modules**: `utils/wildcard_engine.py`, `utils/manager.py`, `utils/sam3.py`
- **Live install ComfyUI loads from**: see `.claude/COMMON_MISTAKES.md` (junction to `ComfyUI-Installs\ComfyUI\ComfyUI`). Edit the live dir, not just the dev copy.

## Import patterns

**Within a node** (e.g., `nodes/prompt/__init__.py`):
```python
from ...utils.wildcard_engine import load_wildcard_dict, process
```

**From root `__init__.py`:**
```python
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
```

**From `nodes/__init__.py`:**
```python
from .loader import NODE_CLASS_MAPPINGS as LOADER_CLASSES
from .prompt import NODE_CLASS_MAPPINGS as PROMPT_CLASSES
# ... merge all and re-export
```

---

**Last Updated**: 2026-06-22
