"""
DirtyBirds Playhouse — Caption node.

An in-graph IMAGE -> STRING node that captions an image with an LM Studio
vision (multimodal) model. Shares the captioning behaviour and default prompt
with the Prompt Studio web tool (dirtybirds_studio.py); the Studio drop zone
and this node are two front-ends to the same idea.

Uses a blocking urllib call (ComfyUI runs node execution off the main loop, so
blocking here is fine — no aiohttp event loop needed).
"""

import io
import json
import base64
import logging
import urllib.request

import numpy as np
from PIL import Image

from .dirtybirds_studio import _DEFAULT_CAPTION_PROMPT

logger = logging.getLogger(__name__)


def _tensor_to_data_url(image):
    """ComfyUI IMAGE tensor ([B,H,W,C] float 0..1) -> PNG data URL (first frame)."""
    frame = image[0]
    arr = frame.cpu().numpy() if hasattr(frame, "cpu") else np.asarray(frame)
    arr = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
    pil = Image.fromarray(arr)
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return "data:image/png;base64," + b64


def _caption_image(server_url, model, data_url, prompt, timeout=180):
    """Call an LM Studio vision model and return the caption text."""
    endpoint = server_url.rstrip("/") + "/chat/completions"
    body = {
        "model": model or "local-model",
        "messages": [
            {"role": "user", "content": [
                {"type": "text", "text": prompt or _DEFAULT_CAPTION_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]},
        ],
        "temperature": 0.3,
        "max_tokens": 8192,
    }
    req = urllib.request.Request(
        endpoint, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    msg = (payload.get("choices") or [{}])[0].get("message") or {}
    # Reasoning models may leave `content` empty and use `reasoning_content`.
    return ((msg.get("content") or "").strip()
            or (msg.get("reasoning_content") or "").strip())


class DirtyBirdsCaption:
    """Caption an image with an LM Studio vision model -> prompt-ready text."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "vision_model": ("STRING", {"default": "local-model"}),
                "server_url": ("STRING", {"default": "http://localhost:1234/v1"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("caption",)
    FUNCTION = "process"
    CATEGORY = "DirtyBirds"

    def process(self, image, vision_model, server_url):
        try:
            data_url = _tensor_to_data_url(image)
            caption = _caption_image(server_url, vision_model, data_url,
                                     _DEFAULT_CAPTION_PROMPT)
            if not caption:
                logger.warning("[DirtyBirds] Caption model returned empty output "
                               "(is '%s' a vision model?)", vision_model)
        except Exception as e:
            logger.warning("[DirtyBirds] Caption failed (%s); returning empty string", e)
            caption = ""
        return (caption,)


NODE_CLASS_MAPPINGS = {"DirtyBirdsCaption": DirtyBirdsCaption}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsCaption": "🖼️ DirtyBirds Caption"}
