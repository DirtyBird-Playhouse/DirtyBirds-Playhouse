"""DirtyBirds image-only inpainting — self-contained, no external node packs.

Inpainting runs entirely on ComfyUI's built-in sampler (``comfy.sample``), which
natively honours a latent ``noise_mask`` (only the masked region is denoised, the
known region is preserved). On top of that base pass we add our own optional
refinement: a RePaint-style "jump-back" resampling loop (Lugmayr et al., 2022)
that re-noises the masked fill at decreasing strength and re-denoises it so the
generated content keeps re-conditioning on the fixed surrounding context. All of
this is our own implementation from the published concept — it does not import or
copy any third-party (e.g. GPL) inpainting node.

Pipeline: DIRTYBIRDS_PIPE + IMAGE (+ optional MASK) -> encode -> masked sample
(+ refinement) -> decode -> feathered composite back over the original.
"""

import copy

import torch
import torch.nn.functional as F

from .._compare import compare_preview, resolution

# Fallbacks if comfy.samplers can't be queried (keeps the node importable in
# non-ComfyUI test contexts and never leaves the dropdowns empty).
_DEFAULT_SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "res_multistep"]
_DEFAULT_SCHEDULERS = ["karras", "normal", "simple"]

# Upscaling, face restore and sharpening live in the ✨ Finish node, not here.
# They are finishing passes — global, automatic, needing no model, VAE,
# conditioning or mask — whereas this node is an authored edit. Bundling them
# left twelve of twenty inputs inert whenever you were not inpainting.


def _sampler_options():
    """(sampler_names, scheduler_names) from ComfyUI core, with fallbacks."""
    try:
        import comfy.samplers as cs

        return list(cs.KSampler.SAMPLERS), list(cs.KSampler.SCHEDULERS)
    except Exception:
        return list(_DEFAULT_SAMPLERS), list(_DEFAULT_SCHEDULERS)


def _core_sample(
    model,
    seed,
    steps,
    cfg,
    sampler_name,
    scheduler,
    positive,
    negative,
    latent,
    denoise,
):
    """One masked diffusion pass via ComfyUI core, returning {"samples": ...}.

    Isolated behind this function so the refinement loop can call it repeatedly
    and so tests can substitute a lightweight fake (no real model needed).
    ``latent`` is a dict with "samples" and optional "noise_mask"; only the
    masked region is updated, mirroring ComfyUI's own KSampler.
    """
    import comfy.sample

    samples = latent["samples"]
    samples = comfy.sample.fix_empty_latent_channels(model, samples)
    noise = comfy.sample.prepare_noise(samples, seed, latent.get("batch_index"))
    noise_mask = latent.get("noise_mask")
    out = comfy.sample.sample(
        model,
        noise,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        samples,
        denoise=denoise,
        noise_mask=noise_mask,
        seed=seed,
    )
    return {"samples": out}


def _masked_sample(
    model,
    base_samples,
    mask,
    seed,
    steps,
    cfg,
    sampler_name,
    scheduler,
    positive,
    negative,
    denoise,
    refine_steps,
    prompt_first,
):
    """Base masked pass plus our RePaint-style refinement.

    The base pass fills the masked region at ``denoise`` strength. Each refinement
    iteration then re-samples the current latent at a decreasing strength (a
    "jump-back" step) so the fill settles into agreement with the fixed context.
    "Prompt First" starts refinement from full strength (let the prompt drive);
    "Image First" starts gentler so the fill blends toward the existing image.
    """
    latent = {"samples": base_samples, "noise_mask": mask}
    out = _core_sample(
        model,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        latent,
        denoise,
    )

    strength = denoise if prompt_first else min(denoise, 0.5)
    for i in range(int(refine_steps)):
        strength *= 0.65  # anneal so passes converge
        if strength < 0.05:
            break
        latent = {"samples": out["samples"], "noise_mask": mask}
        out = _core_sample(
            model,
            seed + i + 1,
            steps,
            cfg,
            sampler_name,
            scheduler,
            positive,
            negative,
            latent,
            strength,
        )
    return out


def _grow_mask(mask, pixels):
    """Grow (pixels > 0) or shrink (pixels < 0) a [B,H,W] mask by |pixels| px.

    Square morphological dilation/erosion via max-pooling — growing the mask lets
    the sampler repaint slightly beyond the segmentation edge so the inpaint seam
    blends instead of cutting off at the exact boundary. Our own implementation.
    """
    p = int(pixels)
    if p == 0:
        return mask
    k = 2 * abs(p) + 1
    x = mask.unsqueeze(1)  # [B,1,H,W]
    if p > 0:  # dilate
        x = F.max_pool2d(x, kernel_size=k, stride=1, padding=abs(p))
    else:  # erode = invert-dilate-invert
        x = 1.0 - F.max_pool2d(1.0 - x, kernel_size=k, stride=1, padding=abs(p))
    return x.squeeze(1).clamp(0.0, 1.0)


