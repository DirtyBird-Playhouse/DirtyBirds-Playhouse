"""Focused platform for variable-resolution Cycler sampler batches."""

import importlib.util
from pathlib import Path

import pytest
import torch

from _source_text import read_source


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "nodes" / "sampler" / "batch_collation.py"
SPEC = importlib.util.spec_from_file_location("dirtybirds_batch_collation", MODULE_PATH)
batch_collation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch_collation)


def test_reported_144_and_176_latent_widths_form_one_batch():
    first = torch.ones((2, 4, 128, 144))
    second = torch.full((2, 4, 128, 176), 2.0)

    result = batch_collation.collate_spatial_batch(
        [first, second], layout="BCHW"
    )

    assert result.shape == (4, 4, 128, 176)
    assert torch.count_nonzero(result[:2] == 1) == first.numel()
    assert torch.all(result[2:] == 2)


def test_mixed_image_aspects_are_centered_without_resizing_content():
    portrait = torch.ones((1, 176, 112, 3))
    landscape = torch.full((1, 112, 176, 3), 0.5)

    result = batch_collation.collate_spatial_batch(
        [portrait, landscape], layout="BHWC"
    )

    assert result.shape == (2, 176, 176, 3)
    assert torch.count_nonzero(result[0] == 1) == portrait.numel()
    assert torch.count_nonzero(result[1] == 0.5) == landscape.numel()
    assert torch.all(result[0, :, :32] == 0)
    assert torch.all(result[0, :, -32:] == 0)
    assert torch.all(result[1, :32] == 0)
    assert torch.all(result[1, -32:] == 0)


def test_equal_shapes_keep_values_and_batch_order():
    first = torch.rand((2, 4, 64, 64))
    second = torch.rand((1, 4, 64, 64))
    result = batch_collation.collate_spatial_batch(
        [first, second], layout="BCHW"
    )
    assert torch.equal(result, torch.cat([first, second], dim=0))


def test_invalid_test_platform_inputs_are_explained():
    with pytest.raises(ValueError, match="empty"):
        batch_collation.collate_spatial_batch([], layout="BCHW")
    with pytest.raises(ValueError, match="unsupported"):
        batch_collation.collate_spatial_batch([torch.zeros((1, 1))], layout="XY")


def test_variable_size_collation_is_at_the_cross_cycler_boundary():
    source = read_source(ROOT / "nodes" / "sampler" / "__init__.py")
    sample_one = source.split("def _sample_one(", 1)[1].split("def sample(", 1)[0]
    sample_many = source.split("def sample(", 1)[1]
    assert "collate_spatial_batch" not in sample_one
    assert 'collate_spatial_batch(latent_parts, layout="BCHW")' in sample_many
    assert 'collate_spatial_batch(image_parts, layout="BHWC")' in sample_many
