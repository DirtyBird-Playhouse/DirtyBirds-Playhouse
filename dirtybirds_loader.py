import torch
import json
import os
import logging
from collections import OrderedDict
import folder_paths
from aiohttp import web
from server import PromptServer
from comfy.sd import load_checkpoint_guess_config, load_lora_for_models, VAE
import comfy.utils

from .dirtybirds_manager import get_lora_meta

logger = logging.getLogger(__name__)

_CHECKPOINT_CACHE = {}
_VAE_CACHE = {}

BAKED_VAE = "Baked VAE"


# ---------------------------------------------------------------------------
# Helper: Load a standalone VAE (cached)
# ---------------------------------------------------------------------------

def load_vae(vae_name):
    vae_path = folder_paths.get_full_path("vae", vae_name)
    if not vae_path or not os.path.exists(vae_path):
        logger.warning("[DirtyBirds] VAE not found: %s — using baked VAE", vae_name)
        return None
    if vae_path in _VAE_CACHE:
        return _VAE_CACHE[vae_path]
    sd = comfy.utils.load_torch_file(vae_path)
    vae = VAE(sd=sd)
    _VAE_CACHE[vae_path] = vae
    return vae

# ---------------------------------------------------------------------------
# Helper: Apply LoRA Stack
# ---------------------------------------------------------------------------

def apply_lora_stack(model, clip, lora_stack):
    if not lora_stack:
        return model, clip
    for lora_path, strength_model, strength_clip in lora_stack:
        try:
            lora_data = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model, clip = load_lora_for_models(
                model, clip, lora_data,
                float(strength_model),
                float(strength_clip)
            )
        except Exception as e:
            logger.warning("[DirtyBirds] Failed to load LoRA %s: %s", lora_path, e)
    return model, clip


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/dirtybirds/embeddings")
async def get_embeddings(request):
    files = folder_paths.get_filename_list("embeddings")
    return web.json_response(sorted(files))


@PromptServer.instance.routes.get("/dirtybirds/dimensions")
async def get_dimensions(request):
    json_path = os.path.join(os.path.dirname(__file__), "dimensions.json")
    try:
        with open(json_path, "r") as f:
            data = json.load(f)
        return web.json_response(data)
    except FileNotFoundError:
        logger.error("[DirtyBirds] dimensions.json not found at %s", json_path)
        return web.json_response({"error": "dimensions.json missing"}, status=404)
    except Exception as e:
        logger.error("[DirtyBirds] Failed to read dimensions.json: %s", e)
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/dirtybirds/send-embedding")
async def send_embedding(request):
    data = await request.json()
    node_id  = data.get("node_id")
    slot     = data.get("slot", "positive")   # "positive" or "negative"
    name     = data.get("name", "")
    strength = data.get("strength", 1.0)
    if not node_id:
        return web.json_response({"success": False, "error": "node_id required"}, status=400)
    PromptServer.instance.send_sync("dirtybirds_set_embedding", {
        "node_id":  str(node_id),
        "slot":     slot,
        "name":     name,
        "strength": strength,
    })
    return web.json_response({"success": True})


# ---------------------------------------------------------------------------
# Node Definition
# ---------------------------------------------------------------------------

