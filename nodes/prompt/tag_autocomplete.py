"""Fast, self-contained tag autocomplete for Dirty Talk."""

import csv
import os
import threading

from aiohttp import web
from server import PromptServer


_CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "danbooru_e621_merged.csv")
_lock = threading.Lock()
_tags = None


def _load_tags():
    global _tags
    if _tags is not None:
        return _tags
    with _lock:
        if _tags is None:
            rows = []
            with open(_CSV_PATH, newline="", encoding="utf-8") as handle:
                for row in csv.reader(handle):
                    if len(row) < 3 or not row[0]:
                        continue
                    aliases = tuple(a.lower() for a in row[3].split(",") if a) if len(row) > 3 else ()
                    rows.append((row[0], int(row[1]), int(row[2]), aliases))
            _tags = tuple(rows)
    return _tags


def search_tags(query, limit=20):
    needle = query.strip().lower().lstrip("/")
    if not needle:
        return []

    direct, secondary = [], []
    for name, category, count, aliases in _load_tags():
        lower_name = name.lower()
        item = {"tag_name": name, "category": category, "post_count": count}
        if lower_name.startswith(needle):
            direct.append(item)
        elif any(alias.lstrip("/").startswith(needle) for alias in aliases):
            secondary.append(item)
        elif any(word.startswith(needle) for word in lower_name.split("_")):
            secondary.append(item)
        if len(direct) >= limit and len(secondary) >= limit:
            break
    return (direct + secondary)[:limit]


@PromptServer.instance.routes.get("/dirtybirds/tag-autocomplete")
async def tag_autocomplete(request):
    query = request.rel_url.query.get("query", "")
    try:
        limit = max(1, min(int(request.rel_url.query.get("limit", "20")), 50))
    except ValueError:
        limit = 20
    return web.json_response({"tags": search_tags(query, limit)})

