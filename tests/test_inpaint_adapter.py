"""Tests for the dependency-free DirtyBirds inpainting node.

Sampling is isolated behind `_core_sample`, which the real node routes to
`comfy.sample`. Tests substitute a lightweight fake so no model/ComfyUI runtime
is needed, and verify: pipe routing without mutation, mask handling, the
refinement (jump-back) loop, and our own feathered blend.
"""

from pathlib import Path

import pytest
import torch

from _comfy_env import load_node_package

ROOT = Path(__file__).resolve().parents[1]


class FakeVAE:
    def encode(self, image):
        return image.permute(0, 3, 1, 2)

    def decode(self, samples):
        return samples.permute(0, 2, 3, 1)


def _load_module():
    """Load the node as a package, not a loose module.

    Loading it flat, or as a top-level package, makes every relative import
    inside it raise -- including ``from .._compare import`` for the shared
    before/after preview.
    """
    return load_node_package("inpaint")


def _fake_core(record):
    """A stand-in for _core_sample: records calls, adds 1 to the latent so the
    output is observably different from the input."""

    def _core(
        model,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        latent,
        denoise,
    ):
        record.append(
            {"seed": seed, "denoise": denoise, "noise_mask": latent.get("noise_mask")}
        )
        return {"samples": latent["samples"] + 1}

    return _core


def _pipe():
    return {
        "model": object(),
        "vae": FakeVAE(),
        "positive": object(),
        "negative": object(),
        "images": None,
        "samples": None,
        "loader_settings": {"keep": True},
    }


def test_inpaint_routes_pipe_and_mask_without_mutating_input(monkeypatch):
    module = _load_module()
    calls = []
    monkeypatch.setattr(module, "_core_sample", _fake_core(calls))

    image = torch.zeros((1, 16, 24, 3))
    mask = torch.zeros((1, 16, 24))
    mask[:, 4:12, 6:18] = 1
    source = _pipe()

    result_pipe, result_image, result_latent = module.DirtyBirdsInpaint().inpaint(
        source,
        image,
        "",
        0.5,
        42,
        30,
        5.0,
        "euler",
        "karras",
        1.0,
        0,
        "Image First",
        1,
        mask=mask,  # 0 refine passes, no feather -> exact
    )

    assert result_pipe is not source
    assert source["images"] is None  # input pipe untouched
    assert result_pipe["images"] is result_image
    assert result_pipe["samples"] is result_latent
    assert result_pipe["seed"] == 42
    assert len(calls) == 1  # base pass only
    assert torch.equal(calls[0]["noise_mask"], mask)
    # Unfeathered blend: fill (ones) inside the mask, base (zeros) outside.
    assert torch.all(result_image[0, 4:12, 6:18] == 1)  # masked region filled
    assert torch.all(result_image[0, 0:4] == 0)  # outside untouched


def test_refinement_adds_passes_and_zero_is_single_pass(monkeypatch):
    module = _load_module()

    calls = []
    monkeypatch.setattr(module, "_core_sample", _fake_core(calls))
    mask = torch.ones((1, 16, 24))
    module.DirtyBirdsInpaint().inpaint(
        _pipe(),
        torch.zeros((1, 16, 24, 3)),
        "",
        0.5,
        7,
        20,
        5.0,
        "euler",
        "karras",
        1.0,
        3,
        "Prompt First",
        9,
        mask=mask,
    )
    # base + 3 annealed refinement passes (1.0*.65=.65, .42, .27 — all >= .05).
    assert len(calls) == 4
    assert [c["seed"] for c in calls] == [7, 8, 9, 10]  # seeds advance
    assert calls[1]["denoise"] < calls[0]["denoise"]  # strength anneals

    calls.clear()
    module.DirtyBirdsInpaint().inpaint(
        _pipe(),
        torch.zeros((1, 16, 24, 3)),
        "",
        0.5,
        7,
        20,
        5.0,
        "euler",
        "karras",
        1.0,
        0,
        "Prompt First",
        9,
        mask=mask,
    )
    assert len(calls) == 1  # no refinement


