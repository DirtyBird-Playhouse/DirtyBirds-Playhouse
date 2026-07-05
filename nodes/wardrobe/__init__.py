"""
DirtyBirds Playhouse — The Wardrobe node (formerly "Pillow Talk").

Pick LoRAs and toggle their trigger words on/off. The active words are pushed
straight into the Dirty Talk positive prompt via the node's "Send to Dirty
Talk" button — no output wiring required.

This node does NOT load LoRA weights — it only manages trigger words. Weight
loading stays in the Loader, so you can mix-and-match trigger-word sets without
touching your checkpoint/LoRA wiring.
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
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "build"
    CATEGORY = "DirtyBirds"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, trigger_words_data="[]"):
        return (trigger_words_data,)

    def build(self, trigger_words_data="[]"):
        try:
            chips = json.loads(trigger_words_data or "[]")
        except Exception as e:
            logger.warning("[DirtyBirds] The Wardrobe: bad trigger_words_data (%s)", e)
            chips = []

        words, seen = [], set()
        for c in chips if isinstance(chips, list) else []:
            if not isinstance(c, dict) or not c.get("active", True):
                continue
            t = str(c.get("text", "")).strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                words.append(t)

        logger.info("[DirtyBirds] The Wardrobe -> %d active trigger words", len(words))
        return ()


NODE_CLASS_MAPPINGS = {"DirtyBirdsWardrobe": DirtyBirdsWardrobe}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsWardrobe": "👗 The Wardrobe · Trigger Words"}
