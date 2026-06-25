# Common Mistakes

CRITICAL - Read at session start.

---

## Top critical mistakes (ComfyUI node suite)

### 1. Editing the dev copy instead of the live install

**Symptom**: Code changes have no effect after restarting ComfyUI.
**Check**: Confirm the active ComfyUI `custom_nodes` path before editing. This
workspace is normally reached from the live install through a symlink/junction.
**Fix**: Edit the directory ComfyUI actually loads from. Verify which copy is
live before making changes.

### 2. Using window.prompt() / alert() in web extensions

**Symptom**: Dialog never appears; node UI silently does nothing on ComfyUI
desktop.
**Check**: ComfyUI desktop blocks `window.prompt()`, `alert()`, and `confirm()`.
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

**Symptom**: Restricted files or private workspace data are exposed.
**Check**: `master.yaml` and `user_files/` are completely off-limits: no read,
list, grep, parse, reference, or junction-target inspection.
**Fix**: If a task requires data from those paths, stop and request manual input.

### 7. SAM3 depending on the venv package

**Symptom**: Import collisions; segmentation breaks across environments.
**Check**: SAM3 must be self-contained with the project utility code and model.
**Fix**: Keep SAM3 code independent of any venv-installed `sam` package.

### 8. Dropping items from an explicit spec / checklist

**Symptom**: User has to ask repeated follow-ups after a "done" report.
**Check**: Did the request include a file tree, checklist, or required sections?
Was every item built and validated?
**Fix**: Treat the provided spec as the contract. Build every listed item and
self-validate against the checklist before reporting complete.

---

**Last Updated**: 2026-06-24
