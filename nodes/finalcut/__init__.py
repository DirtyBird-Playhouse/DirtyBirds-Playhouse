"""
DirtyBirds Playhouse — 🎬 Final Cut.

A "restore → upscale" finishing node: it face-restores and model-upscales every
incoming image. (Image picking now lives in the Sampler node.)
"""

import os
import logging

import numpy as np
import torch

import folder_paths
import comfy.utils
import comfy.model_management as model_management
from comfy.model_management import (
    InterruptProcessingException,
    throw_exception_if_processing_interrupted,
)

logger = logging.getLogger(__name__)


# ── Register the suite's face-restore model folder ───────────────────────────
# ComfyUI doesn't know about My_AI_Tools\models\facerestore_models by default,
# so the FACE MODEL picker shows "(none installed)". Register it (absolute, plus
# a path derived relative to this file in case the suite is relocated) so
# get_filename_list("facerestore_models") returns the installed .pth models.
def _register_facerestore_folders():
    candidates = [
        r"C:\Users\mpick\My_AI_Tools\models\facerestore_models",
        os.path.normpath(os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "models",
            "facerestore_models")),
    ]
    seen = set()
    for path in candidates:
        norm = os.path.normpath(path)
        if norm in seen or not os.path.isdir(norm):
            continue
        seen.add(norm)
        try:
            folder_paths.add_model_folder_path("facerestore_models", norm)
        except Exception:
            logger.debug("[DirtyBirds] could not register facerestore path: %s", norm)


_register_facerestore_folders()


# ── Stage 2: face restore (spandrel model + facexlib detect/align) ───────────
FACEDETECTION = ["retinaface_resnet50", "retinaface_mobile0.25", "YOLOv5l", "YOLOv5n"]

_RESTORER_CACHE = {}   # model_name -> spandrel descriptor
_HELPER_CACHE = {}     # det_model -> FaceRestoreHelper


def _restore_model_list():
    try:
        return folder_paths.get_filename_list("facerestore_models")
    except Exception:
        return []


def _default_restore_model():
    models = _restore_model_list()
    for pref in ("RestoreFormer.pth", "GFPGANv1.4.pth", "GFPGANv1.3.pth"):
        if pref in models:
            return pref
    return models[0] if models else None


def _load_restorer(model_name):
    if model_name not in _RESTORER_CACHE:
        import spandrel
        path = folder_paths.get_full_path("facerestore_models", model_name)
        if not path:
            raise RuntimeError(f"face-restore model not found: {model_name}")
        sd = comfy.utils.load_torch_file(path, safe_load=True)
        try:
            desc = spandrel.ModelLoader().load_from_state_dict(sd).eval()
        except Exception as e:
            raise RuntimeError(
                f"'{model_name}' isn't a spandrel-loadable face model — use a "
                f"GFPGAN/RestoreFormer .pth (not .ckpt/.onnx/codeformer). {e}"
            ) from e
        _RESTORER_CACHE[model_name] = desc
    return _RESTORER_CACHE[model_name]


def _get_helper(det_model, device):
    helper = _HELPER_CACHE.get(det_model)
    if helper is None:
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper
        helper = FaceRestoreHelper(
            1, face_size=512, crop_ratio=(1, 1), det_model=det_model,
            save_ext="png", use_parse=True, device=device,
        )
        _HELPER_CACHE[det_model] = helper
    return helper


