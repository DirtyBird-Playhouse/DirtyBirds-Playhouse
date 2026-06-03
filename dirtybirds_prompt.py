import os
import re
import json
import random
import logging

import aiohttp
from aiohttp import web
from server import PromptServer

logger = logging.getLogger(__name__)

# Wildcards live alongside this node in a "wildcards" folder (.yaml / .yml / .txt)
WILDCARDS_DIR = os.path.join(os.path.dirname(__file__), "wildcards")


# ---------------------------------------------------------------------------
# Self-contained wildcard engine
#
# No external custom-node dependency. Supports an ImpactPack-compatible subset:
#   __key__ / __parent/child__   -> random entry from a named wildcard list
#   {a|b|c}                      -> dynamic prompt, pick one
#   {2$$a|b|c}                   -> pick exactly 2
#   {1-3$$a|b|c}                 -> pick between 1 and 3
#   {2$$ / $$a|b|c}              -> pick 2 joined with a custom separator
# Resolution is recursive (results may themselves contain wildcards) with a
# bounded depth, and is fully driven by the provided seed for reproducibility.
# ---------------------------------------------------------------------------

_WILDCARD_RE = re.compile(r"__([\w./\-]+)__")
_DYNAMIC_RE = re.compile(r"\{([^{}]*)\}")
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

    n = rng.randint(count_lo, count_hi) if count_hi > count_lo else count_lo
    n = max(0, min(n, len(options)))
    if n <= 1 and count_lo == count_hi == 1:
        return rng.choice(options)
    picks = rng.sample(options, n)
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


def _list_wildcard_keys():
    """Sorted wildcard keys (__key__ names) defined in our folder."""
    return sorted(load_wildcard_dict().keys())


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/wildcards")
async def get_wildcards(request):
    """List available wildcard keys for the 'Load Wildcards' picker."""
    return web.json_response({
        "keys": _list_wildcard_keys(),
    })


# ---------------------------------------------------------------------------
# Wildcard editor — standalone page + file/IO + LM Studio extraction
# Self-contained: served by ComfyUI, talks to a local OpenAI-compatible
# endpoint (LM Studio / Ollama / etc.) over plain HTTP. No external Python deps
# beyond PyYAML (already used by the processor).
# ---------------------------------------------------------------------------

def _safe_wildcard_path(name, must_exist=False):
    """Resolve `name` to a path strictly inside WILDCARDS_DIR, or None.

    Guards against path traversal (../, absolute paths) and limits to YAML."""
    if not name:
        return None
    name = str(name).strip().replace("\\", "/").lstrip("/")
    full = os.path.normpath(os.path.join(WILDCARDS_DIR, name))
    base = os.path.abspath(WILDCARDS_DIR)
    if os.path.commonpath([os.path.abspath(full), base]) != base:
        return None
    if os.path.splitext(full)[1].lower() not in (".yaml", ".yml"):
        return None
    if must_exist and not os.path.isfile(full):
        return None
    return full


def _list_wildcard_files():
    """Relative paths of every YAML file in the wildcards folder."""
    os.makedirs(WILDCARDS_DIR, exist_ok=True)
    out = []
    for root, _dirs, files in os.walk(WILDCARDS_DIR, followlinks=True):
        for f in files:
            if f.lower().endswith((".yaml", ".yml")):
                out.append(os.path.relpath(os.path.join(root, f), WILDCARDS_DIR).replace("\\", "/"))
    return sorted(out)


@PromptServer.instance.routes.get("/dirtybirds/wildcard-editor")
async def wildcard_editor_page(request):
    """Serve the standalone wildcard editor page."""
    html_path = os.path.join(os.path.dirname(__file__), "web", "wildcard_editor.html")
    if not os.path.exists(html_path):
        return web.Response(text="wildcard_editor.html not found", status=404)
    with open(html_path, "r", encoding="utf-8") as f:
        return web.Response(text=f.read(), content_type="text/html")


@PromptServer.instance.routes.get("/dirtybirds/wildcard-files")
async def wildcard_files(request):
    """List editable wildcard YAML files."""
    return web.json_response({"files": _list_wildcard_files()})


