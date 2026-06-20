"""Self-contained wildcard / dynamic-prompt engine for DirtyBirds.

Pure logic, no ComfyUI imports, so it is unit-testable on its own. The node and
web routes in dirtybirds_prompt.py import process() / load_wildcard_dict() here.

Supported syntax (ImpactPack-compatible subset, plus roll-scoped variables):
  __key__ / __parent/child__   -> random entry from a named wildcard list
  {a|b|c}                      -> dynamic prompt, pick one
  {7::a|3::b}                  -> weighted pick (a ~70%, b ~30%)
  {2$$a|b|c}                   -> pick exactly 2
  {1-3$$a|b|c}                 -> pick between 1 and 3
  {2$$ / $$a|b|c}              -> pick 2 joined with a custom separator
  [[name=VALUE]]               -> resolve VALUE once, store as a variable, emit
                                  nothing (a "declaration")
  [[name]]                     -> substitute the stored variable value

Variables make selections coherent across multiple tokens. Example: choose a
clothing register once and reuse it so the outfit can't mix formal and casual:

  [[reg={Casual|Business}]]__clothing/tops/[[reg]]__, \
  __clothing/bottoms/[[reg]]__, __clothing/footwear/[[reg]]__

Resolution is recursive with a bounded depth and fully seed-driven.
"""

import os
import re
import logging
import random

logger = logging.getLogger(__name__)

# Wildcards live in "user_files/wildcards" folder (.yaml / .yml / .txt)
WILDCARDS_DIR = os.path.join(os.path.dirname(__file__), "user_files", "wildcards")

_WILDCARD_RE = re.compile(r"__([\w./\-]+)__")
_DYNAMIC_RE = re.compile(r"\{([^{}]*)\}")
_WEIGHT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*::\s*(.*)$", re.DOTALL)
# Roll-scoped variables. [[name=value]] declares; [[name]] references. The value
# excludes [ and ] so a declaration never swallows a neighbouring [[...]].
_VAR_ASSIGN_RE = re.compile(r"\[\[(\w+)\s*=\s*([^\[\]]*)\]\]")
_VAR_REF_RE = re.compile(r"\[\[(\w+)\]\]")
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


def _resolve_fragment(text, wd, rng, variables):
    """Resolve variable declarations/references, {...} groups and __wildcards__.

    Runs to a fixed point (bounded by _MAX_DEPTH) since a resolved value may
    itself contain further tokens. Each pass, in order:
      1. `[[name=value]]` declarations -> store the (resolved) value, emit nothing,
      2. `[[name]]` references         -> substitute the stored value,
      3. `{...}` dynamic groups, then 4. `__wildcards__`.
    Declarations are handled HERE (not only on the top-level text) so a
    declaration that arrives mid-roll -- e.g. inside a scenario template pulled
    via a __token__ -- still fires. Templates with none of these constructs are
    returned unchanged after a single no-op pass, so existing prompts behave
    exactly as before."""
    def _assign(m):
        variables[m.group(1)] = _resolve_fragment(m.group(2), wd, rng, variables)
        return ""

    out = text
    for _ in range(_MAX_DEPTH):
        new = _VAR_ASSIGN_RE.sub(_assign, out)
        new = _VAR_REF_RE.sub(
            lambda m: variables.get(m.group(1), m.group(0)), new)
        new = _DYNAMIC_RE.sub(lambda m: _resolve_dynamic(m, rng), new)
        new = _WILDCARD_RE.sub(lambda m: _resolve_wildcard(m, wd, rng), new)
        if new == out:
            break
        out = new
    return out


def process(text, seed, wildcard_dict=None):
    """Resolve variables, dynamic prompts and __wildcards__, seeded for repeatability.

    Variables (`[[name=value]]` declares once per roll, `[[name]]` reuses) make
    multi-token picks coherent -- e.g. choose a clothing register once and dress
    head to toe from it. They work whether declared in the prompt you type or
    inside a scenario template pulled via a __token__."""
    if not text:
        return text
    wd = wildcard_dict if wildcard_dict is not None else load_wildcard_dict()
    rng = random.Random(seed)
    return _resolve_fragment(text, wd, rng, {})
