---
name: image-enhancer
description: Improves the quality of images, especially screenshots, by enhancing resolution, sharpness, and clarity. Perfect for preparing images for presentations, documentation, or social media posts.
---

# Image Enhancer

This skill takes your images and screenshots and makes them look better—sharper, clearer, and more professional.

## When to Use This Skill

- Improving screenshot quality for blog posts or documentation
- Enhancing images before sharing on social media
- Preparing images for presentations or reports
- Upscaling low-resolution images
- Sharpening blurry photos
- Cleaning up compressed images

## What This Skill Does

1. **Analyzes Image Quality**: Checks resolution, sharpness, and compression artifacts
2. **Enhances Resolution**: Upscales images intelligently
3. **Improves Sharpness**: Enhances edges and details
4. **Reduces Artifacts**: Cleans up compression artifacts and noise
5. **Optimizes for Use Case**: Adjusts based on intended use (web, print, social media)

## How to Use

The skill runs `scripts/enhance_image.py` (Pillow-based: high-quality LANCZOS
upscale + unsharp-mask sharpening). It auto-installs Pillow if missing and always
writes a new `<name>-enhanced.<ext>` file, leaving the original untouched.

### Basic Enhancement

```powershell
python scripts/enhance_image.py screenshot.png
```

### Specific Improvements

```powershell
# 3x upscale, stronger sharpening
python scripts/enhance_image.py screenshot.png --scale 3 --sharpen 1.8

# Cap output width (e.g. for retina at 2560px)
python scripts/enhance_image.py photo.jpg --max-width 2560

# Force output format
python scripts/enhance_image.py screenshot.png --format webp -o out/
```

### Batch Processing

Loop the script over a folder (PowerShell):

```powershell
Get-ChildItem *.png | ForEach-Object { python scripts/enhance_image.py $_.FullName }
```

### Capability note

This is a classical upscaler (resampling + sharpening) — good for screenshots,
UI captures, and mildly soft images. It is **not** an AI super-resolution model,
so it cannot invent detail that isn't present in blurry or very low-res photos.
For those, use a dedicated model (e.g. a ComfyUI upscale workflow).

## Example

**User**: "Improve the image quality of screenshot-2024.png"

**Output**:
```
Analyzing screenshot-2024.png...

Current specs:
- Resolution: 1920x1080
- Format: PNG
- Quality: Good, but slight blur

Enhancements applied:
✓ Upscaled to 2560x1440 (retina)
✓ Sharpened edges
✓ Enhanced text clarity
✓ Optimized file size

Saved as: screenshot-2024-enhanced.png
Original preserved as: screenshot-2024-original.png
```

**Inspired by:** Lenny Rachitsky's workflow from his newsletter - used for screenshots in his articles

## Tips

- Always keeps original files as backup
- Works best with screenshots and digital images
- Can batch process entire folders
- Specify output format if needed (PNG for quality, JPG for smaller size)
- For social media, mention the platform for optimal sizing

## Common Use Cases

- **Blog Posts**: Enhance screenshots before publishing
- **Documentation**: Make UI screenshots crystal clear
- **Social Media**: Optimize images for Twitter, LinkedIn, Instagram
- **Presentations**: Upscale images for large screens
- **Print Materials**: Increase resolution for physical media

