"""
DirtyBirds Playhouse — KSampler node.

Samples from a DIRTYBIRDS_PIPE containing model, conditioning, latent, seed, and denoise.
Provides configurable sampler, scheduler, steps, CFG, and noise placement (GPU/CPU).
Outputs latent + decoded image with live preview in the node.
"""

import os
import re
import json
import random
import logging

import numpy as np
import torch
from PIL import Image

import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
import folder_paths

from server import PromptServer
from aiohttp import web

logger = logging.getLogger(__name__)

# Saved prompts live alongside the existing wildcard prompt files.
PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")
SAVED_PROMPTS_DIR = os.path.join(PROMPTS_DIR, "saved")


def _embed_token(raw):
    """Format an embedding widget value ("name" / "name:strength" / "!name…")
    into the token that gets prepended to the prompt. Mirrors the loader's
    _embed_prefix so the markdown matches what was actually encoded."""
    raw = (raw or "").strip()
    if not raw or raw.startswith("!"):
        return ""
    if ":" in raw:
        base, _, strength = raw.rpartition(":")
        try:
            s = float(strength)
            if abs(s - 1.0) > 1e-3:
                return f"(embedding:{base}:{s:.2f})"
            raw = base
        except ValueError:
            pass
    return f"embedding:{raw}"


def build_prompt_markdown(loader_settings):
    """Compose the final positive / negative prompt strings (with embedding
    tokens) plus an Active-LoRAs summary from a pipe's loader_settings."""
    ls = loader_settings or {}
    positive = ls.get("positive", "") or ""
    negative = ls.get("negative", "") or ""

    pos_tok = _embed_token(ls.get("db_pos_embedding", ""))
    neg_tok = _embed_token(ls.get("db_neg_embedding", ""))
    pos_full = (pos_tok + ", " if pos_tok else "") + positive
    neg_full = (neg_tok + ", " if neg_tok else "") + negative

    lora_parts = []
    for entry in (ls.get("lora_stack") or []):
        try:
            path, strength = entry[0], entry[1]
        except (TypeError, IndexError):
            continue
        lora_parts.append(f"{os.path.basename(path)} ({float(strength):.2f})")
    lora_md = ", ".join(lora_parts)

    return [pos_full, neg_full, lora_md]


def _prepare_noise(latent_image, seed, noise_inds, device):
    """Mirror comfy.sample.prepare_noise but on an arbitrary device.

    CPU (device='cpu') reproduces ComfyUI's standard KSampler exactly; GPU uses
    the GPU RNG stream (A1111-style) for a different noise grain."""
    generator = torch.Generator(device=device).manual_seed(int(seed))
    if noise_inds is None:
        return torch.randn(latent_image.size(), dtype=torch.float32, layout=latent_image.layout,
                           generator=generator, device=device).to(dtype=latent_image.dtype)
    unique_inds, inverse = np.unique(noise_inds, return_inverse=True)
    noises = []
    for i in range(unique_inds[-1] + 1):
        noise = torch.randn([1] + list(latent_image.size())[1:], dtype=torch.float32,
                            layout=latent_image.layout, generator=generator, device=device).to(dtype=latent_image.dtype)
        if i in unique_inds:
            noises.append(noise)
    noises = [noises[i] for i in inverse]
    return torch.cat(noises, axis=0)


