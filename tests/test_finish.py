"""Tests for the ✨ Finish node — upscale, face restore, sharpen.

These passes briefly lived inside the Inpainting node. That merge left twelve of
its twenty inputs inert whenever you were not inpainting, so they were split back
out: inpainting is an authored, masked edit; these are global, automatic
finishing passes that need no model, VAE, conditioning or mask.
"""

import importlib.util
import re
import sys
from pathlib import Path

import torch

from _comfy_env import load_node_package

ROOT = Path(__file__).resolve().parents[1]


def _load_module():
    """Load the node as a package so its relative imports resolve.

    ``upscale`` and ``face_restore`` touch ComfyUI's folder_paths at import, so
    without a real ComfyUI they raise — which is why the node guards them. The
    tests below exercise only the parts that stand alone.
    """
    return load_node_package("finish")


def _sharpen():
    """The sharpen module alone — pure torch, no ComfyUI needed."""
    path = ROOT / "nodes" / "finish" / "sharpen.py"
    spec = importlib.util.spec_from_file_location("db_sharpen", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --------------------------------------------------------------------------- #
# Sharpen — a port of blueprints/.glsl/Sharpen_23.frag
# --------------------------------------------------------------------------- #


def test_sharpen_matches_the_blueprint_shader():
    """edges = centre*4 - top - bottom - left - right; out = centre + edges*strength"""
    sharpen = _sharpen()
    image = torch.zeros((1, 5, 5, 3))
    image[0, 2, 2] = 1.0  # single bright pixel

    out = sharpen.sharpen_image(image, 0.5)

    # Centre: 1 + 0.5*(1*4) = 3.0 -> clamped to 1.0
    assert torch.allclose(out[0, 2, 2], torch.ones(3))
    # A 4-neighbour: 0 + 0.5*(0*4 - 1) = -0.5 -> clamped to 0
    assert torch.allclose(out[0, 1, 2], torch.zeros(3))
    # Untouched corner stays put.
    assert torch.allclose(out[0, 0, 0], torch.zeros(3))
    # Strength 0 is an exact no-op, same object semantics as the other passes.
    assert sharpen.sharpen_image(image, 0.0) is image


def _textured(size=96):
    """Noise through a small blur: real detail at ~1-2px, like a render has.

    NOT a linear gradient. A Laplacian is a second derivative and is exactly
    zero on one, so a ramp measures only the border rows where edge-clamping
    breaks the linearity -- an artifact, not the filter working.
    """
    torch.manual_seed(0)
    noise = torch.rand(1, 3, size, size)
    kernel = torch.ones(3, 1, 3, 3) / 9.0
    padded = torch.nn.functional.pad(noise, (1, 1, 1, 1), mode="replicate")
    return torch.nn.functional.conv2d(padded, kernel, groups=3).movedim(-3, -1)


def test_sharpen_strength_increases_the_effect():
    sharpen = _sharpen()
    image = _textured()

    previous = 0.0
    for amount in (0.25, 0.5, 1.0, 2.0):
        moved = (sharpen.sharpen_image(image, amount) - image).abs().mean().item()
        assert moved > previous, f"strength {amount} did not increase the effect"
        previous = moved


def test_sharpen_stencil_widens_with_an_upscale():
    """One strength must mean the same thing with or without an upscale.

    The stencil samples the pixels touching the centre, which is right at native
    resolution and far too fine after one. Detail spans more pixels, neighbours
    are nearly identical, and the filter finds nothing. Measured before this
    fix: at 4x, strength 2.35 moved the image 0.0296 -- weaker than strength
    0.50 with no upscale (0.0724). Reported as "the slider does nothing".
    """
    sharpen = _sharpen()
    base = _textured()
    import torch.nn.functional as F

    upscaled = (
        F.interpolate(base.movedim(-1, -3), scale_factor=4, mode="bicubic")
        .movedim(-3, -1)
        .clamp(0, 1)
    )

    native = (sharpen.sharpen_image(base, 2.35) - base).abs().mean().item()
    unscaled_stencil = (
        (sharpen.sharpen_image(upscaled, 2.35, 1) - upscaled).abs().mean().item()
    )
    scaled_stencil = (
        (sharpen.sharpen_image(upscaled, 2.35, 4) - upscaled).abs().mean().item()
    )

    assert unscaled_stencil < native / 4, "the defect itself: a fixed stencil fades"
    assert scaled_stencil > native * 0.75, "widening it must restore the effect"

    # Spacing 1 is the untouched blueprint behaviour, and is the default.
    assert torch.equal(
        sharpen.sharpen_image(base, 2.35), sharpen.sharpen_image(base, 2.35, 1)
    )


def test_sharpen_border_has_no_halo():
    """GLSL texture() is clamp-to-edge; zero padding would darken the border."""
    sharpen = _sharpen()
    flat = torch.full((1, 8, 8, 3), 0.5)
    # A perfectly flat image has no edges, so sharpening must not change it —
    # least of all at the border, where the padding mode shows up.
    assert torch.allclose(sharpen.sharpen_image(flat, 2.0), flat, atol=1e-6)


def test_finish_needs_no_model_vae_or_conditioning():
    """The whole point of the split: no pipe required, works on any IMAGE."""
    module = _load_module()
    schema = module.DirtyBirdsFinish.INPUT_TYPES()

    assert "db_pipe" not in schema["required"], "the pipe must stay optional"
    for name in ("model", "vae", "positive", "negative", "mask"):
        assert name not in schema["required"]


def test_image_may_arrive_by_socket_or_by_pipe():
    """Neither may be 'required': the pipe alone is a legitimate wiring.

    Marking ``image`` required makes ComfyUI refuse to queue a graph that feeds
    the node only through db_pipe -- "Required input slots have no connection
    feeding them" -- even though the pipe is carrying the image.
    """
    module = _load_module()
    schema = module.DirtyBirdsFinish.INPUT_TYPES()

    assert "image" not in schema["required"]
    assert set(schema["optional"]) == {"image", "db_pipe"}

    node = module.DirtyBirdsFinish()
    from_pipe = torch.rand((1, 8, 8, 3))
    _, out = node.finish(db_pipe={"images": from_pipe})
    assert out is from_pipe, "the pipe's image must be used when none is wired"

    # An explicit wire beats whatever the chain is carrying.
    direct = torch.rand((1, 8, 8, 3))
    _, out = node.finish(image=direct, db_pipe={"images": from_pipe})
    assert out is direct


def test_finish_errors_when_no_image_reaches_it():
    """A silent pass-through of nothing is worse than a named failure."""
    module = _load_module()
    node = module.DirtyBirdsFinish()

    for kwargs in ({}, {"db_pipe": {}}, {"db_pipe": {"images": None}}):
        try:
            node.finish(**kwargs)
        except ValueError as exc:
            assert "image" in str(exc).lower()
        else:
            raise AssertionError(f"no error raised for {kwargs}")


def test_every_pass_is_off_by_default():
    """An unconfigured Finish node passes the image straight through."""
    module = _load_module()
    schema = module.DirtyBirdsFinish.INPUT_TYPES()["required"]

    assert schema["upscale_model"][1]["default"] == module.UPSCALE_OFF
    assert schema["face_restore"][1]["default"] == module.FACE_RESTORE_OFF
    # Sharpen is the exception: it carries the blueprint's own default of 0.5,
    # matching the node it is ported from rather than starting at off.
    assert schema["sharpen"][1]["default"] == module.SHARPEN_DEFAULT == 0.5
    assert schema["sharpen"][1]["max"] == 3.0
    assert schema["sharpen"][1]["step"] == 0.05

    image = torch.rand((1, 8, 8, 3))
    pipe, out = module.DirtyBirdsFinish().finish(image=image)
    assert out is image
    assert pipe["images"] is image


def test_finish_passes_the_pipe_through_without_mutating_it():
    """It can sit mid-chain, but must never edit the caller's pipe."""
    module = _load_module()
    image = torch.rand((1, 8, 8, 3))
    source = {"images": None, "model": object(), "loader_settings": {"keep": True}}

    pipe, out = module.DirtyBirdsFinish().finish(
        image=image, sharpen=0.5, db_pipe=source
    )

    assert pipe is not source
    assert source["images"] is None, "input pipe was mutated"
    assert pipe["model"] is source["model"], "pipe contents must survive"
    assert pipe["loader_settings"] is not source["loader_settings"]
    assert pipe["images"] is out
    assert not torch.equal(out, image), "sharpen should have changed the image"


def test_finish_works_with_no_pipe_at_all():
    module = _load_module()
    image = torch.rand((1, 8, 8, 3))
    pipe, out = module.DirtyBirdsFinish().finish(image=image, sharpen=0.5)
    assert pipe["images"] is out


def test_finish_ui_hides_exactly_the_widgets_the_node_declares():
    """The JS list and the Python schema must not drift apart.

    A name in the JS that the node doesn't declare hides nothing; a widget the
    node declares but the JS misses renders as a stray stock control below the
    panel. Both fail silently, which is why this is checked rather than eyeballed.
    """
    module = _load_module()
    declared = set(module.DirtyBirdsFinish.INPUT_TYPES()["required"]) - {"image"}

    source = (ROOT / "web" / "jsdirtybirds_finish.js").read_text(encoding="utf-8")
    # Whitespace-tolerant: prettier reflows this array between one line and many.
    match = re.search(r"Object\.fromEntries\(\s*\[(.*?)\]\s*\.map\(", source, re.S)
    assert match, "could not find the hideWidget list in jsdirtybirds_finish.js"
    hidden = set(re.findall(r'"([a-z_]+)"', match.group(1)))

    assert (
        hidden == declared
    ), f"JS hides {sorted(hidden)} but the node declares {sorted(declared)}"


def test_finish_ui_sizes_from_a_constant_not_a_measurement():
    """Panel heights are hand-maintained across this pack on purpose: measuring
    content and calling setSize re-triggers the measurement that resized it."""
    source = (ROOT / "web" / "jsdirtybirds_finish.js").read_text(encoding="utf-8")
    assert re.search(r"^const PANEL_H = \d+;", source, re.M)
    assert "getMinHeight: () => PANEL_H" in source
    assert "ResizeObserver" not in source
    assert "computeSize()" not in source


def test_finish_ui_marks_fidelity_inert_for_non_codeformer():
    """codeformer_fidelity does nothing on GFPGAN, so the UI must say so."""
    source = (ROOT / "web" / "jsdirtybirds_finish.js").read_text(encoding="utf-8")
    assert "db-finish-inert" in source
    css = (ROOT / "web" / "css" / "style.css").read_text(encoding="utf-8")
    assert ".db-finish-inert" in css


# --------------------------------------------------------------------------- #
# Before/After compare
# --------------------------------------------------------------------------- #


class _FakePreviewImage:
    """Stand-in for ComfyUI's PreviewImage, which needs a real install."""

    saved = []

    def save_images(self, images):
        _FakePreviewImage.saved.append(images)
        return {
            "ui": {
                "images": [
                    {
                        "filename": f"db_{len(_FakePreviewImage.saved)}.png",
                        "subfolder": "",
                        "type": "temp",
                    }
                ]
            }
        }


def _with_fake_preview(monkeypatch):
    import types

    fake = types.ModuleType("nodes")
    fake.PreviewImage = _FakePreviewImage
    _FakePreviewImage.saved = []
    monkeypatch.setitem(sys.modules, "nodes", fake)
    return fake


def test_no_preview_when_nothing_ran(monkeypatch):
    """All passes off means `after` IS `before` -- two identical temp PNGs per
    run, written to show an unchanged image, is pure cost."""
    module = _load_module()
    _with_fake_preview(monkeypatch)

    result = module.DirtyBirdsFinish().finish(image=torch.rand((1, 8, 8, 3)))

    assert isinstance(result, tuple), "no ui payload should be emitted"
    assert _FakePreviewImage.saved == [], "nothing should have been saved"


def test_preview_sends_a_before_and_an_after(monkeypatch):
    module = _load_module()
    _with_fake_preview(monkeypatch)
    image = torch.rand((1, 8, 8, 3))

    out = module.DirtyBirdsFinish().finish(image=image, sharpen=0.5)

    assert isinstance(out, dict), "a changed image must emit a ui payload"
    ui = out["ui"]
    assert len(ui["db_compare_before"]) == 1
    assert len(ui["db_compare_after"]) == 1
    # Distinct files, or the flip would show the same picture twice.
    assert (
        ui["db_compare_before"][0]["filename"] != ui["db_compare_after"][0]["filename"]
    )
    # The pipe/image return is unchanged by the preview.
    pipe, final = out["result"]
    assert pipe["images"] is final
    assert not torch.equal(final, image)


def test_preview_failure_never_breaks_the_graph(monkeypatch):
    """A preview is a convenience. If saving it raises, the run still returns."""
    module = _load_module()
    import types

    class Exploding:
        def save_images(self, images):
            raise RuntimeError("no temp directory")

    fake = types.ModuleType("nodes")
    fake.PreviewImage = Exploding
    monkeypatch.setitem(sys.modules, "nodes", fake)

    result = module.DirtyBirdsFinish().finish(
        image=torch.rand((1, 8, 8, 3)), sharpen=0.5
    )
    assert isinstance(result, tuple)


def test_caption_names_what_actually_ran():
    module = _load_module()
    image = torch.rand((1, 64, 48, 3))  # H=64, W=48

    caption = module._summarize("4x-UltraSharp", "CodeFormer", 0.5, 0.7, image)
    assert "4x-UltraSharp" in caption
    assert "CodeFormer 0.70" in caption, "fidelity belongs with the method"
    assert "Sharpen 0.50" in caption
    assert "48×64" in caption, "resolution is width×height"

    quiet = module._summarize(
        module.UPSCALE_OFF, module.FACE_RESTORE_OFF, 0, 0.5, image
    )
    assert "Sharpen" not in quiet and "CodeFormer" not in quiet


def test_compare_is_click_to_flip_and_lives_in_the_shared_ui():
    """A split view halves each image; the differences these passes make are too
    small to judge that way. Both images occupy the same box and click flips."""
    shared = (ROOT / "web" / "db_shared.js").read_text(encoding="utf-8")
    assert "export function makeCompareView" in shared
    assert 'addEventListener("click"' in shared

    finish = (ROOT / "web" / "jsdirtybirds_finish.js").read_text(encoding="utf-8")
    assert "installComparePreview" in finish
    # The node module must not build its own compare out of raw elements.
    assert "db-compare" not in finish, "compare markup belongs in db_shared.js"

    css = (ROOT / "web" / "css" / "style.css").read_text(encoding="utf-8")
    for rule in (".db-compare", ".db-compare-img", ".db-compare-state"):
        assert rule in css


def test_compare_payload_keys_match_between_python_and_js():
    """One contract, defined in nodes/_compare.py and read by db_shared.js."""
    python = (ROOT / "nodes" / "_compare.py").read_text(encoding="utf-8")
    js = (ROOT / "web" / "db_shared.js").read_text(encoding="utf-8")
    for key in ("db_compare_before", "db_compare_after", "db_compare_caption"):
        assert key in python, f"{key} not emitted by nodes/_compare.py"
        assert key in js, f"{key} not read by db_shared.js"


def test_both_editing_nodes_share_one_compare_implementation():
    """Finish and Inpainting must not grow private copies of this.

    The Fixer's picker was reimplemented rather than shared and then patched
    until it broke; this is the same shape of feature in two nodes.
    """
    for module in ("finish", "inpaint"):
        source = (ROOT / "nodes" / module / "__init__.py").read_text(encoding="utf-8")
        assert "from .._compare import" in source
        assert "PreviewImage" not in source, "saving previews belongs in _compare.py"

    for module in ("finish", "inpaint"):
        js = (ROOT / "web" / f"jsdirtybirds_{module}.js").read_text(encoding="utf-8")
        assert "installComparePreview" in js
        assert "installCompareExecuted" in js
        assert "makeCompareView" not in js, "build the compare via the installer"


def test_inpainting_no_longer_carries_the_finishing_passes():
    """Guards the split. Inpainting is an edit; these are finishing passes.

    Merged, twelve of Inpainting's twenty inputs did nothing unless you were
    actually inpainting — the same defect that got the Fixer's sampler widgets
    removed.
    """
    inpaint = (ROOT / "nodes" / "inpaint" / "__init__.py").read_text(encoding="utf-8")
    for symbol in ("upscale_image", "sharpen_image", "FaceRestoreManager"):
        assert symbol not in inpaint, f"{symbol} belongs to the Finish node"
    # And the db_workflow coupling that gated it went with them.
    assert "db_workflow" not in inpaint
    for name in ("upscale.py", "face_restore.py", "sharpen.py"):
        assert not (ROOT / "nodes" / "inpaint" / name).exists()
        assert (ROOT / "nodes" / "finish" / name).exists()
