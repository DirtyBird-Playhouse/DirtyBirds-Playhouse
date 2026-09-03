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

from ..utils.paths import pack_root

logger = logging.getLogger(__name__)

# This pack's own directory — the SOURCE workspace, which on this install is
# what custom_nodes/DirtyBirds-Playhouse symlinks to.
_NODE_DIR = pack_root()


def _custom_nodes_dir():
    """ComfyUI's real custom_nodes directory.

    Asks ComfyUI, rather than taking ``dirname(_NODE_DIR)``. That shortcut is
    only correct when the pack sits physically inside custom_nodes; when it is a
    symlink to a source workspace (the documented layout here — see AGENTS.md)
    pack_root() resolves to the workspace and its parent is some unrelated
    folder. Measured on this machine: it opened C:\\Users\\mpick\\My_AI_Tools
    instead of ...\\ComfyUI\\custom_nodes.
    """
    try:
        paths = folder_paths.get_folder_paths("custom_nodes")
        if paths:
            return os.path.abspath(paths[0])
    except Exception:  # noqa: BLE001 - fall back rather than lose the button
        pass
    return os.path.dirname(_NODE_DIR)


def _known_folders():
    """Button key -> absolute folder path.

    A fixed allow-list: no user-supplied string is ever turned into a path,
    so there is no path-traversal surface here.
    """
    return {
        "models": os.path.abspath(folder_paths.models_dir),
        "custom_nodes": _custom_nodes_dir(),
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

