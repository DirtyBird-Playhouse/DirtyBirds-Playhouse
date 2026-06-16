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

### Constraints
- ComfyUI desktop blocks `window.prompt()` and `alert()` — use inline DOM + status text
- JS extensions run in ComfyUI's browser context, not a separate app
- Local LLM via LM Studio (not llama.cpp CLI)
- SAM3 segmentation must be self-contained (not depend on venv package)

### Testing
- Always start the ComfyUI app and test changes in the UI before reporting complete
- Screenshot-driven verification: run the app, exercise the feature, confirm behavior

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