def test_blend_feathered_composites_and_softens_edges():
    module = _load_module()
    base = torch.zeros((1, 16, 16, 3))
    fill = torch.ones((1, 16, 16, 3))
    mask = torch.zeros((1, 16, 16))
    mask[:, 4:12, 4:12] = 1  # 8x8 region

    hard = module._blend_feathered(base, fill, mask, 1)  # no feather
    assert torch.all(hard[:, 4:12, 4:12] == 1)
    assert torch.all(hard[:, 0, :] == 0)

    soft = module._blend_feathered(base, fill, mask, 5)  # gaussian feather (r=2)
    assert soft[0, 8, 8, 0] == pytest.approx(1.0, abs=1e-3)  # deep center stays filled
    assert 0.0 < soft[0, 3, 8, 0] < 1.0  # just outside edge is partial
    assert soft[0, 0, 0, 0] == pytest.approx(0.0, abs=1e-3)  # corner untouched


def test_grow_mask_dilates_and_shrinks():
    module = _load_module()
    mask = torch.zeros((1, 16, 16))
    mask[:, 6:10, 6:10] = 1  # 4x4 block

    assert torch.equal(module._grow_mask(mask, 0), mask)  # no-op
    grown = module._grow_mask(mask, 2)
    assert grown[0, 4, 6] == 1 and grown[0, 11, 9] == 1  # spread out by 2px
    assert grown.sum() > mask.sum()
    shrunk = module._grow_mask(mask, -1)
    assert shrunk.sum() < mask.sum()  # erosion removes border


def test_inpaint_applies_grow_to_the_sampled_mask(monkeypatch):
    module = _load_module()
    calls = []
    monkeypatch.setattr(module, "_core_sample", _fake_core(calls))
    mask = torch.zeros((1, 16, 24))
    mask[:, 6:10, 8:12] = 1
    module.DirtyBirdsInpaint().inpaint(
        _pipe(),
        torch.zeros((1, 16, 24, 3)),
        "",
        0.5,
        1,
        20,
        5.0,
        "euler",
        "karras",
        1.0,
        0,
        "Image First",
        1,
        grow_mask=3,
        mask=mask,
    )
    used = calls[0]["noise_mask"]
    assert used.sum() > mask.sum()  # grown before sampling
    assert torch.equal(used, module._grow_mask(mask.float(), 3))


def test_internal_segmentation_creates_mask_when_override_absent(monkeypatch):
    module = _load_module()
    calls = []
    monkeypatch.setattr(module, "_core_sample", _fake_core(calls))
    generated = torch.ones((1, 16, 24))
    seen = {}

    def fake_segment(image, prompt, confidence):
        seen.update(prompt=prompt, confidence=confidence)
        return generated

    monkeypatch.setattr(module, "_segment_image", fake_segment)
    module.DirtyBirdsInpaint().inpaint(
        _pipe(),
        torch.zeros((1, 16, 24, 3)),
        "jacket",
        0.65,
        1,
        20,
        5.0,
        "euler",
        "karras",
        1.0,
        0,
        "Image First",
        9,
    )
    assert seen == {"prompt": "jacket", "confidence": 0.65}
    assert torch.equal(calls[-1]["noise_mask"], generated)


def test_missing_mask_and_prompt_is_actionable():
    module = _load_module()
    with pytest.raises(ValueError, match="describe the area to replace"):
        module.DirtyBirdsInpaint().inpaint(
            _pipe(),
            torch.zeros((1, 16, 24, 3)),
            "",
            0.5,
            1,
            20,
            5.0,
            "euler",
            "karras",
            1.0,
            0,
            "Image First",
            9,
        )


def test_prepare_inputs_rejects_non_multiple_of_eight_dimensions():
    module = _load_module()
    with pytest.raises(ValueError, match="divisible by 8"):
        module._prepare_inputs(torch.zeros((1, 15, 24, 3)), torch.zeros((1, 15, 24)))


def test_prepare_inputs_rejects_mismatched_mask_dimensions():
    module = _load_module()
    with pytest.raises(ValueError, match="mask size must match"):
        module._prepare_inputs(torch.zeros((1, 16, 24, 3)), torch.zeros((1, 8, 24)))


def test_sampler_options_are_non_empty():
    module = _load_module()
    samplers, schedulers = module._sampler_options()
    assert samplers and schedulers
    assert isinstance(samplers, list) and isinstance(schedulers, list)
