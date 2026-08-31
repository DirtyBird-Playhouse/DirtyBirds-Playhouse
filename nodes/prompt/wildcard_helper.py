"""
DirtyBirds Playhouse — Wildcards sidebar HTTP routes.

Backs the "Wildcards" ComfyUI sidebar tab (web/jsdirtybirds_wildcard_sidebar.js).
Imported for its route-registration side effect from nodes/prompt/__init__.py,
matching booru.py and tag_autocomplete.py. Widget-only: registers NO
standalone ComfyUI node.
"""

import logging

from aiohttp import web
from server import PromptServer

from .wildcard_catalog import build_catalog, build_preview

logger = logging.getLogger(__name__)


@PromptServer.instance.routes.get("/dirtybirds/wildcard-helper/catalog")
async def wildcard_helper_catalog(request):
    try:
        return web.json_response(build_catalog())
    except Exception as e:
        logger.warning("[DirtyBirds] Could not build wildcard catalog: %s", e)
        return web.json_response(
            {"error": "Could not build wildcard catalog.", "fingerprint": "", "items": []},
            status=200,
        )


@PromptServer.instance.routes.get("/dirtybirds/wildcard-helper/preview")
async def wildcard_helper_preview(request):
    key = str(request.query.get("key", "")).strip()
    if not key:
        return web.json_response({"error": "Missing wildcard key."}, status=400)

    try:
        limit = int(request.query.get("limit", "20"))
    except (TypeError, ValueError):
        limit = 20

    try:
        preview = build_preview(key, limit=limit)
    except KeyError:
        return web.json_response({"error": "Wildcard not found."}, status=404)

    return web.json_response(preview)
