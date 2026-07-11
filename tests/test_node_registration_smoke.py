"""End-to-end registration smoke test for the whole DirtyBirds node pack.

The aggregator (``nodes/__init__.py``) imports each package *defensively*: a
package that raises on import is skipped with a log warning, so a broken node
silently vanishes from the menu instead of failing loudly. That is the exact
"you fix one thing and another quietly breaks" trap.

This runs a clean subprocess (``_registration_probe.py``) that imports the pack
exactly as ComfyUI does — the real ComfyUI on sys.path, no test stubs — and
asserts every expected node registered with a usable schema. A subprocess is
used so the shared conftest's ComfyUI stubs can't distort the result. It needs a
real ComfyUI checkout (set ``COMFYUI_PATH``); without one it skips.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from _comfy_env import _find_comfy


REPO_ROOT = Path(__file__).resolve().parents[1]
PROBE = Path(__file__).resolve().parent / "_registration_probe.py"

EXPECTED_NODES = {
    "DirtyBirdsLoader",
    "DirtyBirdsPrompt",
    "DirtyBirdsLoadImage",
    "DirtyBirdsSampler",
    "DirtyBirdsMuse",
    "DirtyBirdsPipeIn",
    "DirtyBirdsPipeOut",
    "DirtyBirdsWardrobe",
    "DirtyBirdsSavePrompt",
    "DirtyBirdsFixer",
    "DirtyBirdsInpaint",
}


@pytest.fixture(scope="module")
def probe_result():
    comfy = _find_comfy()
    if comfy is None:
        pytest.skip("No ComfyUI checkout found (set COMFYUI_PATH to run).")
    proc = subprocess.run(
        [sys.executable, str(PROBE), str(comfy), str(REPO_ROOT)],
        capture_output=True, text=True,
    )
    # The last stdout line is the JSON payload (ComfyUI prints banners above it).
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines or not lines[-1].startswith("{"):
        pytest.fail(
            "Registration probe produced no JSON.\n"
            f"exit={proc.returncode}\nstdout tail:\n{proc.stdout[-2000:]}\n"
            f"stderr tail:\n{proc.stderr[-2000:]}"
        )
    return json.loads(lines[-1])


def test_every_node_package_registers(probe_result):
    """No package was silently skipped: the full roster is present."""
    registered = set(probe_result["registered"])
    missing = EXPECTED_NODES - registered
    assert not missing, (
        f"Nodes missing from registration (a package failed to import and was "
        f"skipped): {sorted(missing)}. Registered: {sorted(registered)}"
    )


def test_no_schema_or_entrypoint_problems(probe_result):
    """Each node has a callable schema + execute entrypoint (caught here, not at
    queue time)."""
    assert not probe_result["schema_problems"], (
        "Schema/entrypoint problems:\n" + "\n".join(probe_result["schema_problems"])
    )


def test_display_names_cover_every_node(probe_result):
    """Every registered node has a menu label."""
    missing = set(probe_result["registered"]) - set(probe_result["display"])
    assert not missing, f"Nodes without display names: {sorted(missing)}"
