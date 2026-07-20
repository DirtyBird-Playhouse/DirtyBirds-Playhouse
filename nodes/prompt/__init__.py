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

# Name of the roll-scoped variable the dress-state dropdown declares. The
# wildcard file's __Templates/Scene__ (and any prompt) references it as [[reg]].
DRESS_REG = "reg"


def _dress_states():
    """Dress-register values, read live from the wildcards.

    These are the sub-keys directly under clothing/tops/ (nude, partially-nude,
    casual-wear, ...), so the dropdown tracks whatever states exist in the YAML
    without any code change. Returned in the engine's canonical hyphenated form
    (what [[reg]] must inject). Sorted; [] if none/unavailable."""
    try:
        wd = load_wildcard_dict()
    except Exception:
        return []
    prefix = "clothing/tops/"
    states = set()
    for key in wd:
        if key.startswith(prefix):
            rest = key[len(prefix):]
            if rest and "/" not in rest:
                states.add(rest)
    return sorted(states)


def _dress_labels():
    """Human-friendly dropdown labels: 'partially-nude' -> 'partially nude'.

    The label is what the user sees/selects; _dress_declaration converts it back
    to the canonical hyphenated value before injecting, since a __token__ path
    cannot contain a space."""
    return [s.replace("-", " ") for s in _dress_states()]


def _dress_declaration(dress_state):
    """Build the [[reg=...]] text to prepend for a chosen dropdown label.

    '(off)' -> nothing; 'random' -> a {a|b|c} pick over all states; a specific
    label (e.g. 'business attire') -> a fixed pick using its canonical hyphenated
    value ('business-attire'). Returns '' when there is nothing to inject."""
    if not dress_state or dress_state == "(off)":
        return ""
    states = _dress_states()
    if dress_state == "random":
        return f"[[{DRESS_REG}={{{'|'.join(states)}}}]] " if states else ""
    canonical = dress_state.strip().lower().replace(" ", "-")
    if canonical in states:
        return f"[[{DRESS_REG}={canonical}]] "
    return ""


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
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                                 "control_after_generate": False}),
                # When on, wildcards re-roll randomly every run (ignores seed).
                # When off, the seed above gives a fixed, reproducible roll.
                "reroll_each_run": ("BOOLEAN", {"default": True}),
                "cycler_text": ("STRING", {"multiline": True, "default": ""}),
                # Dress-state picker. Auto-populated from the wildcards (the
                # states under clothing/tops/). Prepends [[reg=...]] to positive
                # so __Templates/Scene__ resolves to that outfit. "(off)" leaves
                # the text alone; "random" rolls a new state each run.
                # NOTE: kept LAST so adding it doesn't shift the saved widget
                # values of existing workflows (ComfyUI restores widgets by order).
                "dress_state": (["(off)", "random"] + _dress_labels(),
                                {"default": "(off)"}),
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
    def VALIDATE_INPUTS(cls, dress_state=None, **kwargs):
        # Accept any dress_state, including a stale/empty value from a graph saved
        # before this widget existed (or from an earlier order shuffle). process()
        # safely ignores anything it doesn't recognise, so this only prevents the
        # spurious "Value not in list" error at queue time.
        return True

    @classmethod
    def IS_CHANGED(cls, positive="", negative="", seed=0, reroll_each_run=True,
                   dress_state="(off)", **kwargs):
        if reroll_each_run:
            return random.random()
        return (positive, negative, seed, dress_state)

    def process(self, positive, negative, reroll_each_run=True, seed=0,
                cycler_text="", dress_state="(off)", concat_positive=None,
                concat_negative=None, **_deprecated_inputs):
        if reroll_each_run:
            seed = random.randint(0, 0xffffffffffffffff)

        # Prepend the dress-state declaration (if the dropdown selected one) so
        # [[reg]] is set before __Templates/Scene__ and the outfit tokens resolve.
        positive = _dress_declaration(dress_state) + positive

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

        # Log operational counts only — never the prompt text itself, which can
        # be sensitive and would otherwise land in the console/log files.
        logger.info(
            "[DirtyBirds] Script: concat_positive=%s, concat_negative=%s, cycler_items=%d",
            "set" if cp else "none", "set" if cn else "none", len(cycle_items))

        # Emit the resolved prompt to the node UI (Dirty Talk preview) so it shows
        # before the sampler runs, letting the user cancel early if it's wrong.
        return {"ui": {"db_prompts_md": [positives[0], neg_out]},
                "result": (positives, neg_out)}


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {"DirtyBirdsPrompt": DirtyBirdsPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsPrompt": "🗨️ Prompt Builder"}
