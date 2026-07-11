"""Standalone driver: import the DirtyBirds node pack exactly as ComfyUI does
and print the registration result as JSON.

Run in a *clean* subprocess (see test_node_registration_smoke.py) so it is not
affected by the shared conftest's ComfyUI stubs — it uses the real ComfyUI on
sys.path, just like production. Not a pytest module itself.

Usage:  python _registration_probe.py <comfyui_path> <repo_root>
Prints: {"registered": [...], "display": [...], "schema_problems": [...]}
"""

import importlib.util
import json
import logging
import sys
import types
from pathlib import Path


def _install_server_stub():
    """Passthrough server.PromptServer so @routes decorators are no-ops."""
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


def main():
    comfy_path, repo_root = sys.argv[1], sys.argv[2]
    # ComfyUI first so a bare `import nodes` binds to its nodes.py (PreviewImage);
    # the repo root is intentionally NOT added (the aggregator is loaded by path).
    sys.path.insert(0, comfy_path)

    import folder_paths  # noqa: F401  (fail loudly if ComfyUI isn't importable)
    _install_server_stub()
    logging.basicConfig(level=logging.WARNING)

    nodes_dir = Path(repo_root) / "nodes"
    spec = importlib.util.spec_from_file_location(
        "dirtybirds_nodes", nodes_dir / "__init__.py",
        submodule_search_locations=[str(nodes_dir)],
    )
    agg = importlib.util.module_from_spec(spec)
    sys.modules["dirtybirds_nodes"] = agg
    spec.loader.exec_module(agg)

    schema_problems = []
    for name, cls in agg.NODE_CLASS_MAPPINGS.items():
        try:
            if hasattr(cls, "INPUT_TYPES"):
                schema = cls.INPUT_TYPES()
                if not (isinstance(schema, dict) and "required" in schema):
                    schema_problems.append(f"{name}: INPUT_TYPES missing 'required'")
                fn = getattr(cls, "FUNCTION", None)
                if not (fn and callable(getattr(cls, fn, None))):
                    schema_problems.append(f"{name}: missing/invalid FUNCTION")
            elif hasattr(cls, "define_schema"):
                cls.define_schema()
                if not callable(getattr(cls, "execute", None)):
                    schema_problems.append(f"{name}: missing execute()")
            else:
                schema_problems.append(f"{name}: no INPUT_TYPES/define_schema")
        except Exception as exc:  # noqa: BLE001
            schema_problems.append(f"{name}: {type(exc).__name__}: {exc}")

    print(json.dumps({
        "registered": sorted(agg.NODE_CLASS_MAPPINGS),
        "display": sorted(agg.NODE_DISPLAY_NAME_MAPPINGS),
        "schema_problems": schema_problems,
    }))


if __name__ == "__main__":
    main()
