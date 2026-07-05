"""Native Pillow text overlay for The Audition.

Kept separate from the ComfyUI node module so behavior can be unit tested and
so DirtyBirds never needs another custom-node pack for image captioning.
"""

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont


def _font(size=40):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


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


def add_text_overlay(images, text, font_size=40):
    """Burn a translucent black bottom bar with white text into every image."""
    if not str(text or "").strip():
        return images
    if not torch.is_tensor(images) or images.ndim != 4:
        raise ValueError("images must be a BHWC IMAGE tensor")

    rendered = []
    font = _font(font_size)
    for item in images:
        rgb = np.clip(item.detach().cpu().numpy()[..., :3] * 255.0, 0, 255).astype(np.uint8)
        image = Image.fromarray(rgb, "RGB").convert("RGBA")
        draw = ImageDraw.Draw(image, "RGBA")
        padding = max(6, font_size // 5)
        lines = _wrap(draw, text, font, max(1, image.width - 2 * padding))
        if not lines:
            rendered.append(item)
            continue
        boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
        line_heights = [max(1, box[3] - box[1]) for box in boxes]
        bar_height = sum(line_heights) + padding * 2 + max(0, len(lines) - 1) * 4
        top = max(0, image.height - bar_height)
        draw.rectangle((0, top, image.width, image.height), fill=(0, 0, 0, 170))
        y = top + padding
        for line, height in zip(lines, line_heights):
            draw.text((padding, y), line, font=font, fill=(255, 255, 255, 255))
            y += height + 4
        array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        rendered.append(torch.from_numpy(array).to(device=item.device, dtype=item.dtype))
    return torch.stack(rendered, dim=0)


def should_bypass_picker(batch_mode, overlay_enabled, cycler_text):
    """Picker bypass policy shared by the sampler and its unit tests."""
    return bool(batch_mode or (overlay_enabled and str(cycler_text or "").strip()))
