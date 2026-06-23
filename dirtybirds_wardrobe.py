"""
DirtyBirds Playhouse — Wardrobe node ("The Outfit").

Pick LoRAs, toggle their trigger words on/off, and emit the active ones as a
comma-separated STRING you wire into a prompt (the Script node's
`concat_positive`) or the Loader's `positive` input.

This node does NOT load LoRA weights — it only emits trigger words. Weight
loading stays in the Loader, so you can mix-and-match "outfits" (trigger-word
sets) without touching your checkpoint/LoRA wiring.
"""

import json
import logging

logger = logging.getLogger(__name__)


class DirtyBirdsWardrobe:
    """Emit selected LoRA trigger words as a prompt-ready STRING."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # JSON list of {lora, text, active} chips, managed by the node's
                # JS UI. Hidden in the UI; the styled chip panel drives it.
                "trigger_words_data": ("STRING", {"default": "[]"}),
            },
            "optional": {
                # Prepend upstream text so this can sit inline in a prompt chain.
                "text_in": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("trigger_words",)
    FUNCTION = "build"
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, trigger_words_data="[]", text_in=""):
        return (trigger_words_data, text_in)

    def build(self, trigger_words_data="[]", text_in=""):
        try:
            chips = json.loads(trigger_words_data or "[]")
        except Exception as e:
            logger.warning("[DirtyBirds] Wardrobe: bad trigger_words_data (%s)", e)
            chips = []

        words, seen = [], set()
        for c in chips if isinstance(chips, list) else []:
            if not isinstance(c, dict) or not c.get("active", True):
                continue
            t = str(c.get("text", "")).strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                words.append(t)

        out = ", ".join(words)
        if text_in and text_in.strip():
            out = text_in.strip() + (", " + out if out else "")

        logger.info("[DirtyBirds] Wardrobe -> %d active trigger words", len(words))
        return (out,)


NODE_CLASS_MAPPINGS = {"DirtyBirdsWardrobe": DirtyBirdsWardrobe}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsWardrobe": "👗 Wardrobe — The Outfit"}
