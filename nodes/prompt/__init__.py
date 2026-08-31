import os
import random
import logging

from aiohttp import web
from server import PromptServer

# The wildcard / dynamic-prompt engine lives in its own ComfyUI-free module so it
# can be unit-tested standalone. load_wildcard_dict and process are re-exported
# here for backwards compatibility with anything importing them from this module.
from .utils.wildcard_engine import load_wildcard_dict, process, resolve
from .cycler import append_positive, cycle_text

# Booru tag fetcher: a widget of this (Prompt Builder) node. Imported for the
# side-effect of registering its /dirtybirds/booru-search route.
from . import booru  # noqa: F401
from . import tag_autocomplete  # noqa: F401
from . import wildcard_helper  # noqa: F401

logger = logging.getLogger(__name__)

# Prompt .txt files live in a "prompts" folder alongside this node.
# Save Image & Prompt owns saving prompts; Prompt Builder only loads them.
PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")

# ---------------------------------------------------------------------------
# Web API Routes
# ---------------------------------------------------------------------------


@PromptServer.instance.routes.post("/dirtybirds/send-prompt")
async def send_prompt(request):
    """Inject a positive prompt into every live Prompt Builder node in ComfyUI."""
    data = await request.json()
    positive = str(data.get("positive", "") or "").strip()
    if not positive:
        return web.json_response(
            {"success": False, "error": "positive prompt required"}, status=400
        )
    PromptServer.instance.send_sync("dirtybirds_set_prompt", {"positive": positive})
    return web.json_response({"success": True})


@PromptServer.instance.routes.get("/dirtybirds/wildcards")
async def get_wildcards(request):
    """List available wildcard keys for the 'Load Wildcards' picker.

    File order, not alphabetical. Categories are grouped deliberately in the
    YAML (Hair, then Eyes, then Skin) and sorting scatters that grouping. The
    dict is built by walking the document top to bottom, so insertion order is
    already file order — it just has to survive to the browser.
    """
    return web.json_response({"keys": list(load_wildcard_dict().keys())})


