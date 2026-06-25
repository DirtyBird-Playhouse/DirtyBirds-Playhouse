"""
DirtyBirds Playhouse — Save — Image + Prompt.

Full clone of Dirty Talk (DirtyBirdsPrompt) that also saves the generated
images to ComfyUI's output folder and appends the positive prompt to a
plain-text prompts file.
"""

import os
import random
import logging

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths

# wildcard_engine lives in the prompt (Dirty Talk) node folder post-consolidation.
from ..prompt.utils.wildcard_engine import load_wildcard_dict, process

logger = logging.getLogger(__name__)

DEFAULT_PROMPTS_FILE = r"C:\Users\mpick\My_AI_Tools\DirtyBirds-Playhouse_User\prompts\My_Prompts.txt"


def _append_prompt(prompts_file, text):
    """Append one trimmed prompt line to prompts_file, creating dirs as needed."""
    text = (text or "").strip()
    if not text:
        return False
    path = os.path.expanduser((prompts_file or "").strip() or DEFAULT_PROMPTS_FILE)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(text + "\n")
    return True


class DirtyBirdsSavePrompt:
    """Save — writes images to output, appends positive prompt to a file."""

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "positive": ("STRING", {"multiline": True, "default": ""}),
                "negative": ("STRING", {"multiline": True, "default": ""}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                                 "control_after_generate": False}),
                "reroll_each_run": ("BOOLEAN", {"default": True}),
                "filename_prefix": ("STRING", {"default": "DirtyBirds"}),
                "prompts_file": ("STRING", {"default": DEFAULT_PROMPTS_FILE}),
            },
            "optional": {
                "concat_positive": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
                "concat_negative": ("STRING", {"multiline": True, "default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "DirtyBirds"

    @classmethod
    def IS_CHANGED(cls, positive="", negative="", seed=0, reroll_each_run=True, **kwargs):
        if reroll_each_run:
            return random.random()
        return (positive, negative, seed)

    def save(self, images, positive="", negative="", reroll_each_run=True, seed=0,
             filename_prefix="DirtyBirds", prompts_file=DEFAULT_PROMPTS_FILE,
             concat_positive="", concat_negative=""):
        if reroll_each_run:
            seed = random.randint(0, 0xffffffffffffffff)

        wd = load_wildcard_dict()
        try:
            pos_out = process(positive, seed, wd)
            neg_out = process(negative, (seed + 1) & 0xffffffffffffffff, wd)
        except Exception as e:
            logger.warning("[DirtyBirds] Save: wildcard processing failed (%s); using raw text", e)
            pos_out, neg_out = positive, negative

        if concat_positive and concat_positive.strip():
            pos_out = concat_positive.strip() + (", " + pos_out if pos_out else "")
        if concat_negative and concat_negative.strip():
            neg_out = concat_negative.strip() + (", " + neg_out if neg_out else "")

        full_output_folder, filename, counter, subfolder, filename_prefix = \
            folder_paths.get_save_image_path(
                filename_prefix, self.output_dir,
                images[0].shape[1], images[0].shape[0])

        results = []
        for batch_number, image in enumerate(images):
            arr = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

            metadata = PngInfo()
            if pos_out:
                metadata.add_text("prompt_positive", pos_out)
            if neg_out:
                metadata.add_text("prompt_negative", neg_out)

            file = f"{filename}_{counter:05}_.png"
            img.save(os.path.join(full_output_folder, file),
                     pnginfo=metadata, compress_level=4)
            results.append({"filename": file, "subfolder": subfolder, "type": self.type})
            counter += 1

        try:
            if _append_prompt(prompts_file, pos_out):
                logger.info("[DirtyBirds] Save: appended prompt to %s", prompts_file)
        except Exception as e:
            logger.exception("[DirtyBirds] Save: could not append prompt: %s", e)

        return {"ui": {"images": results, "db_prompts_md": [pos_out, neg_out]},
                "result": (pos_out, neg_out)}


NODE_CLASS_MAPPINGS = {"DirtyBirdsSavePrompt": DirtyBirdsSavePrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsSavePrompt": "💾 Save — Image + Prompt"}
