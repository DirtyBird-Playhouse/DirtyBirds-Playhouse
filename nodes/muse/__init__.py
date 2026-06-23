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
import os
import re
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

# System-prompt preset library (.md/.txt) and SDXL-styler libraries (*.yaml).
PRESETS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "user_files", "presets")
STYLES_DIR  = os.path.join(os.path.dirname(__file__), "..", "..", "user_files", "Styles")

# Built-in presets so the PRESET picker works before any files are dropped in
# PRESETS_DIR. Disk files with the same name override these (see _load_presets).
_BUILTIN_PRESETS = [
    {
        "name": "Caption",
        "instruction": "Describe this image as image-generation tags.",
        "system": DEFAULT_SYSTEM,
    },
    {
        "name": "Enhance",
        "instruction": "Rewrite the following positive prompt richer and more vivid, keeping the same subject.",
        "system": (
            "You are an expert image-prompt writer. Rewrite the user's positive prompt into a "
            "denser, more vivid, comma-separated list of visual tags/phrases. Keep the original "
            "subject and intent; add detail (style, lighting, composition, quality). Output only "
            "the rewritten prompt — no prose, no explanations, no refusals."
        ),
    },
    {
        "name": "Create",
        "instruction": "Turn this short idea into a full image-generation positive prompt.",
        "system": (
            "You are an expert image-prompt writer. Turn the user's short idea into a complete "
            "positive prompt: a single comma-separated list of concise visual tags/phrases "
            "covering subject, style, lighting, composition, and quality. Output only the prompt "
            "— no prose, no explanations, no refusals."
        ),
    },
]

_NONE_STYLE = {"name": "none", "negative_prompt": "", "prompt": "{prompt}"}


def _parse_preset_file(path, name_fallback):
    """Parse a preset file: optional '# Name' first line, optional
    'INSTRUCTION: ...' line, remainder = system-prompt body."""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
    except Exception as e:
        logger.warning("[DirtyBirds] Muse preset read failed %s: %s", path, e)
        return None
    name = name_fallback
    instruction = ""
    body = []
    for i, ln in enumerate(lines):
        if i == 0 and ln.strip().startswith("#"):
            name = ln.strip().lstrip("#").strip() or name_fallback
            continue
        if not body and ln.strip().upper().startswith("INSTRUCTION:"):
            instruction = ln.split(":", 1)[1].strip()
            continue
        body.append(ln)
    system = "\n".join(body).strip()
    if not system:
        return None
    return {"name": name, "instruction": instruction, "system": system}


def _load_presets():
    """Built-in presets plus any *.md/*.txt in PRESETS_DIR (disk overrides by
    name, keeping built-in ordering). Re-read on each call so edits show live."""
    presets = {p["name"]: dict(p) for p in _BUILTIN_PRESETS}
    order = [p["name"] for p in _BUILTIN_PRESETS]
    try:
        if os.path.isdir(PRESETS_DIR):
            for fn in sorted(os.listdir(PRESETS_DIR)):
                if not fn.lower().endswith((".md", ".txt")):
                    continue
                stem = os.path.splitext(fn)[0]
                p = _parse_preset_file(os.path.join(PRESETS_DIR, fn), stem)
                if not p:
                    continue
                if p["name"] not in presets:
                    order.append(p["name"])
                presets[p["name"]] = p
    except Exception as e:
        logger.warning("[DirtyBirds] Muse preset scan failed: %s", e)
    return [presets[n] for n in order]