@PromptServer.instance.routes.get("/dirtybirds/prompt-files")
async def get_prompt_files(request):
    """List .txt files in the prompts/ folder."""
    os.makedirs(PROMPTS_DIR, exist_ok=True)
    files = sorted(
        f
        for f in os.listdir(PROMPTS_DIR)
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
    if os.path.commonpath(
        [os.path.abspath(full), os.path.abspath(PROMPTS_DIR)]
    ) != os.path.abspath(PROMPTS_DIR):
        raise web.HTTPForbidden()
    if not os.path.isfile(full):
        raise web.HTTPNotFound()
    with open(full, "r", encoding="utf-8") as fh:
        lines = [line.strip() for line in fh if line.strip()]
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
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": False,
                    },
                ),
                # When on, wildcards re-roll randomly every run (ignores seed).
                # When off, the seed above gives a fixed, reproducible roll.
                "reroll_each_run": ("BOOLEAN", {"default": True}),
                "cycler_text": ("STRING", {"multiline": True, "default": ""}),
                # Step mode — walk wildcard lists in order, one entry per run,
                # instead of rolling them. For checking a wildcard file entry by
                # entry. The UI advances wildcard_step after each queued run.
                # NOTE: kept LAST so adding widgets doesn't shift the saved
                # values of existing workflows (ComfyUI restores them by order).
                "step_enabled": ("BOOLEAN", {"default": False}),
                "wildcard_step": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFF,
                        "control_after_generate": False,
                    },
                ),
            },
            "optional": {
                # Concatenate additional prompt text after the node's own output.
                "concat_positive": (
                    "STRING",
                    {"multiline": True, "default": "", "forceInput": True},
                ),
                "concat_negative": (
                    "STRING",
                    {"multiline": True, "default": "", "forceInput": True},
                ),
            },
        }

    # cycler_line is appended last so existing saved workflows keep their link
    # indices. It expands in lockstep with positive — iteration i emits
    # positive[i] and the cycler line that produced it — so wiring it straight
    # to Sampler & Picker gives the text overlay the right caption per image,
    # regardless of what sits between here and Generation Setup.
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("positive", "negative", "cycler_line")
    OUTPUT_IS_LIST = (True, False, True)
    FUNCTION = "process"
    CATEGORY = "DirtyBirds"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        # Accept stale widget values from a graph saved against an older widget
        # set (the removed dress_state combo shifted later widgets by one).
        # process() ignores anything it doesn't recognise, so this only prevents
        # a spurious "Value not in list" error at queue time.
        return True

    @classmethod
    def IS_CHANGED(
        cls,
        positive="",
        negative="",
        seed=0,
        reroll_each_run=True,
        step_enabled=False,
        wildcard_step=0,
        **kwargs,
    ):
        if reroll_each_run:
            return random.random()
        # The step number is part of the identity of a stepped run, or a fixed
        # seed would cache the first entry and never advance.
        return (
            positive,
            negative,
            seed,
            bool(step_enabled),
            wildcard_step,
        )

    def process(
        self,
        positive,
        negative,
        reroll_each_run=True,
        seed=0,
        cycler_text="",
        step_enabled=False,
        wildcard_step=0,
        concat_positive=None,
        concat_negative=None,
        **_deprecated_inputs,
    ):
        if reroll_each_run:
            # Cap at 2**53-1 so the seed echoed to the UI round-trips exactly;
            # otherwise the browser loses precision and "Last" can't reproduce
            # the wildcard roll. (JS Numbers are exact only up to 2**53-1.)
            seed = random.randint(0, 0x1FFFFFFFFFFFFF)

        # Step mode walks every wildcard list by position instead of rolling it,
        # so consecutive runs march through a file entry by entry. None = roll.
        # Values are checked rather than trusted: a graph saved before the
        # dress_state widget was removed shifts its "(off)" string into these
        # slots, and a bare truth test would switch stepping on by itself.
        step = None
        if step_enabled is True or step_enabled == 1:
            try:
                step = max(0, int(wildcard_step))
            except (TypeError, ValueError):
                step = 0
        step_total = 0

        wd = load_wildcard_dict()
        try:
            pos_out, picker = resolve(positive, seed, wd, step)
            neg_out = process(negative, (seed + 1) & 0xFFFFFFFFFFFFFFFF, wd, step)
            step_total = getattr(picker, "longest", 0)
        except Exception as e:
            logger.warning(
                "[DirtyBirds] Wildcard processing failed (%s); using raw text", e
            )
            pos_out, neg_out = positive, negative

        # Append concat strings when provided.
        cp = str(concat_positive or "").strip()
        cn = str(concat_negative or "").strip()
        if cp:
            pos_out = append_positive(pos_out, cp)
        if cn:
            neg_out = (neg_out + ", " + cn) if neg_out else cn

        cycle_items = cycle_text(cycler_text)
        positives = [append_positive(pos_out, item) for item in cycle_items]

        # Log operational counts only — never the prompt text itself, which can
        # be sensitive and would otherwise land in the console/log files.
        logger.info(
            "[DirtyBirds] Script: concat_positive=%s, concat_negative=%s, cycler_items=%d",
            "set" if cp else "none",
            "set" if cn else "none",
            len(cycle_items),
        )

        # Emit the resolved prompt to the node UI (Prompt Builder preview) so it shows
        # before the sampler runs, letting the user cancel early if it's wrong.
        # db_seed_used echoes the seed actually rolled so the UI's "Last" recall
        # can reproduce the wildcard roll.
        ui = {"db_prompts_md": [positives[0], neg_out], "db_seed_used": [seed]}
        if step is not None:
            # Position + list length, so the UI can show "step 3 / 42" and say
            # when a full pass through the file is done.
            ui["db_step_used"] = [step, int(step_total)]
        return {
            "ui": ui,
            "result": (positives, neg_out, cycle_items),
        }


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {"DirtyBirdsPrompt": DirtyBirdsPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsPrompt": "🗨️ Prompt Builder"}
