if __package__ in (None, ""):
    # Pytest can import this ComfyUI package entrypoint as a top-level
    # __init__ module during collection. In that context relative imports have
    # no package anchor, so expose empty mappings and let direct tests import
    # their target modules by path.
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}
else:
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# Tell ComfyUI where our JS/CSS live
WEB_DIRECTORY = "./web"

# Every node here is V1 (INPUT_TYPES + NODE_CLASS_MAPPINGS). This package
# deliberately does NOT define ``comfy_entrypoint``: ComfyUI's loader branches
# ``if NODE_CLASS_MAPPINGS ... elif comfy_entrypoint`` (see nodes.py in the
# ComfyUI repo), so with mappings exported the entrypoint is never called and
# any node registered through it would silently vanish from the menu. If a node
# is ever migrated to the V3 API, register it by putting its class straight into
# NODE_CLASS_MAPPINGS under ``cls.GET_SCHEMA().node_id`` — a V3 class exposes
# INPUT_TYPES/RETURN_TYPES/FUNCTION/CATEGORY, so the rest of ComfyUI treats it
# exactly like a V1 one.

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