class DirtyBirdsSampler:
    """KSampler that consumes DIRTYBIRDS_PIPE (includes seed and denoise)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pipe":           ("DIRTYBIRDS_PIPE",),
                "sampler_name":   (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler":      (comfy.samplers.KSampler.SCHEDULERS,),
                "steps":          ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg":            ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                # Noise placement, driven by the JS slider:
                #   cpu  = stock-KSampler parity (CPU RNG)
                #   gpu  = A1111-style grain (GPU RNG)
                #   both = run both and batch the results
                "noise_mode":     (["cpu", "both", "gpu"], {"default": "both"}),
            },
        }

    RETURN_TYPES = ("LATENT", "IMAGE")
    RETURN_NAMES = ("latent", "image")
    FUNCTION = "sample"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    def sample(self, pipe, sampler_name, scheduler, steps, cfg, noise_mode="both"):
        model = pipe["model"]
        positive = pipe["positive"]
        negative = pipe["negative"]
        latent = pipe["samples"]
        vae = pipe["vae"]
        seed = int(pipe.get("seed", 0))
        denoise = float(pipe.get("denoise", 1.0))

        latent_image = latent["samples"]
        latent_image = comfy.sample.fix_empty_latent_channels(model, latent_image)

        batch_inds = latent.get("batch_index", None)
        noise_mask = latent.get("noise_mask", None)
        disable_pbar = not comfy.utils.PROGRESS_BAR_ENABLED

        def _run(noise):
            # Fresh callback per pass so the live preview tracks each run.
            callback = latent_preview.prepare_callback(model, steps)
            return comfy.sample.sample(
                model, noise, steps, cfg, sampler_name, scheduler,
                positive, negative, latent_image,
                denoise=denoise, disable_noise=False,
                noise_mask=noise_mask, callback=callback,
                disable_pbar=disable_pbar, seed=seed,
            )

        # Noise placement, selected by the JS slider:
        #   cpu  = reproducible parity with ComfyUI's stock KSampler (CPU RNG)
        #   gpu  = A1111-style grain (GPU RNG stream)
        #   both = run both passes and batch them (CPU first, then GPU)
        mode = (noise_mode or "both").lower()
        if mode == "cpu":
            order = ["cpu"]
        elif mode == "gpu":
            order = ["gpu"]
        else:
            order = ["cpu", "gpu"]

        latent_parts, image_parts = [], []
        for which in order:
            if which == "gpu":
                noise = _prepare_noise(latent_image, seed, batch_inds, model.load_device)
            else:
                noise = comfy.sample.prepare_noise(latent_image, seed, batch_inds)
            samples_pass = _run(noise)
            latent_parts.append(samples_pass)
            # Decode each pass separately, then batch (one VAE decode per pass
            # keeps memory bounded vs. decoding the doubled latent at once).
            image_parts.append(vae.decode(samples_pass))

        # Single "make batch" output carrying every requested pass.
        samples = torch.cat(latent_parts, dim=0)
        latent_out = latent.copy()
        latent_out["samples"] = samples
        image = torch.cat(image_parts, dim=0)

        # Save preview(s) to the temp dir; the node's JS renders them in-place
        # from db_images. Each pass is a separate preview, in the order run.
        out_dir = folder_paths.get_temp_directory()
        prefix = "dirtybirds_temp_" + "".join(
            random.choice("abcdefghijklmnopqrstupvxyz") for _ in range(5))
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, out_dir, image.shape[2], image.shape[1])

        results = []
        for img_t in image:
            arr = np.clip(img_t.cpu().numpy() * 255, 0, 255).astype(np.uint8)
            pil_image = Image.fromarray(arr)
            file = f"{filename}_{counter:05}_.png"
            pil_image.save(os.path.join(full_output_folder, file), compress_level=1)
            results.append({"filename": file, "subfolder": subfolder, "type": "temp"})
            counter += 1

        prompts_md = build_prompt_markdown(pipe.get("loader_settings"))

        # Use a custom UI key so ComfyUI does NOT render its own default preview
        # widget — the node draws the preview itself from db_images.
        return {
            "ui": {"db_images": results, "db_prompts_md": prompts_md},
            "result": (latent_out, image),
        }


# ---------------------------------------------------------------------------
# Save-prompt route — writes the final prompt to prompts/saved/<name>.txt
# ---------------------------------------------------------------------------
@PromptServer.instance.routes.post("/dirtybirds/save-prompt")
async def api_save_prompt(request):
    try:
        data = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="invalid JSON")

    name = str(data.get("name", "")).strip()
    if not name:
        raise web.HTTPBadRequest(text="name required")
    # Sanitize to a safe single-segment filename.
    name = re.sub(r"[^A-Za-z0-9 _.-]", "_", name).strip()
    if not name or name.startswith("."):
        raise web.HTTPBadRequest(text="invalid name")
    if not name.lower().endswith(".txt"):
        name += ".txt"

    os.makedirs(SAVED_PROMPTS_DIR, exist_ok=True)
    full = os.path.normpath(os.path.join(SAVED_PROMPTS_DIR, name))
    if os.path.commonpath([os.path.abspath(full), os.path.abspath(SAVED_PROMPTS_DIR)]) != os.path.abspath(SAVED_PROMPTS_DIR):
        raise web.HTTPForbidden()

    positive = str(data.get("positive", "") or "")
    negative = str(data.get("negative", "") or "")
    body = f"# positive\n{positive}\n\n# negative\n{negative}\n"
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(body)

    return web.json_response({"ok": True, "path": os.path.relpath(full, os.path.dirname(__file__))})


NODE_CLASS_MAPPINGS = {
    "DirtyBirdsSampler": DirtyBirdsSampler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DirtyBirdsSampler": "🍑 DirtyBirds Sample — The Payoff",
}
