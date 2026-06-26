"""
DirtyBirds Playhouse — Prompt Writer node.

Calls the local LM Studio OpenAI-compatible server to expand/write prompt text.
Captioning lives in the Booru/Image URL tools, so this node is text-only.
"""

import os
import re
import json
import logging
import urllib.request
import urllib.error

from server import PromptServer
from aiohttp import web

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "http://localhost:1234/v1"
DEFAULT_SYSTEM = (
    "You are an expert image-prompt writer. Respond with a single, comma-separated "
    "list of concise visual tags/phrases describing the desired image. No prose, no "
    "explanations, no refusals."
)

NODE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
USER_FILES_DIR = os.path.join(NODE_ROOT, "user-files")
LM_STUDIO_DIR = os.path.join(USER_FILES_DIR, "LM Studio")


def _parse_prompt_file(path, name_fallback):
    """Parse a prompt file. Optional '# Name' first line changes display name."""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
    except Exception as e:
        logger.warning("[DirtyBirds] Muse preset read failed %s: %s", path, e)
        return None
    name = name_fallback
    body = []
    for i, ln in enumerate(lines):
        if i == 0 and ln.strip().startswith("#"):
            name = ln.strip().lstrip("#").strip() or name_fallback
            continue
        body.append(ln)
    system = "\n".join(body).strip()
    rel = os.path.relpath(path, LM_STUDIO_DIR).replace("\\", "/")
    return {"name": name, "file": rel, "system": system}


def _load_lm_studio_prompts(include_system=False):
    """Read *.md/*.txt system prompts from user-files/LM Studio."""
    prompts = []
    try:
        if os.path.isdir(LM_STUDIO_DIR):
            for root, _, files in os.walk(LM_STUDIO_DIR):
                for fn in sorted(files):
                    if not fn.lower().endswith((".md", ".txt")):
                        continue
                    path = os.path.join(root, fn)
                    stem = os.path.splitext(fn)[0]
                    p = _parse_prompt_file(path, stem)
                    if not p:
                        continue
                    if not include_system:
                        p = {k: v for k, v in p.items() if k != "system"}
                    prompts.append(p)
    except Exception as e:
        logger.warning("[DirtyBirds] LM Studio prompt scan failed: %s", e)
    prompts.sort(key=lambda p: (p["name"].lower(), p["file"].lower()))
    return prompts


def _load_system_prompt(prompt_file=""):
    prompts = _load_lm_studio_prompts(include_system=True)
    wanted = (prompt_file or "").strip().replace("\\", "/")
    if wanted:
        for p in prompts:
            if p["file"] == wanted or p["name"] == wanted:
                return p["system"] or DEFAULT_SYSTEM, p["file"]
    if prompts:
        return prompts[0]["system"] or DEFAULT_SYSTEM, prompts[0]["file"]
    return DEFAULT_SYSTEM, ""


def _resolve_lmstudio_model(endpoint):
    endpoint = (endpoint or DEFAULT_ENDPOINT).strip()
    url = endpoint.rstrip("/") + "/models"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer lm-studio"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    for item in data.get("data", []):
        if isinstance(item, dict) and item.get("id"):
            return item["id"]
    raise ValueError("LM Studio is running, but no served model was found")


_MARK_POS_RE     = re.compile(r"^\s*POSITIVE\s*:\s*", re.IGNORECASE | re.MULTILINE)
_MARK_NEG_RE     = re.compile(r"^\s*NEGATIVE\s*:\s*", re.IGNORECASE | re.MULTILINE)


