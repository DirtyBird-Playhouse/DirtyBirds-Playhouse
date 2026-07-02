"""DirtyBirds adapter for Forbidden Vision's face Fixer.

The Forbidden Vision Fixer implementation is vendored with this node. This
adapter replaces its model/conditioning/image inputs with a single
DIRTYBIRDS_PIPE and puts the fixed image back into the returned pipe.
"""

from .vendor.face_processor_integrated import ForbiddenVisionFaceProcessorIntegrated

_INTERNAL_DEFAULTS = {
    "face_selection": 0,
    "detection_confidence": 0.75,
    "manual_rotation": "None",
    "enable_pre_upscale": True,
    "upscaler_model": "Fast 4x (Lanczos)",
    "crop_padding": 1.6,
    "processing_resolution": 1024,
    "blend_softness": 8,
    "mask_expansion": 2,
    "sampling_mask_blur_size": 21,
    "sampling_mask_blur_strength": 1.0,
    "enable_color_correction": True,
    "enable_segmentation": True,
    "enable_differential_diffusion": True,
    "enable_lightness_rescue": True,
    "enable_final_refinement": True,
    "offload_models_to_cpu": True,
}


def _fixer_class():
    """Return DirtyBirds' private, vendored Fixer implementation."""
    return ForbiddenVisionFaceProcessorIntegrated


class DirtyBirdsFixer:
    """Forbidden Vision Fixer wired for a DIRTYBIRDS_PIPE."""

    @classmethod
    def INPUT_TYPES(cls):
        source = _fixer_class().INPUT_TYPES()
        required = dict(source.get("required", {}))
        optional = dict(source.get("optional", {}))

        for name in ("model", "vae", "positive", "negative"):
            required.pop(name, None)
        for name in (*_INTERNAL_DEFAULTS, "seed"):
            required.pop(name, None)
        for name in ("image", "latent", "clip"):
            optional.pop(name, None)

        return {
            "required": {"db_pipe": ("DIRTYBIRDS_PIPE",), **required},
            "optional": optional,
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("db_pipe", "image", "face")
    FUNCTION = "fix"
    CATEGORY = "DirtyBirds"

    def __init__(self):
        self._implementation = None

    def fix(self, db_pipe, **settings):
        pipe = dict(db_pipe or {})
        if self._implementation is None:
            self._implementation = _fixer_class()()

        settings.update(_INTERNAL_DEFAULTS)
        settings["seed"] = int(pipe.get("seed", 0) or 0)

        required = ("model", "vae", "positive", "negative")
        missing = [name for name in required if pipe.get(name) is None]
        if missing:
            raise ValueError("db_pipe is missing required Fixer data: " + ", ".join(missing))

        # DirtyBirds Sample stores its decoded result in ``images``. Its pipe
        # latent may still describe the pre-sampling source, so forwarding it
        # would make Forbidden Vision prefer and decode the wrong latent.
        image = pipe.get("images")
        latent = None if image is not None else pipe.get("samples")
        if image is None and latent is None:
            raise ValueError("db_pipe must contain either images or samples for the Fixer")
        if image is not None and hasattr(image, "shape") and len(image.shape) >= 3:
            height, width = int(image.shape[1]), int(image.shape[2])
            settings["processing_resolution"] = max(512, min(2048, max(height, width)))

        result = self._implementation.process_face_complete(
            model=pipe["model"],
            vae=pipe["vae"],
            positive=pipe["positive"],
            negative=pipe["negative"],
            image=image,
            latent=latent,
            clip=pipe.get("clip"),
            **settings,
        )
        final_image, processed_face, comparison, final_mask = result
        pipe["images"] = final_image
        result = (pipe, final_image, processed_face)
        try:
            from nodes import PreviewImage
            split = int(comparison.shape[2]) // 2
            before = PreviewImage().save_images(comparison[:, :, :split, :])["ui"]["images"]
            after = PreviewImage().save_images(comparison[:, :, split:, :])["ui"]["images"]
            return {"ui": {"db_fixer_before": before, "db_fixer_after": after,
                           "db_fixer_resolution": [settings["processing_resolution"]]}, "result": result}
        except Exception:
            return result


NODE_CLASS_MAPPINGS = {"DirtyBirdsFixer": DirtyBirdsFixer}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsFixer": "🎯 Fixer — Forbidden Vision"}
