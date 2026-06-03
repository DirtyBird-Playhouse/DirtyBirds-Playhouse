import os
import re
import json
import struct
import hashlib
import logging
import asyncio
import urllib.request
import folder_paths
from aiohttp import web
from server import PromptServer

logger = logging.getLogger(__name__)

CACHE_VERSION = 3   # bump to auto-invalidate stale cached entries (v3: civitai.red URLs)

_CACHE_FILE   = os.path.join(os.path.dirname(__file__), "lora_meta_cache.json")
_PREVIEW_DIR  = os.path.join(os.path.dirname(__file__), "web", "previews")
_SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "dirtybirds_settings.json")

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


# ---------------------------------------------------------------------------
# Settings (Civitai API token, persisted locally)
# ---------------------------------------------------------------------------

def _load_settings():
    if os.path.exists(_SETTINGS_FILE):
        try:
            with open(_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_settings(s):
    try:
        with open(_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=2)
    except Exception as e:
        logger.warning(f"[DirtyBirds] Failed to save settings: {e}")


# ---------------------------------------------------------------------------
# Metadata cache (persisted to JSON)
# ---------------------------------------------------------------------------

def _load_cache():
    if os.path.exists(_CACHE_FILE):
        try:
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_cache(cache):
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        logger.warning(f"[DirtyBirds] Failed to save lora cache: {e}")

_meta_cache = _load_cache()


# ---------------------------------------------------------------------------
# Safetensors header reader (reads only the JSON header, never loads tensors)
# ---------------------------------------------------------------------------

def _read_safetensors_metadata(path):
    try:
        with open(path, "rb") as f:
            raw = f.read(8)
            if len(raw) < 8:
                return {}
            header_size = struct.unpack("<Q", raw)[0]
            if header_size == 0 or header_size > 50 * 1024 * 1024:
                return {}
            header_bytes = f.read(header_size)
        header = json.loads(header_bytes)
        return header.get("__metadata__", {})
    except Exception as e:
        logger.debug(f"[DirtyBirds] safetensors header read failed for {path}: {e}")
        return {}


# ---------------------------------------------------------------------------
# Lora Manager sidecar metadata (<base>.metadata.json) — authoritative & local
# ---------------------------------------------------------------------------

def _read_lora_manager_metadata(lora_path):
    """Read the Lora Manager <base>.metadata.json sidecar, if present."""
    meta_path = os.path.splitext(lora_path)[0] + ".metadata.json"
    if not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.debug(f"[DirtyBirds] metadata.json read failed for {meta_path}: {e}")
        return {}


def _is_image(path):
    return bool(path) and os.path.splitext(path)[1].lower() in _IMAGE_EXTS


# ---------------------------------------------------------------------------
# SHA-256 (used for Civitai lookup)
# ---------------------------------------------------------------------------

def _sha256(path, chunk=65536):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Civitai lookup
# ---------------------------------------------------------------------------

def _civitai_by_hash(sha256):
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{sha256}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DirtyBirds-Playhouse/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.debug(f"[DirtyBirds] Civitai lookup failed ({sha256[:8]}...): {e}")
        return None

def _civitai_url(model_id, version_id=None, nsfw=False):
    """Build a Civitai model page URL. Mature models now live on civitai.red."""
    if not model_id:
        return ""
    domain = "civitai.red" if nsfw else "civitai.com"
    url = f"https://{domain}/models/{model_id}"
    if version_id:
        url += f"?modelVersionId={version_id}"
    return url

def _download_file(url, dest):
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "DirtyBirds-Playhouse/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            with open(dest, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as e:
        logger.debug(f"[DirtyBirds] Download failed {url}: {e}")
        return False


# ---------------------------------------------------------------------------
# Core metadata resolver
# ---------------------------------------------------------------------------

def get_lora_meta(lora_filename, allow_remote=True):
    """
    Returns { trigger_words, has_preview, preview_path, model_name } for a LoRA.

    allow_remote=False  → local-only (metadata.json + sibling files + safetensors
    header). NEVER hashes the file or calls Civitai — safe for bulk scans.
    allow_remote=True   → may fall back to SHA-256 + Civitai for missing data.

    Results are cached in lora_meta_cache.json.
    """
    global _meta_cache

    cached = _meta_cache.get(lora_filename)
    if (cached and cached.get("resolved") and cached.get("v") == CACHE_VERSION
            and (cached.get("remote_done") or not allow_remote)):
        return cached

    lora_path = folder_paths.get_full_path("loras", lora_filename)
    if not lora_path or not os.path.exists(lora_path):
        return {"trigger_words": [], "has_preview": False,
                "preview_path": None, "model_name": ""}

    meta = {
        "v":             CACHE_VERSION,
        "resolved":      False,
        "trigger_words": [],
        "has_preview":   False,
        "preview_path":  None,
        "model_name":    "",
        "sha256":        None,
        "civitai_url":   "",
    }

    base = os.path.splitext(lora_path)[0]

    # 1. Lora Manager sidecar metadata (.metadata.json) — local & authoritative
    lm = _read_lora_manager_metadata(lora_path)
    if lm:
        meta["model_name"] = (lm.get("model_name") or "").strip()

        # Trigger words from civitai.trainedWords
        civ = lm.get("civitai") or {}
        if isinstance(civ, dict):
            tw = civ.get("trainedWords") or []
            if isinstance(tw, list) and tw:
                meta["trigger_words"] = [str(w).strip() for w in tw if str(w).strip()]
            # Civitai model page link (from sidecar)
            if civ.get("modelId"):
                _m = civ.get("model") or {}
                meta["civitai_url"] = _civitai_url(
                    civ.get("modelId"), civ.get("id"), bool(_m.get("nsfw")))

        # SHA-256 (avoids re-hashing for any later Civitai fallback)
        sha = (lm.get("sha256") or "").strip().lower()
        if len(sha) == 64:
            meta["sha256"] = sha

        # Preview from preview_url, but only if it is an image that exists
        purl = (lm.get("preview_url") or "").strip()
        if _is_image(purl) and os.path.exists(purl):
            meta["has_preview"]  = True
            meta["preview_path"] = purl

    # 2. Sibling preview file (now includes bare .jpeg / .webp)
    if not meta["has_preview"]:
        for ext in (".preview.png", ".preview.jpg", ".preview.jpeg",
                    ".png", ".jpg", ".jpeg", ".webp", ".gif"):
            candidate = base + ext
            if os.path.exists(candidate):
                meta["has_preview"]  = True
                meta["preview_path"] = candidate
                break

    # 3. Safetensors header (trigger words fallback)
    if not meta["trigger_words"] and lora_path.lower().endswith((".safetensors", ".sft")):
        header = _read_safetensors_metadata(lora_path)
        for field in ("activation text", "trigger_phrase",
                      "modelspec.trigger_phrase", "ss_output_name"):
            val = header.get(field, "").strip()
            if val:
                meta["trigger_words"] = [w.strip() for w in val.split(",") if w.strip()]
                break
        if not meta["sha256"]:
            for field in ("modelspec.hash_sha256", "sshs_model_hash"):
                h = header.get(field, "").strip().lower().lstrip("0x")
                if len(h) == 64:
                    meta["sha256"] = h
                    break

    # 4. Civitai lookup (last resort) — ONLY when remote is allowed.
    #    This is the expensive path: full-file SHA-256 + network call.
    #    Skipped entirely for bulk/local-only scans to keep them instant.
    #    Includes civitai_url so a "Fetch" reaches out even when preview/triggers
    #    are already present locally but the model link is still unknown.
    missing = (not meta["trigger_words"]) or (not meta["has_preview"]) or (not meta["civitai_url"])
    if allow_remote and missing:
        sha256 = meta["sha256"]
        if not sha256:
            logger.debug(f"[DirtyBirds] Hashing {lora_filename} for Civitai lookup…")
            sha256 = _sha256(lora_path)
            meta["sha256"] = sha256

        data = _civitai_by_hash(sha256)
        if data:
            if not meta["trigger_words"]:
                meta["trigger_words"] = data.get("trainedWords", [])
            if not meta["civitai_url"]:
                _model = data.get("model") or {}
                meta["civitai_url"] = _civitai_url(
                    data.get("modelId"), data.get("id"), bool(_model.get("nsfw")))
            if not meta["has_preview"]:
                images = data.get("images", [])
                if images:
                    img_url = images[0].get("url")
                    if img_url:
                        safe_name = lora_filename.replace("\\", "_").replace("/", "_")
                        dest = os.path.join(_PREVIEW_DIR, safe_name + ".jpg")
                        if _download_file(img_url, dest):
                            meta["has_preview"]  = True
                            meta["preview_path"] = dest
        missing = (not meta["trigger_words"]) or (not meta["has_preview"]) or (not meta["civitai_url"])

    # remote_done: True if we've exhausted remote options OR nothing more to gain.
    # A future allow_remote call will retry only if this is False.
    meta["remote_done"] = bool(allow_remote) or (not missing)

    # Friendly name fallback
    if not meta["model_name"]:
        meta["model_name"] = os.path.basename(base)

    meta["resolved"] = True
    _meta_cache[lora_filename] = meta
    _save_cache(_meta_cache)
    return meta


# ---------------------------------------------------------------------------
# Embedding metadata resolver (mirrors get_lora_meta; Civitai is asset-agnostic)
# ---------------------------------------------------------------------------

_EMB_CACHE_PREFIX = "emb::"

def get_embedding_meta(emb_filename, allow_remote=True):
    """
    Returns { trigger_words, has_preview, preview_path, model_name } for a
    textual-inversion embedding. Same resolution chain as LoRAs (sibling preview
    files → safetensors header → Civitai by SHA-256), cached under an "emb::"
    namespace so it never collides with LoRA entries of the same filename.
    """
    global _meta_cache

    cache_key = _EMB_CACHE_PREFIX + emb_filename
    cached = _meta_cache.get(cache_key)
    if (cached and cached.get("resolved") and cached.get("v") == CACHE_VERSION
            and (cached.get("remote_done") or not allow_remote)):
        return cached

    emb_path = folder_paths.get_full_path("embeddings", emb_filename)
    if not emb_path or not os.path.exists(emb_path):
        return {"trigger_words": [], "has_preview": False,
                "preview_path": None, "model_name": ""}

    meta = {
        "v":             CACHE_VERSION,
        "resolved":      False,
        "trigger_words": [],
        "has_preview":   False,
        "preview_path":  None,
        "model_name":    "",
        "sha256":        None,
        "civitai_url":   "",
    }

    base = os.path.splitext(emb_path)[0]

    # 1. Lora Manager-style sidecar (.metadata.json), if the user has one
    lm = _read_lora_manager_metadata(emb_path)
    if lm:
        meta["model_name"] = (lm.get("model_name") or "").strip()
        civ = lm.get("civitai") or {}
        if isinstance(civ, dict):
            tw = civ.get("trainedWords") or []
            if isinstance(tw, list) and tw:
                meta["trigger_words"] = [str(w).strip() for w in tw if str(w).strip()]
            if civ.get("modelId"):
                _m = civ.get("model") or {}
                meta["civitai_url"] = _civitai_url(
                    civ.get("modelId"), civ.get("id"), bool(_m.get("nsfw")))
        sha = (lm.get("sha256") or "").strip().lower()
        if len(sha) == 64:
            meta["sha256"] = sha
        purl = (lm.get("preview_url") or "").strip()
        if _is_image(purl) and os.path.exists(purl):
            meta["has_preview"]  = True
            meta["preview_path"] = purl

    # 2. Sibling preview file
    if not meta["has_preview"]:
        for ext in (".preview.png", ".preview.jpg", ".preview.jpeg",
                    ".png", ".jpg", ".jpeg", ".webp", ".gif"):
            candidate = base + ext
            if os.path.exists(candidate):
                meta["has_preview"]  = True
                meta["preview_path"] = candidate
                break

    # 3. Safetensors header (only for .safetensors embeddings)
    if not meta["sha256"] and emb_path.lower().endswith((".safetensors", ".sft")):
        header = _read_safetensors_metadata(emb_path)
        for field in ("modelspec.hash_sha256", "sshs_model_hash"):
            h = header.get(field, "").strip().lower().lstrip("0x")
            if len(h) == 64:
                meta["sha256"] = h
                break

    # 4. Civitai lookup (last resort) — full-file SHA-256 + network call
    missing = (not meta["has_preview"]) or (not meta["civitai_url"])
    if allow_remote and missing:
        sha256 = meta["sha256"] or _sha256(emb_path)
        meta["sha256"] = sha256
        data = _civitai_by_hash(sha256)
        if data:
            if not meta["trigger_words"]:
                meta["trigger_words"] = data.get("trainedWords", [])
            if not meta["civitai_url"]:
                _model = data.get("model") or {}
                meta["civitai_url"] = _civitai_url(
                    data.get("modelId"), data.get("id"), bool(_model.get("nsfw")))
            if not meta["model_name"]:
                model = data.get("model") or {}
                meta["model_name"] = (model.get("name") or "").strip()
            if not meta["has_preview"]:
                images = data.get("images", [])
                if images:
                    img_url = images[0].get("url")
                    if img_url:
                        safe_name = "emb_" + emb_filename.replace("\\", "_").replace("/", "_")
                        dest = os.path.join(_PREVIEW_DIR, safe_name + ".jpg")
                        if _download_file(img_url, dest):
                            meta["has_preview"]  = True
                            meta["preview_path"] = dest
        missing = (not meta["has_preview"]) or (not meta["civitai_url"])

    meta["remote_done"] = bool(allow_remote) or (not missing)

    if not meta["model_name"]:
        meta["model_name"] = os.path.basename(base)

    meta["resolved"] = True
    _meta_cache[cache_key] = meta
    _save_cache(_meta_cache)
    return meta


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/loras")
async def api_get_loras(request):
    files = folder_paths.get_filename_list("loras")
    return web.json_response(sorted(files))


@PromptServer.instance.routes.get("/dirtybirds/lora-meta")
async def api_get_lora_meta(request):
    name = request.rel_url.query.get("name", "").strip()
    if not name:
        return web.json_response({"error": "missing name"}, status=400)
    loop = asyncio.get_event_loop()
    # Local-only: render-time calls must never hit the network. Remote resolution
    # (hash + Civitai) happens only via the explicit /fetch-meta button.
    meta = await loop.run_in_executor(None, lambda: get_lora_meta(name, allow_remote=False))
    return web.json_response({
        "trigger_words": meta.get("trigger_words", []),
        "has_preview":   meta.get("has_preview", False),
        "model_name":    meta.get("model_name", ""),
        "civitai_url":   meta.get("civitai_url", ""),
    })


@PromptServer.instance.routes.get("/dirtybirds/loras-meta")
async def api_get_loras_meta_bulk(request):
    """Bulk metadata for the LoRA picker grid: { name: { model_name, has_preview } }."""
    def _resolve_all():
        result = {}
        for name in folder_paths.get_filename_list("loras"):
            try:
                m = get_lora_meta(name, allow_remote=False)   # local-only: never hash/network
                result[name] = {
                    "model_name":  m.get("model_name", ""),
                    "has_preview": m.get("has_preview", False),
                    "civitai_url": m.get("civitai_url", ""),
                }
            except Exception as e:
                logger.debug("[DirtyBirds] bulk meta failed for %s: %s", name, e)
                result[name] = {"model_name": "", "has_preview": False, "civitai_url": ""}
        return result

    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _resolve_all)
    return web.json_response(data)


