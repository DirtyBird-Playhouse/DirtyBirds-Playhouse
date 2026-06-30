---
name: sync-to-comfyui
description: Copy the DirtyBirds dev repo into the live ComfyUI custom_nodes install and report whether a browser reload or full server restart is needed. Use when the user says "sync", "deploy to comfyui", "push to install", or wants changes to show up in the running ComfyUI.
disable-model-invocation: true
---

# Sync DirtyBirds to the live ComfyUI install

Mirror the development repo into the installed copy so changes take effect in ComfyUI.

## Paths
- Dev repo (source): `C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse`
- Live install (dest): `C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI\custom_nodes\DirtyBirds-Playhouse`

## Shared model configuration
- ComfyUI model aliases are configured in
  `C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI\extra_model_paths.yaml`.
- DirtyBirds face-restoration models live in
  `C:\Users\mpick\My_AI_Tools\models\face_restore` and the YAML mapping must be
  `facerestore_models: face_restore`.

## Steps
1. Confirm the install path exists. If not, stop and tell the user.
2. Mirror the suite's source files (Python at the root + the `web/` tree), excluding dev-only
   junk. Use robocopy:
   ```powershell
   $src="C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse"
   $dst="C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI\custom_nodes\DirtyBirds-Playhouse"
   robocopy $src $dst *.py *.json *.html /XF lora_meta_cache.json
   robocopy "$src\web" "$dst\web" /E
   ```
   (robocopy exit codes 0-7 are success; treat >=8 as an error.)
3. Determine what changed since the last sync (use `git status`/`git diff --name-only` if helpful):
   - Any `*.py` changed → tell the user to **restart the ComfyUI server** (Python modules only
     reload on restart).
   - Only `web/*` (JS/CSS) changed → tell the user to **hard-reload the browser** (Ctrl+Shift+R).
4. Report exactly which files were copied and the required action in one short summary.

## Notes
- Do NOT copy `.git/`, `.Codex/`, or `lora_meta_cache.json`.
- This is a one-way push dev → install. Never copy install → dev.
