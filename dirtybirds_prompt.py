import os
import re
import random
import logging

from aiohttp import web
from server import PromptServer

logger = logging.getLogger(__name__)

# Wildcards live in "user_files/wildcards" folder (.yaml / .yml / .txt)
WILDCARDS_DIR = os.path.join(os.path.dirname(__file__), "user_files", "wildcards")

# Prompt .txt files live in a "prompts" folder alongside this node
PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")


# ---------------------------------------------------------------------------
# Self-contained wildcard engine
#
# No external custom-node dependency. Supports an ImpactPack-compatible subset:
#   __key__ / __parent/child__   -> random entry from a named wildcard list
#   {a|b|c}                      -> dynamic prompt, pick one
#   {7::a|3::b}                  -> weighted pick (a ~70%, b ~30%)
#   {2$$a|b|c}                   -> pick exactly 2
#   {1-3$$a|b|c}                 -> pick between 1 and 3
#   {2$$ / $$a|b|c}              -> pick 2 joined with a custom separator
# Resolution is recursive (results may themselves contain wildcards) with a
# bounded depth, and is fully driven by the provided seed for reproducibility.
# ---------------------------------------------------------------------------

_WILDCARD_RE = re.compile(r"__([\w./\-]+)__")
_DYNAMIC_RE = re.compile(r"\{([^{}]*)\}")
_WEIGHT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*::\s*(.*)$", re.DOTALL)
_MAX_DEPTH = 50


def _normalize_key(x):
    """slashes, spaces->'-', lowercase — matches the picker's key form."""
    return str(x).replace("\\", "/").replace(" ", "-").lower()


def _flatten_yaml(node, prefix, out):
    """Flatten nested yaml into {normalized-key: [values...]} leaf entries."""
    if isinstance(node, dict):
        for k, v in node.items():
            key = f"{prefix}/{k}" if prefix else str(k)
            _flatten_yaml(v, key, out)
    elif isinstance(node, list):
        if prefix:
            out[_normalize_key(prefix)] = [str(v) for v in node]
    else:
        # scalar leaf
        if prefix:
            out[_normalize_key(prefix)] = [str(node)]


def load_wildcard_dict():
    """Build {key: [values]} from every .yaml/.yml/.txt in the wildcards folder.

    Re-read on each call so edits to the files show up without a restart."""
    result = {}
    os.makedirs(WILDCARDS_DIR, exist_ok=True)
    try:
        import yaml
    except Exception:
        yaml = None

    for root, _dirs, files in os.walk(WILDCARDS_DIR, followlinks=True):
        for file in files:
            path = os.path.join(root, file)
            try:
                if file.endswith(".txt"):
                    rel = os.path.relpath(path, WILDCARDS_DIR)
                    key = _normalize_key(os.path.splitext(rel)[0])
                    with open(path, "r", encoding="UTF-8", errors="ignore") as f:
                        lines = [ln.strip() for ln in f]
                    # Drop blanks and '#' comment lines.
                    values = [ln for ln in lines if ln and not ln.startswith("#")]
                    if values:
                        result[key] = values
                elif (file.endswith(".yaml") or file.endswith(".yml")) and yaml is not None:
                    with open(path, "r", encoding="UTF-8", errors="ignore") as f:
                        data = yaml.safe_load(f) or {}
                    _flatten_yaml(data, "", result)
            except Exception as e:
                logger.warning("[DirtyBirds] Could not load wildcard file %s: %s", path, e)
    return result


def _split_weight(option):
    """Return (weight, text). 'weight::text' -> (float, text); else (1.0, option)."""
    m = _WEIGHT_RE.match(option)
    if m:
        return float(m.group(1)), m.group(2)
    return 1.0, option


