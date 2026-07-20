"""Shared helpers for the DirtyBirds Claude Code hooks.

Kept dependency-free (stdlib only) and importable by sibling hook scripts, which
Claude Code invokes as plain subprocesses with the hook payload on stdin.
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Marker dir: repo-local because this machine's %TEMP% denies writes to
# tool-created subdirs (the same WinError 5 that pytest.ini works around).
# .pytest_tmp/ is already gitignored.
MARKER_DIR = REPO_ROOT / ".pytest_tmp" / "hook-markers"


def read_payload():
    """Parse the hook JSON from stdin; empty dict if it is absent/malformed."""
    try:
        return json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, ValueError):
        return {}


def edited_path(payload):
    """Absolute Path of the file an Edit/Write/NotebookEdit touched, or None."""
    raw = (payload.get("tool_input") or {}).get("file_path")
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = Path(payload.get("cwd") or REPO_ROOT) / path
    try:
        return path.resolve()
    except OSError:
        return None


def within_repo(path):
    """True when path is inside this repo (guards against edits elsewhere)."""
    try:
        path.relative_to(REPO_ROOT)
        return True
    except ValueError:
        return False


def rel(path):
    """Repo-relative display string, falling back to the absolute path."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def find_python():
    """Interpreter that can import ComfyUI: the venv beside the repo, else the
    current one. Discovered rather than hardcoded so settings.json stays
    portable across machines."""
    candidates = [
        os.environ.get("COMFYUI_PYTHON"),
        REPO_ROOT.parent / "Comfyui" / "venv" / "Scripts" / "python.exe",
        REPO_ROOT.parent / "ComfyUI" / "venv" / "Scripts" / "python.exe",
        REPO_ROOT.parent / "Comfyui" / "python_embeded" / "python.exe",
    ]
    for cand in candidates:
        if cand and Path(cand).is_file():
            return str(cand)
    return sys.executable
