import os
import random
import logging

from aiohttp import web
from server import PromptServer

# The wildcard / dynamic-prompt engine lives in its own ComfyUI-free module so it
# can be unit-tested standalone. load_wildcard_dict and process are re-exported
# here for backwards compatibility with anything importing them from this module.
from .utils.wildcard_engine import load_wildcard_dict, process
from .cycler import append_positive, cycle_text, with_cycler_metadata

# Booru tag fetcher: a widget of this (Dirty Talk) node. Imported for the
# side-effect of registering its /dirtybirds/booru-search route.
from . import booru  # noqa: F401
from . import tag_autocomplete  # noqa: F401

logger = logging.getLogger(__name__)

# Prompt .txt files live in a "prompts" folder alongside this node.
# The Archive node owns saving prompts; Dirty Talk only loads them.
PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")


# ---------------------------------------------------------------------------
# Web API Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.post("/dirtybirds/send-prompt")
async def send_prompt(request):
    """Inject a positive prompt into every live Dirty Talk node in ComfyUI."""
    data = await request.json()
    positive = str(data.get("positive", "") or "").strip()
    if not positive:
        return web.json_response(
            {"success": False, "error": "positive prompt required"}, status=400)
    PromptServer.instance.send_sync(
        "dirtybirds_set_prompt", {"positive": positive})
    return web.json_response({"success": True})

@PromptServer.instance.routes.get("/dirtybirds/wildcards")
async def get_wildcards(request):
    """List available wildcard keys for the 'Load Wildcards' picker."""
    return web.json_response({"keys": sorted(load_wildcard_dict().keys())})


@PromptServer.instance.routes.get("/dirtybirds/prompt-files")
async def get_prompt_files(request):
    """List .txt files in the prompts/ folder."""
    os.makedirs(PROMPTS_DIR, exist_ok=True)
    files = sorted(
        f for f in os.listdir(PROMPTS_DIR)
        if f.lower().endswith(".txt") and os.path.isfile(os.path.join(PROMPTS_DIR, f))
    )
    return web.json_response({"files": files})


@PromptServer.instance.routes.get("/dirtybirds/prompt-file")
async def get_prompt_file(request):
    """Return non-empty lines from a named .txt file in the prompts/ folder."""
    name = request.rel_url.query.get("name", "").strip().replace("\\", "/").lstrip("/")
    if not name or ".." in name or not name.lower().endswith(".txt"):
        raise web.HTTPBadRequest(text="invalid name")
    full = os.path.normpath(os.path.join(PROMPTS_DIR, name))
    if os.path.commonpath([os.path.abspath(full), os.path.abspath(PROMPTS_DIR)]) != os.path.abspath(PROMPTS_DIR):
        raise web.HTTPForbidden()
    if not os.path.isfile(full):
        raise web.HTTPNotFound()
    with open(full, "r", encoding="utf-8") as fh:
        lines = [l.strip() for l in fh if l.strip()]
    return web.json_response({"lines": lines})


# ---------------------------------------------------------------------------
# Node Definition
# ---------------------------------------------------------------------------

class DirtyBirdsPrompt:
    """Builds base positive / negative prompts with built-in wildcard support."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": ("STRING", {"multiline": True, "default": ""}),
                "negative": ("STRING", {"multiline": True, "default": ""}),
                # Fixed seed for reproducible wildcard rolls. Used only when
                # reroll_each_run is off.
                # control_after_generate is disabled: ComfyUI auto-adds it to any
                # INT widget named "seed", but reroll_each_run already covers the
                # random/fixed choice, so the dropdown would be redundant.
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                                 "control_after_generate": False}),
                # When on, wildcards re-roll randomly every run (ignores seed).
                # When off, the seed above gives a fixed, reproducible roll.
                "reroll_each_run": ("BOOLEAN", {"default": True}),
                "cycler_text": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                # Concatenate additional prompt text after the node's own output.
                "concat_positive": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
                "concat_negative": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "process"
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, positive="", negative="", seed=0, reroll_each_run=True, **kwargs):
        if reroll_each_run:
            return random.random()
        return (positive, negative, seed)

    def process(self, positive, negative, reroll_each_run=True, seed=0,
                cycler_text="", concat_positive=None, concat_negative=None,
                **_deprecated_inputs):
        if reroll_each_run:
            seed = random.randint(0, 0xffffffffffffffff)

        wd = load_wildcard_dict()
        try:
            pos_out = process(positive, seed, wd)
            neg_out = process(negative, (seed + 1) & 0xffffffffffffffff, wd)
        except Exception as e:
            logger.warning("[DirtyBirds] Wildcard processing failed (%s); using raw text", e)
            pos_out, neg_out = positive, negative

        # Append concat strings when provided.
        cp = str(concat_positive or "").strip()
        cn = str(concat_negative or "").strip()
        if cp:
            pos_out = append_positive(pos_out, cp)
        if cn:
            neg_out = (neg_out + ", " + cn) if neg_out else cn

        cycle_items = cycle_text(cycler_text)
        positives = [with_cycler_metadata(append_positive(pos_out, item), item)
                     for item in cycle_items]

        logger.info(
            "[DirtyBirds] Script: concat_positive=%r cycler_items=%d -> first positive=%r",
            cp[:120], len(cycle_items), (positives[0] or "")[:120])

        # Emit the resolved prompt to the node UI (Dirty Talk preview) so it shows
        # before the sampler runs, letting the user cancel early if it's wrong.
        return {"ui": {"db_prompts_md": [positives[0], neg_out]},
                "result": (positives, neg_out)}


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {"DirtyBirdsPrompt": DirtyBirdsPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsPrompt": "🗨️ Prompt Builder"}
