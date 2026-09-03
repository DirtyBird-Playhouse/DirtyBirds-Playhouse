"""Characterization tests for the extracted Sampler picker state."""

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "dirtybirds_pick_state", ROOT / "nodes" / "sampler" / "pick_state.py"
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
PickState = _module.PickState


def setup_function():
    PickState._requests.clear()


def test_pick_state_accepts_only_pending_tokens_and_normalizes_indices():
    PickState.start("token")
    assert PickState.waiting("token")
    assert PickState.deliver("token", ["2", 1, "bad", None])
    assert not PickState.waiting("token")
    assert PickState.take("token") == [2, 1]
    assert PickState.take("token") is None


def test_pick_state_rejects_stale_delivery_and_keeps_empty_selection():
    assert not PickState.deliver("stale", [1])
    PickState.start("empty")
    assert PickState.deliver("empty", None)
    assert PickState.take("empty") == []