def _feather_mask(mask, kernel):
    """Gaussian-soften a [B,H,W] mask by an odd kernel width (our own blur)."""
    k = int(kernel)
    if k <= 1:
        return mask.clamp(0.0, 1.0)
    if k % 2 == 0:
        k += 1
    r = k // 2
    x = mask.unsqueeze(1)  # [B,1,H,W]
    coords = torch.arange(k, dtype=x.dtype, device=x.device) - r
    sigma = r / 2.0 + 1e-6
    g = torch.exp(-(coords**2) / (2 * sigma**2))
    g = g / g.sum()
    kernel2d = (g[:, None] * g[None, :])[None, None]
    x = F.pad(x, (r, r, r, r), mode="reflect")
    x = F.conv2d(x, kernel2d)
    return x.squeeze(1).clamp(0.0, 1.0)


def _blend_feathered(base, fill, mask, feather):
    """Composite ``fill`` over ``base`` inside a feathered ``mask``.

    base/fill are IMAGE tensors [B,H,W,C]; mask is [B,H,W] in [0,1]. The mask is
    gaussian-feathered by ``feather`` px so the inpaint seam is soft rather than a
    hard cut. Our own implementation (standard alpha compositing)."""
    m = _feather_mask(mask, feather)[..., None]  # [B,H,W,1]
    return base * (1.0 - m) + fill * m


def _summarize(segment_prompt, mask_source, denoise, seed, image):
    """One line naming what this run actually repainted, for the compare view."""
    parts = []
    prompt = str(segment_prompt or "").strip()
    parts.append(f'"{prompt}"' if prompt and mask_source == "SAM3" else mask_source)
    try:
        parts.append(f"denoise {float(denoise):.2f}")
    except (TypeError, ValueError):
        pass
    try:
        parts.append(f"seed {int(seed)}")
    except (TypeError, ValueError):
        pass
    size = resolution(image)
    if size:
        parts.append(size)
    return " · ".join(parts)


def _segment_image(image, prompt, confidence):
    """Generate the inpaint mask with DirtyBirds' native SAM3 integration."""
    try:
        from ..image import _run_sam3
    except ImportError as error:
        raise RuntimeError("DirtyBirds SAM3 segmentation is unavailable") from error
    result = _run_sam3(image, prompt, confidence)
    if result is None:
        raise RuntimeError("SAM3 could not create an inpainting mask")
    return result[1]


def _prepare_image(image):
    if not torch.is_tensor(image) or image.ndim != 4:
        raise ValueError("image must be a ComfyUI IMAGE tensor [B,H,W,C]")
    if image.shape[-1] not in (3, 4):
        raise ValueError("image must have 3 or 4 channels")
    image = image[..., :3]
    height, width = int(image.shape[1]), int(image.shape[2])
    if height % 8 or width % 8:
        raise ValueError(
            f"inpainting image must use dimensions divisible by 8; received {width}x{height}"
        )
    return image


def _prepare_inputs(image, mask):
    image = _prepare_image(image)
    height, width = int(image.shape[1]), int(image.shape[2])

    if not torch.is_tensor(mask):
        raise ValueError("mask must be a ComfyUI MASK tensor [B,H,W]")
    if mask.ndim == 4 and mask.shape[1] == 1:
        mask = mask[:, 0]
    elif mask.ndim == 4 and mask.shape[-1] == 1:
        mask = mask[..., 0]
    if mask.ndim != 3:
        raise ValueError("mask must be a ComfyUI MASK tensor [B,H,W]")
    if tuple(mask.shape[-2:]) != (height, width):
        raise ValueError(
            f"mask size must match image size; image is {width}x{height}, "
            f"mask is {int(mask.shape[2])}x{int(mask.shape[1])}"
        )
    if mask.shape[0] == 1 and image.shape[0] > 1:
        mask = mask.repeat(image.shape[0], 1, 1)
    elif mask.shape[0] != image.shape[0]:
        raise ValueError("mask batch must be 1 or match the image batch")
    return image, mask.float().clamp(0.0, 1.0)


