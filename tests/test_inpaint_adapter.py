import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import torch


ROOT = Path(__file__).resolve().parents[1]


class FakeSampler:
    calls = []

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "sampler_name": (["euler"],),
            "scheduler": (["karras"],),
        }}

    def sample(self, **kwargs):
        self.calls.append(kwargs)
        return ({"samples": kwargs["latent_image"]["samples"] + 1},)


class FakeBlender:
    calls = []

    def blend_images(self, **kwargs):
        self.calls.append(kwargs)
        mask = kwargs["mask"][..., None]
        return (kwargs["image1"] * (1 - mask) + kwargs["image2"] * mask,)


class FakeVAE:
    def encode(self, image):
        return image.permute(0, 3, 1, 2)

    def decode(self, samples):
        return samples.permute(0, 2, 3, 1)


def _load_module(mappings=None):
    prior = sys.modules.get("nodes")
    sys.modules["nodes"] = SimpleNamespace(NODE_CLASS_MAPPINGS=mappings or {})
    try:
        spec = importlib.util.spec_from_file_location(
            "dirtybirds_inpaint", ROOT / "nodes" / "inpaint" / "__init__.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if prior is None:
            sys.modules.pop("nodes", None)
        else:
            sys.modules["nodes"] = prior


def test_inpaint_routes_image_mask_and_pipe_without_mutating_input(monkeypatch):
    module = _load_module({
        "LanPaint_KSampler": FakeSampler,
        "LanPaint_MaskBlend": FakeBlender,
    })
    monkeypatch.setattr(module, "_lanpaint_class", lambda name: {
        "LanPaint_KSampler": FakeSampler,
        "LanPaint_MaskBlend": FakeBlender,
    }[name])
    FakeSampler.calls.clear()
    FakeBlender.calls.clear()
    image = torch.zeros((1, 16, 24, 3))
    mask = torch.zeros((1, 16, 24))
    mask[:, 4:12, 6:18] = 1
    source_pipe = {
        "model": object(), "vae": FakeVAE(),
        "positive": object(), "negative": object(),
        "images": None, "samples": None, "loader_settings": {"keep": True},
    }

    result_pipe, result_image, result_latent = module.DirtyBirdsInpaint().inpaint(
        source_pipe, image, "", 0.5, 42, 30, 5.0, "euler", "karras",
        1.0, 5, "Image First", 9, mask=mask,
    )

    assert result_pipe is not source_pipe
    assert source_pipe["images"] is None
    assert result_pipe["images"] is result_image
    assert result_pipe["samples"] is result_latent
    assert result_pipe["seed"] == 42
    assert torch.equal(FakeSampler.calls[0]["latent_image"]["noise_mask"], mask)
    assert FakeSampler.calls[0]["Inpainting_mode"] == "🖼️ Image Inpainting"
    assert FakeBlender.calls[0]["blend_overlap"] == 9
    assert torch.all(result_image[:, 4:12, 6:18] == 1)
    assert torch.all(result_image[:, :4] == 0)


def test_inpaint_rejects_non_multiple_of_eight_dimensions():
    module = _load_module()
    with pytest.raises(ValueError, match="divisible by 8"):
        module._prepare_inputs(torch.zeros((1, 15, 24, 3)), torch.zeros((1, 15, 24)))


def test_inpaint_rejects_mismatched_mask_dimensions():
    module = _load_module()
    with pytest.raises(ValueError, match="mask size must match"):
        module._prepare_inputs(torch.zeros((1, 16, 24, 3)), torch.zeros((1, 8, 24)))


def test_missing_lanpaint_has_actionable_error(monkeypatch):
    module = _load_module()
    monkeypatch.setitem(sys.modules, "nodes", SimpleNamespace(NODE_CLASS_MAPPINGS={}))
    with pytest.raises(RuntimeError, match="install or enable"):
        module._lanpaint_class("LanPaint_KSampler")


def test_internal_segmentation_creates_mask_when_override_is_absent(monkeypatch):
    module = _load_module({
        "LanPaint_KSampler": FakeSampler,
        "LanPaint_MaskBlend": FakeBlender,
    })
    monkeypatch.setattr(module, "_lanpaint_class", lambda name: {
        "LanPaint_KSampler": FakeSampler,
        "LanPaint_MaskBlend": FakeBlender,
    }[name])
    generated_mask = torch.ones((1, 16, 24))
    seen = {}

    def fake_segment(image, prompt, confidence):
        seen.update(prompt=prompt, confidence=confidence)
        return generated_mask

    monkeypatch.setattr(module, "_segment_image", fake_segment)
    pipe = {
        "model": object(), "vae": FakeVAE(),
        "positive": object(), "negative": object(),
    }
    module.DirtyBirdsInpaint().inpaint(
        pipe, torch.zeros((1, 16, 24, 3)), "jacket", 0.65,
        1, 20, 5.0, "euler", "karras", 1.0, 5, "Image First", 9,
    )

    assert seen == {"prompt": "jacket", "confidence": 0.65}
    assert torch.equal(FakeSampler.calls[-1]["latent_image"]["noise_mask"], generated_mask)
