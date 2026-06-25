"""
DirtyBirds Playhouse — Booru tag fetcher (a widget of the Dirty Talk node).

Backs the "Booru Tags" button in the Dirty Talk (prompt) node by serving the
/dirtybirds/booru-search route. Fetches tags from Danbooru / AIbooru / Gelbooru
for a search query and returns them as JSON for the node's JS widget.

This is widget-only: it intentionally registers NO standalone ComfyUI node.
No API key required for read-only Danbooru/AIbooru/Gelbooru tag queries.
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


# ---------------------------------------------------------------------------
# Web API Route — used by the Dirty Talk "Booru Tags" button
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
