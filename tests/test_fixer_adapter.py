"""Repository-only contract tests for the DirtyBirds Forbidden Vision adapter.

These tests use plain sentinel objects and never import or contact ComfyUI.
"""

import importlib.util
from pathlib import Path
import sys
import types

import pytest
import torch


MODULE_PATH = Path(__file__).parents[1] / "nodes" / "fixer" / "__init__.py"
PACKAGE = "dirtybirds_fixer_test"
vendor = types.ModuleType(f"{PACKAGE}.vendor")
vendor.__path__ = []
processor = types.ModuleType(f"{PACKAGE}.vendor.face_processor_integrated")
processor.ForbiddenVisionFaceProcessorIntegrated = object
sys.modules[vendor.__name__] = vendor
sys.modules[processor.__name__] = processor
SPEC = importlib.util.spec_from_file_location(
    PACKAGE, MODULE_PATH, submodule_search_locations=[str(MODULE_PATH.parent)]
)
FIXER = importlib.util.module_from_spec(SPEC)
sys.modules[PACKAGE] = FIXER
SPEC.loader.exec_module(FIXER)


class CaptureFixer:
    def __init__(self):
        self.call = None

    def process_face_complete(self, **kwargs):
        self.call = kwargs
        return ("fixed", "face", "comparison", "mask")


def make_pipe(**overrides):
    pipe = {
        "model": object(),
        "vae": object(),
        "positive": object(),
        "negative": object(),
        "clip": object(),
        "images": object(),
        "samples": {"samples": object()},
        "seed": 123,
    }
    pipe.update(overrides)
    return pipe


def test_generated_image_matches_direct_source_image_wiring():
    """Use the sampled IMAGE rather than a stale pre-sampling pipe latent."""
    adapter = FIXER.DirtyBirdsFixer()
    capture = CaptureFixer()
    adapter._implementation = capture
    pipe = make_pipe()
    settings = {
        "steps": 10,
        "cfg_scale": 3.0,
        "sampler": "euler_ancestral",
        "scheduler": "sgm_uniform",
        "denoise_strength": 0.4,
    }

    output = adapter.fix(pipe, **settings)

    expected = {
        "model": pipe["model"],
        "vae": pipe["vae"],
        "positive": pipe["positive"],
        "negative": pipe["negative"],
        "clip": pipe["clip"],
        "image": pipe["images"],
        "latent": None,
        "seed": pipe["seed"],
        "face_selection": 0,
        "detection_confidence": 0.75,
        "manual_rotation": "None",
        "enable_pre_upscale": True,
        "upscaler_model": "Fast 4x (Lanczos)",
        "crop_padding": 1.6,
        "processing_resolution": 1024,
        "blend_softness": 8,
        "mask_expansion": 2,
        "sampling_mask_blur_size": 21,
        "sampling_mask_blur_strength": 1.0,
        "enable_color_correction": True,
        "enable_segmentation": True,
        "enable_differential_diffusion": True,
        "enable_lightness_rescue": True,
        "enable_final_refinement": True,
        "offload_models_to_cpu": True,
        "restore_method": "Diffusion (Inpaint)",
        "codeformer_fidelity": 0.5,
        **settings,
    }
    assert capture.call == expected
    assert output == ({**pipe, "images": "fixed"}, "fixed", "face")
    assert pipe["images"] is expected["image"]  # upstream pipe is not mutated


def test_latent_is_only_a_fallback_when_pipe_has_no_image():
    adapter = FIXER.DirtyBirdsFixer()
    capture = CaptureFixer()
    adapter._implementation = capture
    pipe = make_pipe(images=None)

    adapter.fix(pipe, steps=10)

    assert capture.call["image"] is None
    assert capture.call["latent"] is pipe["samples"]


def test_processing_resolution_tracks_input_image():
    class Image:
        shape = (2, 768, 1344, 3)

    adapter = FIXER.DirtyBirdsFixer()
    capture = CaptureFixer()
    adapter._implementation = capture
    adapter.fix(make_pipe(images=Image()), steps=10)

    assert capture.call["processing_resolution"] == 1344


def test_selected_image_batch_is_processed_one_image_at_a_time():
    class BatchCaptureFixer:
        def __init__(self):
            self.batch_sizes = []

        def process_face_complete(self, **kwargs):
            image = kwargs["image"]
            self.batch_sizes.append(image.shape[0])
            comparison = torch.cat([image, image], dim=2)
            return image, image, comparison, torch.zeros(image.shape[:3])

    images = torch.rand(2, 32, 48, 3)
    adapter = FIXER.DirtyBirdsFixer()
    capture = BatchCaptureFixer()
    adapter._implementation = capture

    output = adapter.fix(make_pipe(images=images), steps=10)

    assert capture.batch_sizes == [1, 1]
    assert output[1].shape == images.shape
    assert torch.equal(output[1], images)


@pytest.mark.parametrize("restore_method", ["", None, "Old Saved Value"])
def test_invalid_restore_method_falls_back_to_diffusion(restore_method):
    adapter = FIXER.DirtyBirdsFixer()
    capture = CaptureFixer()
    adapter._implementation = capture

    adapter.fix(make_pipe(), steps=10, restore_method=restore_method)

    assert capture.call["restore_method"] == "Diffusion (Inpaint)"


@pytest.mark.parametrize("codeformer_fidelity", ["", None, "not numeric"])
def test_invalid_codeformer_fidelity_falls_back_to_default(codeformer_fidelity):
    adapter = FIXER.DirtyBirdsFixer()
    capture = CaptureFixer()
    adapter._implementation = capture

    adapter.fix(make_pipe(), steps=10, codeformer_fidelity=codeformer_fidelity)

    assert capture.call["codeformer_fidelity"] == 0.5


def test_codeformer_fidelity_is_forwarded_as_float():
    adapter = FIXER.DirtyBirdsFixer()
    capture = CaptureFixer()
    adapter._implementation = capture

    adapter.fix(make_pipe(), steps=10, codeformer_fidelity="0.75")

    assert capture.call["codeformer_fidelity"] == 0.75


@pytest.mark.parametrize("missing", ["model", "vae", "positive", "negative"])
def test_missing_required_pipe_member_is_reported(missing):
    adapter = FIXER.DirtyBirdsFixer()
    adapter._implementation = CaptureFixer()
    with pytest.raises(ValueError, match=missing):
        adapter.fix(make_pipe(**{missing: None}))
