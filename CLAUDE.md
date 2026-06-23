# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## DirtyBirds-Playhouse

ComfyUI custom node suite for prompt engineering and image generation. Python backend with JavaScript web extensions.

### Quick Facts
- **No build step**: Python imports on ComfyUI start; `web/*.js` served directly from `web/` (WEB_DIRECTORY in `__init__.py`)
- **Dev loop**: Edit live install dir → Restart/reload ComfyUI → Test in browser → Screenshot verification
- **Key constraint**: ComfyUI desktop blocks `window.prompt()` and `alert()` — use inline DOM + status text
- **Local LLM**: LM Studio (OpenAI-compatible endpoint), not llama.cpp CLI

## Session Start Protocol

**MANDATORY at start of each session** (~900 tokens total):

1. Read `.claude/COMMON_MISTAKES.md` (~400 tokens) — **CRITICAL**: covers 8 top pitfalls (editing dev copy, using alerts, claiming fixes from static inspection, IMAGE tensor mishandling, etc.)
2. Skim `.claude/QUICK_START.md` (~250 tokens) — Essential commands and dependencies
3. Reference `.claude/ARCHITECTURE_MAP.md` (~400 tokens) — Directory structure and module responsibilities

**Then, per task:** Load the relevant topic from `docs/INDEX.md` (task-specific docs, ~300-500 tokens each).

## Project Constraints

### Hard File & Path Restrictions
- **`master.yaml`**: Do NOT read, list, grep, parse, or reference. Ever.
- **`user_files/` directory**: Do NOT inspect, index, or open any files in this folder or its symlink targets.
- **Terminal enforcement**: Do not use shell commands to discover or view these banned paths.
- **If a task requires these**: Stop immediately and request manual input from the user.

### Critical Development Practices
- **Always verify in the live app**: Never report a fix as done from server-side or static inspection. Use the `verify-node` skill to prove changes work.
- **Confirm active install path**: ComfyUI loads from `ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\...` (via junction). Edit the live directory, not just the dev copy.
- **Backward compatibility**: Preserve INPUT_TYPES keys and RETURN_TYPES/RETURN_NAMES — they're part of the saved workflow contract.
- **IMAGE tensors**: Are `torch.Tensor [B, H, W, C]`, float32, range 0-1. Respect batch dimension; don't assume B=1 or hardcode `.cuda()`.
- **SAM3 isolation**: Must be self-contained (model at `My_AI_Tools\models\sam3\sam3.pt`) — don't depend on venv packages.

## Architecture Overview

```
Backend modules (dirtybirds_*.py):
├── dirtybirds_loader.py      → Encodes prompt/conditioning into sampler pipe
├── dirtybirds_sampler.py     → Sampling node(s)
├── dirtybirds_prompt.py      → Prompt construction
├── dirtybirds_image.py       → IMAGE tensor operations [B,H,W,C], 0-1 float32
├── dirtybirds_muse.py        → LLM-assisted nodes (LM Studio endpoint)
├── dirtybirds_wardrobe.py    → Wardrobe/outfit nodes
├── dirtybirds_pipe.py        → Pipe routing/bundling
├── dirtybirds_finalcut.py    → Final compositing/output
├── dirtybirds_booru.py       → Booru tag nodes
├── dirtybirds_folders.py     → Folder helpers
├── dirtybirds_sam3.py        → SAM3 segmentation (self-contained)
├── dirtybirds_manager.py     → Manager utilities
└── dirtybirds_wildcard_engine.py → Wildcard expansion + [[reg=...]]/[[reg]] register-lock

Frontend:
├── web/jsdirtybirds.js        → Main/shared extension entry
├── web/jsdirtybirds_*.js      → Per-node UI extensions
├── web/db_shared.js           → Shared token palette + DOM-widget helpers
├── web/folder_buttons.js      → Folder picker buttons
└── web/lorastacker.js         → LoRA stacker UI

Data flow: Prompt → Loader (encodes) → Sampler pipe
```

Each backend module exports `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS`; `__init__.py` merges them all.

## Development Approach

- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names — verify by reading code or docs first.
- Stay strictly within the scope the user defines. Don't explore unrelated nodes/files or auto-trigger unrelated skills.
- When the user says "revert", immediately restore the exact prior state without debating or re-reporting file state.

## Key File Locations

- **Registration/entry**: `__init__.py`
- **Shared JS conventions**: `web/db_shared.js`, `web/jsdirtybirds.js`
- **Per-node JS UI**: `web/jsdirtybirds_<module>.js`
- **Common mistakes**: `.claude/COMMON_MISTAKES.md` (read first on any session)
- **Quick start commands**: `.claude/QUICK_START.md`
- **Full architecture map**: `.claude/ARCHITECTURE_MAP.md`
- **Task-specific docs**: `docs/INDEX.md` (decision tree + token estimates)
- **Quick reference**: `docs/QUICK_REFERENCE.md`

## What To Never Auto-Load (0 token cost)

- `.claude/completions/**` (session completion docs)
- `.claude/sessions/**` (session transcripts)
- `docs/archive/**` (archived docs)

---

**Last Updated**: 2026-06-23
