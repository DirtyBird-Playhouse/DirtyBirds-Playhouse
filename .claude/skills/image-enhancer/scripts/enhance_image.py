#!/usr/bin/env python3
"""Enhance an image: upscale, sharpen, and reduce mild compression noise.

Uses Pillow (auto-installs if missing). Always preserves the original by
writing a new "<name>-enhanced.<ext>" file next to (or into) the output path.

Examples:
  python enhance_image.py screenshot.png
  python enhance_image.py screenshot.png --scale 2 --sharpen 1.5
  python enhance_image.py photo.jpg -o out/ --max-width 2560
"""

import argparse
import os
import subprocess
import sys


def ensure_pillow():
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow not found. Installing...")
        subprocess.run([sys.executable, "-m", "pip", "install", "Pillow"], check=True)


def enhance(path, output_dir=None, scale=2.0, sharpen=1.4, max_width=None, out_format=None):
    ensure_pillow()
    from PIL import Image, ImageFilter, ImageEnhance

    img = Image.open(path)
    orig_mode = img.mode
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")

    w, h = img.size
    target_w = int(w * scale)
    if max_width:
        target_w = min(target_w, max_width)
    target_h = int(h * (target_w / w))

    # High-quality upscale.
    if (target_w, target_h) != (w, h):
        img = img.resize((target_w, target_h), Image.LANCZOS)

    # Reduce mild noise/compression artifacts, then sharpen.
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=int(sharpen * 100), threshold=2))
    img = ImageEnhance.Sharpness(img).enhance(sharpen)

    base = os.path.basename(path)
    stem, ext = os.path.splitext(base)
    ext = (out_format and "." + out_format.lstrip(".")) or ext or ".png"
    out_dir = output_dir or os.path.dirname(os.path.abspath(path))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{stem}-enhanced{ext}")

    save_kwargs = {}
    if ext.lower() in (".jpg", ".jpeg"):
        if img.mode == "RGBA":
            img = img.convert("RGB")
        save_kwargs = {"quality": 95, "optimize": True}

    img.save(out_path, **save_kwargs)

    print(f"Input:  {path}  ({w}x{h}, {orig_mode})")
    print(f"Output: {out_path}  ({target_w}x{target_h})")
    print("Original preserved (a new -enhanced file was written).")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Upscale and sharpen an image.")
    ap.add_argument("image", help="Path to the input image")
    ap.add_argument("-o", "--output", help="Output directory (default: alongside input)")
    ap.add_argument("--scale", type=float, default=2.0, help="Upscale factor (default: 2.0)")
    ap.add_argument("--sharpen", type=float, default=1.4, help="Sharpen strength (default: 1.4)")
    ap.add_argument("--max-width", type=int, default=None, help="Cap output width in pixels")
    ap.add_argument("--format", dest="fmt", default=None, help="Output format: png, jpg, webp")
    args = ap.parse_args()

    if not os.path.isfile(args.image):
        print(f"ERROR: file not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    enhance(
        args.image,
        output_dir=args.output,
        scale=args.scale,
        sharpen=args.sharpen,
        max_width=args.max_width,
        out_format=args.fmt,
    )


if __name__ == "__main__":
    main()