def _resolve_dynamic(match, rng):
    """Expand one {...} dynamic-prompt group."""
    body = match.group(1)

    # Parse an optional "N$$" or "N-M$$" quantifier and "$$sep$$" separator.
    count_lo = count_hi = 1
    sep = ", "
    parts = body.split("$$")
    if len(parts) >= 2:
        quant = parts[0].strip()
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", quant)
        if m:
            count_lo = int(m.group(1))
            count_hi = int(m.group(2)) if m.group(2) else count_lo
            if len(parts) >= 3:
                # N$$sep$$options  — middle segment is the separator
                sep = parts[1]
                options_str = "$$".join(parts[2:])
            else:
                options_str = parts[1]
        else:
            # No valid quantifier; '$$' was literal content.
            options_str = body
    else:
        options_str = body

    options = [o for o in options_str.split("|")]
    if not options:
        return ""

    # Split optional "weight::" prefixes into parallel weights/texts lists.
    weights, texts = [], []
    for o in options:
        w, t = _split_weight(o)
        weights.append(w)
        texts.append(t)

    n = rng.randint(count_lo, count_hi) if count_hi > count_lo else count_lo
    n = max(0, min(n, len(texts)))
    if n <= 1 and count_lo == count_hi == 1:
        return rng.choices(texts, weights=weights, k=1)[0]

    # Weighted sampling without replacement: draw one at a time, removing each pick.
    picks = []
    pool_t, pool_w = list(texts), list(weights)
    for _ in range(n):
        if not pool_t:
            break
        i = rng.choices(range(len(pool_t)), weights=pool_w, k=1)[0]
        picks.append(pool_t.pop(i))
        pool_w.pop(i)
    return sep.join(picks)


def _resolve_wildcard(match, wd, rng):
    """Expand one __key__ reference using the wildcard dict."""
    key = _normalize_key(match.group(1))
    values = wd.get(key)
    if not values:
        # Unknown key: leave the token untouched so it's visibly unresolved.
        return match.group(0)
    return rng.choice(values)


def process(text, seed, wildcard_dict=None):
    """Resolve dynamic prompts and __wildcards__ in `text`, seeded for repeatability."""
    if not text:
        return text
    wd = wildcard_dict if wildcard_dict is not None else load_wildcard_dict()
    rng = random.Random(seed)

    out = text
    for _ in range(_MAX_DEPTH):
        new = _DYNAMIC_RE.sub(lambda m: _resolve_dynamic(m, rng), out)
        new = _WILDCARD_RE.sub(lambda m: _resolve_wildcard(m, wd, rng), new)
        if new == out:
            break
        out = new
    return out




# ---------------------------------------------------------------------------
# Web API Routes
# ---------------------------------------------------------------------------

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
            },
            "optional": {
                # Concatenate additional prompt text before the node's own output.
                "concat_positive": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
                "concat_negative": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "process"
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, positive="", negative="", seed=0, reroll_each_run=True, **kwargs):
        if reroll_each_run:
            return random.random()
        return (positive, negative, seed)

    def process(self, positive, negative, reroll_each_run=True, seed=0,
                concat_positive="", concat_negative=""):
        if reroll_each_run:
            seed = random.randint(0, 0xffffffffffffffff)

        wd = load_wildcard_dict()
        try:
            pos_out = process(positive, seed, wd)
            neg_out = process(negative, (seed + 1) & 0xffffffffffffffff, wd)
        except Exception as e:
            logger.warning("[DirtyBirds] Wildcard processing failed (%s); using raw text", e)
            pos_out, neg_out = positive, negative

        # Prepend concat strings when provided.
        if concat_positive and concat_positive.strip():
            pos_out = concat_positive.strip() + (", " + pos_out if pos_out else "")
        if concat_negative and concat_negative.strip():
            neg_out = concat_negative.strip() + (", " + neg_out if neg_out else "")

        logger.info(
            "[DirtyBirds] Script: concat_positive=%r -> final positive=%r",
            (concat_positive or "")[:120], (pos_out or "")[:120])

        return (pos_out, neg_out)


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {"DirtyBirdsPrompt": DirtyBirdsPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsPrompt": "💬 Dirty Talk — The Script"}
