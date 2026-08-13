"""
DirtyBirds Playhouse — 👗 Trigger Words node.

Pick LoRAs and toggle their trigger words on/off. The active words are pushed
straight into the Prompt Builder positive prompt by the node's "Send to Prompt
Builder" button — no output wiring required.

That push happens entirely in the browser (web/jsdirtybirds_trigger_words.js),
so this module has no outputs and nothing downstream depends on it. It exists so
the chip state has a widget to live in and a node to be saved with; ``build``
only reports what is active. Do not add a STRING output here expecting the words
to travel by wire — they never have.

This node does NOT load LoRA weights — it only manages trigger words. Weight
loading stays in the Loader, so you can mix-and-match trigger-word sets without
touching your checkpoint/LoRA wiring.
"""

import json
import logging

logger = logging.getLogger(__name__)


def _active_trigger_words(trigger_words_data="[]"):
    """Parse the chip JSON and return active trigger words, de-duplicated
    case-insensitively and preserving first-seen order. Bad JSON yields []."""
    try:
        chips = json.loads(trigger_words_data or "[]")
    except Exception as e:
        logger.warning("[DirtyBirds] Trigger Words: bad trigger_words_data (%s)", e)
        chips = []

    words, seen = [], set()
    for c in chips if isinstance(chips, list) else []:
        if not isinstance(c, dict) or not c.get("active", True):
            continue
        t = str(c.get("text", "")).strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            words.append(t)
    return words


class DirtyBirdsTriggerWords:
    """Hold the LoRA trigger-word chip state; the UI sends it to Prompt Builder."""

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
        words = _active_trigger_words(trigger_words_data)
        logger.info("[DirtyBirds] Trigger Words -> %d active trigger words", len(words))
        return ()


NODE_CLASS_MAPPINGS = {"DirtyBirdsTriggerWords": DirtyBirdsTriggerWords}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsTriggerWords": "👗 Trigger Words"}
