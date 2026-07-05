"""
DirtyBirds Playhouse — Pipe routing nodes.

Two utility nodes for moving the DIRTYBIRDS_PIPE around a graph without
re-wiring every socket:

- Pipe Out ("Undress"): unpacks a pipe into its individual parts (model, clip,
  vae, conditioning, latent, image, seed) while passing the pipe straight
  through, so you can tap a component and keep the bundle flowing.
- Pipe In ("Dress"): bundles loose parts back into a pipe. Feed it an existing
  pipe to start from and override only the sockets you wire — anything left
  unconnected keeps the incoming pipe's value.

The pipe is the same Easy_Use-compatible dict the Loader builds:
    model, clip, vae, positive, negative, samples, images, seed, denoise,
    loader_settings.
"""

import copy
import logging

logger = logging.getLogger(__name__)


def _empty_loader_settings():
    """Minimal loader_settings so downstream consumers (sampler markdown,
    pre-sampling nodes) don't KeyError on a hand-built pipe."""
    return {
        "ckpt_name": None,
        "lora_name": None,
        "lora_stack": [],
        "positive": "",
        "negative": "",
        "empty_latent_width": 0,
        "empty_latent_height": 0,
        "batch_size": 1,
        "db_pos_embedding": "",
        "db_neg_embedding": "",
        "db_workflow": "Text2Image",
        "db_dimension": "",
    }


# ---------------------------------------------------------------------------
# Pipe Out — unpack a pipe into its parts
# ---------------------------------------------------------------------------

class DirtyBirdsPipeOut:
    """Unpack a DIRTYBIRDS_PIPE into its components (pipe passes through)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "db_pipe": ("DIRTYBIRDS_PIPE",),
            },
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE", "MODEL", "CLIP", "VAE",
                    "CONDITIONING", "CONDITIONING", "LATENT", "IMAGE", "INT")
    RETURN_NAMES = ("db_pipe", "model", "clip", "vae",
                    "positive", "negative", "latent", "image", "seed")
    FUNCTION = "unpack"
    CATEGORY = "DirtyBirds"

    def unpack(self, db_pipe):
        pipe = db_pipe or {}
        return (
            db_pipe,
            pipe.get("model"),
            pipe.get("clip"),
            pipe.get("vae"),
            pipe.get("positive"),
            pipe.get("negative"),
            pipe.get("samples"),
            pipe.get("images"),
            int(pipe.get("seed", 0) or 0),
        )


# ---------------------------------------------------------------------------
# Pipe In — bundle parts back into a pipe
# ---------------------------------------------------------------------------

class DirtyBirdsPipeIn:
    """Bundle loose parts into a DIRTYBIRDS_PIPE, optionally overriding the
    fields of an existing pipe. Unconnected sockets keep the incoming value."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                # Start from an existing pipe; wired sockets below override it.
                "db_pipe":  ("DIRTYBIRDS_PIPE",),
                "model":    ("MODEL",),
                "clip":     ("CLIP",),
                "vae":      ("VAE",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent":   ("LATENT",),
                "image":    ("IMAGE",),
                "seed":     ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                                     "forceInput": True}),
            },
        }

    RETURN_TYPES = ("DIRTYBIRDS_PIPE",)
    RETURN_NAMES = ("db_pipe",)
    FUNCTION = "pack"
    CATEGORY = "DirtyBirds"

    def pack(self, db_pipe=None, model=None, clip=None, vae=None,
             positive=None, negative=None, latent=None, image=None, seed=None):
        # Shallow-copy the incoming pipe so we don't mutate the upstream dict;
        # loader_settings is copied too so overrides stay local to this branch.
        if db_pipe:
            pipe = dict(db_pipe)
            pipe["loader_settings"] = copy.copy(db_pipe.get("loader_settings")
                                                or _empty_loader_settings())
        else:
            pipe = {
                "model": None, "clip": None, "vae": None,
                "positive": None, "negative": None,
                "samples": None, "images": None,
                "seed": 0, "denoise": 1.0,
                "loader_settings": _empty_loader_settings(),
            }

        # Only overwrite fields whose sockets were actually wired.
        if model is not None:
            pipe["model"] = model
        if clip is not None:
            pipe["clip"] = clip
        if vae is not None:
            pipe["vae"] = vae
        if positive is not None:
            pipe["positive"] = positive
        if negative is not None:
            pipe["negative"] = negative
        if latent is not None:
            pipe["samples"] = latent
        if image is not None:
            pipe["images"] = image
        if seed is not None:
            pipe["seed"] = int(seed)

        return (pipe,)


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS = {
    "DirtyBirdsPipeOut": DirtyBirdsPipeOut,
    "DirtyBirdsPipeIn":  DirtyBirdsPipeIn,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "DirtyBirdsPipeOut": "📤 Undress · Pipe Out",
    "DirtyBirdsPipeIn":  "📥 Dress · Pipe In",
}
