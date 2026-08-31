"""
DirtyBirds Playhouse — Wildcards sidebar catalog backend.

Lists every wildcard key with its source file and entry count, and returns
full previews on demand. Ported from PBandDev/comfyui-wildcard-helper
(AGPL-3.0-only), rewritten against this project's own wildcard_engine instead
of Impact Pack's runtime cache — there is no "on-demand vs full cache" mode
here, load_wildcard_dict() always has everything and re-reads on every call,
so the catalog is simply "walk the same files the engine walks."
"""

import hashlib
import os

from .utils.wildcard_engine import WILDCARDS_DIR, _normalize_key, load_wildcard_dict

try:
    import yaml
except Exception:
    yaml = None


def _iter_wildcard_files():
    try:
        walker = list(os.walk(WILDCARDS_DIR, followlinks=True))
    except Exception:
        return
    for root, _dirs, files in walker:
        for file in files:
            if file.lower().endswith((".txt", ".yaml", ".yml")):
                yield os.path.join(root, file)


def _source_type(path):
    return "yaml" if path.lower().endswith((".yaml", ".yml")) else "txt"


def _register_yaml_keys(data, prefix, path, source_of):
    if not isinstance(data, dict):
        return
    for raw_key, value in data.items():
        key = f"{prefix}/{raw_key}" if prefix else str(raw_key)
        source_of[_normalize_key(key)] = path
        _register_yaml_keys(value, key, path, source_of)


def _collect_source_paths():
    """{normalized_key: absolute_path} for every key any wildcard file defines.

    Walks the same files load_wildcard_dict() does, so a key's reported source
    can never point at a file that key doesn't actually come from."""
    source_of = {}
    for path in _iter_wildcard_files():
        if path.lower().endswith(".txt"):
            rel = os.path.relpath(path, WILDCARDS_DIR)
            source_of[_normalize_key(os.path.splitext(rel)[0])] = path
            continue
        if yaml is None:
            continue
        try:
            with open(path, "r", encoding="UTF-8", errors="ignore") as f:
                data = yaml.safe_load(f) or {}
        except Exception:
            continue
        _register_yaml_keys(data, "", path, source_of)
    return source_of


def build_fingerprint():
    """Cheap change signal for the sidebar's poll loop: hash of every wildcard
    file's (relative path, mtime, size). Changes the instant a file is saved,
    so the sidebar can refetch only when something actually changed."""
    parts = []
    for path in sorted(_iter_wildcard_files()):
        try:
            stat = os.stat(path)
        except OSError:
            continue
        rel = os.path.relpath(path, WILDCARDS_DIR)
        parts.append(f"{rel}:{stat.st_mtime_ns}:{stat.st_size}")
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:12]


def build_catalog():
    """{"fingerprint": str, "items": [...]} for every wildcard key currently
    resolvable through __key__."""
    wd = load_wildcard_dict()
    source_of = _collect_source_paths()

    items = []
    for key in sorted(wd.keys()):
        path = source_of.get(key, "")
        items.append(
            {
                "key": key,
                "token": f"__{key}__",
                "segments": key.split("/"),
                "sourcePath": os.path.relpath(path, WILDCARDS_DIR) if path else "",
                "sourceType": _source_type(path) if path else "txt",
                "entryCount": len(wd[key]),
            }
        )

    return {"fingerprint": build_fingerprint(), "items": items}


def build_preview(key, limit=20):
    wd = load_wildcard_dict()
    norm = _normalize_key(key)
    values = wd.get(norm)
    if values is None:
        raise KeyError(norm)

    effective_limit = max(1, min(int(limit or 20), 50))
    sliced = values[:effective_limit]
    return {
        "key": norm,
        "token": f"__{norm}__",
        "totalEntries": len(values),
        "previewEntries": sliced,
        "truncated": len(sliced) < len(values),
    }