@PromptServer.instance.routes.get("/dirtybirds/lora-preview")
async def api_lora_preview(request):
    name = request.rel_url.query.get("name", "").strip()
    if not name:
        return web.Response(status=400)

    # Check cache first (avoid re-hashing on every request)
    cached = _meta_cache.get(name, {})
    preview_path = cached.get("preview_path")

    if not preview_path or not os.path.exists(preview_path):
        # Resolve (may hit Civitai once, then caches)
        loop = asyncio.get_event_loop()
        meta = await loop.run_in_executor(None, get_lora_meta, name)
        preview_path = meta.get("preview_path")

    if not preview_path or not os.path.exists(preview_path):
        return web.Response(status=404)

    ext = os.path.splitext(preview_path)[1].lower()
    ctype = {
        ".png":  "image/png",
        ".webp": "image/webp",
        ".gif":  "image/gif",
    }.get(ext, "image/jpeg")
    with open(preview_path, "rb") as f:
        return web.Response(body=f.read(), content_type=ctype)


# ---------------------------------------------------------------------------
# Embedding metadata routes (mirror the LoRA routes above)
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/embedding-meta")
async def api_get_embedding_meta(request):
    name = request.rel_url.query.get("name", "").strip()
    if not name:
        return web.json_response({"error": "missing name"}, status=400)
    loop = asyncio.get_event_loop()
    # Local-only (see lora-meta note): network only via /fetch-meta.
    meta = await loop.run_in_executor(None, lambda: get_embedding_meta(name, allow_remote=False))
    return web.json_response({
        "trigger_words": meta.get("trigger_words", []),
        "has_preview":   meta.get("has_preview", False),
        "model_name":    meta.get("model_name", ""),
        "civitai_url":   meta.get("civitai_url", ""),
    })


