"""DirtyBirds image-only inpainting adapter for the LanPaint custom nodes."""

import copy

import torch


_DEFAULT_SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "res_multistep"]
_DEFAULT_SCHEDULERS = ["karras", "normal", "simple"]


def _lanpaint_class(name):
    """Resolve LanPaint through ComfyUI without importing its private package."""
    try:
        import nodes as comfy_nodes
        node_class = comfy_nodes.NODE_CLASS_MAPPINGS.get(name)
    except Exception as error:
        raise RuntimeError("LanPaint is unavailable; install or enable the LanPaint custom node") from error
    if node_class is None:
        raise RuntimeError("LanPaint is unavailable; install or enable the LanPaint custom node")
    return node_class


def _lanpaint_options(name, fallback):
    try:
        required = _lanpaint_class("LanPaint_KSampler").INPUT_TYPES()["required"]
        values = required[name][0]
        return list(values) if isinstance(values, (list, tuple)) else fallback
    except Exception:
        return fallback


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
    """Segment and inpaint an Image Loader source using a DirtyBirds pipe."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "db_pipe": ("DIRTYBIRDS_PIPE",),
                "image": ("IMAGE",),
                "segment_prompt": ("STRING", {
                    "default": "",
                    "placeholder": "describe the area to replace",
                }),
                "confidence": ("FLOAT", {
                    "default": 0.5, "min": 0.05, "max": 0.95, "step": 0.01,
                }),
                "seed": ("INT", {
                    "default": 0, "min": 0, "max": 0xffffffffffffffff,
                    "control_after_generate": False,
                }),
                "steps": ("INT", {"default": 30, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "sampler_name": (_lanpaint_options("sampler_name", _DEFAULT_SAMPLERS), {"default": "euler"}),
                "scheduler": (_lanpaint_options("scheduler", _DEFAULT_SCHEDULERS), {"default": "karras"}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "lanpaint_steps": ("INT", {"default": 5, "min": 0, "max": 100}),
                "prompt_mode": (["Image First", "Prompt First"], {"default": "Image First"}),
                "blend_feather": ("INT", {"default": 9, "min": 1, "max": 51, "step": 2}),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "IMAGE", "LATENT")
    RETURN_NAMES = ("db_pipe", "image", "latent")
    FUNCTION = "inpaint"
    CATEGORY = "DirtyBirds"

    def inpaint(self, db_pipe, image, segment_prompt, confidence, seed, steps, cfg,
                sampler_name, scheduler, denoise, lanpaint_steps, prompt_mode,
                blend_feather, mask=None):
        pipe = dict(db_pipe or {})
        missing = [
            name for name in ("model", "vae", "positive", "negative")
            if pipe.get(name) is None
        ]
        if missing:
            raise ValueError("db_pipe is missing required inpainting data: " + ", ".join(missing))

        image = _prepare_image(image)
        if mask is None:
            prompt = str(segment_prompt or "").strip()
            if not prompt:
                raise ValueError("describe the area to replace or connect an external mask")
            mask = _segment_image(image, prompt, float(confidence))
        image, mask = _prepare_inputs(image, mask)
        vae = pipe["vae"]
        latent = {"samples": vae.encode(image)}
        latent["noise_mask"] = mask

        sampler = _lanpaint_class("LanPaint_KSampler")()
        sampled = sampler.sample(
            model=pipe["model"],
            seed=int(seed),
            steps=int(steps),
            cfg=float(cfg),
            sampler_name=sampler_name,
            scheduler=scheduler,
            positive=pipe["positive"],
            negative=pipe["negative"],
            latent_image=latent,
            denoise=float(denoise),
            LanPaint_NumSteps=int(lanpaint_steps),
            LanPaint_PromptMode=prompt_mode,
            LanPaint_Info="DirtyBirds image inpainting",
            Inpainting_mode="🖼️ Image Inpainting",
        )[0]
        decoded = vae.decode(sampled["samples"])

        blender = _lanpaint_class("LanPaint_MaskBlend")()
        final_image = blender.blend_images(
            image1=image,
            image2=decoded,
            mask=mask,
            blend_overlap=int(blend_feather),
        )[0]

        pipe["samples"] = sampled
        pipe["images"] = final_image
        pipe["seed"] = int(seed)
        pipe["denoise"] = float(denoise)
        pipe["loader_settings"] = copy.copy(pipe.get("loader_settings") or {})
        return (pipe, final_image, sampled)


NODE_CLASS_MAPPINGS = {"DirtyBirdsInpaint": DirtyBirdsInpaint}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsInpaint": "🖌️ Inpainting · LanPaint"}
