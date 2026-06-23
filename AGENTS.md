## DirtyBirds-Playhouse

ComfyUI node suite for prompt engineering and image generation. Python backend with JavaScript web extensions.

### Approach
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

### Architecture
- **Backend**: Python node implementations (`dirtybirds_*.py`)
- **Frontend**: JavaScript web extensions in `web/` for ComfyUI UI
- **Data flow**: Prompt → Loader (encodes) → Sampler pipe
- **UI conventions**: Shared token palette, DOM-widget classes, width-sync/clip gotchas (see memory)
- Full map: `.Codex/ARCHITECTURE_MAP.md`

### Quick Start
- No build step. Python is imported on ComfyUI start; `web/*.js` is served from `web/` (WEB_DIRECTORY).
- Dev loop: edit the live install dir → restart/reload ComfyUI → exercise in browser → screenshot.
- Full commands: `.Codex/QUICK_START.md`

### Documentation Navigation
- Start here: `.Codex/COMMON_MISTAKES.md`, `.Codex/QUICK_START.md`, `.Codex/ARCHITECTURE_MAP.md`
- Task-specific topics + token estimates: `docs/INDEX.md` (and `.Codex/LEARNINGS_INDEX.md`)
- Maintenance rules: `.Codex/DOCUMENTATION_MAINTENANCE.md`

### Constraints
- ComfyUI desktop blocks `window.prompt()` and `alert()` — use inline DOM + status text
- JS extensions run in ComfyUI's browser context, not a separate app
- Local LLM via LM Studio (not llama.cpp CLI)
- SAM3 segmentation must be self-contained (not depend on venv package)

### ComfyUI Development
- Before editing any ComfyUI custom node, confirm the active install path. Edit only the directory ComfyUI actually loads from, and verify which copy is live before making changes.

### Testing
- Always start the ComfyUI app and test changes in the UI before reporting complete
- Screenshot-driven verification: run the app, exercise the feature, confirm behavior
- After any node code change, restart/reload ComfyUI and verify the fix in the live browser before reporting it as done. Never claim a fix works based on server-side or static inspection alone.
- Confirm the correct test model and hardware (CPU/CUDA) context before running tests. Do not hardcode a test model assumption.

### Working with Edits
- When the user says revert, immediately restore the exact prior state (e.g., the green diff) without debating or re-reporting file state. Do not guess at on-disk state — read the file first.

### Scope and Focus
- Stay strictly within the scope the user defines. Do not explore or edit unrelated nodes/files, and do not auto-trigger skills that don't apply to the current task.

## Project Constraints: dirtybirds-playhouse
- Context: These instructions apply strictly to the `dirtybirds-playhouse` workspace.
- Global Blocklist: You are completely barred from accessing, searching, or mapping the `master.yaml` file and the `user_files` directory.

### Hard File & Path Restrictions
- **Specific File Ban**: Do not read, list, grep, parse, or reference the `master.yaml` file under any circumstances.
- **Specific Directory Ban**: Do not inspect, index, or open any files located inside the `C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse\user_files` folder.
- **Symbolic Link Isolation**: Treat the symbolic link target or junction point pointing to `user_files` as completely invisible and blocked.

### Tool & Terminal Enforcement
- **Terminal Restrictions**: Do not use shell commands (e.g., `cat`, `dir`, `ls`, `grep`, `type`, `FindStr`) to discover or view the contents of the banned paths.
- **Execution Handling**: If a script, configuration, or build error explicitly requires data from these blacklisted zones, stop execution immediately and request manual input from the user. Do not attempt autonomous workarounds.

---

## Session Start Protocol ⚡

**MANDATORY** at start of each session:

```bash
# Load essential docs (~800 tokens - 2 min read)
✓ .Codex/COMMON_MISTAKES.md      # ⚠️ CRITICAL - Read FIRST
✓ .Codex/QUICK_START.md          # Essential commands
✓ .Codex/ARCHITECTURE_MAP.md     # File locations
```

**Then, per task:** load the relevant topic from `docs/INDEX.md` (~300-500 tokens each).

**At task completion:**
- Create completion doc in `.Codex/completions/YYYY-MM-DD-task-name.md`
- Move session file to `.Codex/sessions/archive/` (if created)

**⚠️ NEVER auto-load:**
- Files in `.Codex/completions/` (0 token cost)
- Files in `.Codex/sessions/` (0 token cost)
- Files in `docs/archive/` (0 token cost)

---

**Last Updated**: 2026-06-22
**Optimized with**: [Codex Token Optimizer](https://github.com/nadimtuhin/Codex-token-optimizer)
