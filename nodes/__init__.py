"""DirtyBirds Playhouse node aggregator.

Imports and merges NODE_CLASS_MAPPINGS from every node package, then imports the
side-effect ``folders`` module for route registration. (The booru tag fetcher is
a widget of the prompt/Dirty Talk node and registers its route from there.)

Each package is imported defensively: if one fails to load — most likely because
an optional heavy dependency is missing (e.g. the Fixer's OpenCV/ultralytics/timm
stack) — it is skipped with a warning instead of taking the whole pack down. That
prevents the "no supported nodes" failure where a single broken import hides all
eleven nodes.
"""

import importlib
import logging

logger = logging.getLogger(__name__)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
# V3 (comfy_api.latest) node classes, collected from packages that have migrated.
# Registered via the package-root ``comfy_entrypoint`` alongside the V1 mappings.
V3_NODES = []

# Node packages, in menu/registration order. Each exposes NODE_CLASS_MAPPINGS
# and NODE_DISPLAY_NAME_MAPPINGS.
_NODE_PACKAGES = (
    "loader",
    "prompt",
    "image",
    "sampler",
    "muse",
    "pipe",
    "wardrobe",
    "saveprompt",
    "fixer",
    "inpaint",
)

for _name in _NODE_PACKAGES:
    try:
        _module = importlib.import_module(f".{_name}", __name__)
    except Exception as exc:  # noqa: BLE001 - one bad package must not break the rest
        logger.warning(
            "[DirtyBirds] node package %r failed to load and was skipped: %s",
            _name,
            exc,
        )
        continue
    NODE_CLASS_MAPPINGS.update(getattr(_module, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(_module, "NODE_DISPLAY_NAME_MAPPINGS", {}))
    V3_NODES.extend(getattr(_module, "V3_NODES", []))

# Imported for side effects: HTTP route registration. Guarded so a route-import
# failure likewise cannot prevent the nodes above from registering.
try:
    from . import folders  # noqa: F401
except Exception as exc:  # noqa: BLE001
    logger.warning("[DirtyBirds] folders route registration failed: %s", exc)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "V3_NODES"]