@PromptServer.instance.routes.get("/dirtybirds/wildcard-file")
async def wildcard_file_get(request):
    """Return the raw text of one wildcard YAML file."""
    path = _safe_wildcard_path(request.query.get("name"), must_exist=True)
    if not path:
        return web.json_response({"error": "invalid or missing file"}, status=400)
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return web.json_response({"name": request.query.get("name"), "content": f.read()})


@PromptServer.instance.routes.post("/dirtybirds/wildcard-file")
async def wildcard_file_save(request):
    """Save raw text to a wildcard YAML file. Creates it (and dirs) if new.

    Body: { name, content }. Validates YAML before writing."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    path = _safe_wildcard_path(data.get("name"))
    if not path:
        return web.json_response({"error": "invalid file name (must be a .yaml/.yml inside wildcards/)"}, status=400)

    content = data.get("content", "")
    try:
        import yaml
        yaml.safe_load(content or "")  # reject syntactically broken YAML
    except Exception as e:
        return web.json_response({"error": f"YAML error: {e}"}, status=400)

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"success": True})


def _parse_extraction_output(raw):
    """Parse a model's raw reply into a clean [{text, category}] list.

    Tolerant of reasoning models: strips <think> blocks and markdown fences,
    then extracts the first top-level JSON array from the text."""
    cleaned = (raw or "")
    # Drop <think>...</think> reasoning blocks (Qwen3-style).
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
    cleaned = cleaned.replace("```json", "").replace("```", "").strip()

    def _loads_any(s):
        try:
            return json.loads(s)
        except Exception:
            # Fall back to the outermost {...} or [...] anywhere in the text.
            for o, c in (("{", "}"), ("[", "]")):
                start, end = s.find(o), s.rfind(c)
                if start != -1 and end > start:
                    try:
                        return json.loads(s[start:end + 1])
                    except Exception:
                        continue
            raise

    parsed = _loads_any(cleaned)
    # Accept either a bare array or an object like {"items": [...]}.
    if isinstance(parsed, dict):
        items = parsed.get("items") or parsed.get("data") or []
    else:
        items = parsed

    return [{"text": str(it.get("text", "")).strip(),
             "category": str(it.get("category", "")).strip()}
            for it in items if isinstance(it, dict) and it.get("text")]


# ---------------------------------------------------------------------------
# Embedded local model (llama-cpp-python) — optional, no separate app needed.
# Loads the first .gguf found in this node folder, lazily and cached.
# ---------------------------------------------------------------------------

_LOCAL_LLM = None  # cached llama_cpp.Llama instance once loaded
_CUDA_DLLS_READY = False


def _find_gguf():
    import glob
    files = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "*.gguf")))
    return files[0] if files else None


def _prepare_cuda_dlls():
    """Make the pip-installed CUDA 12 runtime DLLs discoverable on Windows.

    The prebuilt llama-cpp-python CUDA wheel bundles ggml-cuda.dll but not the
    CUDA runtime it depends on (cudart64_12.dll / cublas64_12.dll). Those ship
    as nvidia-*-cu12 pip packages; add their bin dirs to PATH + the DLL search
    path so the transitive dependency load succeeds. Idempotent / best-effort."""
    global _CUDA_DLLS_READY
    if _CUDA_DLLS_READY or os.name != "nt":
        return
    import glob
    import site
    roots = []
    try:
        roots.extend(site.getsitepackages())
    except Exception:
        pass
    roots.append(os.path.dirname(os.path.dirname(os.__file__)))  # fallback
    seen = set()
    for root in roots:
        for b in glob.glob(os.path.join(root, "nvidia", "*", "bin")):
            if b in seen or not os.path.isdir(b):
                continue
            seen.add(b)
            os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")
            try:
                os.add_dll_directory(b)
            except Exception:
                pass
    _CUDA_DLLS_READY = True


def _local_model_status():
    """Report availability without loading the model."""
    _prepare_cuda_dlls()
    try:
        import llama_cpp  # noqa: F401
        have_lib = True
    except Exception:
        have_lib = False
    gguf = _find_gguf()
    return {
        "available": bool(have_lib and gguf),
        "have_llama_cpp": have_lib,
        "model": os.path.basename(gguf) if gguf else None,
        "loaded": _LOCAL_LLM is not None,
    }


def _get_local_llm():
    """Return (llm, error). Loads + caches the model on first call."""
    global _LOCAL_LLM
    if _LOCAL_LLM is not None:
        return _LOCAL_LLM, None
    _prepare_cuda_dlls()
    try:
        from llama_cpp import Llama
    except Exception:
        return None, ("llama-cpp-python is not installed. Install it with "
                      "`pip install llama-cpp-python` to use the built-in model.")
    path = _find_gguf()
    if not path:
        return None, "No .gguf model file found in the DirtyBirds-Playhouse folder."
    try:
        # n_gpu_layers=-1 offloads to GPU when a CUDA build is present; ignored
        # by CPU-only builds. verbose off to keep the ComfyUI log clean.
        _LOCAL_LLM = Llama(model_path=path, n_ctx=8192, n_gpu_layers=-1, verbose=False)
    except Exception as e:
        return None, f"Failed to load local model: {e}"
    return _LOCAL_LLM, None


@PromptServer.instance.routes.get("/dirtybirds/wildcard-local-status")
async def wildcard_local_status(request):
    return web.json_response(_local_model_status())


@PromptServer.instance.routes.post("/dirtybirds/wildcard-extract-local")
async def wildcard_extract_local(request):
    """Extract phrases->categories using the embedded GGUF model (in-process)."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    text = (data.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "no text to extract"}, status=400)

    llm, err = _get_local_llm()
    if err:
        return web.json_response({"error": err}, status=503)

    messages = [
        {"role": "system", "content": _extraction_system_prompt(data.get("categories") or [])},
        {"role": "user", "content": f"Extract this data:\n{text}"},
    ]

    import asyncio
    loop = asyncio.get_event_loop()

    def _run():
        # response_format with a schema constrains output to valid JSON from the
        # first token — no reasoning prose possible, so parsing always succeeds.
        return llm.create_chat_completion(
            messages=messages, temperature=0.0, max_tokens=4096,
            response_format={"type": "json_object", "schema": _EXTRACT_SCHEMA},
        )

    try:
        # Run the blocking inference off the event loop so the server stays responsive.
        resp = await loop.run_in_executor(None, _run)
        raw = resp["choices"][0]["message"]["content"]
        items = _parse_extraction_output(raw)
    except Exception as e:
        return web.json_response({"error": f"local model error: {e}"}, status=500)

    return web.json_response({"items": items})


