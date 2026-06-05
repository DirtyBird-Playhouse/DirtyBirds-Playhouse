"""
DirtyBirds Playhouse — Prompt Studio web API.

All HTTP routes for the standalone Prompt Studio page (served at
/dirtybirds/wildcard-editor): wildcard file IO, LM Studio extraction,
captioning, prompt enhancement, and model listing. Kept separate from
dirtybirds_prompt.py so the node/runtime engine stays free of web concerns.

Imported for its side effects (route registration) from __init__.py.
"""

import os
import re
import json
import logging

import aiohttp
from aiohttp import web
from server import PromptServer

from .dirtybirds_prompt import WILDCARDS_DIR, load_wildcard_dict

logger = logging.getLogger(__name__)


def _list_wildcard_keys():
    """Sorted wildcard keys (__key__ names) defined in our folder."""
    return sorted(load_wildcard_dict().keys())


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/wildcards")
async def get_wildcards(request):
    """List available wildcard keys for the 'Load Wildcards' picker."""
    return web.json_response({
        "keys": _list_wildcard_keys(),
    })


# ---------------------------------------------------------------------------
# Wildcard editor — standalone page + file/IO + LM Studio extraction
# Self-contained: served by ComfyUI, talks to a local OpenAI-compatible
# endpoint (LM Studio / Ollama / etc.) over plain HTTP. No external Python deps
# beyond PyYAML (already used by the processor).
# ---------------------------------------------------------------------------

def _safe_wildcard_path(name, must_exist=False):
    """Resolve `name` to a path strictly inside WILDCARDS_DIR, or None.

    Guards against path traversal (../, absolute paths) and limits to YAML."""
    if not name:
        return None
    name = str(name).strip().replace("\\", "/").lstrip("/")
    full = os.path.normpath(os.path.join(WILDCARDS_DIR, name))
    base = os.path.abspath(WILDCARDS_DIR)
    if os.path.commonpath([os.path.abspath(full), base]) != base:
        return None
    if os.path.splitext(full)[1].lower() not in (".yaml", ".yml"):
        return None
    if must_exist and not os.path.isfile(full):
        return None
    return full


def _list_wildcard_files():
    """Relative paths of every YAML file in the wildcards folder."""
    os.makedirs(WILDCARDS_DIR, exist_ok=True)
    out = []
    for root, _dirs, files in os.walk(WILDCARDS_DIR, followlinks=True):
        for f in files:
            if f.lower().endswith((".yaml", ".yml")):
                out.append(os.path.relpath(os.path.join(root, f), WILDCARDS_DIR).replace("\\", "/"))
    return sorted(out)


@PromptServer.instance.routes.get("/dirtybirds/wildcard-editor")
async def wildcard_editor_page(request):
    """Serve the standalone wildcard editor page."""
    html_path = os.path.join(os.path.dirname(__file__), "web", "wildcard_editor.html")
    if not os.path.exists(html_path):
        return web.Response(text="wildcard_editor.html not found", status=404)
    with open(html_path, "r", encoding="utf-8") as f:
        return web.Response(text=f.read(), content_type="text/html")


@PromptServer.instance.routes.get("/dirtybirds/wildcard-files")
async def wildcard_files(request):
    """List editable wildcard YAML files."""
    return web.json_response({"files": _list_wildcard_files()})


@PromptServer.instance.routes.get("/dirtybirds/wildcard-file")
async def wildcard_file_get(request):
    """Return the raw text of one wildcard YAML file."""
    path = _safe_wildcard_path(request.query.get("name"), must_exist=True)
    if not path:
        return web.json_response({"error": "invalid or missing file"}, status=400)
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return web.json_response({"name": request.query.get("name"), "content": f.read()})


