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
    assert (
        cycler.append_positive(base, "red dress")
        == "portrait, from load prompt, red dress"
    )
    assert cycler.append_positive(base, "") == base


def test_cycler_line_never_rides_on_the_prompt_string_again():
    """The line reaches the sampler on its own socket, not as string metadata.

    The old design hung it on a str subclass. Any node that rebuilt the prompt
    dropped it — including a no-op .strip(), which always returns a fresh plain
    str — and the text overlay then did nothing, with no error to explain why.
    """
    assert not hasattr(cycler, "CyclerPrompt")
    assert not hasattr(cycler, "with_cycler_metadata")
    assert type(cycler.append_positive("portrait", "red dress")) is str


def test_positives_and_cycler_lines_stay_index_aligned():
    """Prompt Builder emits both as lists; ComfyUI expands them in lockstep, so
    image i must carry the caption from line i."""
    lines = cycler.cycle_text("red dress\nblue coat\ngreen hat")
    positives = [cycler.append_positive("portrait", item) for item in lines]
    assert len(positives) == len(lines)
    for positive, line in zip(positives, lines):
        assert positive.endswith(line)


def test_overlay_updates_each_batch_image_without_resizing():
    images = torch.ones((2, 96, 160, 3), dtype=torch.float32)
    result = overlay.add_text_overlay(images, "first cycler line")
    assert result.shape == images.shape
    assert result.dtype == images.dtype
    assert torch.all(result[:, 0] == 1)
    assert torch.any(result[:, -20:] < 0.9)


def test_overlay_draws_no_backing_bar():
    """Only glyph pixels change — no darkened strip across the image.

    The old version filled a translucent black rectangle behind the caption,
    which hid a band of the picture.
    """
    images = torch.ones((1, 768, 1024, 3), dtype=torch.float32)
    result = overlay.add_text_overlay(images, "red dress")[0]
    band = result[-160:]
    # A full-width bar would darken nearly every pixel in the band. Outlined
    # text touches only a small minority of them.
    darkened = (band.min(dim=2).values < 0.9).float().mean().item()
    assert darkened < 0.25, f"{darkened:.0%} of the caption band was darkened"
    # The left and right edges of that band stay untouched picture.
    assert torch.all(band[:, -1] == 1)


def test_caption_scales_with_image_height_and_never_uses_the_bitmap_fallback():
    """font_size=None must scale, and the face must be a real scalable font.

    DejaVuSans.ttf does not exist on Windows; the old single-font lookup fell
    back to ImageFont.load_default(), an ~8px bitmap face that ignores the size
    argument, so every caption rendered unreadably small.
    """
    assert overlay._caption_size(512, None) < overlay._caption_size(1536, None)
    assert overlay._caption_size(96, None) >= 10
    # An explicit size always wins over the scaled one.
    assert overlay._caption_size(1536, 24) == 24
    small, large = overlay._font(12), overlay._font(96)
    assert small.getlength("AAA") < large.getlength("AAA")


def test_empty_overlay_is_a_noop():
    images = torch.rand((2, 32, 32, 3))
    assert overlay.add_text_overlay(images, "") is images


def test_picker_bypass_is_decided_by_the_buttons_alone():
    """Batch mode or Text Overlay turns the picker off. Nothing else counts.

    The cycler line used to be part of this: an empty Cycler left the picker
    running even with Text Overlay on, while the node's button said "Picker
    off". The button is the control, so the button decides.
    """
    assert overlay.should_bypass_picker(True, False)
    assert overlay.should_bypass_picker(False, True)
    assert overlay.should_bypass_picker(True, True)
    assert not overlay.should_bypass_picker(False, False)
