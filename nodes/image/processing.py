"""Source loading and tensor conversion for the DirtyBirds Image Loader."""

import io
import os
import urllib.parse
import urllib.request
from html.parser import HTMLParser

import numpy as np
import torch
from PIL import Image, ImageFilter, ImageOps, ImageSequence

import folder_paths


USER_AGENT = "Mozilla/5.0 (DirtyBirds-Playhouse ComfyUI node)"
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


class SocialImageParser(HTMLParser):
    """Find the preview image advertised by a normal webpage."""

    def __init__(self):
        super().__init__()
        self.image_url = None

    def handle_starttag(self, tag, attrs):
        if self.image_url or tag.lower() != "meta":
            return
        values = {str(key).lower(): value for key, value in attrs}
        name = str(values.get("property") or values.get("name") or "").lower()
        if name in {"og:image", "og:image:url", "twitter:image", "twitter:image:src"}:
            self.image_url = values.get("content")


def read_response(response):
    """Read a remote response with a firm size limit."""
    declared = response.headers.get("Content-Length")
    if declared and int(declared) > MAX_DOWNLOAD_BYTES:
        raise ValueError("remote image is larger than 50 MB")
    data = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise ValueError("remote image is larger than 50 MB")
    return data


def open_remote_image(url):
    """Open a direct image URL or the social-preview image from an HTML page."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        content_type = response.headers.get_content_type().lower()
        final_url = response.geturl()
        data = read_response(response)

    if content_type in {"text/html", "application/xhtml+xml"}:
        parser = SocialImageParser()
        parser.feed(data.decode("utf-8", errors="replace"))
        if not parser.image_url:
            raise ValueError("webpage does not advertise an og:image or twitter:image")
        image_url = urllib.parse.urljoin(final_url, parser.image_url)
        image_request = urllib.request.Request(image_url, headers=headers)
        with urllib.request.urlopen(image_request, timeout=20) as response:
            data = read_response(response)

    image = Image.open(io.BytesIO(data))
    image.load()
    return image


def open_source(image, image_url):
    """Resolve inputs to a PIL image. URL/local path override the picker."""
    source = (image_url or "").strip()
    if source:
        if source.lower().startswith(("http://", "https://")):
            return open_remote_image(source)
        if os.path.isfile(source):
            return Image.open(source)
        candidate = os.path.join(folder_paths.get_input_directory(), source)
        if os.path.isfile(candidate):
            return Image.open(candidate)
        raise FileNotFoundError(f"image not found: {source}")
    return Image.open(folder_paths.get_annotated_filepath(image))


def resize_to_max(image, max_side, allow_upscale=False):
    """Fit to a latent-safe long side while preserving aspect ratio."""
    max_side = max(8, int(max_side))
    width, height = image.size
    longest = max(width, height)
    if longest <= 0:
        return image
    if longest <= max_side and not allow_upscale:
        return image
    scale = float(max_side) / float(longest)
    new_width = max(8, int(round(width * scale / 8.0)) * 8)
    new_height = max(8, int(round(height * scale / 8.0)) * 8)
    if (new_width, new_height) == (width, height):
        return image
    return image.resize((new_width, new_height), Image.LANCZOS)


def sharpen_image(image, mode="off", scale_ratio=1.0):
    """Apply the existing conservative unsharp mask to resized sources."""
    mode = str(mode or "off").lower()
    if mode == "off":
        return image
    if mode == "auto":
        loss = max(0.0, 1.0 - float(scale_ratio))
        if loss < 0.05:
            return image
        radius = 0.8 + min(0.5, loss * 0.8)
        percent = int(round(35 + min(75, loss * 110)))
    else:
        radius, percent = {
            "low": (0.8, 45),
            "medium": (1.1, 80),
            "high": (1.4, 125),
        }.get(mode, (0.0, 0))
        if not percent:
            return image
    alpha = image.getchannel("A") if "A" in image.getbands() else None
    sharpened = image.convert("RGB").filter(
        ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3)
    )
    if alpha is not None:
        sharpened.putalpha(alpha)
    return sharpened


def to_tensors(image):
    """Replicate native LoadImage conversion: IMAGE ``BHWC`` plus MASK."""
    output_images, output_masks = [], []
    width, height = None, None
    for frame in ImageSequence.Iterator(image):
        frame = ImageOps.exif_transpose(frame)
        if frame.mode == "I":
            frame = frame.point(lambda value: value * (1 / 255))
        rgb = frame.convert("RGB")
        if width is None:
            width, height = rgb.size
        if rgb.size != (width, height):
            continue
        array = np.array(rgb).astype(np.float32) / 255.0
        output_images.append(torch.from_numpy(array)[None,])
        if "A" in frame.getbands():
            mask = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        else:
            mask = torch.zeros((height, width), dtype=torch.float32)
        output_masks.append(mask.unsqueeze(0))

    if len(output_images) > 1:
        return torch.cat(output_images, dim=0), torch.cat(output_masks, dim=0)
    return output_images[0], output_masks[0]