@PromptServer.instance.routes.get("/dirtybirds/embeddings-meta")
async def api_get_embeddings_meta_bulk(request):
    """Bulk metadata for the embeddings grid: { name: { model_name, has_preview } }."""
    def _resolve_all():
        result = {}
        for name in folder_paths.get_filename_list("embeddings"):
            try:
                m = get_embedding_meta(name, allow_remote=False)  # local-only
                result[name] = {
                    "model_name":  m.get("model_name", ""),
                    "has_preview": m.get("has_preview", False),
                    "civitai_url": m.get("civitai_url", ""),
                }
            except Exception as e:
                logger.debug("[DirtyBirds] bulk embedding meta failed for %s: %s", name, e)
                result[name] = {"model_name": "", "has_preview": False, "civitai_url": ""}
        return result

    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, _resolve_all)
    return web.json_response(data)


@PromptServer.instance.routes.get("/dirtybirds/embedding-preview")
async def api_embedding_preview(request):
    name = request.rel_url.query.get("name", "").strip()
    if not name:
        return web.Response(status=400)

    cached = _meta_cache.get(_EMB_CACHE_PREFIX + name, {})
    preview_path = cached.get("preview_path")

    if not preview_path or not os.path.exists(preview_path):
        loop = asyncio.get_event_loop()
        meta = await loop.run_in_executor(None, get_embedding_meta, name)
        preview_path = meta.get("preview_path")

    if not preview_path or not os.path.exists(preview_path):
        return web.Response(status=404)

    ext = os.path.splitext(preview_path)[1].lower()
    ctype = {
        ".png":  "image/png",
        ".webp": "image/webp",
        ".gif":  "image/gif",
    }.get(ext, "image/jpeg")
    with open(preview_path, "rb") as f:
        return web.Response(body=f.read(), content_type=ctype)


