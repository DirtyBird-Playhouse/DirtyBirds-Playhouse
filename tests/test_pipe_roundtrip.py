"""Tests for the Pipe In / Pipe Out routing nodes.

Both modules import only the standard library (copy, logging), so they load
directly from their file path without importing the whole node package.
"""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pipe = _load("dirtybirds_pipe", "nodes/pipe/__init__.py")


def _full_pipe():
    return {
        "model": "M", "clip": "C", "vae": "V",
        "positive": "pos", "negative": "neg",
        "samples": "lat", "images": "img",
        "seed": 7, "denoise": 0.5,
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
    assert packed["positive"] == "NEW"       # wired -> overridden
    assert packed["seed"] == 99
    assert packed["negative"] == "neg"       # unwired -> kept
    assert packed["model"] == "M"


def test_pack_does_not_mutate_incoming_pipe():
    base = _full_pipe()
    before = dict(base)
    before_settings = dict(base["loader_settings"])
    pipe.DirtyBirdsPipeIn().pack(db_pipe=base, positive="NEW")
    assert base == before                    # top-level dict untouched
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
    assert out_none[0] is None               # passthrough of the original arg
    assert out_none[-1] == 0
