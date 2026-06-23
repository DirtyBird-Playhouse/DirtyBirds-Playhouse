"""
DirtyBirds Playhouse — Booru Tag Fetcher node.

Fetches tags from Danbooru or Gelbooru for a search query and returns them as
a comma-separated STRING that can be wired into any prompt input.

No API key required for read-only Danbooru tag queries.
Gelbooru tag endpoint is public as well.
"""

import logging
import urllib.request
import urllib.parse
import json

from aiohttp import web
from server import PromptServer

logger = logging.getLogger(__name__)

_DANBOORU_TAGS_URL = "https://danbooru.donmai.us/tags.json"
_AIBOORU_TAGS_URL  = "https://aibooru.online/tags.json"
_GELBOORU_TAGS_URL = "https://gelbooru.com/index.php"

_TAG_TYPE_NAMES = {
    0: "general",
    1: "artist",
    3: "copyright",
    4: "character",
    5: "meta",
}


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
        req = urllib.request.Request(url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"})
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
    params = urllib.parse.urlencode({
        "page": "dapi", "s": "tag", "q": "index", "json": "1",
        "name_pattern": f"%{query}%",
        "orderby": "count",
        "limit": min(max_tags, 200),
    })
    url = f"{_GELBOORU_TAGS_URL}?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DirtyBirdsPlayhouse/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        # Gelbooru wraps results under "tag" key
        tags = data.get("tag", data) if isinstance(data, dict) else data
        return [t["name"] for t in tags if isinstance(t, dict) and t.get("name")]
    except Exception as e:
        logger.warning("[DirtyBirds] Gelbooru fetch failed: %s", e)
        return []


class DirtyBirdsBooruTag:
    """Fetch booru tags for a query and return them as a prompt-ready string."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "query":     ("STRING",  {"default": ""}),
                "source":    (["aibooru", "danbooru", "gelbooru"],),
                "max_tags":  ("INT",     {"default": 40, "min": 5, "max": 200, "step": 5}),
                "blacklist": ("STRING",  {"default": ""}),
            },
        }

    RETURN_TYPES  = ("STRING",)
    RETURN_NAMES  = ("tags",)
    FUNCTION      = "process"
    CATEGORY      = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, query="", source="aibooru", max_tags=40, blacklist=""):
        # Re-run when any input changes; cache when identical.
        return (query, source, max_tags, blacklist)

    def process(self, query, source, max_tags, blacklist):
        query = query.strip()
        if not query:
            return ("",)

        tags = _dispatch(source, query, max_tags)

        # Apply blacklist filter
        blocked = {t.strip().lower() for t in blacklist.split(",") if t.strip()}
        tags = [t for t in tags if t.lower() not in blocked]

        result = ", ".join(tags[:max_tags])
        logger.info("[DirtyBirds] BooruTag: %d tags for '%s' from %s", len(tags[:max_tags]), query, source)
        return (result,)


# ---------------------------------------------------------------------------
# Web API Route — used by the DDT "Booru Tags" button
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/booru-search")
async def booru_search(request):
    import asyncio
    query  = request.rel_url.query.get("query",   "").strip()
    source = request.rel_url.query.get("source",  "aibooru")
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

NODE_CLASS_MAPPINGS        = {"DirtyBirdsBooruTag": DirtyBirdsBooruTag}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsBooruTag": "🍑 DirtyBirds — Booru Tag Fetcher"}
