"""DirtyBirds Playhouse — 💾 Save Image & Prompt.

Final output node. Saves generated images on execution, displays the
final prompt in markdown, and exposes routes for explicit prompt saving.
"""

import os
import json
import logging

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths
from aiohttp import web
from server import PromptServer

from ..utils.paths import pack_root
from .summary import generation_summary, summary_line

logger = logging.getLogger(__name__)

# Repo-root user_files/prompts/My_Prompts.txt. The pack root is derived from the
# file layout (see utils.paths.pack_root) so the path is portable across installs
# instead of a machine-specific absolute path.
_REPO_ROOT = pack_root()
DEFAULT_PROMPTS_FILE = os.path.join(
    _REPO_ROOT, "user_files", "prompts", "My_Prompts.txt"
)


def _prompt_browser_root(path=""):
    raw = (path or "").strip() or os.path.dirname(DEFAULT_PROMPTS_FILE)
    raw = os.path.expanduser(raw)
    if os.path.isfile(raw):
        raw = os.path.dirname(raw)
    if not os.path.isdir(raw):
        raw = os.path.dirname(DEFAULT_PROMPTS_FILE)
    return os.path.abspath(raw)


@PromptServer.instance.routes.get("/dirtybirds/saveprompt-browse")
async def api_saveprompt_browse(request):
    """List folders and prompt filenames for the Save Image & Prompt picker.

    This route lists names only. It does not read prompt file contents.
    """
    path = _prompt_browser_root(request.rel_url.query.get("path", ""))
    dirs = []
    files = []
    try:
        with os.scandir(path) as entries:
            for entry in entries:
                try:
                    if entry.is_dir():
                        dirs.append(entry.name)
                    elif entry.is_file() and entry.name.lower().endswith(".txt"):
                        files.append(entry.name)
                except OSError:
                    continue
    except Exception as e:
        return web.json_response(
            {"error": str(e), "path": path, "dirs": [], "files": []}, status=400
        )
    parent = os.path.dirname(path) if os.path.dirname(path) != path else ""
    return web.json_response(
        {
            "path": path,
            "parent": parent,
            "dirs": sorted(dirs, key=str.lower),
            "files": sorted(files, key=str.lower),
        }
    )


def _append_prompt(prompts_file, text):
    """Append one trimmed prompt line to prompts_file, creating dirs as needed."""
    text = (text or "").strip()
    if not text:
        return False
    path = os.path.expanduser((prompts_file or "").strip() or DEFAULT_PROMPTS_FILE)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(text + "\n")
    return True


def _collect_prompt_files(folder):
    if not os.path.isdir(folder):
        return []
    return [
        os.path.join(folder, name)
        for name in sorted(os.listdir(folder))
        if name.lower().endswith(".txt") and os.path.isfile(os.path.join(folder, name))
    ]


def _prompt_file_from_name(name):
    base = os.path.dirname(DEFAULT_PROMPTS_FILE)
    name = str(name or "").replace("\\", "/").strip().lstrip("/")
    if not name or "/" in name or ".." in name or not name.lower().endswith(".txt"):
        raise web.HTTPBadRequest(text="invalid prompt file")
    path = os.path.abspath(os.path.join(base, name))
    if os.path.commonpath([path, os.path.abspath(base)]) != os.path.abspath(base):
        raise web.HTTPForbidden()
    return path


@PromptServer.instance.routes.get("/dirtybirds/saved-prompts")
async def api_saved_prompts(request):
    """Return saved prompt lines for Prompt Builder's Load Prompt menu.

    Save Image & Prompt owns the file location. This route reads only .txt prompt
    library files, not wildcard/style files.
    """
    folder = os.path.dirname(DEFAULT_PROMPTS_FILE)
    files = _collect_prompt_files(folder)
    prompts, items, seen = [], [], set()
    for path in files:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for idx, line in enumerate(fh, start=1):
                    line = line.strip()
                    if line and line not in seen:
                        seen.add(line)
                        prompts.append(line)
                    if line:
                        items.append(
                            {
                                "file": os.path.basename(path),
                                "line": idx,
                                "text": line,
                            }
                        )
        except Exception as e:
            logger.warning("[DirtyBirds] Could not read prompt file %s: %s", path, e)
    return web.json_response({"prompts": prompts, "items": items})


