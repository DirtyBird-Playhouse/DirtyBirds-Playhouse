"""
DirtyBirds Playhouse — Load Image node.

A branded Load Image node that pulls an image from the ComfyUI input folder
(upload picker) OR from a URL / local path and outputs a clean IMAGE + alpha
MASK. Text-prompted segmentation is owned by the Inpainting node.
"""

import os
import io
import hashlib
import logging
import urllib.request
import urllib.parse
from html.parser import HTMLParser

import numpy as np
import torch
from PIL import Image, ImageFilter, ImageOps, ImageSequence

import folder_paths

logger = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (DirtyBirds-Playhouse ComfyUI node)"
_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


class _SocialImageParser(HTMLParser):
    """Find the preview image advertised by a normal webpage."""

    def __init__(self):
        super().__init__()
        self.image_url = None

    def handle_starttag(self, tag, attrs):
        if self.image_url or tag.lower() != "meta":
            return
        values = {str(key).lower(): value for key, value in attrs}
        name = str(values.get("property") or values.get("name") or "").lower()
        if name in {"og:image", "og:image:url", "twitter:image", "twitter:image:src"}:
            self.image_url = values.get("content")


def _read_response(response):
    """Read a remote response with a firm size limit."""
    declared = response.headers.get("Content-Length")
    if declared and int(declared) > _MAX_DOWNLOAD_BYTES:
        raise ValueError("remote image is larger than 50 MB")
    data = response.read(_MAX_DOWNLOAD_BYTES + 1)
    if len(data) > _MAX_DOWNLOAD_BYTES:
        raise ValueError("remote image is larger than 50 MB")
    return data


def _open_remote_image(url):
    """Open a direct image URL or the social-preview image from an HTML page."""
    headers = {
        "User-Agent": _UA,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as response:
        content_type = response.headers.get_content_type().lower()
        final_url = response.geturl()
        data = _read_response(response)

    if content_type in {"text/html", "application/xhtml+xml"}:
        parser = _SocialImageParser()
        parser.feed(data.decode("utf-8", errors="replace"))
        if not parser.image_url:
            raise ValueError("webpage does not advertise an og:image or twitter:image")
        image_url = urllib.parse.urljoin(final_url, parser.image_url)
        image_req = urllib.request.Request(image_url, headers=headers)
        with urllib.request.urlopen(image_req, timeout=20) as response:
            data = _read_response(response)

    image = Image.open(io.BytesIO(data))
    image.load()
    return image


def _open_source(image, image_url):
    """Resolve inputs to a PIL.Image. URL/local path override the picker."""
    src = (image_url or "").strip()
    if src:
        if src.lower().startswith(("http://", "https://")):
            return _open_remote_image(src)
        if os.path.isfile(src):
            return Image.open(src)
        # Treat as a name inside the input directory.
        cand = os.path.join(folder_paths.get_input_directory(), src)
        if os.path.isfile(cand):
            return Image.open(cand)
        raise FileNotFoundError(f"image not found: {src}")
    # No override → the upload-picker selection.
    return Image.open(folder_paths.get_annotated_filepath(image))


def _resize_to_max(img, max_side, allow_upscale=False):
    """Fit within ``max_side`` while preserving aspect ratio.

    Dimensions are snapped to a latent-friendly multiple of eight. Smaller
    images remain untouched unless ``allow_upscale`` is explicitly enabled.
    """
    max_side = max(8, int(max_side))
    w, h = img.size
    longest = max(w, h)
    if longest <= 0:
        return img
    if longest <= max_side and not allow_upscale:
        return img
    scale = float(max_side) / float(longest)
    nw = max(8, int(round(w * scale / 8.0)) * 8)
    nh = max(8, int(round(h * scale / 8.0)) * 8)
    if (nw, nh) == (w, h):
        return img
    return img.resize((nw, nh), Image.LANCZOS)


def _sharpen_image(img, mode="off", scale_ratio=1.0):
    """Apply conservative unsharp masking, tuned for resized source images."""
    mode = str(mode or "off").lower()
    if mode == "off":
        return img
    if mode == "auto":
        # Native-size and upscaled images do not need automatic recovery.
        loss = max(0.0, 1.0 - float(scale_ratio))
        if loss < 0.05:
            return img
        radius = 0.8 + min(0.5, loss * 0.8)
        percent = int(round(35 + min(75, loss * 110)))
    else:
        radius, percent = {
            "low": (0.8, 45),
            "medium": (1.1, 80),
            "high": (1.4, 125),
        }.get(mode, (0.0, 0))
        if not percent:
            return img
    alpha = img.getchannel("A") if "A" in img.getbands() else None
    sharpened = img.convert("RGB").filter(
        ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3)
    )
    if alpha is not None:
        sharpened.putalpha(alpha)
    return sharpened


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
        output_images.append(torch.from_numpy(arr)[None,])
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
    return image, mask


