"""
DirtyBirds Playhouse — KSampler node.

Samples from a DIRTYBIRDS_PIPE containing model, conditioning, latent, seed, and denoise.
Provides configurable sampler, scheduler, steps, CFG, and noise placement (GPU/CPU).
Outputs latent + decoded image with live preview in the node.
"""

import time
import uuid
import logging
import threading

import numpy as np
import torch
from aiohttp import web

import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
from server import PromptServer
from nodes import PreviewImage
from .text_overlay import add_text_overlay, should_bypass_picker
from comfy.model_management import (
    InterruptProcessingException,
    throw_exception_if_processing_interrupted,
)

logger = logging.getLogger(__name__)


# ── Interactive in-node image picker (blocking handshake) ────────────────────
# After sampling, the node pushes the batch to the browser and BLOCKS until the
# user multi-selects images inline in the node and confirms. Only picked images
# (and their matching latents) flow onward. Adapted from the mechanism that used
# uses a websocket event + a POST route filling a shared state.
EVENT = "dirtybirds-sampler-pick"
ROUTE = "/dirtybirds/sampler-pick"

# On timeout we send NO images and stop the graph cleanly, rather than passing
# an unreviewed batch downstream.
PICK_TIMEOUT = 30


class _PickState:
    """Token-keyed pick requests, safe when more than one prompt is active."""

    _PENDING = object()
    _requests = {}
    _lock = threading.Lock()

    @classmethod
    def start(cls, token):
        with cls._lock:
            cls._requests[str(token)] = cls._PENDING

    @classmethod
    def waiting(cls, token):
        with cls._lock:
            return cls._requests.get(str(token)) is cls._PENDING

    @classmethod
    def deliver(cls, token, selection):
        key = str(token)
        with cls._lock:
            if cls._requests.get(key) is not cls._PENDING:
                return False
            clean = []
            for item in selection or []:
                try:
                    clean.append(int(item))
                except (TypeError, ValueError):
                    continue
            cls._requests[key] = clean
            return True

    @classmethod
    def take(cls, token):
        with cls._lock:
            sel = cls._requests.pop(str(token), cls._PENDING)
        return None if sel is cls._PENDING else sel


