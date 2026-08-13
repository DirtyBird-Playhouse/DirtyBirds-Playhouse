"""The Inpainting node's live mask preview.

The overlay is pushed mid-run, before sampling, so a SAM3 miss can be cancelled
instead of waited out. That crosses a Python/JS boundary by string keys, so the
keys are pinned here — the compare payload drifted this way once already.
"""

import pathlib
import re

import torch

from _comfy_env import load_node_package

ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE = ROOT / "nodes" / "inpaint" / "__init__.py"
JS = ROOT / "web" / "jsdirtybirds_inpaint.js"


def _constants(source):
    """The event/payload names as literals, however each side spells them."""
    return set(re.findall(r'"(dirtybirds-inpaint-mask|db_inpaint_\w+)"', source))


def test_python_and_js_agree_on_the_event_and_payload_keys():
    python = _constants(NODE.read_text(encoding="utf-8"))
    assert python >= {
        "dirtybirds-inpaint-mask",
        "db_inpaint_images",
        "db_inpaint_caption",
    }
    assert python <= _constants(JS.read_text(encoding="utf-8"))


def test_the_overlay_is_pushed_before_sampling_not_after():
    """Ordering is the whole feature: after the sample it cannot be cancelled."""
    source = NODE.read_text(encoding="utf-8")
    push = source.index("_push_mask_preview(unique_id")
    sample = source.index("sampled = _masked_sample(")
    assert push < sample


def test_the_node_receives_its_own_id_to_address_the_push():
    source = NODE.read_text(encoding="utf-8")
    assert '"hidden": {"unique_id": "UNIQUE_ID"}' in source
    assert "unique_id=None" in source


def test_an_empty_mask_says_so_rather_than_reporting_zero_percent():
    """ "0.0% masked" reads like a number; it needs to read like a problem."""
    _mask_caption = load_node_package("inpaint")._mask_caption

    empty = torch.zeros(1, 8, 8)
    assert "nothing detected" in _mask_caption(empty, "SAM3", "her shirt")

    half = torch.zeros(1, 8, 8)
    half[:, :4] = 1.0
    caption = _mask_caption(half, "SAM3", "her shirt")
    assert "50.0% masked" in caption and "her shirt" in caption


def test_the_overlay_tints_only_inside_the_mask():
    _overlay_mask = load_node_package("inpaint")._overlay_mask

    image = torch.zeros(1, 4, 4, 3)
    mask = torch.zeros(1, 4, 4)
    mask[:, :2] = 1.0
    out = _overlay_mask(image, mask, strength=0.5)

    assert torch.allclose(out[:, 2:], image[:, 2:]), "untouched outside the mask"
    assert float(out[0, 0, 0, 0]) > 0.4, "red channel raised inside the mask"
    assert float(out[0, 0, 0, 1]) == 0.0, "green left alone"