def _restore_faces(images, model_name, det_model, visibility):
    """Restore faces in an IMAGE batch [B,H,W,3] RGB 0..1. Returns same shape."""
    device = model_management.get_torch_device()
    desc = _load_restorer(model_name)
    desc.to(device)
    helper = _get_helper(det_model, device)

    arr = images.detach().cpu().numpy()
    out = []
    for i in range(arr.shape[0]):
        throw_exception_if_processing_interrupted()
        orig = arr[i].astype(np.float32)
        bgr = (orig * 255.0).clip(0, 255).astype(np.uint8)[:, :, ::-1]

        helper.clean_all()
        helper.read_image(bgr)
        helper.get_face_landmarks_5(only_center_face=False, resize=640, eye_dist_threshold=5)
        helper.align_warp_face()

        for cropped in helper.cropped_faces:  # BGR uint8 512x512
            cf = (cropped[:, :, ::-1].astype(np.float32) / 255.0)  # RGB 0..1
            t = torch.from_numpy(np.ascontiguousarray(cf.transpose(2, 0, 1)))[None].to(device)
            with torch.no_grad():
                res = desc(t)  # spandrel: [0,1] RGB
            res_img = (res[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy() * 255).round().astype(np.uint8)
            helper.add_restored_face(np.ascontiguousarray(res_img[:, :, ::-1]))  # back to BGR

        helper.get_inverse_affine(None)
        restored_bgr = helper.paste_faces_to_input_image()
        restored = restored_bgr[:, :, ::-1].astype(np.float32) / 255.0  # RGB 0..1

        if restored.shape != orig.shape:  # safety; paste should preserve size
            restored = orig
        blended = orig * (1.0 - visibility) + restored * visibility
        out.append(torch.from_numpy(np.ascontiguousarray(blended)).float())

    return torch.stack(out)


# ── Stage 3: model upscale (spandrel) + optional resize-to-target ────────────
RESCALE_MODES = ["model only", "by percent", "to longer side"]

_UPSCALER_CACHE = {}  # model_name -> spandrel descriptor


def _upscale_model_list():
    try:
        return folder_paths.get_filename_list("upscale_models")
    except Exception:
        return []


def _load_upscaler(model_name):
    if model_name not in _UPSCALER_CACHE:
        import spandrel
        path = folder_paths.get_full_path("upscale_models", model_name)
        if not path:
            raise RuntimeError(f"upscale model not found: {model_name}")
        sd = comfy.utils.load_torch_file(path, safe_load=True)
        if "module.layers.0.residual_group.blocks.0.norm1.weight" in sd:
            sd = comfy.utils.state_dict_prefix_replace(sd, {"module.": ""})
        desc = spandrel.ModelLoader().load_from_state_dict(sd).eval()
        if not isinstance(desc, spandrel.ImageModelDescriptor):
            raise RuntimeError(f"'{model_name}' is not a single-image upscale model")
        _UPSCALER_CACHE[model_name] = desc
    return _UPSCALER_CACHE[model_name]


def _upscale_images(images, model_name, rescale_mode, percent, longer_side):
    """Model-upscale an IMAGE batch, then optionally resize to a target size."""
    device = model_management.get_torch_device()
    desc = _load_upscaler(model_name)
    desc.to(device)

    in_img = images.movedim(-1, -3).to(device)  # BCHW
    tile, overlap = 512, 32
    out_device = model_management.intermediate_device()
    s = None
    try:
        oom = True
        while oom:
            try:
                steps = in_img.shape[0] * comfy.utils.get_tiled_scale_steps(
                    in_img.shape[3], in_img.shape[2], tile_x=tile, tile_y=tile, overlap=overlap)
                pbar = comfy.utils.ProgressBar(steps)
                s = comfy.utils.tiled_scale(
                    in_img, lambda a: desc(a.float()), tile_x=tile, tile_y=tile,
                    overlap=overlap, upscale_amount=desc.scale, pbar=pbar, output_device=out_device)
                oom = False
            except Exception as e:
                model_management.raise_non_oom(e)
                tile //= 2
                if tile < 128:
                    raise
    finally:
        desc.to("cpu")

    if s is None:  # unreachable (loop assigns or raises); guards the type checker
        raise RuntimeError("upscale produced no output")
    s = torch.clamp(s.movedim(-3, -1), min=0, max=1.0)  # BHWC, on out_device

    oh, ow = int(images.shape[1]), int(images.shape[2])
    if rescale_mode == "by percent":
        th, tw = max(1, round(oh * percent / 100.0)), max(1, round(ow * percent / 100.0))
    elif rescale_mode == "to longer side":
        if oh >= ow:
            th, tw = int(longer_side), max(1, round(ow * longer_side / oh))
        else:
            tw, th = int(longer_side), max(1, round(oh * longer_side / ow))
    else:  # model only — keep the model's native upscale
        return s

    t = comfy.utils.common_upscale(s.movedim(-1, 1), tw, th, "bicubic", "disabled")
    return t.movedim(1, -1)


class DirtyBirdsFinalCut:
    """🎬 Final Cut — face-restore and upscale every incoming image."""

    @classmethod
    def INPUT_TYPES(cls):
        restore_models = _restore_model_list()
        default_model = _default_restore_model()
        model_opt = (restore_models, {"default": default_model}) if restore_models else (["(none installed)"],)
        up_models = _upscale_model_list()
        return {
            "required": {
                # Picking moved to the Sampler. These two are kept (hidden in the
                # UI, ignored by run) only to preserve widget order so existing
                # saved workflows don't shift their values onto the wrong inputs.
                "timeout": ("INT", {"default": 600, "min": 1, "max": 86400}),
                "ontimeout": (["send none", "send all", "send first", "send last"],),
                "restore_faces": ("BOOLEAN", {"default": True}),
                "restore_model": model_opt,
                "facedetection": (FACEDETECTION,),
                "visibility": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "upscale": ("BOOLEAN", {"default": True}),
                "upscale_model": (up_models, {"default": up_models[0]}) if up_models else (["(none installed)"],),
                "rescale_mode": (RESCALE_MODES,),
                "rescale_percent": ("INT", {"default": 200, "min": 10, "max": 400, "step": 5}),
                "longer_side": ("INT", {"default": 2048, "min": 64, "max": 8192, "step": 8}),
            },
            "optional": {
                "pipe": ("DIRTYBIRDS_PIPE",),
                "images": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "IMAGE", "STRING")
    RETURN_NAMES = ("pipe", "IMAGE", "picked_indexes")
    FUNCTION = "run"
    CATEGORY = "DirtyBirds"

    def run(self, timeout=600, ontimeout="send none",
            restore_faces=True, restore_model=None, facedetection="retinaface_resnet50",
            visibility=1.0, upscale=True, upscale_model=None,
            rescale_mode="model only", rescale_percent=200, longer_side=2048,
            pipe=None, images=None):
        if images is None and pipe is not None:
            images = pipe.get("images")
        if images is None:
            raise ValueError("No images provided -- connect an IMAGE input or a pipe with images.")
        batch = images.shape[0]
        # Process every incoming image (picking now lives in the Sampler).
        selection = list(range(batch))
        picked = images

        # Stage 2: face restore. Treat this as optional finishing: missing
        # facexlib/spandrel/model support should not discard a completed batch.
        if restore_faces and visibility > 0 and restore_model and restore_model != "(none installed)":
            try:
                picked = _restore_faces(picked, restore_model, facedetection, visibility)
            except InterruptProcessingException:
                raise
            except Exception as e:
                logger.warning(
                    "[DirtyBirds] Final Cut face restore skipped: %s",
                    e,
                    exc_info=True,
                )

        # Stage 3: model upscale (+ optional resize-to-target).
        if upscale and upscale_model and upscale_model != "(none installed)":
            try:
                picked = _upscale_images(picked, upscale_model, rescale_mode,
                                         rescale_percent, longer_side)
            except InterruptProcessingException:
                raise
            except Exception as e:
                logger.exception("[DirtyBirds] Final Cut upscale failed")
                raise RuntimeError(f"Final Cut upscale failed: {e}") from e

        return (pipe, picked, ",".join(str(i) for i in selection))


NODE_CLASS_MAPPINGS = {"DirtyBirdsFinalCut": DirtyBirdsFinalCut}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsFinalCut": "🎬 Final Cut — Restore, Upscale"}
