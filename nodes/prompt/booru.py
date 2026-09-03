"""
DirtyBirds Playhouse — Booru tag and image-caption route helpers.

Backs the image-derived prompt tools by serving the /aibooru-post-tags,
/url-caption and /image-caption routes. Widget-only: registers NO standalone
ComfyUI node.

A /dirtybirds/booru-search route and Danbooru/Gelbooru/AIBooru tag-search
helpers used to live here with no caller anywhere in the pack — the Booru
button has always gone through /aibooru-post-tags. Gelbooru had also started
returning HTTP 401 (its API now needs api_key + user_id, which nothing here
supplies), and the failure was swallowed into an empty tag list.
"""

import base64
import logging
import mimetypes
import re
import urllib.request
import urllib.parse
import urllib.error
import json

from aiohttp import web
from server import PromptServer

from .._openai_compat import clean_completion, message_text, resolve_first_model

logger = logging.getLogger(__name__)

_AIBOORU_POST_URL = "https://aibooru.online/posts/{post_id}.json"
_AIBOORU_TAG_FIELDS = (
    "tag_string_general",
    "tag_string_character",
    "tag_string_copyright",
    "tag_string_artist",
    "tag_string_meta",
)
def _aibooru_post_id(url):
    parsed = urllib.parse.urlparse((url or "").strip())
    host = parsed.netloc.lower()
    if parsed.scheme.lower() != "https" or host not in {
        "aibooru.online",
        "www.aibooru.online",
    }:
        raise ValueError("AIBooru tools require an https://aibooru.online/ post URL")

    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 2 and parts[0] == "posts":
        post_id = parts[1].removesuffix(".json")
    elif len(parts) >= 3 and parts[0] == "post" and parts[1] == "show":
        post_id = parts[2]
    else:
        post_id = (urllib.parse.parse_qs(parsed.query).get("id") or [""])[0]

    if not re.fullmatch(r"\d+", post_id or ""):
        raise ValueError(
            "AIBooru URL must look like https://aibooru.online/posts/12345"
        )
    return post_id


def _fetch_aibooru_post(url, timeout=15):
    api_url = _AIBOORU_POST_URL.format(post_id=_aibooru_post_id(url))
    req = urllib.request.Request(
        api_url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("AIBooru response was not a post object")
    return data


def _tags_from_aibooru_post(data):
    seen = set()
    tags = []
    for field in _AIBOORU_TAG_FIELDS:
        for tag in str(data.get(field) or "").split():
            if tag and tag not in seen:
                seen.add(tag)
                tags.append(tag)
    if not tags:
        for tag in str(data.get("tag_string") or "").split():
            if tag and tag not in seen:
                seen.add(tag)
                tags.append(tag)
    return tags


def _resolve_aibooru_image_url(data):
    for field in ("large_file_url", "file_url", "preview_file_url"):
        image_url = str(data.get(field) or "").strip()
        if image_url:
            return urllib.parse.urljoin("https://aibooru.online/", image_url)
    raise ValueError("AIBooru post did not contain an image URL")


def _fetch_image_data_uri(url, timeout=30, max_bytes=30 * 1024 * 1024):
    url = str(url or "").strip()
    if url.startswith("/"):
        # Root-relative ComfyUI path (e.g. /view?filename=...); urllib needs a host.
        port = getattr(PromptServer.instance, "port", None) or 8188
        url = f"http://127.0.0.1:{port}{url}"
    req = urllib.request.Request(url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("image is too large to caption")
    mime, _ = mimetypes.guess_type(urllib.parse.urlparse(url).path)
    if not mime or not mime.startswith("image/"):
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


_clean_completion = clean_completion


def _message_text(message):
    """Extract text from string or OpenAI-compatible multipart content."""
    return message_text(message, reasoning_fallback=True)


_DEFAULT_CAPTION_INSTRUCTION = (
    "Describe this image as comma-separated image-generation tags."
)

_DEFAULT_CAPTION_ENDPOINT = "http://127.0.0.1:8765/v1"


def _resolve_lmstudio_model(endpoint):
    """First model LM Studio is serving, for captioning when none was named."""
    return resolve_first_model(
        endpoint,
        default_endpoint=_DEFAULT_CAPTION_ENDPOINT,
        empty_message="LM Studio is running, but no served model was found",
    )


def _caption_data_uri_with_lmstudio(
    data_uri, model, endpoint, instruction, temperature=0.3, max_tokens=1024
):
    """Caption an inline ``data:image/...`` URL with LM Studio's vision chat API.

    The single caption call. The URL route reaches it through
    ``_caption_url_with_lmstudio`` below, which only has to turn a URL into a
    data URI first — the two used to be forty-line copies of each other, so a fix
    to one (the root-relative /view handling in _fetch_image_data_uri, say)
    silently missed the other.
    """
    endpoint = (endpoint or _DEFAULT_CAPTION_ENDPOINT).strip()
    model = (model or "").strip() or _resolve_lmstudio_model(endpoint)
    instruction = (instruction or _DEFAULT_CAPTION_INSTRUCTION).strip()
    if not str(data_uri or "").startswith("data:image/"):
        raise ValueError("image upload must be a data:image URL")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            }
        ],
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
        "stream": False,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint.rstrip("/") + "/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer lm-studio",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")
            parsed = json.loads(detail)
            detail = parsed.get("error", parsed) if isinstance(parsed, dict) else detail
        except Exception:
            pass
        raise RuntimeError(f"LM Studio HTTP {e.code}: {detail or e.reason}") from None
    choice = data["choices"][0]
    text = _clean_completion(_message_text(choice.get("message", {})))
    if not text:
        finish = choice.get("finish_reason") or "unknown"
        raise RuntimeError(
            f"Caption model returned no text (finish_reason={finish})."
        )
    return text


