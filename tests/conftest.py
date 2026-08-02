"""Shared pytest fixtures/stubs for DirtyBirds tests.

Every DirtyBirds node is V1, but the tests that load a node package against a
real ComfyUI (``tests/_comfy_env.py``) put ComfyUI on ``sys.path``, which drags
in its ``comfy_api`` package. This stub claims ``comfy_api`` in ``sys.modules``
first, so those imports resolve to a small, predictable surface (``io.ComfyNode``,
``io.Schema``, the typed ``*.Input``/``*.Output`` builders, ``io.NodeOutput``,
and the ``FolderType``/``UploadType`` enums) instead of the live one.

Not optional: removing it fails three adapter tests in ``test_finish.py`` and
``test_inpaint_adapter.py``. It is also why ``test_node_registration_smoke.py``
has to probe in a subprocess — the real ComfyUI ``nodes.py`` needs the genuine
``comfy_api.internal``, which this stub shadows.

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
        def __init__(
            self,
            node_id=None,
            display_name=None,
            category=None,
            inputs=None,
            outputs=None,
            hidden=None,
            **kwargs
        ):
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
    for _name in (
        "Combo",
        "String",
        "Boolean",
        "Int",
        "Float",
        "Image",
        "Mask",
        "Latent",
        "Conditioning",
        "Custom",
    ):
        setattr(io, _name, _io_type(_name))
    io.FolderType = FolderType
    io.UploadType = UploadType
    io.Schema = Schema
    io.ComfyNode = ComfyNode
    io.NodeOutput = NodeOutput

    ui = types.ModuleType("comfy_api.latest.ui")

    latest = types.ModuleType("comfy_api.latest")
    latest.io = io
    latest.ui = ui

    root = types.ModuleType("comfy_api")
    root.latest = latest

    sys.modules["comfy_api"] = root
    sys.modules["comfy_api.latest"] = latest
    sys.modules["comfy_api.latest.io"] = io
    sys.modules["comfy_api.latest.ui"] = ui


_install_comfy_api_stub()
