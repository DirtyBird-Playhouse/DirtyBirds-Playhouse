"""Tests for the GAN face-restore backend in nodes/finish/.

Replaces the parts of the retired test_fixer_adapter.py that still apply. The
Fixer node and the Forbidden Vision vendor tree are gone; GFPGAN / CodeFormer
live in nodes/finish/face_restore.py, driven by the Finish node.

These are behavioural rather than source-grep assertions: the previous versions
only checked that certain lines existed in the file, which would have passed
even if the conversion were applied in the wrong direction.
"""

import importlib.util
import sys
from pathlib import Path

import pytest
import torch

from _comfy_env import ensure_comfy

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "nodes" / "finish" / "face_restore.py"


@pytest.fixture(scope="module")
def face_restore():
    if ensure_comfy() is None:
        pytest.skip("No importable ComfyUI checkout (set COMFYUI_PATH to run).")
    spec = importlib.util.spec_from_file_location("db_face_restore", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeDescriptor:
    """Stands in for a spandrel ImageModelDescriptor, recording what it sees."""

    def __init__(self, echo=None):
        self.seen = []
        self.kwargs = []
        self._echo = echo

    def model(self, x, **kwargs):
        self.seen.append(x.clone())
        self.kwargs.append(kwargs)
        return x if self._echo is None else self._echo

    def __call__(self, x):  # the plain descriptor API (0..1 range)
        self.seen.append(x.clone())
        self.kwargs.append({"__plain_call__": True})
        return x


def test_codeformer_converts_to_the_models_native_range_and_back(face_restore):
    """CodeFormer is trained on [-1,1]; the manager works in [0,1].

    Skipping the conversion made the model shift colour and saturation, so the
    direction matters, not merely that a conversion exists.
    """
    descriptor = FakeDescriptor()
    x = torch.tensor([[[[0.0, 0.5, 1.0]]]])  # [1,1,1,3] in [0,1]

    out = face_restore.FaceRestoreManager._run_codeformer(descriptor, x, 0.7)

    # The model must receive [-1, 1].
    assert torch.allclose(descriptor.seen[0], torch.tensor([[[[-1.0, 0.0, 1.0]]]]))
    # And the result must come back as [0, 1].
    assert torch.allclose(out, x)


def test_codeformer_fidelity_is_passed_as_weight_not_w(face_restore):
    """spandrel_extra_arches' signature is ``forward(x, weight=0.5, **kwargs)``.

    Extra kwargs are silently swallowed, so passing ``w=`` pinned fidelity at
    0.5 with no error — the bug this guards.
    """
    descriptor = FakeDescriptor()
    face_restore.FaceRestoreManager._run_codeformer(
        descriptor, torch.zeros((1, 3, 4, 4)), 0.25
    )
    assert descriptor.kwargs[0] == {"weight": 0.25}


@pytest.mark.parametrize("fidelity,expected", [(-2.0, 0.0), (5.0, 1.0), (0.3, 0.3)])
def test_codeformer_fidelity_is_clamped(face_restore, fidelity, expected):
    descriptor = FakeDescriptor()
    face_restore.FaceRestoreManager._run_codeformer(
        descriptor, torch.zeros((1, 3, 4, 4)), fidelity
    )
    assert descriptor.kwargs[0]["weight"] == pytest.approx(expected)


def test_gfpgan_converts_to_the_models_native_range_and_back(face_restore):
    descriptor = FakeDescriptor()
    x = torch.tensor([[[[0.0, 0.5, 1.0]]]])

    out = face_restore.FaceRestoreManager._run_gfpgan(descriptor, x)

    assert torch.allclose(descriptor.seen[0], torch.tensor([[[[-1.0, 0.0, 1.0]]]]))
    assert torch.allclose(out, x)


def test_a_model_that_will_not_load_returns_the_image_unchanged(face_restore):
    """A missing or broken checkpoint must never break the graph."""
    manager = face_restore.FaceRestoreManager()
    manager.load = lambda method: (_ for _ in ()).throw(RuntimeError("no model"))
    image = torch.rand((1, 8, 8, 3))

    assert manager.restore(image, "CodeFormer") is image


def test_face_restore_carries_no_forbidden_vision_dependency(face_restore):
    """The module must stand alone — that is what let the vendor tree go."""
    imports = [
        line.strip()
        for line in MODULE_PATH.read_text(encoding="utf-8").splitlines()
        if line.startswith(("import ", "from "))
    ]
    # No relative imports at all: nothing left in the package to depend on.
    assert not [line for line in imports if line.startswith("from .")], imports
    # check_for_interruption was the single vendor dependency; it is inlined now.
    assert hasattr(face_restore, "check_for_interruption")
    assert face_restore.FACE_RESTORE_OPTIONS[0] == face_restore.FACE_RESTORE_OFF


def test_extra_arches_registration_survives_a_prior_add(face_restore):
    """ComfyUI registers the extra arches at startup; a second add raises
    DuplicateArchitectureError. That must read as 'already available', not as
    the CodeFormer 'needs the package' false negative."""
    pytest.importorskip("spandrel")
    pytest.importorskip("spandrel_extra_arches")
    from spandrel import MAIN_REGISTRY
    from spandrel_extra_arches import EXTRA_REGISTRY

    try:
        MAIN_REGISTRY.add(*EXTRA_REGISTRY)  # first add (like ComfyUI startup)
    except Exception:
        pass  # already registered by an earlier import — that's the scenario

    face_restore._extra_arches_registered._done = False
    assert face_restore._extra_arches_registered() is True
