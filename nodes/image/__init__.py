"""
DirtyBirds Playhouse — Load Image node.

A branded Load Image node that pulls an image from the ComfyUI input folder
(upload picker) OR from a URL / local path, and outputs a clean IMAGE + MASK
(plus width/height), with optional native SAM3 text-prompted segmentation
(see sam3.py in this folder).

Segmentation runs through our own native SAM3 module — no dependency on
ComfyUI-RMBG or any other node pack.
"""

import os
import io
import hashlib
import logging
import urllib.request

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths

logger = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (DirtyBirds-Playhouse ComfyUI node)"


def _open_source(image, image_url):
    """Resolve inputs to a PIL.Image. URL/local path override the picker."""
    src = (image_url or "").strip()
    if src:
        if src.startswith(("http://", "https://")):
            req = urllib.request.Request(src, headers={"User-Agent": _UA})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return Image.open(io.BytesIO(resp.read()))
        if os.path.isfile(src):
            return Image.open(src)
        # Treat as a name inside the input directory.
        cand = os.path.join(folder_paths.get_input_directory(), src)
        if os.path.isfile(cand):
            return Image.open(cand)
        raise FileNotFoundError(f"image not found: {src}")
    # No override → the upload-picker selection.
    return Image.open(folder_paths.get_annotated_filepath(image))


def _to_tensors(img):
    """Replicate ComfyUI's native LoadImage conversion: IMAGE [1,H,W,3] + MASK."""
    output_images, output_masks = [], []
    w, h = None, None
    for frame in ImageSequence.Iterator(img):
        frame = ImageOps.exif_transpose(frame)
        if frame.mode == "I":
            frame = frame.point(lambda x: x * (1 / 255))
        rgb = frame.convert("RGB")
        if w is None:
            w, h = rgb.size
        if rgb.size[0] != w or rgb.size[1] != h:
            continue  # skip frames of a differing size (animated/multi-size)
        arr = np.array(rgb).astype(np.float32) / 255.0
        output_images.append(torch.from_numpy(arr)[None, ])
        if "A" in frame.getbands():
            mask = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        else:
            mask = torch.zeros((h, w), dtype=torch.float32)
        output_masks.append(mask.unsqueeze(0))

    if len(output_images) > 1:
        image = torch.cat(output_images, dim=0)
        mask = torch.cat(output_masks, dim=0)
    else:
        image = output_images[0]
        mask = output_masks[0]
    return image, mask, w, h


def _run_sam3(image_tensor, prompt, confidence):
    """Segment via our native SAM3 module (sam3.py in this folder).

    Returns (cutout_image, mask) tensors, or None if SAM3 is unavailable or the
    call fails (caller then falls back to passthrough)."""
    try:
        from . import sam3  # native, self-contained — no node-registry lookup
        cutout, mask = sam3.segment(image_tensor, prompt, float(confidence))
        return cutout, mask
    except Exception as e:
        logger.warning("[DirtyBirds] SAM3 segmentation failed (%s); passing image through.", e)
        return None


class DirtyBirdsLoadImage:
    """Load an image (folder/URL/path), optionally SAM3-segment it.

    Outputs the original IMAGE plus a MASK and a SEGMENTED cutout. With
    `segment` off, MASK is the alpha mask and SEGMENTED mirrors IMAGE."""

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [""] + sorted(
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ) if os.path.isdir(input_dir) else []
        return {
            "required": {
                "image": (files, {"image_upload": True, "default": ""}),
            },
            "optional": {
                "image_url": ("STRING", {
                    "default": "",
                    "placeholder": "http(s):// or local path — overrides the picker when set",
                }),
                "segment": ("BOOLEAN", {"default": False}),
                "segment_prompt": ("STRING", {
                    "default": "",
                    "placeholder": "describe what to segment (native SAM3)",
                }),
                "confidence": ("FLOAT", {"default": 0.5, "min": 0.05, "max": 0.95, "step": 0.01}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "MASK", "SEGMENTED", "width", "height")
    FUNCTION = "load"
    CATEGORY = "DirtyBirds"

    def load(self, image=None, image_url="", segment=False, segment_prompt="", confidence=0.5):
        img = _open_source(image, image_url)
        out_image, out_mask, w, h = _to_tensors(img)
        segmented = out_image
        if segment and (segment_prompt or "").strip():
            res = _run_sam3(out_image, segment_prompt.strip(), confidence)
            if res is not None:
                segmented, out_mask = res
        return (out_image, out_mask, segmented, w, h)

    @classmethod
    def IS_CHANGED(cls, image=None, image_url="", segment=False, segment_prompt="", confidence=0.5):
        seg_key = f"|{bool(segment)}|{segment_prompt}|{confidence}"
        src = (image_url or "").strip()
        if src:
            if src.startswith(("http://", "https://")):
                return src + seg_key  # fixed URL -> stable cache key
            path = src if os.path.isfile(src) else os.path.join(
                folder_paths.get_input_directory(), src)
        else:
            path = folder_paths.get_annotated_filepath(image)
        try:
            m = hashlib.sha256()
            with open(path, "rb") as f:
                m.update(f.read())
            return m.hexdigest() + seg_key
        except Exception:
            return (src or image) + seg_key

    @classmethod
    def VALIDATE_INPUTS(cls, image=None, image_url="", segment=False, segment_prompt="", confidence=0.5):
        # When `image_url` supplies the source the picker is irrelevant, so an
        # empty/absent `image` is fine. ComfyUI omits `image` from the call when
        # the widget has no value, hence the default above.
        if (image_url or "").strip():
            return True
        if not image:
            return "No image selected: pick a file or set image_url."
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"DirtyBirdsLoadImage": DirtyBirdsLoadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsLoadImage": "📸 Peep Show"}
