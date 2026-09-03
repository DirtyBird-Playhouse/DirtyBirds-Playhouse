"""
DirtyBirds Playhouse — Load Image node.

A branded Load Image node that pulls an image from the ComfyUI input folder
(upload picker) OR from a URL / local path and outputs a clean IMAGE + alpha
MASK. Text-prompted segmentation is owned by the Inpainting node.
"""

import os
import hashlib
import logging
import urllib.request  # noqa: F401 - compatibility facade for request monkeypatches
from PIL import Image

import folder_paths

from .processing import (
    open_source as _open_source,
    resize_to_max as _resize_to_max,
    sharpen_image as _sharpen_image,
    to_tensors as _to_tensors,
)

logger = logging.getLogger(__name__)

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
                "caption_mode": (
                    ["off", "single", "batch_folder"],
                    {"default": "off"},
                ),
                "caption_directory": (
                    "STRING",
                    {"default": "", "placeholder": "folder to batch caption"},
                ),
                "caption_api_key": (
                    "STRING",
                    {"default": "", "password": True},
                ),
                "caption_provider": (
                    ["joycaption_local", "openai_host", "nvidia"],
                    {"default": "joycaption_local"},
                ),
                "caption_endpoint": (
                    "STRING",
                    {
                        "default": "http://127.0.0.1:8000/v1",
                        "placeholder": "OpenAI-compatible vision server base URL",
                    },
                ),
                "caption_model": (
                    "STRING",
                    {"default": "fancyfeast/llama-joycaption-beta-one-hf-llava"},
                ),
                "caption_quantization": (
                    ["4bit", "8bit", "bf16"],
                    {"default": "4bit"},
                ),
                "caption_unload_after": ("BOOLEAN", {"default": True}),
                "caption_prompt": (
                    "STRING",
                    {
                        "default": "Describe this image in detail for use as an image-generation prompt. Output only the description.",
                        "multiline": True,
                    },
                ),
                "caption_skip_existing": ("BOOLEAN", {"default": True}),
                "caption_use_cache": ("BOOLEAN", {"default": True}),
                "caption_prompt_type": (
                    ["descriptive", "natural_language", "tags", "danbooru", "custom"],
                    {"default": "descriptive"},
                ),
                "caption_options": ("STRING", {"default": "{}"}),
                "caption_temperature": (
                    "FLOAT", {"default": 0.6, "min": 0.0, "max": 2.0, "step": 0.05}
                ),
                "caption_system_prompt": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "caption", "all_captions")
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
        caption_mode="off",
        caption_directory="",
        caption_api_key="",
        caption_provider="joycaption_local",
        caption_endpoint="http://127.0.0.1:8000/v1",
        caption_model="fancyfeast/llama-joycaption-beta-one-hf-llava",
        caption_quantization="4bit",
        caption_unload_after=True,
        caption_prompt="Describe this image in detail for use as an image-generation prompt. Output only the description.",
        caption_skip_existing=True,
        caption_use_cache=True,
        caption_prompt_type="descriptive",
        caption_options="{}",
        caption_temperature=0.6,
        caption_system_prompt="",
    ):
        if (
            str(caption_mode or "off") == "batch_folder"
            and not str(image_url or "").strip()
            and not image
        ):
            from .captioning import image_files

            batch_files = image_files(caption_directory)
            if not batch_files:
                raise ValueError("caption directory contains no supported images")
            image_url = batch_files[0]
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
        caption = ""
        all_captions = ""
        mode = str(caption_mode or "off")
        if mode != "off":
            from .captioning import caption_directory as run_caption_directory
            from .captioning import caption_directory_local
            from .captioning import caption_image
            from .captioning import caption_image_local
            from .captioning import NVIDIA_ENDPOINT
            from .captioning import build_caption_prompt

            provider = str(caption_provider or "joycaption_local")
            endpoint = (
                NVIDIA_ENDPOINT
                if provider == "nvidia"
                else str(caption_endpoint or "http://127.0.0.1:8000/v1").strip()
            )
            require_api_key = provider == "nvidia"
            prompt = build_caption_prompt(caption_prompt_type, caption_options, caption_prompt)
            temperature = None if float(caption_temperature) < 0 else float(caption_temperature)

            if mode == "batch_folder":
                if provider == "joycaption_local":
                    results = caption_directory_local(
                        caption_directory,
                        caption_model,
                        prompt,
                        caption_quantization,
                        use_cache=bool(caption_use_cache),
                        skip_existing=bool(caption_skip_existing),
                        unload_after=bool(caption_unload_after),
                        temperature=temperature,
                        system_prompt=caption_system_prompt,
                    )
                else:
                    results = run_caption_directory(
                        caption_directory,
                        caption_api_key,
                        caption_model,
                        prompt,
                        endpoint=endpoint,
                        use_cache=bool(caption_use_cache),
                        skip_existing=bool(caption_skip_existing),
                        require_api_key=require_api_key,
                        temperature=temperature,
                        system_prompt=caption_system_prompt,
                    )
                caption = results[-1][1]
                all_captions = "\n".join(
                    f"{filename} -> {text}" for filename, text in results
                )
            else:
                if provider == "joycaption_local":
                    try:
                        caption = caption_image_local(
                            img,
                            caption_model,
                            prompt,
                            caption_quantization,
                            use_cache=bool(caption_use_cache),
                            temperature=temperature,
                            system_prompt=caption_system_prompt,
                        )
                    finally:
                        if caption_unload_after:
                            from .captioning import unload_local_joycaption

                            unload_local_joycaption()
                else:
                    caption = caption_image(
                        img,
                        caption_api_key,
                        caption_model,
                        prompt,
                        endpoint=endpoint,
                        use_cache=bool(caption_use_cache),
                        require_api_key=require_api_key,
                        temperature=temperature,
                        system_prompt=caption_system_prompt,
                    )
                all_captions = caption
        return (out_image, out_mask, caption, all_captions)

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
        caption_mode="off",
        caption_directory="",
        caption_api_key="",
        caption_provider="joycaption_local",
        caption_endpoint="http://127.0.0.1:8000/v1",
        caption_model="fancyfeast/llama-joycaption-beta-one-hf-llava",
        caption_quantization="4bit",
        caption_unload_after=True,
        caption_prompt="",
        caption_skip_existing=True,
        caption_use_cache=True,
        caption_prompt_type="descriptive",
        caption_options="{}",
        caption_temperature=0.6,
        caption_system_prompt="",
    ):
        seg_key = (
            f"|{bool(resize)}|{resize_mode}|{int(resize_max)}|"
            f"{int(resize_width)}x{int(resize_height)}|{sharpen}|{caption_mode}|"
            f"{caption_directory}|{caption_provider}|{caption_endpoint}|"
            f"{caption_model}|{caption_quantization}|{bool(caption_unload_after)}|"
            f"{caption_prompt}|{caption_prompt_type}|{caption_options}|{caption_temperature}|{caption_system_prompt}|"
            f"{bool(caption_skip_existing)}|{bool(caption_use_cache)}"
        )
        if str(caption_mode or "off") == "batch_folder":
            directory = os.path.abspath(
                os.path.expanduser(str(caption_directory or "").strip())
            )
            try:
                manifest = []
                for name in sorted(os.listdir(directory), key=str.casefold):
                    path = os.path.join(directory, name)
                    if os.path.isfile(path) and os.path.splitext(name)[1].lower() in {
                        ".png",
                        ".jpg",
                        ".jpeg",
                        ".webp",
                        ".bmp",
                        ".tif",
                        ".tiff",
                    }:
                        stat = os.stat(path)
                        manifest.append(f"{name}:{stat.st_size}:{stat.st_mtime_ns}")
                seg_key += "|" + hashlib.sha256("\n".join(manifest).encode()).hexdigest()
            except OSError:
                pass
        src = (image_url or "").strip()
        if str(caption_mode or "off") == "batch_folder" and not src and not image:
            try:
                from .captioning import image_files

                src = image_files(caption_directory)[0]
            except Exception:
                src = ""
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
        caption_mode="off",
        caption_directory="",
        caption_api_key="",
        caption_provider="joycaption_local",
        caption_endpoint="http://127.0.0.1:8000/v1",
        caption_model="fancyfeast/llama-joycaption-beta-one-hf-llava",
        caption_quantization="4bit",
        caption_unload_after=True,
        caption_prompt="",
        caption_skip_existing=True,
        caption_use_cache=True,
        caption_prompt_type="descriptive",
        caption_options="{}",
        caption_temperature=0.6,
        caption_system_prompt="",
    ):
        # When `image_url` supplies the source the picker is irrelevant, so an
        # empty/absent `image` is fine. ComfyUI omits `image` from the call when
        # the widget has no value, hence the default above.
        if str(caption_mode or "off") == "batch_folder" and not os.path.isdir(
            os.path.expanduser(str(caption_directory or "").strip())
        ):
            return "Batch captioning requires a valid caption directory."
        if str(caption_mode or "off") == "batch_folder":
            return True
        if (image_url or "").strip():
            return True
        if not image:
            return "No image selected: pick a file or set image_url."
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"DirtyBirdsLoadImage": DirtyBirdsLoadImage}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsLoadImage": "📸 Image Loader"}
