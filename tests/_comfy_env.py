"""Helpers for tests that must import DirtyBirds nodes against a real ComfyUI.

Most DirtyBirds tests stub ComfyUI entirely. A few (the node-registration smoke,
the face-restore registration guard) need the genuine article: ``folder_paths``,
``comfy.*`` and the node packages importing exactly as they do in production.

``ensure_comfy()`` locates a ComfyUI checkout, puts it on ``sys.path`` and
installs a minimal ``server.PromptServer`` stub so the packages' route
registration (``@PromptServer.instance.routes.get(...)``) runs headlessly. It
returns the ComfyUI path, or ``None`` when no checkout / dependencies are
available so callers can ``pytest.skip`` cleanly (e.g. on CI without ComfyUI).
"""

import os
import sys
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]

# Candidate ComfyUI locations, in order. Override with COMFYUI_PATH.
_CANDIDATES = (
    os.environ.get("COMFYUI_PATH"),
    _REPO_ROOT.parent / "Comfyui" / "ComfyUI",
    _REPO_ROOT.parent / "ComfyUI",
    _REPO_ROOT.parent.parent / "Comfyui" / "ComfyUI",
)


def _find_comfy():
    for cand in _CANDIDATES:
        if not cand:
            continue
        path = Path(cand)
        if (path / "folder_paths.py").is_file():
            return path
    return None


def _install_server_stub():
    """Passthrough ``server.PromptServer`` so @routes decorators are no-ops."""
    if "server" in sys.modules and hasattr(sys.modules["server"], "PromptServer"):
        return

    class _Routes:
        def __getattr__(self, _name):
            def factory(*_a, **_k):
                def wrap(fn):
                    return fn

                return wrap

            return factory

    class _Instance:
        routes = _Routes()
        port = 8188

        def send_sync(self, *_a, **_k):
            pass

    class PromptServer:
        instance = _Instance()

    server = types.ModuleType("server")
    server.PromptServer = PromptServer
    sys.modules["server"] = server


def ensure_comfy():
    """Prepare the import environment; return the ComfyUI path or ``None``."""
    comfy = _find_comfy()
    if comfy is None:
        return None
    comfy_str = str(comfy)
    if comfy_str not in sys.path:
        # Prepend so a bare ``import nodes`` binds to ComfyUI's own nodes.py
        # (which exposes PreviewImage) rather than the DirtyBirds ``nodes``
        # package on the repo root. Test-installed stubs are unaffected: they
        # live in sys.modules, which is consulted before sys.path.
        sys.path.insert(0, comfy_str)
    try:
        import folder_paths  # noqa: F401
    except Exception:
        return None
    _install_server_stub()
    return comfy


# ── Loading a node package standalone ────────────────────────────────────────
# Node packages import shared helpers from the parent package (``from .._compare
# import ...``). Loading one flat, or as a top-level package, makes that raise
# "attempted relative import beyond top-level package". So a stub parent is
# registered first, with ``nodes/`` as its search path, and each package is
# loaded as a child of it — the same shape ComfyUI imports them in.
_PARENT = "dirtybirds_nodes"


def load_node_package(name):
    """Import ``nodes/<name>/__init__.py`` with its relative imports intact."""
    import importlib.util

    if _PARENT not in sys.modules:
        parent = types.ModuleType(_PARENT)
        parent.__path__ = [str(_REPO_ROOT / "nodes")]
        sys.modules[_PARENT] = parent

    package = _REPO_ROOT / "nodes" / name
    full = f"{_PARENT}.{name}"
    spec = importlib.util.spec_from_file_location(
        full,
        package / "__init__.py",
        submodule_search_locations=[str(package)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[full] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(full, None)
        raise
    return module
