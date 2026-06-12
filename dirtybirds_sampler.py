"""
DirtyBirds Playhouse — KSampler node.

Samples from a DIRTYBIRDS_PIPE containing model, conditioning, latent, seed, and denoise.
Provides configurable sampler, scheduler, steps, CFG, and noise placement (GPU/CPU).
Outputs latent + decoded image with live preview in the node.
"""

import os
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

logger = logging.getLogger(__name__)


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
                "add_noise":      (["GPU", "CPU"], {"default": "GPU"}),
            },
        }

    RETURN_TYPES = ("LATENT", "IMAGE")
    RETURN_NAMES = ("latent", "image")
    FUNCTION = "sample"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    def sample(self, pipe, sampler_name, scheduler, steps, cfg, add_noise):
        model = pipe["model"]
        positive = pipe["positive"]
        negative = pipe["negative"]
        latent = pipe["samples"]
        vae = pipe["vae"]
        seed = int(pipe.get("seed", 0))
        denoise = float(pipe.get("denoise", 1.0))

        latent_image = latent["samples"]
        latent_image = comfy.sample.fix_empty_latent_channels(model, latent_image)

        # Generate the start noise on the chosen device (GPU = A1111-style grain,
        # CPU = reproducible parity with ComfyUI's stock KSampler).
        batch_inds = latent.get("batch_index", None)
        if add_noise == "GPU":
            noise = _prepare_noise(latent_image, seed, batch_inds, model.load_device)
        else:
            noise = comfy.sample.prepare_noise(latent_image, seed, batch_inds)

        noise_mask = latent.get("noise_mask", None)
        callback = latent_preview.prepare_callback(model, steps)
        disable_pbar = not comfy.utils.PROGRESS_BAR_ENABLED

        samples = comfy.sample.sample(
            model, noise, steps, cfg, sampler_name, scheduler,
            positive, negative, latent_image,
            denoise=denoise, disable_noise=False,
            noise_mask=noise_mask, callback=callback,
            disable_pbar=disable_pbar, seed=seed,
        )

        latent_out = latent.copy()
        latent_out["samples"] = samples

        # Decode latent to image
        image = vae.decode(samples)

        # Save preview(s) to the temp dir in ComfyUI's native PreviewImage format
        # so the node renders them in-place (matches the standard preview widget).
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

        return {
            "ui": {"images": results},
            "result": (latent_out, image),
        }


NODE_CLASS_MAPPINGS = {
    "DirtyBirdsSampler": DirtyBirdsSampler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DirtyBirdsSampler": "🍑 DirtyBirds Sample — The Payoff",
}