@PromptServer.instance.routes.post("/dirtybirds/wildcard-file")
async def wildcard_file_save(request):
    """Save raw text to a wildcard YAML file. Creates it (and dirs) if new.

    Body: { name, content }. Validates YAML before writing."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    path = _safe_wildcard_path(data.get("name"))
    if not path:
        return web.json_response({"error": "invalid file name (must be a .yaml/.yml inside wildcards/)"}, status=400)

    content = data.get("content", "")
    try:
        import yaml
        yaml.safe_load(content or "")  # reject syntactically broken YAML
    except Exception as e:
        return web.json_response({"error": f"YAML error: {e}"}, status=400)

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"success": True})


def _parse_extraction_output(raw):
    """Parse a model's raw reply into a clean [{text, category}] list.

    Tolerant of reasoning models: strips <think> blocks and markdown fences,
    then extracts the first top-level JSON array from the text."""
    cleaned = (raw or "")
    # Drop <think>...</think> reasoning blocks (Qwen3-style).
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
    cleaned = cleaned.replace("```json", "").replace("```", "").strip()

    def _loads_any(s):
        try:
            return json.loads(s)
        except Exception:
            # Fall back to the outermost {...} or [...] anywhere in the text.
            for o, c in (("{", "}"), ("[", "]")):
                start, end = s.find(o), s.rfind(c)
                if start != -1 and end > start:
                    try:
                        return json.loads(s[start:end + 1])
                    except Exception:
                        continue
            raise

    parsed = _loads_any(cleaned)
    # Accept either a bare array or an object like {"items": [...]}.
    if isinstance(parsed, dict):
        items = parsed.get("items") or parsed.get("data") or []
    else:
        items = parsed

    return [{"text": str(it.get("text", "")).strip(),
             "category": str(it.get("category", "")).strip()}
            for it in items if isinstance(it, dict) and it.get("text")]


# Default system-prompt template. The literal token {categories} is replaced
# with the bullet list at request time (str.replace, not .format — the body
# contains other { } braces from ComfyUI/JSON notation).
_DEFAULT_EXTRACT_PROMPT = (
    "You are the Extraction Engine for a YAML Wildcard Manager. You ingest "
    "unstructured prompt text, split it into the smallest meaningful image-prompt "
    "phrases, and assign each phrase to a category path.\n\n"
    "Existing categories (for reference only):\n{categories}\n\n"
    "RULES:\n"
    "1. SPLIT AGGRESSIVELY. Break comma-separated lists, clauses, and compound "
    "descriptions into separate atomic phrases. 'a woman in a red dress standing "
    "in neon rain' becomes 'woman', 'red dress', 'standing', 'neon rain' — NOT one "
    "phrase. Each item is ONE concept.\n"
    "2. Preserve ComfyUI notation exactly: {a|b}, {1-2$$, $$a|b}.\n"
    "3. FOLLOW THE EXISTING STRUCTURE. Always prefer one of the existing category "
    "paths listed above, and use its FULL path EXACTLY as written (e.g. "
    "'clothing/footwear/casual', NOT a shortened 'footwear/casual'). A phrase that "
    "is the same kind of attribute as an existing leaf MUST go into that exact "
    "leaf.\n"
    "4. Only invent a NEW category when nothing existing fits. When you do, NEST it "
    "under the most relevant EXISTING parent and keep its full path (e.g. a new "
    "eyewear bucket becomes 'clothing/accessories', or extend an existing parent "
    "like 'clothing/headwear' — never a parallel top-level 'accessories' or "
    "'footwear' that duplicates an existing parent). Lowercase, slash-separated.\n"
    "5. Never drop content. Every distinct concept in the input must appear as an "
    "item.\n"
    "6. EXPAND & BRAINSTORM. After extracting what is literally in the input, also "
    "INVENT 8-15 additional brand-new phrases that fit the same aesthetic and "
    "categories (both the existing ones above and any new ones you created). These "
    "are fresh alternatives the user could add for more variety — they must NOT "
    "duplicate the input text or any existing category value, and each must still "
    "be ONE atomic concept assigned to a category path.\n\n"
    "Output ONLY JSON of the form {\"items\": [...]}, no prose, no markdown.\n"
    "Example input: 'cinematic photo of a woman in a red dress, neon cyan rim "
    "light, shot on Kodak Portra 400, raining'\n"
    "Example output:\n"
    '{"items": ['
    '{"text": "cinematic photo", "category": "style/photographic"}, '
    '{"text": "woman", "category": "subject/woman"}, '
    '{"text": "red dress", "category": "clothing/dress"}, '
    '{"text": "neon cyan rim light", "category": "lighting/neon"}, '
    '{"text": "Kodak Portra 400", "category": "camera/film-stock"}, '
    '{"text": "raining", "category": "environment/weather"}]}'
)


def _extraction_system_prompt(categories, template=None):
    """Build the system prompt. A custom `template` (from the UI) may include a
    {categories} token; if absent, the category list is appended."""
    bullets = "\n".join(f"- {c}" for c in categories) or "- (none yet)"
    tmpl = (template or "").strip() or _DEFAULT_EXTRACT_PROMPT
    if "{categories}" in tmpl:
        return tmpl.replace("{categories}", bullets)
    return f"{tmpl}\n\nExisting categories (for reference only):\n{bullets}"


# JSON schema used to constrain model output to valid, parseable structure.
_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["text", "category"],
            },
        }
    },
    "required": ["items"],
}

# Defaults for tunable sampling settings (overridable per-request from the UI).
_DEFAULT_TEMPERATURE = 0.3
_DEFAULT_MAX_TOKENS = 8192


def _resolve_llm_settings(data):
    """Pull temperature / max_tokens from a request body, clamped to sane ranges."""
    try:
        temp = float(data.get("temperature"))
    except (TypeError, ValueError):
        temp = _DEFAULT_TEMPERATURE
    temp = max(0.0, min(2.0, temp))
    try:
        max_tokens = int(data.get("max_tokens"))
    except (TypeError, ValueError):
        max_tokens = _DEFAULT_MAX_TOKENS
    max_tokens = max(256, min(32768, max_tokens))
    return temp, max_tokens


# Default instruction sent to a vision model when captioning an image.
_DEFAULT_CAPTION_PROMPT = (
    "Describe this image as a single dense stream of comma-separated image-prompt "
    "tags: subject, clothing, pose, setting, lighting, colors, camera/lens, and "
    "overall style. Be concrete and specific. Output only the comma-separated tags, "
    "no sentences, no preamble."
)

# Default system prompt for enhancing a user's image-generation prompt.
_DEFAULT_ENHANCE_PROMPT = (
    "You are a prompt engineer for text-to-image diffusion models. Rewrite the "
    "user's prompt into a single richer, more vivid prompt. Add concrete detail "
    "about subject, composition, lighting, color, mood, camera/lens, and art "
    "style where helpful, while preserving the user's original intent and any "
    "ComfyUI notation like {a|b} or __wildcard__. Do not add commentary, do not "
    "use markdown, do not add a negative prompt. Output ONLY the enhanced prompt "
    "as a single line of comma-separated phrases."
)


@PromptServer.instance.routes.get("/dirtybirds/wildcard-extract-defaults")
async def wildcard_extract_defaults(request):
    """Expose default prompt template + sampling settings so the UI can prefill."""
    return web.json_response({
        "system_prompt": _DEFAULT_EXTRACT_PROMPT,
        "caption_prompt": _DEFAULT_CAPTION_PROMPT,
        "enhance_prompt": _DEFAULT_ENHANCE_PROMPT,
        "temperature": _DEFAULT_TEMPERATURE,
        "max_tokens": _DEFAULT_MAX_TOKENS,
    })


@PromptServer.instance.routes.post("/dirtybirds/wildcard-enhance")
async def wildcard_enhance(request):
    """Enhance a user's prompt via an LM Studio text model.

    Body: { server_url, model, text, prompt?(system), temperature?, max_tokens? }
    -> { enhanced }"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    text = (data.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "no prompt to enhance"}, status=400)

    server_url = (data.get("server_url") or "http://localhost:1234/v1").rstrip("/")
    endpoint = f"{server_url}/chat/completions"
    system_prompt = (data.get("prompt") or "").strip() or _DEFAULT_ENHANCE_PROMPT
    temperature, max_tokens = _resolve_llm_settings(data)
    body = {
        "model": data.get("model") or "local-model",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        timeout = aiohttp.ClientTimeout(total=180)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(endpoint, json=body) as resp:
                raw_resp = await resp.text()
                if resp.status != 200:
                    return web.json_response(
                        {"error": f"model server returned HTTP {resp.status}: {raw_resp[:300]}"},
                        status=502)
                payload = json.loads(raw_resp)
    except Exception as e:
        return web.json_response(
            {"error": f"could not reach model server at {endpoint} ({e}). Is LM Studio running?"},
            status=502)

    try:
        choice = payload["choices"][0]
        msg = choice.get("message") or {}
        enhanced = (msg.get("content") or "").strip() or (msg.get("reasoning_content") or "").strip()
        # Strip <think> blocks reasoning models may leave inline.
        enhanced = re.sub(r"<think>.*?</think>", "", enhanced, flags=re.DOTALL | re.IGNORECASE).strip()
        if not enhanced:
            return web.json_response({"error": "model returned an empty result"}, status=502)
    except Exception as e:
        return web.json_response({"error": f"could not parse model output: {e}"}, status=502)

    return web.json_response({"enhanced": enhanced})


@PromptServer.instance.routes.post("/dirtybirds/wildcard-extract")
async def wildcard_extract(request):
    """Call a local OpenAI-compatible model to extract phrases->categories.

    Body: { server_url, text, categories: [..] } -> { items: [{text, category}] }"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    text = (data.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "no text to extract"}, status=400)

    server_url = (data.get("server_url") or "http://localhost:1234/v1").rstrip("/")
    endpoint = f"{server_url}/chat/completions"
    temperature, max_tokens = _resolve_llm_settings(data)
    system_prompt = _extraction_system_prompt(
        data.get("categories") or [], data.get("system_prompt"))
    body = {
        "model": data.get("model") or "local-model",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Extract this data:\n{text}"},
        ],
        "temperature": temperature,
        # Cap output so a chatty/reasoning model can't run away; large enough
        # for a sizable extraction. Without this some servers truncate or, for
        # reasoning models, burn the whole budget on hidden thinking.
        "max_tokens": max_tokens,
        # Ask the server to constrain output to our schema. The newer
        # OpenAI-compatible "json_schema" format is required by recent
        # LM Studio builds (older "json_object" is rejected with HTTP 400).
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "extraction",
                "schema": _EXTRACT_SCHEMA,
                "strict": True,
            },
        },
    }

    # Some servers don't support response_format at all; on a 4xx we retry
    # once without it (the parser tolerates unconstrained prose/markdown).
    async def _post(session, payload):
        async with session.post(endpoint, json=payload) as resp:
            return resp.status, await resp.text()

    try:
        timeout = aiohttp.ClientTimeout(total=180)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            status, raw_resp = await _post(session, body)
            if status != 200 and 400 <= status < 500:
                fallback = {k: v for k, v in body.items() if k != "response_format"}
                status, raw_resp = await _post(session, fallback)
            if status != 200:
                return web.json_response(
                    {"error": f"model server returned HTTP {status}: {raw_resp[:300]}"},
                    status=502)
            payload = json.loads(raw_resp)
    except Exception as e:
        return web.json_response(
            {"error": f"could not reach model server at {endpoint} ({e}). Is LM Studio running?"},
            status=502)

    try:
        choice = payload["choices"][0]
        msg = choice.get("message") or {}
        # Reasoning models sometimes leave `content` empty and put the answer
        # in `reasoning_content`; fall back to that before giving up.
        raw = (msg.get("content") or "").strip() or (msg.get("reasoning_content") or "")
        if not raw.strip():
            finish = choice.get("finish_reason")
            hint = " (output hit max_tokens — try shorter input)" if finish == "length" else ""
            return web.json_response(
                {"error": f"model returned empty output{hint}"}, status=502)
        items = _parse_extraction_output(raw)
    except Exception as e:
        return web.json_response({"error": f"could not parse model output: {e}"}, status=502)

    return web.json_response({"items": items})


@PromptServer.instance.routes.post("/dirtybirds/wildcard-models")
async def wildcard_models(request):
    """List models from LM Studio (browser can't reach it cross-origin).

    Prefers LM Studio's native REST endpoint /api/v0/models, which lists EVERY
    downloaded model (loaded or not). The OpenAI-compatible /v1/models only
    returns currently-loaded models, so it's used only as a fallback.

    Body: { server_url } -> { models: [id, ...] }"""
    try:
        data = await request.json()
    except Exception:
        data = {}
    server_url = (data.get("server_url") or "http://localhost:1234/v1").rstrip("/")
    # Base host without the trailing /v1 (so we can reach /api/v0/...).
    base = re.sub(r"/v\d+$", "", server_url)
    # Try the richer native endpoint first, then the OpenAI-compatible one.
    endpoints = [f"{base}/api/v0/models", f"{server_url}/models"]

    last_err = None
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for endpoint in endpoints:
            try:
                async with session.get(endpoint) as resp:
                    if resp.status != 200:
                        last_err = f"HTTP {resp.status} from {endpoint}"
                        continue
                    payload = json.loads(await resp.text())
            except Exception as e:
                last_err = f"{endpoint} ({e})"
                continue
            # Native /api/v0/models reports a `type` (llm/vlm/embeddings);
            # /v1/models does not, so type is None there.
            # Native /api/v0/models reports `type` (llm/vlm/embeddings) and
            # `state` (loaded/not-loaded); /v1/models reports neither (-> None).
            models = [{"id": m.get("id"), "type": m.get("type"), "state": m.get("state")}
                      for m in (payload.get("data") or []) if m.get("id")]
            if models:
                return web.json_response({"models": models})

    return web.json_response(
        {"error": f"could not list models ({last_err or 'no models returned'}). "
                  "Is LM Studio running with the server started?"},
        status=502)


@PromptServer.instance.routes.post("/dirtybirds/fetch-image")
async def fetch_image(request):
    """Resolve a Load Image node's selection (picker name / URL / path) to a PNG
    data URL, so the Studio Caption tab can pull the graph's current image.

    Body: { image, image_url } -> { image: "data:image/png;base64,..." }"""
    try:
        data = await request.json()
    except Exception:
        data = {}
    image = data.get("image") or ""
    image_url = data.get("image_url") or ""
    if not image and not image_url:
        return web.json_response({"error": "no image selected on the Load Image node"}, status=400)

    def _resolve():
        import io
        import base64
        from .dirtybirds_image import _open_source
        pil = _open_source(image, image_url).convert("RGB")
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    try:
        import asyncio
        loop = asyncio.get_event_loop()
        data_url = await loop.run_in_executor(None, _resolve)
    except Exception as e:
        return web.json_response(
            {"error": f"could not load that image ({e})"}, status=502)
    return web.json_response({"image": data_url})


@PromptServer.instance.routes.post("/dirtybirds/wildcard-caption")
async def wildcard_caption(request):
    """Caption an image with an LM Studio vision (multimodal) model.

    Body: { server_url, model, image (data URL or base64), prompt?, temperature?,
    max_tokens? } -> { caption }"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    image = (data.get("image") or "").strip()
    if not image:
        return web.json_response({"error": "no image provided"}, status=400)
    # Accept a bare base64 string or a full data URL; the API wants a data URL.
    if not image.startswith("data:"):
        image = "data:image/png;base64," + image

    server_url = (data.get("server_url") or "http://localhost:1234/v1").rstrip("/")
    endpoint = f"{server_url}/chat/completions"
    prompt = (data.get("prompt") or "").strip() or _DEFAULT_CAPTION_PROMPT
    temperature, max_tokens = _resolve_llm_settings(data)
    body = {
        "model": data.get("model") or "local-model",
        "messages": [
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image}},
            ]},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        timeout = aiohttp.ClientTimeout(total=180)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(endpoint, json=body) as resp:
                raw_resp = await resp.text()
                if resp.status != 200:
                    return web.json_response(
                        {"error": f"model server returned HTTP {resp.status}: {raw_resp[:300]}"},
                        status=502)
                payload = json.loads(raw_resp)
    except Exception as e:
        return web.json_response(
            {"error": f"could not reach model server at {endpoint} ({e}). "
                      "Is LM Studio running with a vision model loaded?"},
            status=502)

    try:
        choice = payload["choices"][0]
        msg = choice.get("message") or {}
        caption = (msg.get("content") or "").strip() or (msg.get("reasoning_content") or "").strip()
        if not caption:
            return web.json_response(
                {"error": "model returned an empty caption (is it a vision model?)"},
                status=502)
    except Exception as e:
        return web.json_response({"error": f"could not parse model output: {e}"}, status=502)

    return web.json_response({"caption": caption})


