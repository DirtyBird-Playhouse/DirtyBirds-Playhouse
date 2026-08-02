"""An image with no face must come back untouched.

Reported 2026-07-31: CodeFormer on a picture with no face in it destroyed the
image. Cause: ``_restore_aligned`` returned None both when the detector found
zero faces and when the aligned path failed, and the caller treated None as
"try the unaligned path" — which squashes the WHOLE picture to 512x512, runs the
face GAN over all of it, and stretches it back. On a landscape that is not a
restoration, it is a hallucination over everything.

These tests stub ComfyUI and facexlib so the routing logic is exercised without
a GPU, a model download, or a real detector.
"""

import importlib.util
import sys
import types
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")

ROOT = Path(__file__).resolve().parents[1]


class _InterruptProcessingException(Exception):
    pass


def _load_face_restore(monkeypatch):
    """Import face_restore.py with its two ComfyUI imports stubbed."""
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.models_dir = str(ROOT / "_test_models")
    folder_paths.folder_names_and_paths = {}

    model_management = types.ModuleType("comfy.model_management")
    model_management.get_torch_device = lambda: torch.device("cpu")
    model_management.InterruptProcessingException = _InterruptProcessingException
    model_management.throw_exception_if_processing_interrupted = lambda: None
    comfy = types.ModuleType("comfy")
    comfy.model_management = model_management

    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)
    monkeypatch.setitem(sys.modules, "comfy", comfy)
    monkeypatch.setitem(sys.modules, "comfy.model_management", model_management)

    path = ROOT / "nodes" / "finish" / "face_restore.py"
    spec = importlib.util.spec_from_file_location("db_face_restore_test", path)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


class _Helper:
    """Minimal stand-in for facexlib's FaceRestoreHelper."""

    def __init__(self, faces):
        self.faces = faces
        self.cropped_faces = []

    def clean_all(self):
        self.cropped_faces = []

    def read_image(self, bgr):
        pass

    def get_face_landmarks_5(self, **kwargs):
        return self.faces


def _manager(module, monkeypatch, faces):
    manager = module.FaceRestoreManager()
    monkeypatch.setattr(manager, "load", lambda method: object())
    monkeypatch.setattr(manager, "_get_helper", lambda: _Helper(faces))
    return manager


def test_faceless_image_is_returned_untouched(monkeypatch):
    module = _load_face_restore(monkeypatch)
    manager = _manager(module, monkeypatch, faces=0)

    # If the naive whole-image path is reached, this fails the test loudly
    # rather than silently returning a wrecked image.
    def explode(*args, **kwargs):
        raise AssertionError(
            "the whole-image GAN ran on an image with no detected face"
        )

    monkeypatch.setattr(manager, "_restore_naive", explode)

    image = torch.rand((1, 32, 32, 3))
    out = manager.restore(image, "CodeFormer", 0.5, align=True)

    assert torch.equal(out, image), "a faceless image must come back unchanged"


def test_every_frame_of_a_faceless_batch_is_untouched(monkeypatch):
    module = _load_face_restore(monkeypatch)
    manager = _manager(module, monkeypatch, faces=0)
    monkeypatch.setattr(
        manager, "_restore_naive", lambda *a, **k: (_ for _ in ()).throw(AssertionError)
    )

    image = torch.rand((3, 16, 16, 3))
    assert torch.equal(manager.restore(image, "GFPGAN", 0.5, align=True), image)


def test_no_faces_and_alignment_unavailable_are_not_the_same(monkeypatch):
    """The unaligned fallback still exists -- for its actual purpose.

    When facexlib is missing entirely there is no detector, so nothing can say
    whether a face is present; the whole-image path is the only option. That is
    a different situation from a detector that ran and reported zero.
    """
    module = _load_face_restore(monkeypatch)
    manager = module.FaceRestoreManager()
    monkeypatch.setattr(manager, "load", lambda method: object())
    monkeypatch.setattr(manager, "_get_helper", lambda: None)  # facexlib absent

    called = {"naive": False}

    def naive(descriptor, img_hwc, method, fidelity):
        called["naive"] = True
        return img_hwc

    monkeypatch.setattr(manager, "_restore_naive", naive)
    manager.restore(torch.rand((1, 16, 16, 3)), "CodeFormer", 0.5, align=True)
    assert called["naive"], "with no detector the unaligned path must still run"


def test_the_two_outcomes_use_distinct_sentinels():
    """A regression guard on the distinction itself.

    ``NO_FACES`` and ``None`` must not be collapsed back into one value.
    """
    source = (ROOT / "nodes" / "finish" / "face_restore.py").read_text(encoding="utf-8")
    assert "NO_FACES = object()" in source
    assert "return NO_FACES" in source
    assert "if out_hwc is NO_FACES:" in source