class DirtyBirdsLoader:

    @classmethod
    def INPUT_TYPES(cls):
        ckpt_list = folder_paths.get_filename_list("checkpoints")
        vae_list  = [BAKED_VAE] + folder_paths.get_filename_list("vae")

        json_path = os.path.join(os.path.dirname(__file__), "dimensions.json")
        try:
            with open(json_path, "r") as f:
                dims_data = json.load(f)
        except Exception as e:
            logger.error("[DirtyBirds] Could not load dimensions.json: %s", e)
            dims_data = {"1024x1024": [1024, 1024]}
        dim_options = list(dims_data.keys())

        return {
            "required": {
                # Hidden – driven by workflow toggle in JS
                "workflow":    (["Text2Image", "Image2Image"], {"default": "Text2Image"}),
                # Checkpoint dropdown
                "ckpt_name":   (ckpt_list,),
                # VAE — defaults to the checkpoint's baked VAE; pick a file to override
                "vae_name":    (vae_list, {"default": BAKED_VAE}),
                # Raw prompt strings — connect from DDT or type directly
                "positive":    ("STRING", {"multiline": True, "default": ""}),
                "negative":    ("STRING", {"multiline": True, "default": ""}),
                # Hidden – resolution pills
                "dimension":   ("STRING", {"default": dim_options[0]}),
                # Hidden – inline LoRA picker (JSON array of selected loras)
                "loras_data":  ("STRING", {"default": "[]"}),
                # Hidden – trigger word chip states (JSON array of { lora, text, active })
                "trigger_words_data": ("STRING", {"default": "[]"}),
                # Batch size for generation (slider 1-5)
                "batch_size":  ("INT", {"default": 1, "min": 1, "max": 5, "step": 1, "display": "slider"}),
            },
            "optional": {
                "image":        ("IMAGE",),
                "lora_stack":   ("LORA_STACK",),   # chain from external stacker
                # Embedding selection — wired from DirtyBirdsEmbeddingLoader or set inline
                "pos_embedding": ("STRING", {"default": ""}),
                "neg_embedding": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES  = ("PIPE_LINE", "BASIC_PIPE", "LATENT")
    RETURN_NAMES  = ("pipe", "basic_pipe", "latent")
    FUNCTION      = "process"
    CATEGORY      = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, dimension="", **kwargs):
        # Force re-execution every run when resolution is randomized so a fresh
        # size is picked each time, rather than caching a single random result.
        if dimension == "__random__":
            import random
            return random.random()
        return dimension

    def process(self, workflow, ckpt_name, vae_name, positive="", negative="",
                dimension="__random__", loras_data="[]", trigger_words_data="[]", batch_size=1,
                image=None, lora_stack=None, pos_embedding="", neg_embedding=""):

        # ── Checkpoint ──────────────────────────────────────────────────────
        ckpt_path = folder_paths.get_full_path("checkpoints", ckpt_name)
        if ckpt_path in _CHECKPOINT_CACHE:
            model, clip, vae = _CHECKPOINT_CACHE[ckpt_path]
        else:
            model, clip, vae = load_checkpoint_guess_config(ckpt_path)[:3]
            _CHECKPOINT_CACHE[ckpt_path] = (model, clip, vae)

        # ── VAE override (default keeps the checkpoint's baked VAE) ──────────
        if vae_name and vae_name != BAKED_VAE:
            loaded = load_vae(vae_name)
            if loaded is not None:
                vae = loaded

        device = model.load_device
        dtype  = model.model_dtype()

        # ── Build combined LoRA stack ────────────────────────────────────────
        combined_stack = []

        try:
            inline_entries = json.loads(loras_data) if isinstance(loras_data, str) else []
        except Exception as e:
            logger.warning("[DirtyBirds] Malformed loras_data JSON, skipping: %s", e)
            inline_entries = []

        for entry in inline_entries:
            if not entry.get("active", True):
                continue
            name = entry.get("name", "").strip()
            if not name:
                continue
            lora_path = folder_paths.get_full_path("loras", name)
            if not lora_path or not os.path.exists(lora_path):
                logger.warning("[DirtyBirds] LoRA not found: %s", name)
                continue
            combined_stack.append((
                lora_path,
                float(entry.get("strength", 1.0)),
                float(entry.get("clip_strength", entry.get("strength", 1.0))),
            ))

        if lora_stack:
            combined_stack.extend(lora_stack)

        if combined_stack:
            model, clip = apply_lora_stack(model, clip, combined_stack)

        # ── Trigger words (appended to positive before encoding) ─────────────
        try:
            tw_entries = json.loads(trigger_words_data) if isinstance(trigger_words_data, str) else []
        except Exception as e:
            logger.warning("[DirtyBirds] Malformed trigger_words_data JSON, skipping: %s", e)
            tw_entries = []

        trigger_terms = []
        for entry in tw_entries:
            if not entry.get("active", True):
                continue
            text = entry.get("text", "").strip()
            if text:
                trigger_terms.append(text)

        trigger_words = ", ".join(trigger_terms)
        if trigger_words:
            positive = (positive + ", " + trigger_words) if positive.strip() else trigger_words

        # ── Encode prompts (after LoRA so clip modifications apply) ──────────
        # Embedding widget value is "name" or "name:strength" (set from Casting Coach).
        def _embed_prefix(raw):
            raw = (raw or "").strip()
            if not raw:
                return ""
            if raw.startswith("!"):
                return ""  # toggled off in UI
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

        pos_prefix = _embed_prefix(pos_embedding)
        neg_prefix = _embed_prefix(neg_embedding)
        pos_text = (pos_prefix + ", " if pos_prefix else "") + positive
        neg_text = (neg_prefix + ", " if neg_prefix else "") + negative

        pos_tokens = clip.tokenize(pos_text)
        pos_cond, pos_pooled = clip.encode_from_tokens(pos_tokens, return_pooled=True)
        positive_cond = [[pos_cond, {"pooled_output": pos_pooled}]]

        neg_tokens = clip.tokenize(neg_text)
        neg_cond, neg_pooled = clip.encode_from_tokens(neg_tokens, return_pooled=True)
        negative_cond = [[neg_cond, {"pooled_output": neg_pooled}]]

        # ── Latent ──────────────────────────────────────────────────────────
        json_path = os.path.join(os.path.dirname(__file__), "dimensions.json")
        try:
            with open(json_path, "r") as f:
                dims_data = json.load(f)
        except Exception:
            dims_data = {"1024x1024": [1024, 1024]}

        if workflow == "Text2Image":
            if dimension == "__random__":
                import random
                dimension = random.choice(list(dims_data.keys())) if dims_data else "1024x1024"
                logger.info("[DirtyBirds] Random resolution selected: %s", dimension)
            width, height = dims_data.get(dimension, [1024, 1024])
            latent_tensor = torch.zeros([batch_size, 4, height // 8, width // 8], device=device, dtype=dtype)
            latent = {"samples": latent_tensor}
        else:
            if image is None:
                raise ValueError("Image input is required for Image 2 Image mode.")
            if not torch.is_tensor(image):
                raise ValueError("Image input must be a tensor.")
            if image.ndim != 4:
                raise ValueError("Image input must be a 4D tensor.")

            # ComfyUI IMAGE tensors are channels-last [B, H, W, C]; VAE.encode
            # expects that layout (it moves channels internally). Do NOT permute
            # to channels-first here or encode will scramble the spatial dims.
            if image.shape[-1] in (3, 4):
                image_bhwc = image[..., :3]
            elif image.shape[1] in (3, 4):
                # Fallback: an already channels-first [B, C, H, W] tensor
                image_bhwc = image.permute(0, 2, 3, 1)[..., :3]
            else:
                raise ValueError("Image tensor must have 3 or 4 channels.")

            image_bhwc = image_bhwc.to(device=device, dtype=dtype)
            latent_tensor = vae.encode(image_bhwc)
            # Tile a single encoded image up to the requested batch size.
            if batch_size > 1 and latent_tensor.shape[0] == 1:
                latent_tensor = latent_tensor.repeat(batch_size, 1, 1, 1)
            latent = {"samples": latent_tensor}
            # Dimensions for loader_settings (channels-last axes)
            height = image_bhwc.shape[1]
            width  = image_bhwc.shape[2]

        # ── PIPE_LINE dict (Easy_Use compatible) ─────────────────────────────
        pipe = {
            # Core – required by all Easy_Use consumers
            "model":    model,
            "clip":     clip,
            "vae":      vae,
            "positive": positive_cond,
            "negative": negative_cond,
            "samples":  latent,
            "images":   None,
            "seed":     0,
            # Loader settings – read by pre-sampling / sampler nodes
            "loader_settings": {
                "ckpt_name":          ckpt_name,
                "vae_name":           vae_name,
                "lora_name":          None,
                "lora_stack":         combined_stack,
                "positive":           positive,
                "negative":           negative,
                "empty_latent_width":  width,
                "empty_latent_height": height,
                "batch_size":         batch_size,
                # DirtyBirds-specific extras (harmless to Easy_Use nodes)
                "db_pos_embedding":   pos_embedding,
                "db_neg_embedding":   neg_embedding,
                "db_workflow":        workflow,
                "db_dimension":       dimension,
            },
        }

        # Standard BASIC_PIPE: (model, clip, vae, positive, negative)
        basic_pipe = (model, clip, vae, positive_cond, negative_cond)

        # Send executed prompt text and external lora names back to the node UI.
        ext_lora_names = [os.path.basename(path) for path, _, _ in (lora_stack or [])]
        return {"ui": {"db_prompts": [positive, negative],
                       "db_lora_stack": ext_lora_names},
                "result": (pipe, basic_pipe, latent)}


# ---------------------------------------------------------------------------
# Mappings
# ---------------------------------------------------------------------------

NODE_CLASS_MAPPINGS        = {"DirtyBirdsLoader": DirtyBirdsLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsLoader": "🍑 DirtyBirds Foreplay — The Setup"}
