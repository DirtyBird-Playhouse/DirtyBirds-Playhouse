from .dirtybirds_loader import (
    NODE_CLASS_MAPPINGS as _LOADER_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _LOADER_NAMES,
)
from .dirtybirds_prompt import (
    NODE_CLASS_MAPPINGS as _PROMPT_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _PROMPT_NAMES,
)
# Imported for its side effects: registers the Prompt Studio web API routes.
from . import dirtybirds_studio  # noqa: F401
from .dirtybirds_caption import (
    NODE_CLASS_MAPPINGS as _CAPTION_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _CAPTION_NAMES,
)
from .dirtybirds_image import (
    NODE_CLASS_MAPPINGS as _IMAGE_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _IMAGE_NAMES,
)

NODE_CLASS_MAPPINGS = {**_LOADER_CLASSES, **_PROMPT_CLASSES, **_CAPTION_CLASSES, **_IMAGE_CLASSES}
NODE_DISPLAY_NAME_MAPPINGS = {**_LOADER_NAMES, **_PROMPT_NAMES, **_CAPTION_NAMES, **_IMAGE_NAMES}

# Tell ComfyUI where our JS/CSS live
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