def _load_styles():
    """Flatten user_files/Styles/*.yaml (SDXL-styler list of {name, negative_prompt,
    prompt}) into one list, always including a 'none' passthrough. Degrades to
    just 'none' if PyYAML is missing. De-duped by name (first wins)."""
    styles = [dict(_NONE_STYLE)]
    seen = {"none"}
    try:
        import yaml
    except Exception:
        return styles
    try:
        if os.path.isdir(STYLES_DIR):
            for fn in sorted(os.listdir(STYLES_DIR)):
                if not fn.lower().endswith((".yaml", ".yml")):
                    continue
                try:
                    with open(os.path.join(STYLES_DIR, fn), "r", encoding="utf-8", errors="ignore") as f:
                        data = yaml.safe_load(f) or []
                except Exception as e:
                    logger.warning("[DirtyBirds] Muse style read failed %s: %s", fn, e)
                    continue
                if not isinstance(data, list):
                    continue
                for entry in data:
                    if not isinstance(entry, dict):
                        continue
                    nm = str(entry.get("name", "")).strip()
                    if not nm or nm.lower() in seen:
                        continue
                    seen.add(nm.lower())
                    styles.append({
                        "name": nm,
                        "negative_prompt": str(entry.get("negative_prompt", "") or ""),
                        "prompt": str(entry.get("prompt", "{prompt}") or "{prompt}"),
                    })
    except Exception as e:
        logger.warning("[DirtyBirds] Muse style scan failed: %s", e)
    return styles


def _find_style(styles, name):
    name = (name or "").strip().lower()
    for s in styles:
        if s["name"].strip().lower() == name:
            return s
    return None


def _apply_style(style, positive_text):
    """Inject positive_text into the style's {prompt} placeholder; return
    (positive, negative). 'none'/missing/no-placeholder = passthrough."""
    if not style or style.get("name", "none").strip().lower() == "none":
        return (positive_text, "")
    tpl = style.get("prompt", "") or ""
    if "{prompt}" not in tpl:
        return (positive_text, "")
    return (tpl.replace("{prompt}", positive_text), style.get("negative_prompt", "") or "")


