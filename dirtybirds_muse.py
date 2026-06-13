"""
DirtyBirds Playhouse — Muse node.

Calls a local LM Studio (OpenAI-compatible) server to:
  • expand / write prompts from text, or
  • caption an image (when an IMAGE is connected, sent to a vision model).

Outputs a STRING that chains into the Loader's `positive` input or the Prompt
node's `concat_positive`. LM Studio's just-in-time model loading means naming a
model in the request is enough — it loads on demand, so the same node works with
a text model or a vision model depending on what you pick.
"""

import io
import json
import base64
import logging
import urllib.request
import urllib.error

import numpy as np
from PIL import Image

from server import PromptServer
from aiohttp import web

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "http://localhost:1234/v1"
DEFAULT_SYSTEM = (
    "You are an expert image-prompt writer. Respond with a single, comma-separated "
    "list of concise visual tags/phrases describing the desired image. No prose, no "
    "explanations, no refusals."
)


def _first_image_to_data_url(image):
    """ComfyUI IMAGE tensor [B,H,W,C] float 0-1 -> base64 PNG data URL (first frame)."""
    arr = image[0]
    if hasattr(arr, "cpu"):
        arr = arr.cpu().numpy()
    else:
        arr = np.asarray(arr)
    arr = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
    pil = Image.fromarray(arr)
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _chat_completion(endpoint, payload, timeout=120):
    url = endpoint.rstrip("/") + "/chat/completions"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer lm-studio"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # LM Studio returns a JSON body explaining 4xx errors; surface it.
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")
            parsed = json.loads(detail)
            detail = parsed.get("error", parsed) if isinstance(parsed, dict) else detail
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code}: {detail or e.reason}") from None
    return data["choices"][0]["message"]["content"]


class DirtyBirdsMuse:
    """LM Studio prompt-writer / image-captioner. Outputs a STRING."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model":       ("STRING", {"default": ""}),
                "endpoint":    ("STRING", {"default": DEFAULT_ENDPOINT}),
                "system":      ("STRING", {"multiline": True, "default": DEFAULT_SYSTEM}),
                "instruction": ("STRING", {"multiline": True,
                                           "default": "Describe this image as image-generation tags."}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "max_tokens":  ("INT", {"default": 512, "min": 16, "max": 8192, "step": 16}),
            },
            "optional": {
                "image":   ("IMAGE",),
                "text_in": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "generate"
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, model="", endpoint="", system="", instruction="",
                   temperature=0.7, max_tokens=512, image=None, text_in=""):
        # Re-run on any control change; if an image is connected, re-run always
        # (cheap vs. hashing the tensor, and captions are usually wanted fresh).
        if image is not None:
            import random
            return random.random()
        return (model, endpoint, system, instruction, temperature, max_tokens, text_in)

    def generate(self, model, endpoint, system, instruction,
                 temperature=0.7, max_tokens=512, image=None, text_in=""):
        endpoint = (endpoint or DEFAULT_ENDPOINT).strip()
        if not (model or "").strip():
            return ("[Muse error: no model selected. Click MODEL and pick a loaded "
                    "LM Studio model (vision model for captioning an image).]",)
        user_text = instruction or ""
        if text_in and text_in.strip():
            user_text = (user_text + "\n\n" + text_in.strip()).strip()

        messages = []
        if system and system.strip():
            messages.append({"role": "system", "content": system.strip()})

        if image is not None:
            try:
                data_url = _first_image_to_data_url(image)
            except Exception as e:
                logger.warning("[DirtyBirds] Muse image encode failed: %s", e)
                return (f"[Muse error: could not encode image: {e}]",)
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text or "Describe this image."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            })
        else:
            messages.append({"role": "user", "content": user_text})

        payload = {
            "model": (model or "").strip(),
            "messages": messages,
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
            "stream": False,
        }

        try:
            text = _chat_completion(endpoint, payload)
        except Exception as e:
            logger.warning("[DirtyBirds] Muse request failed (%s): %s", endpoint, e)
            return (f"[Muse error: {e} — is LM Studio's server running at {endpoint}?]",)

        return ((text or "").strip(),)


# ---------------------------------------------------------------------------
# Model-list proxy (server-side, avoids browser CORS to LM Studio)
# ---------------------------------------------------------------------------
@PromptServer.instance.routes.get("/dirtybirds/lm-models")
async def api_lm_models(request):
    endpoint = (request.rel_url.query.get("endpoint") or DEFAULT_ENDPOINT).strip()
    url = endpoint.rstrip("/") + "/models"
    try:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer lm-studio"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ids = [m.get("id") for m in data.get("data", []) if isinstance(m, dict) and m.get("id")]
        return web.json_response({"models": ids})
    except Exception as e:
        logger.warning("[DirtyBirds] lm-models fetch failed (%s): %s", url, e)
        return web.json_response({"models": [], "error": str(e)})


NODE_CLASS_MAPPINGS = {"DirtyBirdsMuse": DirtyBirdsMuse}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsMuse": "🍑 DirtyBirds Muse — The Eye"}
