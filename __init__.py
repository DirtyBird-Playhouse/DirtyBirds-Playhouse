if __package__ in (None, ""):
    # Pytest can import this ComfyUI package entrypoint as a top-level
    # __init__ module during collection. In that context relative imports have
    # no package anchor, so expose empty mappings and let direct tests import
    # their target modules by path.
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}
    _V3_NODES = []
else:
    from .nodes import (
        NODE_CLASS_MAPPINGS,
        NODE_DISPLAY_NAME_MAPPINGS,
        V3_NODES as _V3_NODES,
    )

# Tell ComfyUI where our JS/CSS live
WEB_DIRECTORY = "./web"

# V3 registration. ComfyUI reads both the legacy NODE_CLASS_MAPPINGS (the V1
# nodes) and this ``comfy_entrypoint`` (the migrated V3 nodes) from the same
# package, so the two register side by side during the incremental migration.
# The import is deferred and guarded so a ComfyUI that lacks comfy_api.latest, or
# the pytest collection path, simply skips V3 registration without erroring.
try:
    from comfy_api.latest import ComfyExtension as _ComfyExtension

    class DirtyBirdsExtension(_ComfyExtension):
        async def get_node_list(self):
            return list(_V3_NODES)

    async def comfy_entrypoint():
        return DirtyBirdsExtension()
except Exception:  # noqa: BLE001 - no V3 API available; V1 mappings still load
    pass

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
