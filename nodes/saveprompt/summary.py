"""How-it-was-made record for saved images.

Dependency-free (stdlib only) so it stays testable outside ComfyUI, the same
way ``loader/seed_util.py`` and ``loader/dimension_store.py`` are.

Resolution is the reason this exists: with 🎲 Random the size is rolled at run
time, so without a record a picture you liked has no traceable size. Seed,
checkpoint, LoRAs and sampler settings ride along so the whole image can be
reproduced, not just its shape.
"""

import os

_SAMPLER_KEYS = ("sampler_name", "scheduler", "steps", "cfg", "noise_mode")


def _stem(path):
    return os.path.splitext(os.path.basename(str(path)))[0]


def generation_summary(pipe):
    """Machine-readable record of the settings behind one image."""
    if not pipe:
        return {}
    settings = pipe.get("loader_settings") or {}
    sampler = pipe.get("db_sampler_settings") or {}
    summary = {}

    width = settings.get("empty_latent_width")
    height = settings.get("empty_latent_height")
    if width and height:
        summary["resolution"] = f"{int(width)}x{int(height)}"
    if pipe.get("seed") is not None:
        summary["seed"] = int(pipe.get("seed") or 0)
    if settings.get("ckpt_name"):
        summary["checkpoint"] = _stem(settings["ckpt_name"])
    loras = []
    for entry in settings.get("lora_stack") or []:
        try:
            name, strength = entry[0], float(entry[1])
        except (TypeError, ValueError, IndexError):
            continue
        loras.append(f"{_stem(name)}:{strength:.2f}")
    if loras:
        summary["loras"] = loras
    for key in _SAMPLER_KEYS:
        if sampler.get(key) is not None:
            summary[key] = sampler[key]
    if settings.get("db_workflow"):
        summary["workflow"] = str(settings["db_workflow"])
    if pipe.get("denoise") is not None:
        summary["denoise"] = round(float(pipe.get("denoise") or 1.0), 3)
    return summary


def summary_line(summary):
    """One readable line of the same record, for the node UI and PNG text."""
    if not summary:
        return ""
    parts = []
    if summary.get("resolution"):
        parts.append(summary["resolution"].replace("x", " × "))
    if summary.get("seed") is not None:
        parts.append(f"seed {summary['seed']}")
    if summary.get("checkpoint"):
        parts.append(summary["checkpoint"])
    if summary.get("steps") is not None:
        parts.append(f"{summary['steps']} steps")
    if summary.get("cfg") is not None:
        parts.append(f"CFG {float(summary['cfg']):g}")
    if summary.get("sampler_name"):
        sampler = summary["sampler_name"]
        scheduler = summary.get("scheduler") or ""
        parts.append(f"{sampler}/{scheduler}" if scheduler else sampler)
    for lora in summary.get("loras") or []:
        parts.append(f"LoRA {lora}")
    return " · ".join(parts)
