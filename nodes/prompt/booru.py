"""
DirtyBirds Playhouse — Booru tag and image-caption route helpers.

Backs the image-derived prompt tools by serving the /dirtybirds/booru-search,
/aibooru-post-tags, /url-caption, and /image-caption routes. Widget-only:
registers NO standalone ComfyUI node.
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

logger = logging.getLogger(__name__)

_DANBOORU_TAGS_URL = "https://danbooru.donmai.us/tags.json"
_AIBOORU_TAGS_URL = "https://aibooru.online/tags.json"
_GELBOORU_TAGS_URL = "https://gelbooru.com/index.php"

_TAG_TYPE_NAMES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta",
}


def _resolve_lmstudio_model(endpoint):
    endpoint = (endpoint or "http://localhost:1234/v1").strip()
    url = endpoint.rstrip("/") + "/models"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer lm-studio"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    for item in data.get("data", []):
        if isinstance(item, dict) and item.get("id"):
            return item["id"]
    raise ValueError("LM Studio is running, but no served model was found")


def _fetch_danbooru_style(base_url, query, max_tags):
    # Danbooru-engine tags.json (Danbooru, AIbooru). Build the query string
    # manually — urlencode percent-encodes brackets which the API ignores, so
    # the search parameter must stay literal.
    qs = (
        f"search[name_or_alias_matches]={urllib.parse.quote(f'*{query}*')}"
        f"&search[order]=count"
        f"&limit={min(max_tags, 200)}"
    )
    url = f"{base_url}?{qs}"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        return [t["name"] for t in data if isinstance(t, dict) and t.get("name")]
    except Exception as e:
        logger.warning("[DirtyBirds] %s fetch failed: %s", base_url, e)
        return []


def _fetch_danbooru(query, max_tags):
    return _fetch_danbooru_style(_DANBOORU_TAGS_URL, query, max_tags)


def _fetch_aibooru(query, max_tags):
    return _fetch_danbooru_style(_AIBOORU_TAGS_URL, query, max_tags)


def _dispatch(source, query, max_tags):
    if source == "danbooru":
        return _fetch_danbooru(query, max_tags)
    if source == "gelbooru":
        return _fetch_gelbooru(query, max_tags)
    return _fetch_aibooru(query, max_tags)  # default


def _fetch_gelbooru(query, max_tags):
    params = urllib.parse.urlencode(
        {
            "page": "dapi",
            "s": "tag",
            "q": "index",
            "json": "1",
            "name_pattern": f"%{query}%",
            "orderby": "count",
            "limit": min(max_tags, 200),
        }
    )
    url = f"{_GELBOORU_TAGS_URL}?{params}"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        # Gelbooru wraps results under "tag" key
        tags = data.get("tag", data) if isinstance(data, dict) else data
        return [t["name"] for t in tags if isinstance(t, dict) and t.get("name")]
    except Exception as e:
        logger.warning("[DirtyBirds] Gelbooru fetch failed: %s", e)
        return []


_AIBOORU_POST_URL = "https://aibooru.online/posts/{post_id}.json"
_AIBOORU_TAG_FIELDS = (
    "tag_string_general",
    "tag_string_character",
    "tag_string_copyright",
    "tag_string_artist",
    "tag_string_meta",
)
_THINK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


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
    req = urllib.request.Request(url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("image is too large to caption")
    mime, _ = mimetypes.guess_type(urllib.parse.urlparse(url).path)
    if not mime or not mime.startswith("image/"):
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def _clean_completion(content):
    text = _THINK_RE.sub("", content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def _caption_url_with_lmstudio(
    url, model, endpoint, instruction, temperature=0.3, max_tokens=1024
):
    endpoint = (endpoint or "http://localhost:1234/v1").strip()
    model = (model or "").strip() or _resolve_lmstudio_model(endpoint)
    instruction = (
        instruction or "Describe this image as comma-separated image-generation tags."
    ).strip()
    data_uri = _fetch_image_data_uri(url)
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
    msg = data["choices"][0].get("message", {})
    return _clean_completion(msg.get("content") or msg.get("reasoning_content") or "")


def _caption_data_uri_with_lmstudio(
    data_uri, model, endpoint, instruction, temperature=0.3, max_tokens=1024
):
    endpoint = (endpoint or "http://localhost:1234/v1").strip()
    model = (model or "").strip() or _resolve_lmstudio_model(endpoint)
    instruction = (
        instruction or "Describe this image as comma-separated image-generation tags."
    ).strip()
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
    msg = data["choices"][0].get("message", {})
    return _clean_completion(msg.get("content") or msg.get("reasoning_content") or "")


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
    endpoint = request.rel_url.query.get("endpoint", "http://localhost:1234/v1").strip()
    instruction = request.rel_url.query.get(
        "instruction",
        "Describe this image as comma-separated image-generation tags. Output only the tags.",
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
    endpoint = str(data.get("endpoint") or "http://localhost:1234/v1").strip()
    instruction = str(
        data.get(
            "instruction",
            "Describe this image as comma-separated image-generation tags. Output only the tags.",
        )
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


@PromptServer.instance.routes.get("/dirtybirds/booru-search")
async def booru_search(request):
    import asyncio

    query = request.rel_url.query.get("query", "").strip()
    source = request.rel_url.query.get("source", "aibooru")
    try:
        max_tags = int(request.rel_url.query.get("max_tags", "40"))
    except ValueError:
        max_tags = 40
    max_tags = max(5, min(max_tags, 200))

    if not query:
        return web.json_response({"tags": []})

    loop = asyncio.get_event_loop()
    tags = await loop.run_in_executor(None, _dispatch, source, query, max_tags)

    return web.json_response({"tags": tags[:max_tags]})


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------