def _extraction_system_prompt(categories):
    bullets = "\n".join(f"- {c}" for c in categories) or "- (none yet)"
    return (
        "You are the Extraction Engine for a YAML Wildcard Manager. Your task is "
        "to ingest unstructured text, break it into individual image-prompt phrases, "
        "and assign each to a logical category path.\n\n"
        f"Current Target Schema Categories:\n{bullets}\n\n"
        "Instructions:\n"
        "1. Isolate atomic phrases and preserve ComfyUI notations like {a|b} or {1-2$$, $$a|b}.\n"
        "2. If a phrase fits an existing category above, use that exact category string.\n"
        "3. If a phrase falls outside all categories, invent a logical nested path using "
        "lowercase and forward slashes (e.g. 'lighting/neon', 'vehicle/sports-car').\n\n"
        "Output ONLY a JSON object of the form {\"items\": [...]}, no prose, no markdown:\n"
        '{"items": [{"text": "vintage Kodak Portra 400 film", "category": "quality"}, '
        '{"text": "neon cyan rim light", "category": "lighting/neon"}]}'
    )


# JSON schema used to constrain model output to valid, parseable structure.
_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["text", "category"],
            },
        }
    },
    "required": ["items"],
}


@PromptServer.instance.routes.post("/dirtybirds/wildcard-extract")
async def wildcard_extract(request):
    """Call a local OpenAI-compatible model to extract phrases->categories.

    Body: { server_url, text, categories: [..] } -> { items: [{text, category}] }"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    text = (data.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "no text to extract"}, status=400)

    server_url = (data.get("server_url") or "http://localhost:1234/v1").rstrip("/")
    endpoint = f"{server_url}/chat/completions"
    body = {
        "model": data.get("model") or "local-model",
        "messages": [
            {"role": "system", "content": _extraction_system_prompt(data.get("categories") or [])},
            {"role": "user", "content": f"Extract this data:\n{text}"},
        ],
        "temperature": 0.0,
        # Ask the server to constrain output to a JSON object (supported by
        # LM Studio / many OpenAI-compatible servers); parser tolerates absence.
        "response_format": {"type": "json_object"},
    }

    try:
        timeout = aiohttp.ClientTimeout(total=180)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(endpoint, json=body) as resp:
                if resp.status != 200:
                    msg = await resp.text()
                    return web.json_response(
                        {"error": f"model server returned HTTP {resp.status}: {msg[:300]}"},
                        status=502)
                payload = await resp.json()
    except Exception as e:
        return web.json_response(
            {"error": f"could not reach model server at {endpoint} ({e}). Is LM Studio running?"},
            status=502)

    try:
        raw = payload["choices"][0]["message"]["content"]
        items = _parse_extraction_output(raw)
    except Exception as e:
        return web.json_response({"error": f"could not parse model output: {e}"}, status=502)

    return web.json_response({"items": items})


@PromptServer.instance.routes.post("/dirtybirds/wildcard-merge")
async def wildcard_merge(request):
    """Merge {text, category} items into a wildcard YAML file on disk.

    Body: { name, items: [{text, category}] } -> { success, content }"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    path = _safe_wildcard_path(data.get("name"))
    if not path:
        return web.json_response({"error": "invalid file name"}, status=400)

    try:
        import yaml
    except Exception:
        return web.json_response({"error": "PyYAML not available"}, status=500)

    # Load existing YAML (or start fresh).
    tree = {}
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                tree = yaml.safe_load(f) or {}
        except Exception as e:
            return web.json_response({"error": f"existing YAML invalid: {e}"}, status=400)

    for item in data.get("items", []):
        phrase = str(item.get("text", "")).strip()
        category = str(item.get("category", "")).strip()
        if not phrase or not category:
            continue
        parts = [p for p in category.split("/") if p]
        node = tree
        for part in parts[:-1]:
            if not isinstance(node.get(part), dict):
                node[part] = {}
            node = node[part]
        leaf = parts[-1]
        if not isinstance(node.get(leaf), list):
            node[leaf] = []
        if phrase not in node[leaf]:
            node[leaf].append(phrase)

    try:
        out = yaml.dump(tree, allow_unicode=True, sort_keys=False)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"success": True, "content": out})


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
                # reroll_each_run is off. A plain widget, so it stays typeable
                # and can be right-click "Convert to input" if upstream control
                # is ever wanted.
                # control_after_generate is disabled: ComfyUI auto-adds it to any
                # INT widget named "seed", but reroll_each_run already covers the
                # random/fixed choice, so the dropdown would be redundant.
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                                 "control_after_generate": False}),
                # When on, wildcards re-roll randomly every run (ignores seed).
                # When off, the seed above gives a fixed, reproducible roll.
                "reroll_each_run": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "process"
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, positive="", negative="", seed=0, reroll_each_run=True):
        # Force re-execution (fresh wildcard roll) every run when enabled;
        # otherwise cache on the actual inputs so identical settings reuse output.
        # NOTE: when rerolling, this invalidates the cache for this node AND every
        # downstream node each run — that's the intended "re-roll" behavior.
        if reroll_each_run:
            return random.random()
        return (positive, negative, seed)

    def process(self, positive, negative, reroll_each_run=True, seed=0):
        # With reroll on, vary the seed each run so wildcards actually change.
        if reroll_each_run:
            seed = random.randint(0, 0xffffffffffffffff)

        # Load once and share across both prompts.
        wd = load_wildcard_dict()
        try:
            pos_out = process(positive, seed, wd)
            # Offset the seed for the negative so it doesn't mirror the positive.
            neg_out = process(negative, (seed + 1) & 0xffffffffffffffff, wd)
        except Exception as e:
            logger.warning("[DirtyBirds] Wildcard processing failed (%s); using raw text", e)
            pos_out, neg_out = positive, negative

        return (pos_out, neg_out)


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {"DirtyBirdsPrompt": DirtyBirdsPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsPrompt": "🍑 DirtyBirds Dirty Talk — The Script"}
