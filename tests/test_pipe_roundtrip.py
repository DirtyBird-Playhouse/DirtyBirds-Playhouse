"""Tests for the Pipe In / Pipe Out routing nodes.

Both modules import only the standard library (copy, logging) plus the shared
socket-type constants, so they load without pulling in ComfyUI. They are loaded
UNDER a stand-in parent package rather than from a bare file path: the modules
use ``from .._pipe_type import ...``, which raises "attempted relative import
beyond top-level package" for a module with no package of its own.
"""

import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = "dirtybirds_nodes"


def _ensure_package():
    """Register nodes/ as a package so relative imports inside it resolve."""
    if PKG in sys.modules:
        return
    package = types.ModuleType(PKG)
    package.__path__ = [str(ROOT / "nodes")]
    sys.modules[PKG] = package


def _load(name, relative_path):
    _ensure_package()
    full = f"{PKG}.{name}"
    spec = importlib.util.spec_from_file_location(full, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[full] = module
    spec.loader.exec_module(module)
    return module


pipe = _load("pipe", "nodes/pipe/__init__.py")


def _full_pipe():
    return {
        "model": "M",
        "clip": "C",
        "vae": "V",
        "positive": "pos",
        "negative": "neg",
        "samples": "lat",
        "images": "img",
        "seed": 7,
        "denoise": 0.5,
        "loader_settings": {"ckpt_name": "ckpt.safetensors", "lora_stack": []},
    }


def test_pack_then_unpack_roundtrips_every_socket():
    packed = pipe.DirtyBirdsPipeIn().pack(db_pipe=_full_pipe())[0]
    out = pipe.DirtyBirdsPipeOut().unpack(packed)
    # unpack order: db_pipe, model, clip, vae, positive, negative, latent, image, seed
    _, model, clip, vae, positive, negative, latent, image, seed = out
    assert (model, clip, vae) == ("M", "C", "V")
    assert (positive, negative) == ("pos", "neg")
    assert (latent, image) == ("lat", "img")
    assert seed == 7


def test_pack_overrides_only_wired_sockets():
    base = _full_pipe()
    packed = pipe.DirtyBirdsPipeIn().pack(db_pipe=base, positive="NEW", seed=99)[0]
    assert packed["positive"] == "NEW"  # wired -> overridden
    assert packed["seed"] == 99
    assert packed["negative"] == "neg"  # unwired -> kept
    assert packed["model"] == "M"


def test_pack_does_not_mutate_incoming_pipe():
    base = _full_pipe()
    before = dict(base)
    before_settings = dict(base["loader_settings"])
    pipe.DirtyBirdsPipeIn().pack(db_pipe=base, positive="NEW")
    assert base == before  # top-level dict untouched
    assert base["loader_settings"] == before_settings  # settings not mutated


def test_pack_with_no_pipe_builds_defaults_with_loader_settings():
    packed = pipe.DirtyBirdsPipeIn().pack()[0]
    assert packed["seed"] == 0
    assert packed["denoise"] == 1.0
    # Downstream consumers must not KeyError on loader_settings.
    assert isinstance(packed["loader_settings"], dict)
    assert packed["loader_settings"]["batch_size"] == 1


def test_unpack_tolerates_missing_seed_and_none_pipe():
    _, *rest, seed = pipe.DirtyBirdsPipeOut().unpack({})
    assert seed == 0
    out_none = pipe.DirtyBirdsPipeOut().unpack(None)
    assert out_none[0] is None  # passthrough of the original arg
    assert out_none[-1] == 0


# ── Easy-Use interoperability ───────────────────────────────────────────────
# The pipe has always been an Easy-Use PIPE_LINE dict in everything but name.
# Only the declared socket type differed, and LiteGraph matches types by exact
# string — so two interchangeable payloads could never be wired together.

EASY_USE_KEYS = {
    "model",
    "clip",
    "vae",
    "positive",
    "negative",
    "samples",
    "images",
    "seed",
    "loader_settings",
}


def test_pipe_outputs_declare_the_easy_use_type():
    assert pipe.PIPE_TYPE == "PIPE_LINE"
    assert pipe.DirtyBirdsPipeIn.RETURN_TYPES == ("PIPE_LINE",)
    assert pipe.DirtyBirdsPipeOut.RETURN_TYPES[0] == "PIPE_LINE"


def test_pipe_inputs_still_accept_graphs_saved_with_the_old_type():
    """Union type, canonical name first. Graphs saved against DIRTYBIRDS_PIPE
    must keep loading; ComfyUI resolves comma-separated unions natively."""
    assert pipe.PIPE_INPUT == "PIPE_LINE,DIRTYBIRDS_PIPE"
    assert pipe.PIPE_INPUT.split(",")[0] == pipe.PIPE_TYPE
    for node in (pipe.DirtyBirdsPipeIn, pipe.DirtyBirdsPipeOut):
        types = node.INPUT_TYPES()
        slot = {**types.get("required", {}), **types.get("optional", {})}["db_pipe"]
        assert slot[0] == pipe.PIPE_INPUT


def test_a_hand_built_pipe_carries_every_easy_use_key():
    built = pipe.DirtyBirdsPipeIn().pack()[0]
    assert EASY_USE_KEYS <= set(built)


def test_an_easy_use_pipe_survives_a_round_trip():
    """A foreign PIPE_LINE — no denoise key, seed explicitly None — must pass
    through Pipe In without losing fields or raising."""
    foreign = {
        "model": "M",
        "clip": "C",
        "vae": "V",
        "positive": "P",
        "negative": "N",
        "samples": "S",
        "images": None,
        "seed": None,
        "loader_settings": {"ckpt_name": "x.safetensors"},
    }
    out = pipe.DirtyBirdsPipeIn().pack(db_pipe=foreign)[0]
    assert EASY_USE_KEYS <= set(out)
    assert out["loader_settings"]["ckpt_name"] == "x.safetensors"
    # Unpacking a null seed must not raise.
    assert pipe.DirtyBirdsPipeOut().unpack(out)[8] == 0
