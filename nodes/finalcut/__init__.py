"""
DirtyBirds Playhouse — 🎬 Final Cut.

A "restore → sharpen" finishing node: it face-restores and GLSL-sharpens every
incoming image, and emits a before/after preview. (Image picking now lives in
the Sampler node.)
"""

import os
import logging

import cv2
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
# ComfyUI doesn't know about My_AI_Tools\models\face_restore by default,
# so the FACE MODEL picker shows "(none installed)". Register it (absolute, plus
# a path derived relative to this file in case the suite is relocated) so
# get_filename_list("facerestore_models") returns the installed .pth models.
def _register_facerestore_folders():
    candidates = [
        r"C:\Users\mpick\My_AI_Tools\models\face_restore",
        os.path.normpath(os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "models",
            "face_restore")),
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
        models = folder_paths.get_filename_list("facerestore_models")
        # The extracted ReActor restoration path supports PTH CodeFormer and
        # Spandrel-compatible GFPGAN/RestoreFormer models.
        return [
            model for model in models
            if model.lower().endswith(".pth")
        ]
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
        path = folder_paths.get_full_path("facerestore_models", model_name)
        if not path:
            raise RuntimeError(f"face-restore model not found: {model_name}")
        if "codeformer" in model_name.lower():
            from .codeformer_arch import CodeFormer
            model = CodeFormer(
                dim_embd=512, codebook_size=1024, n_head=8, n_layers=9,
                connect_list=["32", "64", "128", "256"],
            )
            checkpoint = comfy.utils.load_torch_file(path, safe_load=True)
            # ComfyUI's loader may already unwrap params_ema. Accept both the
            # original CodeFormer package and normalized/raw state dictionaries.
            state_dict = checkpoint
            for key in ("params_ema", "params-ema", "params", "state_dict"):
                if isinstance(state_dict, dict) and key in state_dict:
                    state_dict = state_dict[key]
                    break
            if not isinstance(state_dict, dict) or "position_emb" not in state_dict:
                raise RuntimeError(
                    f"'{model_name}' does not contain recognizable CodeFormer weights"
                )
            model.load_state_dict(state_dict)
            _RESTORER_CACHE[model_name] = ("codeformer", model.eval())
        else:
            import spandrel
            sd = comfy.utils.load_torch_file(path, safe_load=True)
            try:
                model = spandrel.ModelLoader().load_from_state_dict(sd).eval()
            except Exception as e:
                raise RuntimeError(
                    f"'{model_name}' isn't a supported face-restoration model: {e}"
                ) from e
            _RESTORER_CACHE[model_name] = ("spandrel", model)
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


# Parse-map class -> mask value. Ported verbatim from ReActor / facexlib: keeps
# facial skin + features (255) and drops hair/background/ears (0), so the paste
# is confined to the actual face shape rather than the square crop.
_MASK_COLORMAP = [0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
                  255, 255, 255, 255, 0, 255, 0, 0, 0]