def _run_sam3(image_tensor, prompt, confidence):
    """Segment via our native SAM3 module (sam3.py in this folder).

    Returns (cutout_image, mask) tensors, or None if SAM3 is unavailable or the
    call fails (caller then falls back to passthrough)."""
    try:
        from . import sam3  # native, self-contained — no node-registry lookup

        cutout, mask = sam3.segment(image_tensor, prompt, float(confidence))
        return cutout, mask
    except Exception as e:
        logger.warning(
            "[DirtyBirds] SAM3 segmentation failed (%s); passing image through.", e
        )
        return None


class DirtyBirdsLoadImage:
    """Load an image from a picker, URL, or local path."""

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = (
            [""]
            + sorted(
                f
                for f in os.listdir(input_dir)
                if os.path.isfile(os.path.join(input_dir, f))
            )
            if os.path.isdir(input_dir)
            else []
        )
        return {
            "required": {
                "image": (files, {"image_upload": True, "default": ""}),
            },
            "optional": {
                "image_url": (
                    "STRING",
                    {
                        "default": "",
                        "placeholder": "http(s):// or local path — overrides the picker when set",
                    },
                ),
                # Auto-resize the loaded image so its longest side == resize_max
                # (aspect preserved, snapped to a multiple of 8).
                "resize": ("BOOLEAN", {"default": False}),
                "resize_mode": (["long_side", "custom"], {"default": "long_side"}),
                # Ranges match the on-node sliders (256–2048, step 64).
                "resize_max": (
                    "INT",
                    {"default": 1024, "min": 256, "max": 2048, "step": 64},
                ),
                "resize_width": (
                    "INT",
                    {"default": 1024, "min": 256, "max": 2048, "step": 64},
                ),
                "resize_height": (
                    "INT",
                    {"default": 1024, "min": 256, "max": 2048, "step": 64},
                ),
                # Retained only so older saved workflows still load. The UI hides
                # it and long_side resize always hits the chosen target (up or
                # down), so this input is intentionally ignored.
                "allow_upscale": ("BOOLEAN", {"default": False}),
                "sharpen": (
                    ["off", "auto", "low", "medium", "high"],
                    {"default": "auto"},
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load"
    CATEGORY = "DirtyBirds"

    def load(
        self,
        image=None,
        image_url="",
        resize=False,
        resize_mode="long_side",
        resize_max=1024,
        resize_width=1024,
        resize_height=1024,
        allow_upscale=False,
        sharpen="auto",
    ):
        img = _open_source(image, image_url)
        original_longest = max(img.size)
        if resize:
            if resize_mode == "custom":
                width = max(8, int(round(int(resize_width) / 8)) * 8)
                height = max(8, int(round(int(resize_height) / 8)) * 8)
                if img.size != (width, height):
                    img = img.resize((width, height), Image.LANCZOS)
            else:
                # Enabling Resize means the selected long side is the target,
                # whether that requires reducing or enlarging the source — so
                # upscaling is always permitted here (the allow_upscale input is
                # retired; see INPUT_TYPES).
                img = _resize_to_max(img, int(resize_max), allow_upscale=True)
        scale_ratio = max(img.size) / original_longest if original_longest else 1.0
        img = _sharpen_image(img, sharpen, scale_ratio)
        out_image, out_mask = _to_tensors(img)
        return (out_image, out_mask)

    @classmethod
    def IS_CHANGED(
        cls,
        image=None,
        image_url="",
        resize=False,
        resize_mode="long_side",
        resize_max=1024,
        resize_width=1024,
        resize_height=1024,
        allow_upscale=False,
        sharpen="auto",
    ):
        seg_key = (
            f"|{bool(resize)}|{resize_mode}|{int(resize_max)}|"
            f"{int(resize_width)}x{int(resize_height)}|{sharpen}"
        )
        src = (image_url or "").strip()
        if src:
            if src.startswith(("http://", "https://")):
                return src + seg_key  # fixed URL -> stable cache key
            path = (
                src
                if os.path.isfile(src)
                else os.path.join(folder_paths.get_input_directory(), src)
            )
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
    def VALIDATE_INPUTS(
        cls,
        image=None,
        image_url="",
        resize=False,
        resize_mode="long_side",
        resize_max=1024,
        resize_width=1024,
        resize_height=1024,
        allow_upscale=False,
        sharpen="auto",
    ):
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
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsLoadImage": "📸 Image Loader"}
