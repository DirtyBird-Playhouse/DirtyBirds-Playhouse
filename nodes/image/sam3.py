"""
DirtyBirds Playhouse — native SAM3 segmentation.

Runs Meta's SAM3 text-prompted segmentation ourselves by importing the `sam3`
Python package (installed in the ComfyUI environment), pointed at a local
`sam3.pt` checkpoint. This deliberately does NOT call into any other custom
node's registry — `import sam3` is a plain Python dependency, like torch/PIL.

Public entry point:
    segment(image_tensor, prompt, confidence, unload=False) -> (segmented, mask)

`image_tensor` is a ComfyUI IMAGE [B, H, W, C] in [0, 1]; we segment the first
frame. Returns a black-background cutout IMAGE [1, H, W, C] and a MASK [1, H, W].
"""

import os
import logging

import numpy as np
import torch
from PIL import Image

import folder_paths
import comfy.model_management

logger = logging.getLogger(__name__)

CHECKPOINT_NAME = "sam3.pt"

# The checkpoint's known absolute location on this machine (user-provided).
# This is the authoritative source; the folder_paths lookups below are fallbacks.
SAM3_CHECKPOINT = r"C:\Users\mpick\My_AI_Tools\models\sam3\sam3.pt"

# BPE tokenizer vocab, vendored INTO this pack so we don't rely on the `sam3`
# package's default lookup — that default resolves relative to whichever `sam3`
# module Python loaded first (comfyui_sam3's or comfyui-rmbg's), and lands on a
# path that may not exist. `assets/` lives in this node folder (alongside sam3.py).
BPE_PATH = os.path.join(os.path.dirname(__file__), "assets", "bpe_simple_vocab_16e6.txt.gz")

# The venv that holds comfyui_sam3's installed `sam3` package (matches sam3.pt).
# comfyui-rmbg ALSO ships a top-level `sam3`, so a bare `import sam3` is a coin
# flip; we force the site-packages copy here. Derived from the install root.
_VENV_SITE_PACKAGES = r"C:\Users\mpick\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Lib\site-packages"

# Loaded once; the 3.2 GB model is reused across runs.
_SAM3 = {"model": None, "processor": None, "device": None}


def _import_sam3_modules():
    """Deterministically import comfyui_sam3's `sam3` (in the venv site-packages),
    not comfyui-rmbg's bundled copy. Both register the top-level name `sam3` and
    whichever node ComfyUI loaded first wins a bare `import sam3` — and RMBG's
    copy expects a different checkpoint than our sam3.pt. We evict any cached
    `sam3*` modules and put site-packages first so the right one loads."""
    import sys
    import importlib

    if os.path.isfile(os.path.join(_VENV_SITE_PACKAGES, "sam3", "model_builder.py")):
        for name in [m for m in sys.modules if m == "sam3" or m.startswith("sam3.")]:
            del sys.modules[name]
        if _VENV_SITE_PACKAGES in sys.path:
            sys.path.remove(_VENV_SITE_PACKAGES)
        sys.path.insert(0, _VENV_SITE_PACKAGES)

    mb = importlib.import_module("sam3.model_builder")
    sp = importlib.import_module("sam3.model.sam3_image_processor")
    return mb.build_sam3_image_model, sp.Sam3Processor


# ---------------------------------------------------------------------------
# Checkpoint resolution
# ---------------------------------------------------------------------------

def _candidate_checkpoints():
    """Ordered list of places sam3.pt might live; first existing wins."""
    cands = []

    # 1) The known absolute location the user provided — authoritative.
    cands.append(SAM3_CHECKPOINT)

    # 2) Anything registered under a "sam3" folder type (fallback).
    try:
        for d in folder_paths.get_folder_paths("sam3"):
            cands.append(os.path.join(d, CHECKPOINT_NAME))
    except Exception:
        pass

    # 3) <ComfyUI>/models/sam3/sam3.pt — derive the models root from a known
    #    folder type's parent (fallback; mirrors how comfyui_sam3 searches).
    try:
        ckpt_dirs = folder_paths.get_folder_paths("checkpoints")
        if ckpt_dirs:
            models_root = os.path.dirname(ckpt_dirs[0])
            cands.append(os.path.join(models_root, "sam3", CHECKPOINT_NAME))
    except Exception:
        pass

    return cands


