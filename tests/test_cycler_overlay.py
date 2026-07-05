import importlib.util
from pathlib import Path

import torch


ROOT = Path(__file__).resolve().parents[1]


def _load(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cycler = _load("dirtybirds_cycler", "nodes/prompt/cycler.py")
overlay = _load("dirtybirds_overlay", "nodes/sampler/text_overlay.py")


def test_cycle_text_emits_each_line_once_in_source_order():
    assert cycler.cycle_text("red\nblue") == ["red", "blue"]


def test_cycle_text_is_limited_to_50_lines():
    lines = [f"line {index}" for index in range(60)]
    assert cycler.cycle_text("\n".join(lines)) == lines[:50]


def test_trailing_newline_does_not_create_an_extra_run():
    assert cycler.cycle_text("red\nblue\n") == ["red", "blue"]


def test_empty_cycle_executes_once_and_concat_is_preserved():
    assert cycler.cycle_text("") == [""]
    base = cycler.append_positive("portrait", "from load prompt")
    assert cycler.append_positive(base, "red dress") == "portrait, from load prompt, red dress"
    assert cycler.append_positive(base, "") == base


def test_cycler_prompt_is_a_string_with_private_pipe_metadata():
    prompt = cycler.with_cycler_metadata("portrait, red dress", "red dress")
    assert isinstance(prompt, str)
    assert prompt == "portrait, red dress"
    assert prompt.db_cycler_text == "red dress"


def test_overlay_updates_each_batch_image_without_resizing():
    images = torch.ones((2, 96, 160, 3), dtype=torch.float32)
    result = overlay.add_text_overlay(images, "first cycler line")
    assert result.shape == images.shape
    assert result.dtype == images.dtype
    assert torch.all(result[:, 0] == 1)
    assert torch.any(result[:, -20:] < 0.9)


def test_empty_overlay_is_a_noop():
    images = torch.rand((2, 32, 32, 3))
    assert overlay.add_text_overlay(images, "") is images


def test_picker_bypass_requires_batch_or_active_cycler_overlay():
    assert overlay.should_bypass_picker(True, False, "")
    assert overlay.should_bypass_picker(False, True, "caption")
    assert not overlay.should_bypass_picker(False, True, "  ")
    assert not overlay.should_bypass_picker(False, False, "caption")
