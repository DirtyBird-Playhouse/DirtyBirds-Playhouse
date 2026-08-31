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


# Longest edge, in pixels, of the PNG a preview is saved at.
#
# These previews are decoration: the compare view is 190px tall and the batch
# strip's thumbnails are smaller still. Saving at full resolution meant ✨ Finish
# — the one node whose whole job is making images bigger — wrote two 4096px PNGs
# per run and handed both to the browser, which decoded them at full size into a
# 190px box. Two ~67MB bitmaps per node, per run, and the before image is never
# torn down; that stall on the main thread is what froze the canvas. 512 is
# comfortably more than either view can show, even on a HiDPI display.
PREVIEW_MAX_EDGE = 512


def _downscale_for_preview(image, max_edge=PREVIEW_MAX_EDGE):
    """Resample a BHWC IMAGE down to ``max_edge`` on its long edge.

    Returns ``image`` untouched when it is already small enough, and on any
    failure — a preview that cannot be shrunk is still worth showing.
    """
    try:
        height, width = int(image.shape[1]), int(image.shape[2])
        longest = max(height, width)
        max_edge = max(1, int(max_edge))
        if longest <= max_edge:
            return image

        # Plain torch, not comfy.utils.common_upscale. This module is imported
        # by every node that shows a before/after and deliberately pulls in
        # nothing from ComfyUI at module scope; a thumbnail does not justify
        # making that a runtime dependency. Antialiased bilinear is the right
        # filter for a large downsample anyway, and no one is inspecting detail
        # in a 190px box.
        import torch.nn.functional as F

        ratio = max_edge / float(longest)
        target_h = max(1, int(round(height * ratio)))
        target_w = max(1, int(round(width * ratio)))
        samples = image.movedim(-1, -3).float()
        out = F.interpolate(
            samples,
            size=(target_h, target_w),
            mode="bilinear",
            align_corners=False,
            antialias=True,
        )
        return out.movedim(-3, -1).clamp(0.0, 1.0)
    except Exception:  # noqa: BLE001
        return image


def save_preview(image, max_edge=PREVIEW_MAX_EDGE):
    """Temp-save an IMAGE tensor, returning ComfyUI's ``images`` list or None.

    The one place a node is allowed to reach for ``PreviewImage``. The image is
    downscaled to ``max_edge`` first — see the note there. Returns None
    on any failure: a preview is a convenience and must never fail the graph.
    """
    if image is None:
        return None
    try:
        from nodes import PreviewImage

        return PreviewImage().save_images(_downscale_for_preview(image, max_edge))["ui"]["images"]
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