_STYLE_NAME_RE   = re.compile(r"^\s*-?\s*name:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_STYLE_PROMPT_RE = re.compile(r"^\s*-?\s*prompt:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_STYLE_NEG_RE    = re.compile(r"^\s*-?\s*negative_prompt:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_MARK_POS_RE     = re.compile(r"^\s*POSITIVE\s*:\s*", re.IGNORECASE | re.MULTILINE)
_MARK_NEG_RE     = re.compile(r"^\s*NEGATIVE\s*:\s*", re.IGNORECASE | re.MULTILINE)


def _strip_quotes(s):
    s = (s or "").strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        s = s[1:-1]
    return s.strip()


def _split_pos_neg(completion, subject):
    """Parse an LLM completion into (positive, negative):
      1) style-definition block (needs both name: and prompt:) -> fill {prompt}
         with `subject`, take negative_prompt if present;
      2) POSITIVE:/NEGATIVE: markers;
      3) plain text -> (completion, "")."""
    text = completion or ""

    name_m = _STYLE_NAME_RE.search(text)
    prompt_m = _STYLE_PROMPT_RE.search(text)
    if name_m and prompt_m:
        tpl = _strip_quotes(prompt_m.group(1))
        neg_m = _STYLE_NEG_RE.search(text)
        neg = _strip_quotes(neg_m.group(1)) if neg_m else ""
        pos = tpl.replace("{prompt}", subject) if "{prompt}" in tpl else tpl
        return (pos.strip(), neg.strip())

    pos_m = _MARK_POS_RE.search(text)
    neg_m = _MARK_NEG_RE.search(text)
    if pos_m or neg_m:
        if pos_m:
            end = neg_m.start() if (neg_m and neg_m.start() > pos_m.end()) else len(text)
            pos = text[pos_m.end():end].strip()
        else:
            pos = text[:neg_m.start()].strip()
        neg = text[neg_m.end():].strip() if neg_m else ""
        return (pos, neg)

    return (text.strip(), "")


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
    choice = data["choices"][0]
    msg = choice.get("message", {})
    return {
        "content": msg.get("content") or "",
        "reasoning": msg.get("reasoning_content") or "",
        "finish_reason": choice.get("finish_reason", ""),
    }


_THINK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


def _clean_completion(content):
    """Strip inline <think> blocks and surrounding code fences/whitespace."""
    text = _THINK_RE.sub("", content or "").strip()
    if text.startswith("```"):
        # Drop a leading ```lang fence and the trailing ```.
        text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


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
                "max_tokens":  ("INT", {"default": 1024, "min": 16, "max": 8192, "step": 16}),
            },
            "optional": {
                "image":   ("IMAGE",),
                "text_in": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
                # Hidden — driven by the STYLE flyout in JS; appended LAST so adding
                # it can't shift positional widgets_values for already-saved graphs.
                "style":   ("STRING", {"default": "none"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "generate"
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, model="", endpoint="", system="", instruction="",
                   temperature=0.7, max_tokens=1024, image=None, text_in="", style="none"):
        # Re-run on any control change; if an image is connected, re-run always
        # (cheap vs. hashing the tensor, and captions are usually wanted fresh).
        if image is not None:
            import random
            return random.random()
        return (model, endpoint, system, instruction, temperature, max_tokens, text_in, style)

    def generate(self, model, endpoint, system, instruction,
                 temperature=0.7, max_tokens=1024, image=None, text_in="", style="none"):
        endpoint = (endpoint or DEFAULT_ENDPOINT).strip()
        if not (model or "").strip():
            return ("[Muse error: no model selected. Click MODEL and pick a loaded "
                    "LM Studio model (vision model for captioning an image).]", "")
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
                return (f"[Muse error: could not encode image: {e}]", "")
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
            resp = _chat_completion(endpoint, payload)
        except Exception as e:
            logger.warning("[DirtyBirds] Muse request failed (%s): %s", endpoint, e)
            return (f"[Muse error: {e} — is LM Studio's server running at {endpoint}?]", "")

        text = _clean_completion(resp["content"])
        if not text:
            # Reasoning models can spend the whole budget in the think channel and
            # return empty content (finish_reason == "length"). Tell the user how
            # to fix it rather than silently emitting nothing.
            if resp["reasoning"] and resp["finish_reason"] == "length":
                logger.warning(
                    "[DirtyBirds] Muse: model used all %s tokens reasoning, no answer.",
                    max_tokens)
                return (f"[Muse error: '{model}' is a reasoning model and used all "
                        f"{max_tokens} tokens thinking before answering. Raise max_tokens "
                        f"(~2000+) or pick a non-reasoning model for prompt writing.]", "")
            logger.warning("[DirtyBirds] Muse: empty completion (finish=%s).",
                           resp["finish_reason"])
            return ("[Muse error: model returned empty text.]", "")

        # Parse pos/neg out of the completion, then optionally wrap in a named style.
        subject = (user_text or "").strip()
        raw_pos, raw_neg = _split_pos_neg(text, subject)
        chosen = _find_style(_load_styles(), style)
        pos_out, style_neg = _apply_style(chosen, raw_pos)
        # An LLM-generated style's own negative (raw_neg) wins over a separately
        # selected style's negative.
        neg_out = raw_neg or style_neg

        logger.info("[DirtyBirds] Muse -> pos=%r neg=%r", pos_out[:120], neg_out[:80])
        return (pos_out, neg_out)


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


@PromptServer.instance.routes.get("/dirtybirds/muse-presets")
async def api_muse_presets(request):
    """System-prompt presets for the Muse PRESET flyout."""
    try:
        return web.json_response({"presets": _load_presets()})
    except Exception as e:
        logger.warning("[DirtyBirds] muse-presets failed: %s", e)
        return web.json_response({"presets": [], "error": str(e)})


@PromptServer.instance.routes.get("/dirtybirds/muse-styles")
async def api_muse_styles(request):
    """Named styles (user_files/Styles/*.yaml) for the Muse STYLE flyout."""
    try:
        return web.json_response({"styles": _load_styles()})
    except Exception as e:
        logger.warning("[DirtyBirds] muse-styles failed: %s", e)
        return web.json_response({"styles": [], "error": str(e)})


NODE_CLASS_MAPPINGS = {"DirtyBirdsMuse": DirtyBirdsMuse}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsMuse": "👁️ Muse — The Eye"}
