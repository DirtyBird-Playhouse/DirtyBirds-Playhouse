"""DirtyBirds adapter for Forbidden Vision's face Fixer.

The Forbidden Vision Fixer implementation is vendored with this node. This
adapter replaces its model/conditioning/image inputs with a single
DIRTYBIRDS_PIPE and puts the fixed image back into the returned pipe.
"""

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

_ALL_COMPARE = "All (Compare)"
# The three real restore methods run, in order, by the "All (Compare)" mode.
_COMPARE_METHODS = ("Diffusion (Inpaint)", "GFPGAN", "CodeFormer")
_RESTORE_METHODS = (*_COMPARE_METHODS, _ALL_COMPARE)
_DEFAULT_RESTORE_METHOD = "Diffusion (Inpaint)"
_DEFAULT_CODEFORMER_FIDELITY = 0.5

# Blocking in-node picker for "All (Compare)": show all restores, keep the picks.
# Built at import (startup) so its route is live before the server freezes. Guarded
# so the node still imports when loaded in isolation (tests) or without a server:
# _PICKER is then None and All-Compare simply passes every result through.
try:
    from ..utils.picker import ImagePicker

    _PICKER = ImagePicker(
        event="dirtybirds-fixer-pick",
        route="/dirtybirds/fixer-pick",
        timeout=180,
        label="Fixer pick",
    )
except Exception:  # noqa: BLE001 - relative import beyond top-level, or no server
    _PICKER = None


def _fixer_class():
    """Return DirtyBirds' private, vendored Fixer implementation.

    Imported lazily so this node still registers when the Fixer's heavy vision
    dependencies (opencv, ultralytics, timm, segmentation-models-pytorch, …) are
    not installed. Missing deps then surface as a clear error when the node is
    actually used, rather than as a pack-wide "no supported nodes" at load time.
    """
    from .vendor.face_processor_integrated import ForbiddenVisionFaceProcessorIntegrated
    return ForbiddenVisionFaceProcessorIntegrated