class DirtyBirdsInpaint:
    """Segment and inpaint an Image Loader source using a DirtyBirds pipe.

    One job: mask a region — from ``segment_prompt`` via SAM3, or from a supplied
    MASK — and repaint it with the pipe's model and conditioning.

    Upscaling, face restore and sharpening are the ✨ Finish node's job. They are
    finishing passes: global, automatic, and needing nothing from the pipe. Wire
    this node's image output into Finish when you want both.
    """

    @classmethod
    def INPUT_TYPES(cls):
        samplers, schedulers = _sampler_options()
        return {
            "required": {
                "db_pipe": ("DIRTYBIRDS_PIPE",),
                "image": ("IMAGE",),
                "segment_prompt": (
                    "STRING",
                    {
                        "default": "",
                        "placeholder": "describe the area to replace",
                    },
                ),
                "confidence": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.05,
                        "max": 0.95,
                        "step": 0.01,
                    },
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": False,
                    },
                ),
                "steps": ("INT", {"default": 30, "min": 1, "max": 10000}),
                "cfg": (
                    "FLOAT",
                    {"default": 5.0, "min": 0.0, "max": 100.0, "step": 0.1},
                ),
                "sampler_name": (
                    samplers,
                    {"default": "euler" if "euler" in samplers else samplers[0]},
                ),
                "scheduler": (
                    schedulers,
                    {"default": "karras" if "karras" in schedulers else schedulers[0]},
                ),
                "denoise": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                # Number of refinement (jump-back resampling) passes. Kept under
                # the original widget key so existing workflows/UI still bind.
                "lanpaint_steps": ("INT", {"default": 5, "min": 0, "max": 100}),
                "prompt_mode": (
                    ["Image First", "Prompt First"],
                    {"default": "Image First"},
                ),
                "blend_feather": (
                    "INT",
                    {"default": 9, "min": 1, "max": 51, "step": 2},
                ),
                # NOTE: appended LAST on purpose — ComfyUI maps a saved workflow's
                # widget values to inputs by position, so a new widget must go at
                # the end or it shifts every following value onto the wrong input.
                # Expand (negative = shrink) the mask before sampling so the repaint
                # reaches slightly past the segmentation edge.
                "grow_mask": ("INT", {"default": 4, "min": -64, "max": 256, "step": 1}),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "IMAGE", "LATENT")
    RETURN_NAMES = ("db_pipe", "image", "latent")
    FUNCTION = "inpaint"
    CATEGORY = "DirtyBirds"
    # See the note on DirtyBirdsFinish: a node returning a `ui` payload has to
    # be an output node, or ComfyUI prunes it and the preview never renders.
    OUTPUT_NODE = True

    def inpaint(
        self,
        db_pipe,
        image,
        segment_prompt,
        confidence,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        denoise,
        lanpaint_steps,
        prompt_mode,
        blend_feather,
        grow_mask=0,
        mask=None,
    ):
        pipe = dict(db_pipe or {})
        missing = [
            name
            for name in ("model", "vae", "positive", "negative")
            if pipe.get(name) is None
        ]
        if missing:
            raise ValueError(
                "db_pipe is missing required inpainting data: " + ", ".join(missing)
            )

        image = _prepare_image(image)
        # Recorded before the branch below reassigns `mask`.
        mask_source = "mask input" if mask is not None else "SAM3"
        if mask is None:
            prompt = str(segment_prompt or "").strip()
            if not prompt:
                raise ValueError(
                    "describe the area to replace or connect an external mask"
                )
            mask = _segment_image(image, prompt, float(confidence))
        image, mask = _prepare_inputs(image, mask)
        mask = _grow_mask(mask, int(grow_mask))

        vae = pipe["vae"]
        base_samples = vae.encode(image)
        sampled = _masked_sample(
            pipe["model"],
            base_samples,
            mask,
            int(seed),
            int(steps),
            float(cfg),
            sampler_name,
            scheduler,
            pipe["positive"],
            pipe["negative"],
            float(denoise),
            int(lanpaint_steps),
            prompt_mode == "Prompt First",
        )
        decoded = vae.decode(sampled["samples"])
        final_image = _blend_feathered(image, decoded, mask, int(blend_feather))

        pipe["samples"] = sampled
        pipe["images"] = final_image
        pipe["seed"] = int(seed)
        pipe["denoise"] = float(denoise)
        pipe["loader_settings"] = copy.copy(pipe.get("loader_settings") or {})
        result = (pipe, final_image, sampled)

        # Before/after compare. Inpainting changes one masked region, so the
        # final image alone rarely answers "did that help?" — flipping between
        # the two in the same box does.
        preview = compare_preview(
            image,
            final_image,
            _summarize(segment_prompt, mask_source, denoise, seed, final_image),
        )
        return {"ui": preview, "result": result} if preview else result


NODE_CLASS_MAPPINGS = {"DirtyBirdsInpaint": DirtyBirdsInpaint}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsInpaint": "🖌️ Inpainting"}