# ---------------------------------------------------------------------------
# Library page (standalone HTML, served by us — no external dependency)
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/library")
async def api_library_page(request):
    html_path = os.path.join(os.path.dirname(__file__), "web", "library.html")
    if not os.path.exists(html_path):
        return web.Response(text="library.html not found", status=404)
    with open(html_path, "r", encoding="utf-8") as f:
        return web.Response(text=f.read(), content_type="text/html")


# ---------------------------------------------------------------------------
# Push selected LoRAs from the library page back into a node
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.post("/dirtybirds/send-loras")
async def api_send_loras(request):
    """
    Body: { node_id, graph_id?, mode? ("append"|"replace"), loras: [
              { name, strength?, clip_strength?, active? } ] }
    Broadcasts a 'dirtybirds_set_loras' event; the node's JS applies it.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "invalid JSON"}, status=400)

    node_id = data.get("node_id")
    if node_id is None:
        return web.json_response({"success": False, "error": "missing node_id"}, status=400)

    loras = []
    for entry in data.get("loras", []):
        name = (entry.get("name") or "").strip()
        if not name:
            continue
        s = float(entry.get("strength", 1.0))
        loras.append({
            "name":          name,
            "strength":      s,
            "clip_strength": float(entry.get("clip_strength", s)),
            "active":        bool(entry.get("active", True)),
        })

    payload = {
        "node_id":  node_id,
        "graph_id": data.get("graph_id"),
        "mode":     data.get("mode", "append"),
        "loras":    loras,
    }
    PromptServer.instance.send_sync("dirtybirds_set_loras", payload)
    return web.json_response({"success": True, "sent": len(loras)})


# ---------------------------------------------------------------------------
# Fetch / update metadata from Civitai (self-contained — no Lora Manager needed)
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.post("/dirtybirds/fetch-meta")
async def api_fetch_meta(request):
    """
    Body: { names?: [...], scope?: "missing"|"all", type?: "loras"|"embeddings" }
    Resolves with allow_remote=True (SHA-256 + Civitai) for the targets, refreshing
    the local cache + downloading previews. Returns a per-name result summary.
    """
    try:
        data = await request.json()
    except Exception:
        data = {}

    names = data.get("names") or []
    scope = data.get("scope", "missing")
    asset = data.get("type", "loras")   # "loras" | "embeddings"
    print(f"[DirtyBirds] /fetch-meta request: type={asset}, scope={scope}, names={len(names)}", flush=True)

    is_emb       = (asset == "embeddings")
    folder       = "embeddings" if is_emb else "loras"
    resolver     = get_embedding_meta if is_emb else get_lora_meta
    cache_prefix = _EMB_CACHE_PREFIX if is_emb else ""

    def _fetch():
        targets = list(names) if names else folder_paths.get_filename_list(folder)
        print(f"[DirtyBirds] Fetch-meta started: {len(targets)} {folder}, scope={scope}", flush=True)
        results = {}
        for idx, name in enumerate(targets, 1):
            cached = _meta_cache.get(cache_prefix + name, {})
            # "Complete" requires a Civitai link too, so Fetch reaches out for the
            # model URL even when preview/triggers already resolved locally.
            already_complete = (cached.get("v") == CACHE_VERSION
                                and cached.get("has_preview")
                                and cached.get("civitai_url")
                                and (is_emb or cached.get("trigger_words")))
            if scope == "missing" and already_complete:
                results[name] = {"skipped": True}
                continue
            # Force a fresh remote resolve by dropping the cached entry
            _meta_cache.pop(cache_prefix + name, None)
            print(f"[DirtyBirds] ({idx}/{len(targets)}) Civitai lookup: {name}", flush=True)
            try:
                m = resolver(name, allow_remote=True)
                ok_img = "img" if m.get("has_preview") else "no-img"
                ok_url = "url" if m.get("civitai_url") else "no-url"
                print(f"[DirtyBirds]    -> {m.get('model_name', '')} [{ok_img}, {ok_url}]", flush=True)
                results[name] = {
                    "trigger_words": m.get("trigger_words", []),
                    "has_preview":   m.get("has_preview", False),
                    "model_name":    m.get("model_name", ""),
                    "civitai_url":   m.get("civitai_url", ""),
                }
            except Exception as e:
                print(f"[DirtyBirds] fetch-meta failed for {name}: {e}", flush=True)
                results[name] = {"error": str(e)}
        return results

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, _fetch)
    fetched = sum(1 for r in results.values() if not r.get("skipped") and not r.get("error"))
    print(f"[DirtyBirds] Fetch-meta done: {fetched} fetched, {len(results)} total", flush=True)
    return web.json_response({"success": True, "fetched": fetched, "results": results})


# ---------------------------------------------------------------------------
# Download from Civitai (paste a URL → pick a folder → download)
# ---------------------------------------------------------------------------

def _list_subfolders(asset):
    """Return relative destination folders for an asset type ("loras"/"embeddings").
    Always includes "" (the root of the first registered folder)."""
    folders = set([""])
    try:
        for name in folder_paths.get_filename_list(asset):
            rel = name.replace("\\", "/")
            if "/" in rel:
                folders.add(rel.rsplit("/", 1)[0])
    except Exception as e:
        logger.debug("[DirtyBirds] subfolder scan failed for %s: %s", asset, e)
    return sorted(folders, key=lambda s: (s != "", s.lower()))


def _civitai_api_get(url, token=None):
    headers = {"User-Agent": "DirtyBirds-Playhouse/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def _parse_civitai_ids(url):
    """Extract (model_id, version_id) from a civitai.com / civitai.red URL."""
    model_id   = None
    version_id = None
    m = re.search(r"/models/(\d+)", url)
    if m:
        model_id = m.group(1)
    m = re.search(r"[?&]modelVersionId=(\d+)", url)
    if m:
        version_id = m.group(1)
    # Direct API download URL: /api/download/models/{versionId}
    m = re.search(r"/api/download/models/(\d+)", url)
    if m:
        version_id = m.group(1)
    return model_id, version_id


def _resolve_download(url, token):
    """Given a Civitai URL, return (download_url, filename, model_type, version_id)."""
    model_id, version_id = _parse_civitai_ids(url)
    if not model_id and not version_id:
        raise ValueError("Could not find a model id in that URL")

    if version_id:
        ver = _civitai_api_get(f"https://civitai.com/api/v1/model-versions/{version_id}", token)
    else:
        model = _civitai_api_get(f"https://civitai.com/api/v1/models/{model_id}", token)
        versions = model.get("modelVersions") or []
        if not versions:
            raise ValueError("Model has no downloadable versions")
        ver = versions[0]
        version_id = str(ver.get("id"))

    model_type = ((ver.get("model") or {}).get("type") or "").lower()  # "lora" / "textualinversion" / ...

    # Choose the primary file (or the first model-type file)
    files = ver.get("files") or []
    chosen = None
    for f in files:
        if f.get("primary"):
            chosen = f
            break
    if not chosen and files:
        chosen = files[0]
    if not chosen:
        raise ValueError("Version has no files")

    download_url = chosen.get("downloadUrl") or f"https://civitai.com/api/download/models/{version_id}"
    filename     = chosen.get("name") or f"model_{version_id}.safetensors"
    return download_url, filename, model_type, version_id


def _stream_download(url, dest, token, chunk=1 << 20):
    headers = {"User-Agent": "DirtyBirds-Playhouse/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers=headers)
    total = 0
    with urllib.request.urlopen(req, timeout=60) as resp:
        with open(tmp, "wb") as f:
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                f.write(buf)
                total += len(buf)
    os.replace(tmp, dest)
    return total


@PromptServer.instance.routes.get("/dirtybirds/folders")
async def api_get_folders(request):
    asset = request.rel_url.query.get("type", "loras").strip()
    if asset not in ("loras", "embeddings"):
        asset = "loras"
    return web.json_response({"folders": _list_subfolders(asset)})


@PromptServer.instance.routes.get("/dirtybirds/settings")
async def api_get_settings(request):
    s = _load_settings()
    # Never echo the raw token back; just report whether one is set.
    return web.json_response({"has_token": bool(s.get("civitai_token"))})


@PromptServer.instance.routes.post("/dirtybirds/settings")
async def api_set_settings(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    s = _load_settings()
    if "civitai_token" in data:
        s["civitai_token"] = (data.get("civitai_token") or "").strip()
    _save_settings(s)
    return web.json_response({"success": True, "has_token": bool(s.get("civitai_token"))})


@PromptServer.instance.routes.post("/dirtybirds/download")
async def api_download(request):
    """
    Body: { url, type: "loras"|"embeddings", folder?: "<subfolder>", token? }
    Downloads the Civitai model file into the chosen folder, then resolves meta.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "invalid JSON"}, status=400)

    url    = (data.get("url") or "").strip()
    asset  = data.get("type", "loras")
    folder = (data.get("folder") or "").strip().strip("/\\")
    token  = (data.get("token") or "").strip() or _load_settings().get("civitai_token", "")

    if asset not in ("loras", "embeddings"):
        asset = "loras"
    if not url:
        return web.json_response({"success": False, "error": "missing url"}, status=400)

    bases = folder_paths.get_folder_paths(asset)
    if not bases:
        return web.json_response({"success": False, "error": f"no {asset} folder configured"}, status=500)
    base = bases[0]

    def _do():
        download_url, filename, model_type, version_id = _resolve_download(url, token)
        # Guard against path traversal in the chosen subfolder
        dest_dir = os.path.normpath(os.path.join(base, folder))
        if not dest_dir.startswith(os.path.normpath(base)):
            raise ValueError("Invalid destination folder")
        dest = os.path.join(dest_dir, filename)
        print(f"[DirtyBirds] Downloading {filename} → {asset}/{folder or '(root)'} …", flush=True)
        size = _stream_download(download_url, dest, token)
        print(f"[DirtyBirds] Downloaded {filename} ({size/1048576:.1f} MB)", flush=True)
        # Resolve metadata for the freshly downloaded file (preview + civitai link)
        rel = os.path.join(folder, filename) if folder else filename
        try:
            if asset == "embeddings":
                get_embedding_meta(rel, allow_remote=True)
            else:
                get_lora_meta(rel, allow_remote=True)
        except Exception as e:
            logger.debug("[DirtyBirds] post-download meta failed: %s", e)
        return {"filename": filename, "rel": rel, "size": size, "model_type": model_type}

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, _do)
        return web.json_response({"success": True, **result})
    except Exception as e:
        print(f"[DirtyBirds] Download failed: {e}", flush=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------
# DirtyBirdsLoraStacker has been merged into DirtyBirdsLoader.
# This file now serves only as the metadata / API backend.
# ---------------------------------------------------------------------------
