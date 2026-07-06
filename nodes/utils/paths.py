"""Shared filesystem-path helpers for the DirtyBirds node pack.

Centralizes the "where is the pack root / user-files directory" logic that
several nodes previously each recomputed with slightly different idioms
(``../..`` from a node package, a triple ``dirname``, etc.). No ComfyUI imports,
so this is safe to load early and unit-test in isolation.
"""

import os
import logging

logger = logging.getLogger(__name__)


def pack_root():
    """Absolute path to the node-pack root (…/custom_nodes/DirtyBirds-Playhouse).

    This module lives at ``nodes/utils/paths.py``, so the pack root is two
    directories up from ``nodes/`` — i.e. three from this file.
    """
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def user_files_dir():
    """Resolve the pack's user-files directory, honoring a text-file pointer.

    Looks for a ``user-files`` marker at the pack root:

    * if it is a directory, that directory is the user-files dir;
    * if it is a text file, its contents are treated as a pointer to the real
      directory (``$VARS`` and ``~`` expanded; a relative path is resolved
      against the pack root);
    * otherwise fall back to a legacy ``user_files`` directory, and finally to
      the ``user-files`` marker path itself.
    """
    root = pack_root()
    marker = os.path.join(root, "user-files")
    if os.path.isdir(marker):
        return marker
    if os.path.isfile(marker):
        try:
            with open(marker, "r", encoding="utf-8", errors="ignore") as f:
                target = f.read().strip().strip('"')
            if target:
                target = os.path.expandvars(os.path.expanduser(target))
                if not os.path.isabs(target):
                    target = os.path.join(root, target)
                return os.path.abspath(target)
        except OSError as e:
            logger.warning("[DirtyBirds] user-files pointer read failed: %s", e)
    # Compatibility with older installs that used an underscore directory.
    legacy = os.path.join(root, "user_files")
    return legacy if os.path.isdir(legacy) else marker