def _existing_leaf_paths(tree):
    """Every path (list of segments) that leads to a non-dict leaf in `tree`."""
    paths = []

    def walk(node, prefix):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, prefix + [str(k)])
        elif prefix:
            paths.append(prefix)

    walk(tree, [])
    return paths


def _resolve_category(category, existing_paths):
    """Snap a model-supplied category onto an existing path when it clearly
    belongs there, so we don't spawn parallel top-level keys.

    Rules (first match wins):
      1. Exact path already exists -> use as-is.
      2. The given path is an unambiguous *suffix* of exactly one existing path
         (e.g. 'footwear/casual' -> 'clothing/footwear/casual') -> use that.
    Otherwise keep the path as given (a genuinely new category).
    """
    parts = [p for p in category.split("/") if p]
    if not parts:
        return parts
    for ep in existing_paths:
        if ep == parts:
            return list(parts)
    n = len(parts)
    matches = [ep for ep in existing_paths if len(ep) >= n and ep[-n:] == parts]
    if len(matches) == 1:
        return list(matches[0])
    return list(parts)


@PromptServer.instance.routes.post("/dirtybirds/wildcard-merge")
async def wildcard_merge(request):
    """Merge {text, category} items into a wildcard YAML file on disk.

    Body: { name, items: [{text, category}] } -> { success, content }"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    path = _safe_wildcard_path(data.get("name"))
    if not path:
        return web.json_response({"error": "invalid file name"}, status=400)

    # Prefer ruamel.yaml: it round-trips the file, so existing comments,
    # quoting, ordering and layout survive — only the appended lines change.
    # Fall back to PyYAML (which re-dumps the whole file in canonical style) if
    # ruamel isn't installed.
    use_ruamel = True
    try:
        from ruamel.yaml import YAML
        from ruamel.yaml.comments import CommentedMap
        import io
    except Exception:
        use_ruamel = False
        try:
            import yaml
        except Exception:
            return web.json_response({"error": "no YAML library available"}, status=500)

    # Load existing YAML (or start fresh).
    if use_ruamel:
        ryaml = YAML()
        ryaml.preserve_quotes = True
        ryaml.width = 4096            # don't wrap long wildcard entries
        ryaml.indent(mapping=2, sequence=2, offset=0)
        new_map = CommentedMap
        new_list = list
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    tree = ryaml.load(f)
                if tree is None:
                    tree = CommentedMap()
            except Exception as e:
                return web.json_response({"error": f"existing YAML invalid: {e}"}, status=400)
        else:
            tree = CommentedMap()
    else:
        new_map = dict
        new_list = list
        tree = {}
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    tree = yaml.safe_load(f) or {}
            except Exception as e:
                return web.json_response({"error": f"existing YAML invalid: {e}"}, status=400)

    # Map of existing leaf paths (lists of segments) in the file, so a model's
    # short/parallel path can be snapped onto the real one it belongs in.
    existing_paths = _existing_leaf_paths(tree)

    # Insert each phrase under its category path. Works on either plain
    # dict/list or ruamel CommentedMap/CommentedSeq (both behave the same here).
    for item in data.get("items", []):
        phrase = str(item.get("text", "")).strip()
        category = str(item.get("category", "")).strip()
        if not phrase or not category:
            continue
        parts = _resolve_category(category, existing_paths)
        node = tree
        for part in parts[:-1]:
            if not isinstance(node.get(part), dict):
                node[part] = new_map()
            node = node[part]
        leaf = parts[-1]
        if not isinstance(node.get(leaf), list):
            node[leaf] = new_list()
        if phrase not in node[leaf]:
            node[leaf].append(phrase)

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if use_ruamel:
            buf = io.StringIO()
            ryaml.dump(tree, buf)
            out = buf.getvalue()
        else:
            out = yaml.dump(
                tree,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
                width=4096,  # keep each wildcard entry on one line (no wrapping)
            )
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"success": True, "content": out})
