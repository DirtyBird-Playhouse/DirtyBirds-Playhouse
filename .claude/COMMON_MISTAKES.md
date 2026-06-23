# Common Mistakes

CRITICAL - Read at session start.

---

## Top critical mistakes (ComfyUI node suite)

### 1. Editing the dev copy instead of the live install

**Symptom**: Code changes have no effect after restarting ComfyUI.
**Check**: ComfyUI loads from `ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\...`
(this dev folder is reached via a junction). Confirm the active load path before
editing.
**Fix**: Edit the directory ComfyUI actually loads from. Verify which copy is
live before making changes.

### 2. Using window.prompt() / alert() in web extensions

**Symptom**: Dialog never appears; node UI silently does nothing on ComfyUI
desktop.
**Check**: ComfyUI desktop blocks `window.prompt()`, `alert()`, `confirm()`.
**Fix**: Use inline DOM widgets plus status text. See `web/db_shared.js` for the
shared pattern.

### 3. Claiming a fix works from static inspection alone

**Symptom**: "Fixed" reported but the bug persists in the live app.
**Check**: Was the change exercised in the running ComfyUI browser UI?
**Fix**: Restart/reload ComfyUI, exercise the feature, confirm with a screenshot
before reporting done. Use the `verify-node` skill.

### 4. Mishandling IMAGE tensors

**Symptom**: Wrong colors, crashes, or single-image assumptions break batches.
**Check**: IMAGE is `torch.Tensor [B, H, W, C]`, float32, range 0-1. MASK is
`[B, H, W]`. LATENT is `{"samples": tensor}`.
**Fix**: Respect the batch dim; do not assume B=1. Do not hardcode `.cuda()` -
honor the active CPU/CUDA device.

### 5. Renaming node inputs/outputs casually

**Symptom**: Existing saved workflows break on load.
**Check**: INPUT_TYPES keys and RETURN_TYPES/RETURN_NAMES are part of the saved
graph contract.
**Fix**: Preserve names for backward compatibility unless the change is the task.

### 6. Touching banned paths

**Symptom**: -
**Check**: `master.yaml` and `user_files/` (and its junction target) are
completely off-limits - no read, list, grep, or reference.
**Fix**: If a task requires data from those, stop and request manual input.

### 7. SAM3 depending on the venv package

**Symptom**: Import collisions; segmentation breaks across environments.
**Check**: SAM3 must be self-contained (model at `My_AI_Tools\models\sam3\sam3.pt`).
**Fix**: Keep `dirtybirds_sam3.py` independent of any venv-installed sam package.

### 8. Dropping items from an explicit spec / checklist

**Symptom**: User has to ask repeated follow-ups to surface missing files or
sections after a "done" report.
**Check**: Did the request include a file tree, a list of required sections, or a
validation checklist? Was every item built, and did I run through that checklist
before reporting done?
**Fix**: Treat a provided spec as the contract. Build every listed item in full,
even ones that seem redundant (build it and note the overlap; do not silently
drop it). Self-validate against the spec's own checklist before reporting
complete.

---

**Last Updated**: 2026-06-22
