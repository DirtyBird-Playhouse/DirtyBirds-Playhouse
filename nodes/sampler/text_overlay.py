"""Native Pillow text overlay for The Audition.

Kept separate from the ComfyUI node module so behavior can be unit tested and
so DirtyBirds never needs another custom-node pack for image captioning.
"""

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

# Tried in order. DejaVuSans alone silently failed on Windows — ImageFont
# then fell back to load_default(), an ~8px bitmap face that ignores the size
# argument, so every caption rendered tiny no matter what was asked for.
_FONT_CANDIDATES = (
    "arial.ttf",
    "DejaVuSans.ttf",
    "Helvetica.ttc",
    "LiberationSans-Regular.ttf",
)


def _font(size):
    for name in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        # Pillow >= 10.1 can scale its built-in face; older ones cannot.
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _caption_size(image_height, font_size):
    """Scale the caption to the image so it reads at 512px and at 2048px."""
    return max(10, int(font_size or image_height // 12))


def _wrap(draw, text, font, max_width):
    words = str(text or "").split()
    if not words:
        return []
    lines, current = [], []
    for word in words:
        candidate = " ".join(current + [word])
        if current and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines


def add_text_overlay(images, text, font_size=None):
    """Burn white text with a dark outline across the bottom of every image.

    No backing bar: the outline is what keeps the caption legible, on a pale sky
    or a black dress alike, without hiding a strip of the picture behind it.
    ``font_size`` of None scales the caption to each image's height.
    """
    if not str(text or "").strip():
        return images
    if not torch.is_tensor(images) or images.ndim != 4:
        raise ValueError("images must be a BHWC IMAGE tensor")

    rendered = []
    for item in images:
        rgb = np.clip(item.detach().cpu().numpy()[..., :3] * 255.0, 0, 255).astype(
            np.uint8
        )
        image = Image.fromarray(rgb, "RGB").convert("RGBA")
        draw = ImageDraw.Draw(image, "RGBA")
        size = _caption_size(image.height, font_size)
        font = _font(size)
        # The outline grows with the text, or it vanishes at large sizes.
        stroke = max(1, size // 10)
        padding = max(4, size // 3)
        usable = max(1, image.width - 2 * (padding + stroke))
        lines = _wrap(draw, text, font, usable)
        if not lines:
            rendered.append(item)
            continue
        # Measure with the stroke included so tall glyphs and the outline are
        # not clipped by the image edge.
        boxes = [
            draw.textbbox((0, 0), line, font=font, stroke_width=stroke)
            for line in lines
        ]
        line_heights = [max(1, box[3] - box[1]) for box in boxes]
        gap = max(2, size // 8)
        block = sum(line_heights) + max(0, len(lines) - 1) * gap
        y = max(0, image.height - padding - block)
        for line, height in zip(lines, line_heights):
            draw.text(
                (padding, y),
                line,
                font=font,
                fill=(255, 255, 255, 255),
                stroke_width=stroke,
                stroke_fill=(0, 0, 0, 255),
            )
            y += height + gap
        array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        rendered.append(
            torch.from_numpy(array).to(device=item.device, dtype=item.dtype)
        )
    return torch.stack(rendered, dim=0)


def should_bypass_picker(batch_mode, overlay_enabled):
    """Picker bypass policy shared by the sampler and its unit tests.

    The buttons decide, and nothing else. Turning on Batch mode or Text Overlay
    turns the picker off; whether cycler_line is wired, and what it carries, has
    no say. This previously also required a non-blank cycler line, which meant an
    empty Cycler left the picker running while the node's own button said
    "Picker off" — the UI promised one thing and the run did another.

    Whether a caption is actually drawn is a separate question, answered by the
    cycler text at the call site.
    """
    return bool(batch_mode or overlay_enabled)