@PromptServer.instance.routes.post(ROUTE)
async def _sampler_pick_message(request):
    """Browser posts {token, selection:[indices]} when the user confirms."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    matched = _PickState.deliver(data.get("token"), data.get("selection"))
    if not matched:
        logger.info("[DirtyBirds] Sampler pick: ignoring stale/mismatched reply")
    return web.json_response({"ok": matched})


def _wait_for_pick(token, payload, timeout):
    """Send the batch to the browser and block until a reply or timeout.

    Returns list[int] of selected indices, or None on timeout."""
    _PickState.start(token)
    payload["token"] = token
    PromptServer.instance.send_sync(EVENT, payload)

    end = time.monotonic() + max(1, int(timeout))
    while time.monotonic() < end and _PickState.waiting(token):
        # Honour the Cancel/Interrupt button so a blocked graph can be stopped.
        throw_exception_if_processing_interrupted()
        PromptServer.instance.send_sync(
            EVENT, {"token": token, "tick": int(end - time.monotonic())}
        )
        time.sleep(0.5)

    sel = _PickState.take(token)
    if sel is None:
        PromptServer.instance.send_sync(EVENT, {"token": token, "timeout": True})
    return sel


def _prepare_noise(latent_image, seed, noise_inds, device):
    """Mirror comfy.sample.prepare_noise but on an arbitrary device.

    CPU (device='cpu') reproduces ComfyUI's standard KSampler exactly; GPU uses
    the GPU RNG stream (A1111-style) for a different noise grain."""
    generator = torch.Generator(device=device).manual_seed(int(seed))
    if noise_inds is None:
        return torch.randn(
            latent_image.size(),
            dtype=torch.float32,
            layout=latent_image.layout,
            generator=generator,
            device=device,
        ).to(dtype=latent_image.dtype)
    unique_inds, inverse = np.unique(noise_inds, return_inverse=True)
    noises = []
    for i in range(unique_inds[-1] + 1):
        noise = torch.randn(
            [1] + list(latent_image.size())[1:],
            dtype=torch.float32,
            layout=latent_image.layout,
            generator=generator,
            device=device,
        ).to(dtype=latent_image.dtype)
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
                "pipe": ("DIRTYBIRDS_PIPE",),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg": (
                    "FLOAT",
                    {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1},
                ),
                # Noise placement, driven by the JS slider:
                #   cpu  = stock-KSampler parity (CPU RNG)
                #   gpu  = A1111-style grain (GPU RNG)
                #   both = run both and batch the results
                "noise_mode": (["cpu", "both", "gpu"], {"default": "both"}),
                "batch_mode": ("BOOLEAN", {"default": False}),
                "overlay_enabled": ("BOOLEAN", {"default": False}),
                # How long the interactive picker blocks before sending no images.
                "pick_timeout": (
                    "INT",
                    {"default": PICK_TIMEOUT, "min": 5, "max": 600, "step": 5},
                ),
            },
            "optional": {
                # Wire straight from Prompt Builder's cycler_line output. Optional
                # so existing workflows still load; unwired simply means no
                # caption, which is also what an empty cycler produces.
                "cycler_line": ("STRING", {"default": "", "forceInput": True}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "LATENT", "IMAGE")
    RETURN_NAMES = ("pipe", "latent", "image")
    FUNCTION = "sample"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    # Interactive: always re-run so the inline picker shows on every queue.
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def sample(
        self,
        pipe,
        sampler_name,
        scheduler,
        steps,
        cfg,
        noise_mode="both",
        batch_mode=False,
        overlay_enabled=False,
        pick_timeout=PICK_TIMEOUT,
        cycler_line="",
        unique_id=None,
    ):
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
                model,
                noise,
                steps,
                cfg,
                sampler_name,
                scheduler,
                positive,
                negative,
                latent_image,
                denoise=denoise,
                disable_noise=False,
                noise_mask=noise_mask,
                callback=callback,
                disable_pbar=disable_pbar,
                seed=seed,
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
                noise = _prepare_noise(
                    latent_image, seed, batch_inds, model.load_device
                )
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
        image = torch.cat(image_parts, dim=0)
        batch = image.shape[0]

        cycler_text = str(cycler_line or "").strip()
        overlay_active = bool(overlay_enabled and cycler_text)
        if overlay_active:
            image = add_text_overlay(image, cycler_text)

        # Save preview(s) so the browser has real URLs to render the picker grid.
        ui = PreviewImage().save_images(image)
        previews = ui["ui"]["images"]
        for preview in previews:
            preview["width"] = int(image.shape[2])
            preview["height"] = int(image.shape[1])

        # Ride the sampler's own settings out on the pipe so the Archive node can
        # record how the image was actually made (see its _generation_summary).
        sampler_settings = {
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "steps": int(steps),
            "cfg": float(cfg),
            "noise_mode": mode,
        }

        if should_bypass_picker(batch_mode, overlay_enabled):
            # Batch mode: skip the interactive picker, pass everything through.
            latent_out["samples"] = samples
            pipe = dict(pipe)
            pipe["images"] = image
            pipe["db_sampler_settings"] = sampler_settings
            return {
                "ui": {"db_images": previews},
                "result": (pipe, latent_out, image),
            }

        # Push the batch to the node and BLOCK until the user picks inline.
        token = str(uuid.uuid4())
        selection = _wait_for_pick(
            token,
            {"images": previews, "count": batch, "node_id": str(unique_id)},
            max(5, int(pick_timeout)),
        )
        if selection is None:  # timed out -> send no images
            selection = []

        # Clamp to valid, de-dup, keep order.
        seen = set()
        selection = [
            i for i in selection if 0 <= i < batch and not (i in seen or seen.add(i))
        ]
        if not selection:
            # Nothing kept (timeout or empty pick) -> stop the graph cleanly
            # rather than passing junk on.
            raise InterruptProcessingException()

        # Filter image + matching latents to the picks (kept aligned).
        image = torch.stack([image[i] for i in selection])
        latent_out["samples"] = torch.stack([samples[i] for i in selection])
        latent_out.pop("batch_index", None)
        picked_previews = [previews[i] for i in selection]

        pipe = dict(pipe)
        pipe["images"] = image
        pipe["db_sampler_settings"] = sampler_settings
        return {
            "ui": {"db_images": picked_previews},
            "result": (pipe, latent_out, image),
        }


NODE_CLASS_MAPPINGS = {
    "DirtyBirdsSampler": DirtyBirdsSampler,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DirtyBirdsSampler": "🎬 Sampler & Picker",
}
