"""
DirtyBirds Playhouse — KSampler node.

Samples from a DIRTYBIRDS_PIPE containing model, conditioning, latent, seed, and denoise.
Provides configurable sampler, scheduler, steps, CFG, and noise placement (GPU/CPU).
Outputs latent + decoded image with live preview in the node.
"""

import time
import uuid
import logging

import numpy as np
import torch
from aiohttp import web

import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
from server import PromptServer
from .._compare import save_preview
from .text_overlay import add_text_overlay, should_bypass_picker
from .batch_collation import collate_spatial_batch
from .pick_state import PickState as _PickState
from .._pipe_type import PIPE_INPUT, PIPE_TYPE
from comfy.model_management import (
    InterruptProcessingException,
    throw_exception_if_processing_interrupted,
)

logger = logging.getLogger(__name__)

# The picker can fill most of the browser window, unlike the small comparison
# panels that use _compare's 512px default. Preserve a 1024px long edge here so
# judging faces and fine detail does not turn into guessing from a blurry card.
PICKER_PREVIEW_MAX_EDGE = 1024


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
                "pipe": (PIPE_INPUT,),
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

    RETURN_TYPES = (PIPE_TYPE, "LATENT", "IMAGE")
    RETURN_NAMES = ("pipe", "latent", "image")
    FUNCTION = "sample"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    # A wired Cycler line makes Prompt Builder OUTPUT_IS_LIST outputs
    # (positive / cycler_line, see nodes/prompt/__init__.py) real Python
    # lists, which ComfyUI expands by mapping every downstream node over the
    # list one item at a time. Without this flag this node would be mapped
    # too: sample() would run once per cycler line, each call opening its own
    # blocking picker, and the picked image would never reach Finish / Save
    # because a mapped node only releases its output downstream once every
    # mapped call has completed. INPUT_IS_LIST makes ComfyUI call sample()
    # exactly once, handing every input in as a list, so the whole cycler
    # batch is sampled and picked in a single pass.
    INPUT_IS_LIST = True

    # Interactive: always re-run so the inline picker shows on every queue.
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    @staticmethod
    def _first(value, default=None):
        """Unwrap a widget input. With INPUT_IS_LIST every argument arrives
        as a list (widgets always length 1); an unconnected optional input
        still arrives as its plain Python default, so pass scalars through
        unchanged too."""
        if isinstance(value, list):
            return value[0] if value else default
        return default if value is None else value

    def _sample_one(
        self,
        pipe,
        sampler_name,
        scheduler,
        steps,
        cfg,
        noise_mode,
        cycler_line,
        overlay_enabled,
    ):
        """Sample and decode a single pipe. Returns (latent_dict, samples, image)."""
        model = pipe["model"]
        positive = pipe["positive"]
        negative = pipe["negative"]
        latent = pipe["samples"]
        vae = pipe["vae"]
        # `or` rather than a get default: Easy-Use writes an explicit
        # "seed": None when the incoming pipe carries no seed, and it has no
        # "denoise" key at all. A default only fires on a missing key, so
        # int(None) would raise the moment a foreign PIPE_LINE arrived.
        seed = int(pipe.get("seed") or 0)
        denoise = float(pipe.get("denoise") or 1.0)

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
        #   cpu  = reproducible parity with ComfyUI stock KSampler (CPU RNG)
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

        # Single "make batch" output carrying every requested pass. These
        # passes came from one latent, so their spatial shapes already match.
        samples = torch.cat(latent_parts, dim=0)
        image = torch.cat(image_parts, dim=0)

        cycler_text = str(cycler_line or "").strip()
        if bool(overlay_enabled and cycler_text):
            image = add_text_overlay(image, cycler_text)

        return latent, samples, image

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
        # INPUT_IS_LIST: every argument arrives as a list. `pipe` carries one
        # entry per upstream Cycler line (each produced by its own Loader /
        # Prompt run, expanded before this node because that node lacks
        # INPUT_IS_LIST); an unwired `cycler_line` arrives as its bare ""
        # Python default rather than a list, since it is never linked at all.
        # Widgets are always plain single-item lists.
        sampler_name = self._first(sampler_name)
        scheduler = self._first(scheduler)
        steps = int(self._first(steps))
        cfg = float(self._first(cfg))
        noise_mode = self._first(noise_mode, "both")
        batch_mode = bool(self._first(batch_mode, False))
        overlay_enabled = bool(self._first(overlay_enabled, False))
        pick_timeout = self._first(pick_timeout, PICK_TIMEOUT)
        unique_id = self._first(unique_id)

        pipes = pipe if isinstance(pipe, list) else [pipe]
        if isinstance(cycler_line, list) and cycler_line:
            cycler_lines = cycler_line
        else:
            cycler_lines = [cycler_line] * len(pipes)

        # Sample and decode every pipe (one per cycler line, or just the one
        # pipe when no cycler is wired), then batch everything together so
        # the picker below shows the whole set in a single pass.
        latent_parts, image_parts = [], []
        first_latent = None
        for i, item_pipe in enumerate(pipes):
            cycler_text = cycler_lines[i] if i < len(cycler_lines) else cycler_lines[-1]
            latent, samples, image = self._sample_one(
                item_pipe,
                sampler_name,
                scheduler,
                steps,
                cfg,
                noise_mode,
                cycler_text,
                overlay_enabled,
            )
            if first_latent is None:
                first_latent = latent
            latent_parts.append(samples)
            image_parts.append(image)

        # Random resolution is resolved independently for each Cycler entry.
        # Preserve every result without distortion by placing unlike sizes on
        # the smallest common canvas before making the picker batch.
        samples = collate_spatial_batch(latent_parts, layout="BCHW")
        image = collate_spatial_batch(image_parts, layout="BHWC")
        latent_out = first_latent.copy()
        batch = image.shape[0]

        # Save preview(s) so the browser has real URLs to render the picker grid.
        #
        # Through save_preview, with a picker-specific high-resolution cap. The
        # picker shows the WHOLE batch at once, so writing these at full
        # resolution meant the browser decoded eight-plus full-size bitmaps in
        # one go the moment the modal opened -- images appear, then the tab
        # locks up. Nothing downstream reads these; they are URLs for the grid
        # and for the node's own strip (ui.db_images), both of which are
        # thumbnails.
        previews = save_preview(image, max_edge=PICKER_PREVIEW_MAX_EDGE)
        if not previews:
            raise RuntimeError(
                "Could not save the picker previews, so there is nothing to "
                "pick from. Set Batch mode to skip the picker."
            )
        # The TRUE dimensions, not the thumbnail's: the picker lays its grid out
        # from this aspect ratio, and it should describe the real image.
        for preview in previews:
            preview["width"] = int(image.shape[2])
            preview["height"] = int(image.shape[1])

        # Ride the sampler own settings out on the pipe so Save Image & Prompt
        # can record how the image was actually made (see its _generation_summary).
        sampler_settings = {
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "steps": int(steps),
            "cfg": float(cfg),
            "noise_mode": (noise_mode or "both").lower(),
        }

        # Base the returned pipe on the first item: model / clip / vae /
        # loader settings are identical across every cycler line (only the
        # prompt text differs), so any one of them is representative.
        base_pipe = pipes[0]

        if should_bypass_picker(batch_mode, overlay_enabled):
            # Batch mode: skip the interactive picker, pass everything through.
            latent_out["samples"] = samples
            pipe = dict(base_pipe)
            pipe["images"] = image
            pipe["db_sampler_settings"] = sampler_settings
            return {
                "ui": {"db_images": previews},
                "result": (pipe, latent_out, image),
            }

        # Push the batch to the node and BLOCK until the user picks inline.
        # One picker for the whole batch, even when it was assembled from
        # many cycler lines above -- see the INPUT_IS_LIST note on the class.
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

        pipe = dict(base_pipe)
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
