"""
DirtyBirds Playhouse — quick "open folder" web API.

A single POST route that opens one of a few fixed, known-safe folders in the
OS file manager: the ComfyUI models dir, the custom_nodes dir, or this node's
own folder. Backs the on-canvas folder buttons (web/folder_buttons.js).

The folder opens on the machine running the ComfyUI *server* — for a normal
local install that's your own desktop, which is the intended behaviour.

Imported for its side effects (route registration) from __init__.py.
"""

import os
import sys
import logging
import subprocess

from aiohttp import web
from server import PromptServer

import folder_paths

logger = logging.getLogger(__name__)

# Node pack root (…/custom_nodes/DirtyBirds-Playhouse). This file lives two
# levels down (nodes/folders/), hence the double dirname up.
_NODE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# …/custom_nodes
_CUSTOM_NODES_DIR = os.path.dirname(_NODE_DIR)


def _known_folders():
    """Button key -> absolute folder path.

    A fixed allow-list: no user-supplied string is ever turned into a path,
    so there is no path-traversal surface here.
    """
    return {
        "models": os.path.abspath(folder_paths.models_dir),
        "custom_nodes": _CUSTOM_NODES_DIR,
        "dirtybirds": _NODE_DIR,
    }


def _open_in_file_manager(path):
    """Open `path` in the OS file manager. Returns None on success else error str."""
    if not os.path.isdir(path):
        return f"folder does not exist: {path}"
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # opens Explorer; path is from our fixed allow-list
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception as e:  # noqa: BLE001 - surface any OS error to the UI
        return str(e)
    return None


@PromptServer.instance.routes.post("/dirtybirds/open-folder")
async def open_folder(request):
    """Open one of the known folders in the OS file manager.

    Body: { key: "models" | "custom_nodes" | "dirtybirds" } -> { success, path }
    """
    try:
        data = await request.json()
    except Exception:
        data = {}
    key = (data.get("key") or "").strip()
    folders = _known_folders()
    if key not in folders:
        return web.json_response({"error": f"unknown folder '{key}'"}, status=400)
    path = folders[key]
    err = _open_in_file_manager(path)
    if err:
        logger.warning("open-folder failed for %s: %s", key, err)
        return web.json_response({"error": err, "path": path}, status=500)
    return web.json_response({"success": True, "path": path})
