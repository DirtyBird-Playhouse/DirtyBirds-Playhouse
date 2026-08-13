"""Shared before/after preview payload for DirtyBirds nodes.

Any node that changes an image it was handed can emit one of these, and the
shared ``installComparePreview`` in ``web/db_shared.js`` renders it as the
click-to-flip compare view. One payload contract, one renderer — rather than a
private pair per node that drifts.

Not a node package: ``nodes/__init__.py`` imports from an explicit list, so this
module is only ever pulled in by the nodes that use it.
"""

# The keys the JS side reads. Changing one means changing db_shared.js with it,
# which tests/test_finish.py checks.
BEFORE_KEY = "db_compare_before"
AFTER_KEY = "db_compare_after"
CAPTION_KEY = "db_compare_caption"


def resolution(image):
    """``WIDTHxHEIGHT`` for a BHWC IMAGE tensor, or "" if it isn't one."""
    try:
        return f"{int(image.shape[2])}×{int(image.shape[1])}"
    except (AttributeError, IndexError, TypeError, ValueError):
        return ""


def save_preview(image):
    """Temp-save an IMAGE tensor, returning ComfyUI's ``images`` list or None.

    The one place a node is allowed to reach for ``PreviewImage``. Returns None
    on any failure: a preview is a convenience and must never fail the graph.
    """
    if image is None:
        return None
    try:
        from nodes import PreviewImage

        return PreviewImage().save_images(image)["ui"]["images"]
    except Exception:  # noqa: BLE001
        return None


def compare_preview(before, after, caption=""):
    """Save ``before``/``after`` as temp previews for the compare view.

    Returns the ``ui`` dict, or None when there is nothing worth showing.

    None when ``after`` is ``before`` — the same tensor means nothing ran, and
    writing two identical temp PNGs every run to show an unchanged image is pure
    cost. None on any failure too: a preview is a convenience and must never be
    able to fail the graph.
    """
    if after is before or before is None or after is None:
        return None
    before_images = save_preview(before)
    after_images = save_preview(after)
    if not before_images or not after_images:
        return None
    return {
        BEFORE_KEY: before_images,
        AFTER_KEY: after_images,
        CAPTION_KEY: [str(caption or "")],
    }
