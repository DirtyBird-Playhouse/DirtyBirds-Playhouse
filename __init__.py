from .dirtybirds_loader import (
    NODE_CLASS_MAPPINGS as _LOADER_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _LOADER_NAMES,
)
from .dirtybirds_prompt import (
    NODE_CLASS_MAPPINGS as _PROMPT_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _PROMPT_NAMES,
)
# Imported for its side effects: registers the "open folder" web API route.
from . import dirtybirds_folders  # noqa: F401
from .dirtybirds_image import (
    NODE_CLASS_MAPPINGS as _IMAGE_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _IMAGE_NAMES,
)
from . import dirtybirds_booru  # noqa: F401 — registers /dirtybirds/booru-search route

NODE_CLASS_MAPPINGS = {
    **_LOADER_CLASSES, **_PROMPT_CLASSES,
    **_IMAGE_CLASSES,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    **_LOADER_NAMES, **_PROMPT_NAMES,
    **_IMAGE_NAMES,
}

# Tell ComfyUI where our JS/CSS live
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