class DirtyBirdsFixer:
    """Forbidden Vision Fixer wired for a DIRTYBIRDS_PIPE."""

    @classmethod
    def INPUT_TYPES(cls):
        try:
            source = _fixer_class().INPUT_TYPES()
        except Exception:
            # Vision dependencies (opencv, ultralytics, timm, …) aren't
            # installed. Expose a minimal schema so the node still lists and
            # /object_info stays healthy; running it raises a clear error that
            # points at requirements.txt.
            return {"required": {"db_pipe": ("DIRTYBIRDS_PIPE",)}}
        required = dict(source.get("required", {}))
        optional = dict(source.get("optional", {}))

        for name in ("model", "vae", "positive", "negative"):
            required.pop(name, None)
        for name in (*_INTERNAL_DEFAULTS, "seed"):
            required.pop(name, None)
        for name in ("image", "latent", "clip"):
            optional.pop(name, None)

        # Offer "All (Compare)" alongside the vendored restore methods.
        rm = required.get("restore_method")
        if rm and isinstance(rm[0], (list, tuple)) and _ALL_COMPARE not in rm[0]:
            cfg = dict(rm[1]) if len(rm) > 1 and isinstance(rm[1], dict) else {}
            cfg["tooltip"] = (cfg.get("tooltip", "").rstrip() +
                              " · 'All (Compare)' runs Diffusion, GFPGAN and "
                              "CodeFormer, then lets you pick which to keep.").strip()
            required["restore_method"] = ([*rm[0], _ALL_COMPARE], cfg)

        # How long the "All (Compare)" picker blocks before keeping every result.
        required["pick_timeout"] = ("INT", {"default": 180, "min": 5, "max": 600, "step": 5})

        return {
            "required": {"db_pipe": ("DIRTYBIRDS_PIPE",), **required},
            "optional": optional,
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("db_pipe", "image", "face")
    FUNCTION = "fix"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # "All (Compare)" shows a blocking picker every run, so force re-execution.
        # Other methods keep normal input-hash caching (don't re-restore for free).
        if kwargs.get("restore_method") == _ALL_COMPARE:
            return float("nan")
        return ""

    def __init__(self):
        self._implementation = None

    def fix(self, db_pipe, **settings):
        pipe = dict(db_pipe or {})
        # Hidden node id (for routing the All-Compare picker); not a vendor arg.
        unique_id = settings.pop("unique_id", None)
        # Picker timeout (All-Compare only); DirtyBirds arg, not a vendor arg.
        try:
            pick_timeout = int(settings.pop("pick_timeout", 180))
        except (TypeError, ValueError):
            pick_timeout = 180
        if self._implementation is None:
            try:
                self._implementation = _fixer_class()()
            except ImportError as exc:
                raise RuntimeError(
                    "The Fixer needs extra dependencies that aren't installed. "
                    "Run `pip install -r requirements.txt` in the "
                    f"DirtyBirds-Playhouse folder (missing module: {exc.name})."
                ) from exc

        settings.update(_INTERNAL_DEFAULTS)
        if settings.get("restore_method") not in _RESTORE_METHODS:
            settings["restore_method"] = _DEFAULT_RESTORE_METHOD
        try:
            settings["codeformer_fidelity"] = float(settings.get("codeformer_fidelity"))
        except (TypeError, ValueError):
            settings["codeformer_fidelity"] = _DEFAULT_CODEFORMER_FIDELITY
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

        call = {
            "model": pipe["model"],
            "vae": pipe["vae"],
            "positive": pipe["positive"],
            "negative": pipe["negative"],
            "latent": latent,
            "clip": pipe.get("clip"),
            **settings,
        }

        # "All (Compare)": run every method and let the user pick which to keep.
        if settings["restore_method"] == _ALL_COMPARE:
            return self._run_all_compare(pipe, image, call, settings, unique_id, pick_timeout)

        final_image, processed_face, comparison = self._run_once(image, call)
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

    def _run_once(self, image, call):
        """Run the vendored processor once over ``image``. ForbiddenVision's
        detector takes one BHWC image at a time, so a batch >1 is processed frame
        by frame and rebuilt. Returns (final_image, processed_face, comparison)."""
        import torch
        batch_size = (
            int(image.shape[0])
            if image is not None and hasattr(image, "shape") and hasattr(image, "__getitem__")
            else 1
        )
        if image is not None and batch_size > 1:
            results = [
                self._implementation.process_face_complete(image=image[i:i + 1], **call)
                for i in range(batch_size)
            ]
            final_image = torch.cat([item[0] for item in results], dim=0)
            processed_face = torch.cat([item[1] for item in results], dim=0)
            comparison = torch.cat([item[2] for item in results], dim=0)
        else:
            final_image, processed_face, comparison, _ = \
                self._implementation.process_face_complete(image=image, **call)
        return final_image, processed_face, comparison

    def _run_all_compare(self, pipe, image, call, settings, unique_id=None, pick_timeout=180):
        """Run Diffusion + GFPGAN + CodeFormer over the input, push all results to
        the in-node picker, and keep only the user's selection (all on timeout)."""
        import torch
        try:
            import comfy.utils
            progress = comfy.utils.ProgressBar(len(_COMPARE_METHODS))
        except ImportError:  # repository-only unit tests
            progress = None

        finals, faces = [], []
        try:
            for method in _COMPARE_METHODS:
                # Reusing the detector and restore models across the comparison
                # avoids a GPU->CPU offload between GFPGAN and CodeFormer. That
                # per-pass cleanup could remain at 100% and prevent pass three.
                compare_call = {
                    **call,
                    "restore_method": method,
                    "offload_models_to_cpu": False,
                }
                final_image, processed_face, _ = self._run_once(image, compare_call)
                finals.append(final_image)
                faces.append(processed_face)
                if progress is not None:
                    progress.update(1)
        finally:
            # Comparison is one logical operation: release its shared models
            # once, after all three methods (or after an error/interruption).
            try:
                self._implementation.face_detector.model_manager.offload_to_cpu()
            except Exception:
                pass
            try:
                from .vendor.face_restore import FaceRestoreManager
                FaceRestoreManager.get_instance().offload_to_cpu()
            except Exception:
                pass

        # Each method may return tensors on a different device (Diffusion stays on
        # cuda; the GAN restores come back on cpu). Normalise before concatenating,
        # otherwise torch.cat raises "tensors on different devices".
        target = finals[0].device
        finals = [t.to(target) for t in finals]
        faces = [t.to(target) for t in faces]

        # Group outputs by method: [Diffusion frames…, GFPGAN…, CodeFormer…].
        batch = torch.cat(finals, dim=0)
        faces_batch = torch.cat(faces, dim=0)
        per_method = int(finals[0].shape[0])
        labels = [m for m in _COMPARE_METHODS for _ in range(per_method)]
        total = int(batch.shape[0])

        pipe["images"] = batch
        try:
            from nodes import PreviewImage
            previews = PreviewImage().save_images(batch)["ui"]["images"]
        except Exception:
            # No preview surface (e.g. tests) -> skip the picker, pass all through.
            return (pipe, batch, faces_batch)
        for preview, label in zip(previews, labels):
            preview["width"] = int(batch.shape[2])
            preview["height"] = int(batch.shape[1])
            preview["label"] = label

        # Blocking in-node picker: show all three restores and keep only the
        # user's picks. Mirrors the Sampler's proven handshake; the frontend
        # renders the grid from the "dirtybirds-fixer-pick" event and POSTs the
        # selection back. Without a picker (tests/no server) keep every result.
        picked = list(range(total))          # default / fallback = keep all
        if _PICKER is not None:
            import uuid
            token = str(uuid.uuid4())
            selection = _PICKER.wait_for_pick(
                token,
                {"images": previews, "labels": labels,
                 "count": total, "node_id": str(unique_id)},
                timeout=max(5, int(pick_timeout)),
            )
            if selection:                    # None = timeout (keep all)
                seen = set()
                picked = [i for i in selection
                          if 0 <= i < total and not (i in seen or seen.add(i))]
                if not picked:               # cancelled / deselected everything
                    picked = list(range(total))

        batch = torch.stack([batch[i] for i in picked])
        faces_batch = torch.stack([faces_batch[i] for i in picked])
        picked_previews = [previews[i] for i in picked]
        pipe["images"] = batch
        return {"ui": {"db_fixer_batch": picked_previews,
                       "db_fixer_resolution": [settings["processing_resolution"]]},
                "result": (pipe, batch, faces_batch)}


NODE_CLASS_MAPPINGS = {"DirtyBirdsFixer": DirtyBirdsFixer}
# Forbidden Vision credit lives in the module docstring / README.
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsFixer": "💄 Face Restore"}
