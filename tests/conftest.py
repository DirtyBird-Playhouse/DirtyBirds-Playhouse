"""Shared pytest fixtures/stubs for DirtyBirds tests.

Nodes migrated to the ComfyUI V3 API import ``comfy_api.latest`` at module load
time. That package only exists inside a running ComfyUI, so tests that import a
migrated node by path would fail to collect. We install a lightweight but
faithful stub of the small V3 surface those nodes use (``io.ComfyNode``,
``io.Schema``, the typed ``*.Input``/``*.Output`` builders, ``io.NodeOutput``,
and the ``FolderType``/``UploadType`` enums) so the modules import and their
``execute``/``define_schema`` logic stays exercisable off-ComfyUI.

The stub mirrors the real semantics the tests depend on: ``NodeOutput`` exposes
``.result`` and positional ``__getitem__`` (so ``a, b = node.execute(...)``
unpacks identically to live ComfyUI), and ``*.Input(...)`` retains ``id`` plus
its keyword options for schema inspection.
"""

import sys
import types
from enum import Enum


def _install_comfy_api_stub():
    if "comfy_api.latest" in sys.modules:
        return

    class _Input:
        def __init__(self, id=None, **kwargs):
            self.id = id
            self.__dict__.update(kwargs)

    class _Output:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.__dict__.update(kwargs)

    def _io_type(name):
        return type(name, (), {"Input": _Input, "Output": _Output})

    class FolderType(str, Enum):
        input = "input"
        output = "output"
        temp = "temp"

    class UploadType(str, Enum):
        image = "image_upload"
        mask = "mask_upload"

    class Schema:
        def __init__(self, node_id=None, display_name=None, category=None,
                     inputs=None, outputs=None, hidden=None, **kwargs):
            self.node_id = node_id
            self.display_name = display_name
            self.category = category
            self.inputs = inputs or []
            self.outputs = outputs or []
            self.hidden = hidden or []
            self.__dict__.update(kwargs)

    class ComfyNode:
        """Stand-in base; V3 nodes only rely on being subclassable here."""

    class NodeOutput:
        def __init__(self, *args, ui=None, expand=None, block_execution=None):
            self.args = args
            self.ui = ui
            self.expand = expand
            self.block_execution = block_execution

        @property
        def result(self):
            return self.args if len(self.args) > 0 else None

        def __getitem__(self, index):
            return self.args[index]

    io = types.ModuleType("comfy_api.latest.io")
    for _name in ("Combo", "String", "Boolean", "Int", "Float",
                  "Image", "Mask", "Latent", "Conditioning", "Custom"):
        setattr(io, _name, _io_type(_name))
    io.FolderType = FolderType
    io.UploadType = UploadType
    io.Schema = Schema
    io.ComfyNode = ComfyNode
    io.NodeOutput = NodeOutput

    ui = types.ModuleType("comfy_api.latest.ui")

    class ComfyExtension:
        async def get_node_list(self):
            return []

    latest = types.ModuleType("comfy_api.latest")
    latest.io = io
    latest.ui = ui
    latest.ComfyExtension = ComfyExtension

    root = types.ModuleType("comfy_api")
    root.latest = latest

    sys.modules["comfy_api"] = root
    sys.modules["comfy_api.latest"] = latest
    sys.modules["comfy_api.latest.io"] = io
    sys.modules["comfy_api.latest.ui"] = ui


_install_comfy_api_stub()