def _paste_faces_feathered(helper, bgr):
    """Paste restored faces back onto `bgr`.

    Ported from comfyui-reactor-node's
    r_facelib/utils/face_restoration_helper.py::paste_faces_to_input_image
    (upscale_factor=1, no upsampler, no draw_box). The essential difference from
    stock facexlib is that ReActor combines a square feather mask with the
    face-parsing mask, taking the TIGHTER of the two per pixel. The parse mask
    clips the blend to actual skin, so the square crop's background corners are
    never composited in — which is what removes the visible paste-back box.
    """
    from facexlib.utils import img2tensor
    from torchvision.transforms.functional import normalize

    h, w = bgr.shape[:2]
    face_size = helper.face_size  # (512, 512)
    upsample_img = bgr.astype(np.float32)

    for restored_face, inverse_affine in zip(helper.restored_faces, helper.inverse_affine_matrices):
        inv_restored = cv2.warpAffine(restored_face, inverse_affine, (w, h)).astype(np.float32)

        # Square mask feather (fusion edge scaled to face area) — identical to ReActor.
        mask = np.ones(face_size, dtype=np.float32)
        inv_mask = cv2.warpAffine(mask, inverse_affine, (w, h))
        inv_mask_erosion = cv2.erode(inv_mask, np.ones((2, 2), np.uint8))
        pasted_face = inv_mask_erosion[:, :, None] * inv_restored
        total_face_area = np.sum(inv_mask_erosion)
        w_edge = int(total_face_area ** 0.5) // 20
        erosion_radius = w_edge * 2
        inv_mask_center = cv2.erode(inv_mask_erosion, np.ones((erosion_radius, erosion_radius), np.uint8))
        blur_size = w_edge * 2
        inv_soft_mask = cv2.GaussianBlur(inv_mask_center, (blur_size + 1, blur_size + 1), 0)[:, :, None]

        # Face-parsing mask, combined with the square feather via the tighter value.
        if helper.use_parse:
            face_input = cv2.resize(restored_face, (512, 512), interpolation=cv2.INTER_LINEAR)
            face_input = img2tensor(face_input.astype("float32") / 255., bgr2rgb=True, float32=True)
            normalize(face_input, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
            face_input = torch.unsqueeze(face_input, 0).to(helper.device)
            with torch.no_grad():
                out = helper.face_parse(face_input)[0]
            out = out.argmax(dim=1).squeeze().cpu().numpy()

            parse_mask = np.zeros(out.shape)
            for idx, color in enumerate(_MASK_COLORMAP):
                parse_mask[out == idx] = color
            parse_mask = cv2.GaussianBlur(parse_mask, (101, 101), 11)
            parse_mask = cv2.GaussianBlur(parse_mask, (101, 101), 11)
            thres = 10
            parse_mask[:thres, :] = 0
            parse_mask[-thres:, :] = 0
            parse_mask[:, :thres] = 0
            parse_mask[:, -thres:] = 0
            parse_mask = parse_mask / 255.

            parse_mask = cv2.resize(parse_mask, face_size)
            parse_mask = cv2.warpAffine(parse_mask, inverse_affine, (w, h), flags=3)
            inv_soft_parse_mask = parse_mask[:, :, None]
            fuse_mask = (inv_soft_parse_mask < inv_soft_mask).astype("int")
            inv_soft_mask = inv_soft_parse_mask * fuse_mask + inv_soft_mask * (1 - fuse_mask)

        upsample_img = inv_soft_mask * pasted_face + (1 - inv_soft_mask) * upsample_img

    return upsample_img.clip(0, 255).astype(np.uint8)


def _restore_faces(images, model_name, det_model, visibility):
    """Restore faces in an IMAGE batch [B,H,W,3] RGB 0..1. Returns same shape."""
    device = model_management.get_torch_device()
    restorer_kind, desc = _load_restorer(model_name)
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
                if restorer_kind == "codeformer":
                    # ReActor's default fidelity weight is 0.5. CodeFormer
                    # consumes and returns normalized RGB in the [-1, 1] range.
                    res = desc(t.mul(2.0).sub(1.0), w=0.5)[0]
                    res = res.add(1.0).div(2.0)
                else:
                    res = desc(t)  # Spandrel: [0,1] RGB
            res_img = (res[0].permute(1, 2, 0).clamp(0, 1).cpu().numpy() * 255).round().astype(np.uint8)
            helper.add_restored_face(np.ascontiguousarray(res_img[:, :, ::-1]))  # back to BGR

        helper.get_inverse_affine(None)
        restored_bgr = _paste_faces_feathered(helper, bgr)
        restored = restored_bgr[:, :, ::-1].astype(np.float32) / 255.0  # RGB 0..1

        if restored.shape != orig.shape:  # safety; paste should preserve size
            restored = orig
        blended = orig * (1.0 - visibility) + restored * visibility
        out.append(torch.from_numpy(np.ascontiguousarray(blended)).float())

    return torch.stack(out)


# ── Stage 3: GLSL sharpen (reuses comfy-core's shader engine) ────────────────
# A 4-neighbour unsharp mask. u_image0 is the source; u_float0 is the amount
# (0..0.5 from the UI). The * 5.0 gain spreads that range from subtle to strong.
_SHARPEN_SHADER = """#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_float0;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() {
    vec2 px = 1.0 / u_resolution;
    vec4 c = texture(u_image0, v_texCoord);
    vec4 n = texture(u_image0, v_texCoord + vec2(0.0, px.y));
    vec4 s = texture(u_image0, v_texCoord - vec2(0.0, px.y));
    vec4 e = texture(u_image0, v_texCoord + vec2(px.x, 0.0));
    vec4 w = texture(u_image0, v_texCoord - vec2(px.x, 0.0));
    vec3 sharp = c.rgb + (u_float0 * 5.0) * (4.0 * c.rgb - n.rgb - s.rgb - e.rgb - w.rgb);
    fragColor0 = vec4(clamp(sharp, 0.0, 1.0), c.a);
}
"""


def _sharpen_images(images, amount):
    """GLSL-sharpen an IMAGE batch [B,H,W,3] in-place size (no resize)."""
    # Import lazily: comfy_extras.nodes_glsl runs an OpenGL availability check at
    # import time and raises when glfw/PyOpenGL are missing. Keeping it here lets
    # the caller treat a missing-OpenGL environment as a skipped finishing pass.
    from comfy_extras.nodes_glsl import _render_shader_batch

    arr = images.detach().cpu().numpy().astype(np.float32)  # [B,H,W,3]
    b, h, w = arr.shape[0], arr.shape[1], arr.shape[2]
    image_batches = [[arr[i]] for i in range(b)]  # one input image (u_image0) per batch

    outputs = _render_shader_batch(
        _SHARPEN_SHADER, w, h, image_batches, [float(amount)], [])

    frames = []
    for batch_out in outputs:
        rgb = batch_out[0][:, :, :3]  # drop alpha from fragColor0 (H,W,4)
        frames.append(torch.from_numpy(np.ascontiguousarray(rgb)).float())
    return torch.stack(frames)


class DirtyBirdsFinalCut:
    """🎬 Final Cut — face-restore and GLSL-sharpen every incoming image."""

    @classmethod
    def INPUT_TYPES(cls):
        restore_models = _restore_model_list()
        default_model = _default_restore_model()
        model_opt = (restore_models, {"default": default_model}) if restore_models else (["(none installed)"],)
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
                "visibility": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
                "sharpen": ("BOOLEAN", {"default": True}),
                "sharpen_amount": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 0.5, "step": 0.05}),
            },
            "optional": {
                "pipe": ("DIRTYBIRDS_PIPE",),
                "images": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "IMAGE", "STRING")
    RETURN_NAMES = ("pipe", "IMAGE", "picked_indexes")
    FUNCTION = "run"
    CATEGORY = "DirtyBirds"

    def run(self, timeout=600, ontimeout="send none",
            restore_faces=True, restore_model=None, facedetection="retinaface_resnet50",
            visibility=1.0, sharpen=True, sharpen_amount=0.25,
            pipe=None, images=None, prompt=None, extra_pnginfo=None):
        if images is None and pipe is not None:
            images = pipe.get("images")
        if images is None:
            raise ValueError("No images provided -- connect an IMAGE input or a pipe with images.")
        batch = images.shape[0]
        # Process every incoming image (picking now lives in the Sampler).
        selection = list(range(batch))
        before = images  # keep the pre-finishing frames for the compare preview
        picked = images

        # Stage 2: face restore. Treat this as optional finishing: missing
        # facexlib/spandrel/model support should not discard a completed batch.
        valid_restore_models = _restore_model_list()
        if restore_model not in valid_restore_models:
            restore_model = _default_restore_model()
        if restore_faces and visibility > 0 and restore_model:
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

        # Stage 3: GLSL sharpen. Optional finishing: a missing OpenGL backend or
        # shader failure should not discard a completed batch.
        if sharpen and sharpen_amount > 0:
            try:
                picked = _sharpen_images(picked, sharpen_amount)
            except InterruptProcessingException:
                raise
            except Exception as e:
                logger.warning(
                    "[DirtyBirds] Final Cut sharpen skipped: %s", e, exc_info=True)

        # Before/after compare preview (saved to temp, surfaced by the web UI).
        ui = {"db_before": [], "db_after": []}
        try:
            from nodes import PreviewImage
            saver = PreviewImage()
            ui["db_before"] = saver.save_images(
                before, "dirtybirds.compare.", prompt, extra_pnginfo)["ui"]["images"]
            ui["db_after"] = saver.save_images(
                picked, "dirtybirds.compare.", prompt, extra_pnginfo)["ui"]["images"]
        except Exception as e:
            logger.warning("[DirtyBirds] Final Cut compare preview skipped: %s", e)

        return {
            "ui": ui,
            "result": (pipe, picked, ",".join(str(i) for i in selection)),
        }


NODE_CLASS_MAPPINGS = {"DirtyBirdsFinalCut": DirtyBirdsFinalCut}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsFinalCut": "🎬 Final Cut — Restore, Sharpen"}