def _caption_url_with_lmstudio(
    url, model, endpoint, instruction, temperature=0.3, max_tokens=1024
):
    """Fetch ``url`` and caption it. Thin wrapper over the data-URI path."""
    return _caption_data_uri_with_lmstudio(
        _fetch_image_data_uri(url),
        model,
        endpoint,
        instruction,
        temperature,
        max_tokens,
    )


# ---------------------------------------------------------------------------
# Web API Routes — used by image-derived prompt tools
# ---------------------------------------------------------------------------


@PromptServer.instance.routes.get("/dirtybirds/aibooru-post-tags")
async def aibooru_post_tags(request):
    import asyncio

    url = request.rel_url.query.get("url", "").strip()
    if not url:
        return web.json_response(
            {"tags": [], "error": "missing AIBooru URL"}, status=400
        )

    def work():
        data = _fetch_aibooru_post(url)
        tags = _tags_from_aibooru_post(data)
        image_url = ""
        try:
            image_url = _resolve_aibooru_image_url(data)
        except Exception:
            pass
        return tags, image_url

    try:
        tags, image_url = await asyncio.get_event_loop().run_in_executor(None, work)
        return web.json_response({"tags": tags, "image_url": image_url})
    except Exception as e:
        logger.warning("[DirtyBirds] AIBooru post tag fetch failed: %s", e)
        return web.json_response({"tags": [], "error": str(e)}, status=400)


@PromptServer.instance.routes.get("/dirtybirds/url-caption")
async def url_caption(request):
    import asyncio

    source_url = request.rel_url.query.get("url", "").strip()
    model = request.rel_url.query.get("model", "").strip()
    endpoint = request.rel_url.query.get("endpoint", _DEFAULT_CAPTION_ENDPOINT).strip()
    instruction = request.rel_url.query.get(
        "instruction",
        f"{_DEFAULT_CAPTION_INSTRUCTION} Output only the tags.",
    )
    if not source_url:
        return web.json_response(
            {"caption": "", "error": "missing image URL"}, status=400
        )

    def work():
        image_url = source_url
        if "aibooru.online" in source_url.lower():
            image_url = _resolve_aibooru_image_url(_fetch_aibooru_post(source_url))
        caption = _caption_url_with_lmstudio(image_url, model, endpoint, instruction)
        return caption, image_url

    try:
        caption, image_url = await asyncio.get_event_loop().run_in_executor(None, work)
        return web.json_response({"caption": caption, "image_url": image_url})
    except Exception as e:
        logger.warning("[DirtyBirds] URL caption failed: %s", e)
        return web.json_response({"caption": "", "error": str(e)}, status=400)


@PromptServer.instance.routes.post("/dirtybirds/image-caption")
async def image_caption(request):
    import asyncio

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"caption": "", "error": "invalid JSON"}, status=400)

    data_uri = str(data.get("image") or "").strip()
    model = str(data.get("model") or "").strip()
    endpoint = str(data.get("endpoint") or _DEFAULT_CAPTION_ENDPOINT).strip()
    instruction = str(
        data.get("instruction", f"{_DEFAULT_CAPTION_INSTRUCTION} Output only the tags.")
    )
    if not data_uri:
        return web.json_response({"caption": "", "error": "missing image"}, status=400)

    def work():
        return _caption_data_uri_with_lmstudio(data_uri, model, endpoint, instruction)

    try:
        caption = await asyncio.get_event_loop().run_in_executor(None, work)
        return web.json_response({"caption": caption})
    except Exception as e:
        logger.warning("[DirtyBirds] Image caption failed: %s", e)
        return web.json_response({"caption": "", "error": str(e)}, status=400)


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------