def _find_checkpoint():
    """Resolve sam3.pt or raise with the searched locations. Registers the
    containing dir under a "sam3" folder type so it's discoverable afterward."""
    tried = []
    for path in _candidate_checkpoints():
        norm = os.path.normpath(path)
        tried.append(norm)
        if os.path.isfile(norm):
            try:
                folder_paths.add_model_folder_path("sam3", os.path.dirname(norm))
            except Exception:
                pass
            return norm
    raise RuntimeError(
        "SAM3 checkpoint '%s' not found. Searched:\n  %s\nPlace the checkpoint "
        "at one of these locations." % (CHECKPOINT_NAME, "\n  ".join(tried))
    )


# ---------------------------------------------------------------------------
# Model loading (cached)
# ---------------------------------------------------------------------------

def _load(device_str):
    if (_SAM3["model"] is not None and _SAM3["processor"] is not None
            and _SAM3["device"] == device_str):
        return _SAM3["model"], _SAM3["processor"]

    try:
        build_sam3_image_model, Sam3Processor = _import_sam3_modules()
    except ImportError as e:
        raise RuntimeError(
            "The 'sam3' Python package is not installed in this ComfyUI "
            "environment, so segmentation can't run. Install SAM3 (the package "
            "that provides `import sam3`) into this Python env, then retry."
        ) from e

    ckpt = _find_checkpoint()
    if not os.path.isfile(BPE_PATH):
        raise RuntimeError(
            "SAM3 tokenizer vocab is missing from the pack: %s. It should ship "
            "with DirtyBirds (assets/bpe_simple_vocab_16e6.txt.gz)." % BPE_PATH)
    logger.info("[DirtyBirds] Loading SAM3 image model on %s from %s", device_str, ckpt)
    model = build_sam3_image_model(
        checkpoint_path=ckpt,
        bpe_path=BPE_PATH,
        device=device_str,
        load_from_HF=False,
        enable_segmentation=True,
    )
    processor = Sam3Processor(model, device=device_str)

    _SAM3.update(model=model, processor=processor, device=device_str)
    return model, processor


def _unload():
    _SAM3.update(model=None, processor=None, device=None)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

@torch.inference_mode()
def segment(image_tensor, prompt, confidence, unload=False):
    """Segment the first frame of `image_tensor` by text `prompt`.

    Returns (segmented [1,H,W,C], mask [1,H,W]) as CPU float32 tensors. With no
    matches, returns a zero mask and a black cutout (so an empty result is
    visible rather than a silent passthrough)."""
    device = comfy.model_management.get_torch_device()
    device_str = "cuda" if device.type == "cuda" else "cpu"

    _model, processor = _load(device_str)

    frame = image_tensor[0]                       # [H, W, C] in [0, 1]
    h, w = int(frame.shape[0]), int(frame.shape[1])
    pil = Image.fromarray((frame.cpu().numpy() * 255).astype(np.uint8)[..., :3])

    state = processor.set_image(pil)
    processor.confidence_threshold = float(confidence)
    state = processor.set_text_prompt(prompt.strip() or "object", state)

    masks = state.get("masks")                    # [N, 1, H, W] bool, or None
    if masks is None or masks.shape[0] == 0:
        logger.warning("[DirtyBirds] SAM3: no objects matched '%s' at confidence %.2f",
                       prompt, float(confidence))
        mask_hw = torch.zeros((h, w), dtype=torch.float32)
    else:
        # Merge all detections into one mask (per-pixel max).
        merged = masks.float().amax(dim=0)        # [1, H, W]
        mask_hw = merged[0].to(dtype=torch.float32, device="cpu")

    out_mask = mask_hw.unsqueeze(0)               # [1, H, W]
    cutout = (frame.cpu().to(torch.float32) * mask_hw.unsqueeze(-1)).unsqueeze(0)  # [1,H,W,C]

    if unload:
        _unload()

    return cutout, out_mask
