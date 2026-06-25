if __package__ in (None, ""):
    # Pytest can import this ComfyUI package entrypoint as a top-level
    # __init__ module during collection. In that context relative imports have
    # no package anchor, so expose empty mappings and let direct tests import
    # their target modules by path.
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}
else:
    from .nodes import (
        NODE_CLASS_MAPPINGS,
        NODE_DISPLAY_NAME_MAPPINGS,
    )

# Tell ComfyUI where our JS/CSS live
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