@PromptServer.instance.routes.post("/dirtybirds/delete-saved-prompt")
async def api_delete_saved_prompt(request):
    try:
        data = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="invalid JSON")

    path = _prompt_file_from_name(data.get("file"))
    line_no = int(data.get("line") or 0)
    expected = str(data.get("text", "") or "").strip()
    if line_no < 1:
        raise web.HTTPBadRequest(text="invalid line")
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
        if line_no > len(lines):
            raise web.HTTPBadRequest(text="line no longer exists")
        current = lines[line_no - 1].strip()
        if expected and current != expected:
            raise web.HTTPConflict(text="prompt changed; refresh list")
        del lines[line_no - 1]
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.writelines(lines)
    except web.HTTPException:
        raise
    except Exception as e:
        logger.warning("[DirtyBirds] Delete saved prompt failed: %s", e)
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    return web.json_response(
        {"ok": True, "file": os.path.basename(path), "line": line_no}
    )


@PromptServer.instance.routes.post("/dirtybirds/saveprompt-write-text")
async def api_saveprompt_write_text(request):
    try:
        data = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="invalid JSON")

    positive = str(data.get("positive", "") or "").strip()
    prompts_file = str(data.get("prompts_file", "") or "").strip()
    if not positive:
        raise web.HTTPBadRequest(text="nothing to save")
    try:
        _append_prompt(prompts_file, positive.replace("\n", " ").strip())
    except Exception as e:
        logger.warning("[DirtyBirds] Save Image & Prompt text save failed: %s", e)
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    path = os.path.expanduser(prompts_file or DEFAULT_PROMPTS_FILE)
    return web.json_response({"ok": True, "path": os.path.basename(path)})


class DirtyBirdsSavePrompt:
    """Save Image & Prompt: save images and display/save final prompt markdown."""

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filename_prefix": ("STRING", {"default": "DirtyBirds"}),
                "prompts_file": ("STRING", {"default": DEFAULT_PROMPTS_FILE}),
            },
            "optional": {
                "pipe": ("DIRTYBIRDS_PIPE",),
                "images": ("IMAGE",),
                "positive": (
                    "STRING",
                    {"multiline": True, "default": "", "forceInput": True},
                ),
                "negative": (
                    "STRING",
                    {"multiline": True, "default": "", "forceInput": True},
                ),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "DirtyBirds"

    def save(
        self,
        filename_prefix="DirtyBirds",
        prompts_file=DEFAULT_PROMPTS_FILE,
        pipe=None,
        images=None,
        positive=None,
        negative=None,
        prompt=None,
        extra_pnginfo=None,
    ):
        if images is None and pipe is not None:
            images = pipe.get("images")
        if images is None:
            raise ValueError(
                "No images provided -- connect an IMAGE input or a pipe with images."
            )
        pos_out = positive or ""
        neg_out = negative or ""
        if pipe:
            ls = pipe.get("loader_settings") or {}
            if not pos_out:
                pos_out = str(ls.get("positive", "") or "")
            if not neg_out:
                neg_out = str(ls.get("negative", "") or "")
        summary = generation_summary(pipe)
        settings_line = summary_line(summary)
        full_output_folder, filename, counter, subfolder, filename_prefix = (
            folder_paths.get_save_image_path(
                filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0]
            )
        )

        results = []
        for batch_number, image in enumerate(images):
            arr = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

            metadata = PngInfo()
            # Embed the executed graph + workflow (like stock SaveImage) so the
            # PNG can be dragged back onto the ComfyUI canvas to restore it.
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt))
            for key, value in (extra_pnginfo or {}).items():
                metadata.add_text(key, json.dumps(value))
            if pos_out:
                metadata.add_text("prompt_positive", pos_out)
            if neg_out:
                metadata.add_text("prompt_negative", neg_out)
            # Settings in two forms: machine-readable for tooling, and one plain
            # line any image viewer's metadata panel can show at a glance.
            if summary:
                metadata.add_text("db_generation", json.dumps(summary))
                metadata.add_text("db_settings", settings_line)

            file = f"{filename}_{counter:05}_.png"
            img.save(
                os.path.join(full_output_folder, file),
                pnginfo=metadata,
                compress_level=4,
            )
            results.append(
                {"filename": file, "subfolder": subfolder, "type": self.type}
            )
            counter += 1

        return {
            "ui": {
                "images": results,
                "db_prompts_md": [pos_out, neg_out],
                "db_settings_md": [settings_line],
            },
            "result": (),
        }


NODE_CLASS_MAPPINGS = {"DirtyBirdsSavePrompt": DirtyBirdsSavePrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsSavePrompt": "💾 Save Image & Prompt"}
