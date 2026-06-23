"""DirtyBirds Playhouse node aggregator.

Imports and merges NODE_CLASS_MAPPINGS from all node packages.
Imports side-effect modules (folders, booru) for route registration.
"""

from .loader import (
    NODE_CLASS_MAPPINGS as _LOADER_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _LOADER_NAMES,
)
from .prompt import (
    NODE_CLASS_MAPPINGS as _PROMPT_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _PROMPT_NAMES,
)
from .image import (
    NODE_CLASS_MAPPINGS as _IMAGE_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _IMAGE_NAMES,
)
from .sampler import (
    NODE_CLASS_MAPPINGS as _SAMPLER_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _SAMPLER_NAMES,
)
from .muse import (
    NODE_CLASS_MAPPINGS as _MUSE_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _MUSE_NAMES,
)
from .pipe import (
    NODE_CLASS_MAPPINGS as _PIPE_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _PIPE_NAMES,
)
from .wardrobe import (
    NODE_CLASS_MAPPINGS as _WARDROBE_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _WARDROBE_NAMES,
)
from .finalcut import (
    NODE_CLASS_MAPPINGS as _FINALCUT_CLASSES,
    NODE_DISPLAY_NAME_MAPPINGS as _FINALCUT_NAMES,
)

# Imported for side effects: route registration
from . import folders  # noqa: F401
from . import booru  # noqa: F401

# Merge all node mappings
NODE_CLASS_MAPPINGS = {
    **_LOADER_CLASSES,
    **_PROMPT_CLASSES,
    **_IMAGE_CLASSES,
    **_SAMPLER_CLASSES,
    **_MUSE_CLASSES,
    **_PIPE_CLASSES,
    **_WARDROBE_CLASSES,
    **_FINALCUT_CLASSES,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **_LOADER_NAMES,
    **_PROMPT_NAMES,
    **_IMAGE_NAMES,
    **_SAMPLER_NAMES,
    **_MUSE_NAMES,
    **_PIPE_NAMES,
    **_WARDROBE_NAMES,
    **_FINALCUT_NAMES,
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