def _split_pos_neg(completion):
    """Parse an LLM completion into (positive, negative):
      1) POSITIVE:/NEGATIVE: markers;
      2) plain text -> (completion, "")."""
    text = completion or ""

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
    """LM Studio prompt writer. Displays response in the node UI."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enabled": ("BOOLEAN", {"default": True}),
                "instruction": ("STRING", {"multiline": True,
                                           "default": "Turn this idea into a full image-generation positive prompt."}),
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.05}),
                "max_tokens":  ("INT", {"default": 1024, "min": 16, "max": 8192, "step": 16}),
                "prompt_file": ("STRING", {"default": ""}),
            },
            "optional": {
                "text_in": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "generate"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, enabled=True, instruction="", temperature=0.7, max_tokens=1024,
                   prompt_file="", text_in=""):
        if not enabled:
            return (enabled, instruction, text_in)
        system, resolved_file = _load_system_prompt(prompt_file)
        return (enabled, instruction, temperature, max_tokens, resolved_file, system, text_in)

    def generate(self, enabled=True, instruction="", temperature=0.7, max_tokens=1024,
                 prompt_file="", text_in=""):
        if not enabled:
            source = (text_in or instruction or "").strip()
            return {"ui": {"db_muse_response": [source, ""],
                           "db_muse_status": ["Prompt Muse: off"]},
                    "result": ()}

        endpoint = DEFAULT_ENDPOINT
        try:
            model = _resolve_lmstudio_model(endpoint)
        except Exception as e:
            logger.warning("[DirtyBirds] Muse model resolve failed (%s): %s", endpoint, e)
            msg = f"[Muse error: {e} — is LM Studio running at {endpoint}?]"
            return {"ui": {"db_muse_response": [msg, ""],
                           "db_muse_status": ["Prompt Muse: error"]}, "result": ()}

        system, resolved_file = _load_system_prompt(prompt_file)
        user_text = instruction or ""
        if text_in and text_in.strip():
            user_text = (user_text + "\n\n" + text_in.strip()).strip()

        messages = [{"role": "system", "content": system.strip()}]
        messages.append({"role": "user", "content": user_text})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
            "stream": False,
        }

        try:
            resp = _chat_completion(endpoint, payload)
        except Exception as e:
            logger.warning("[DirtyBirds] Muse request failed (%s): %s", endpoint, e)
            msg = f"[Muse error: {e} — is LM Studio's server running at {endpoint}?]"
            return {"ui": {"db_muse_response": [msg, ""],
                           "db_muse_status": ["Prompt Muse: error"]}, "result": ()}

        text = _clean_completion(resp["content"])
        if not text:
            # Reasoning models can spend the whole budget in the think channel and
            # return empty content (finish_reason == "length"). Tell the user how
            # to fix it rather than silently emitting nothing.
            if resp["reasoning"] and resp["finish_reason"] == "length":
                logger.warning(
                    "[DirtyBirds] Muse: model used all %s tokens reasoning, no answer.",
                    max_tokens)
                msg = (f"[Muse error: '{model}' is a reasoning model and used all "
                       f"{max_tokens} tokens thinking before answering. Raise max_tokens "
                       f"(~2000+) or pick a non-reasoning model for prompt writing.]")
                return {"ui": {"db_muse_response": [msg, ""],
                               "db_muse_status": ["Prompt Muse: error"]}, "result": ()}
            logger.warning("[DirtyBirds] Muse: empty completion (finish=%s).",
                           resp["finish_reason"])
            msg = "[Muse error: model returned empty text.]"
            return {"ui": {"db_muse_response": [msg, ""],
                           "db_muse_status": ["Prompt Muse: error"]}, "result": ()}

        raw_pos, raw_neg = _split_pos_neg(text)
        pos_out = raw_pos
        neg_out = raw_neg

        logger.info("[DirtyBirds] Muse (%s) -> pos=%r neg=%r",
                    resolved_file or "default", pos_out[:120], neg_out[:80])
        return {"ui": {"db_muse_response": [pos_out, neg_out],
                       "db_muse_status": ["Prompt Muse: on"]}, "result": ()}


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


@PromptServer.instance.routes.get("/dirtybirds/muse-prompts")
async def api_muse_prompts(request):
    """System prompts from user-files/LM Studio for the prompt flyout."""
    try:
        return web.json_response({"prompts": _load_lm_studio_prompts()})
    except Exception as e:
        logger.warning("[DirtyBirds] muse-prompts failed: %s", e)
        return web.json_response({"prompts": [], "error": str(e)})


@PromptServer.instance.routes.get("/dirtybirds/muse-presets")
async def api_muse_presets(request):
    """Compatibility alias for older web UIs."""
    try:
        prompts = _load_lm_studio_prompts()
        return web.json_response({"presets": [
            {"name": p["name"], "file": p["file"], "instruction": "", "system": ""}
            for p in prompts
        ]})
    except Exception as e:
        logger.warning("[DirtyBirds] muse-presets failed: %s", e)
        return web.json_response({"presets": [], "error": str(e)})


NODE_CLASS_MAPPINGS = {"DirtyBirdsMuse": DirtyBirdsMuse}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsMuse": "✍️ Prompt Muse — The Writer"}
