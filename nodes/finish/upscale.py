"""Whole-image upscaling for the ✨ Finish node.

Two kinds of upscale are offered:

* **Fast Nx (Lanczos)** — a plain resample through ``comfy.utils.common_upscale``.
  No model, no VRAM, instant. Adds pixels but no detail.
* **A model** — any checkpoint in ``models/upscale_models`` (ESRGAN, UltraSharp,
  Remacri, SwinIR, …), loaded with spandrel and run tiled.

The model path deliberately mirrors ComfyUI's own ``ImageUpscaleWithModel``
(``comfy_extras/nodes_upscale_model.py``) rather than reimplementing it: same
state-dict prefix fix, same memory estimate, same 512px tiling with the
halve-the-tile retry on OOM. Behaviour therefore matches the core node exactly,
including on models that need the tile fallback.
"""

import torch

import comfy.model_management as model_management
import comfy.utils
import folder_paths

UPSCALE_OFF = "None"
# label -> scale factor for the model-free resamples.
FAST_UPSCALES = {
    "Fast 2x (Lanczos)": 2,
    "Fast 4x (Lanczos)": 4,
}

_MODEL_CACHE = {}


def upscale_options():
    """Combo values: off, the model-free resamples, then every installed model.

    Read at INPUT_TYPES time so a newly dropped-in checkpoint appears after a
    ComfyUI restart without touching this file.
    """
    try:
        installed = sorted(folder_paths.get_filename_list("upscale_models") or [])
    except Exception:  # noqa: BLE001 - never break node registration
        installed = []
    return [UPSCALE_OFF, *FAST_UPSCALES, *installed]


def _load_upscale_model(name):
    """Load (and cache) a spandrel upscale model by filename."""
    if name in _MODEL_CACHE:
        return _MODEL_CACHE[name]

    from spandrel import ModelLoader, ImageModelDescriptor

    path = folder_paths.get_full_path_or_raise("upscale_models", name)
    sd = comfy.utils.load_torch_file(path, safe_load=True)
    # Some SwinIR-family checkpoints are saved with a "module." prefix.
    if "module.layers.0.residual_group.blocks.0.norm1.weight" in sd:
        sd = comfy.utils.state_dict_prefix_replace(sd, {"module.": ""})
    model = ModelLoader().load_from_state_dict(sd).eval()
    if not isinstance(model, ImageModelDescriptor):
        raise ValueError(f"{name} is not a single-image upscale model.")
    _MODEL_CACHE[name] = model
    return model


def _fast_upscale(image, factor):
    """Lanczos resample, no model. ``image`` is [B,H,W,C] in [0,1]."""
    height, width = int(image.shape[1]), int(image.shape[2])
    samples = image.movedim(-1, -3)
    out = comfy.utils.common_upscale(
        samples, width * factor, height * factor, "lanczos", "disabled"
    )
    return out.movedim(-3, -1).clamp(0.0, 1.0)


def _model_upscale(image, name):
    """Tiled model upscale. Mirrors ComfyUI's ImageUpscaleWithModel."""
    upscale_model = _load_upscale_model(name)
    device = model_management.get_torch_device()

    memory_required = model_management.module_size(upscale_model.model)
    memory_required += (
        (512 * 512 * 3)
        * image.element_size()
        * max(upscale_model.scale, 1.0)
        * 384.0  # core's own rough per-model estimate
    )
    memory_required += image.nelement() * image.element_size()
    model_management.free_memory(memory_required, device)

    upscale_model.to(device)
    in_img = image.movedim(-1, -3).to(device)
    output_device = model_management.intermediate_device()

    tile = 512
    overlap = 32
    oom = True
    try:
        while oom:
            try:
                steps = in_img.shape[0] * comfy.utils.get_tiled_scale_steps(
                    in_img.shape[3],
                    in_img.shape[2],
                    tile_x=tile,
                    tile_y=tile,
                    overlap=overlap,
                )
                pbar = comfy.utils.ProgressBar(steps)
                s = comfy.utils.tiled_scale(
                    in_img,
                    lambda a: upscale_model(a.float()),
                    tile_x=tile,
                    tile_y=tile,
                    overlap=overlap,
                    upscale_amount=upscale_model.scale,
                    pbar=pbar,
                    output_device=output_device,
                )
                oom = False
            except Exception as exc:
                model_management.raise_non_oom(exc)
                tile //= 2
                if tile < 128:
                    raise
    finally:
        upscale_model.to("cpu")

    return torch.clamp(s.movedim(-3, -1), min=0.0, max=1.0)


def _resample_to_scale(image, original, scale):
    """Resample ``image`` so it ends up ``scale``x the size of ``original``.

    Used to decouple the requested size from the model's own factor: a 4x model
    set to 2 upscales to 4x, then comes back down to 2x. Going through the model
    first and resampling down beats asking for 2x directly — the detail the
    model invented survives the downsample.
    """
    target_h = max(1, int(round(int(original.shape[1]) * scale)))
    target_w = max(1, int(round(int(original.shape[2]) * scale)))
    if int(image.shape[1]) == target_h and int(image.shape[2]) == target_w:
        return image
    samples = image.movedim(-1, -3)
    out = comfy.utils.common_upscale(samples, target_w, target_h, "lanczos", "disabled")
    return out.movedim(-3, -1).clamp(0.0, 1.0)


def upscale_image(image, choice, scale=0.0):
    """Upscale the whole image. Returns it unchanged when ``choice`` is off.

    ``scale`` is the final size relative to the input, independent of whatever
    factor the model is built for — a 4x model with ``scale=2`` yields 2x. Zero
    (the default) means "whatever the model does", which is what every workflow
    saved before this argument existed will pass, so their output is unchanged.

    A failure here never breaks the graph: the original image is returned with a
    console note, because losing the inpaint you just ran to an upscaler problem
    would be a poor trade.
    """
    name = str(choice or UPSCALE_OFF)
    if name == UPSCALE_OFF or not torch.is_tensor(image):
        return image
    try:
        scale = float(scale or 0.0)
    except (TypeError, ValueError):
        scale = 0.0
    try:
        if name in FAST_UPSCALES:
            out = _fast_upscale(image, FAST_UPSCALES[name])
        else:
            out = _model_upscale(image, name)
        return _resample_to_scale(out, image, scale) if scale > 0 else out
    except model_management.InterruptProcessingException:
        raise
    except Exception as exc:  # noqa: BLE001
        print(
            f"[DirtyBirds] Upscale with '{name}' failed: {exc}. Keeping original size."
        )
        return image
