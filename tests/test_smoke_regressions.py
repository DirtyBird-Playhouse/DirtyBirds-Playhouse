"""Regression guards for bugs fixed this session, so they can't come back.

1. Loader "stuck seed": random mode never re-rolled the sampling seed, so every
   generation was identical. Guarded via the dependency-free ``resolve_seed``.
2. Fixer CodeFormer "package missing": ComfyUI already registers
   ``spandrel_extra_arches`` at startup, so the Fixer's second registration
   raised ``DuplicateArchitectureError`` and CodeFormer wrongly reported the
   package as absent. Guarded by re-running registration after a prior add.
"""

import importlib.util
import random
from pathlib import Path

import pytest

from _comfy_env import ensure_comfy


REPO_ROOT = Path(__file__).resolve().parents[1]


# --------------------------------------------------------------------------- #
# 1. Loader seed re-roll (no ComfyUI needed — resolve_seed is dependency-free)
# --------------------------------------------------------------------------- #

def _load_seed_util():
    path = REPO_ROOT / "nodes" / "loader" / "seed_util.py"
    spec = importlib.util.spec_from_file_location("db_seed_util", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


seed_util = _load_seed_util()


def test_fixed_mode_preserves_the_seed():
    assert seed_util.resolve_seed(12345, "fixed") == 12345


def test_fixed_mode_coerces_to_int():
    assert seed_util.resolve_seed("999", "fixed") == 999


def test_random_mode_rerolls_a_fresh_seed():
    # A fixed widget value of 7 must NOT be what gets sampled in random mode.
    got = seed_util.resolve_seed(7, "random", rng=random.Random(0))
    assert got != 7
    assert 0 <= got <= seed_util.SEED_MAX


def test_random_mode_varies_between_runs():
    rng = random.Random(1234)
    seeds = {seed_util.resolve_seed(7, "random", rng=rng) for _ in range(20)}
    # Overwhelmingly likely to be 20 distinct values; certainly more than one.
    assert len(seeds) > 1, "random seed mode produced a constant seed"


def test_loader_resolves_random_seed_only_once():
    """Keep the loader's displayed/returned seed identical to the sampled seed."""
    loader_source = (REPO_ROOT / "nodes" / "loader" / "__init__.py").read_text(
        encoding="utf-8"
    )
    process_source = loader_source.split("def process(self,", 1)[1]
    assert process_source.count("resolve_seed(seed, seed_mode)") == 1
    assert 'if seed_mode == "random":' not in process_source


def test_loader_ignores_trigger_words_without_an_active_lora():
    loader_source = (REPO_ROOT / "nodes" / "loader" / "__init__.py").read_text(
        encoding="utf-8"
    )
    assert "active_inline_loras.add(name)" in loader_source
    assert 'if entry.get("lora") not in active_inline_loras:' in loader_source


# --------------------------------------------------------------------------- #
# 2. Fixer CodeFormer extra-arch registration tolerates a prior registration
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def face_restore():
    if ensure_comfy() is None:
        pytest.skip("No importable ComfyUI checkout (set COMFYUI_PATH to run).")
    try:
        import spandrel  # noqa: F401
        import spandrel_extra_arches  # noqa: F401
    except Exception:
        pytest.skip("spandrel / spandrel_extra_arches not installed.")
    # Load face_restore.py inside a synthetic parent package so its
    # ``from .utils import ...`` relative import resolves against the vendor dir.
    import sys
    import types

    vendor_dir = REPO_ROOT / "nodes" / "fixer" / "vendor"
    pkg_name = "db_fixer_vendor"
    if pkg_name not in sys.modules:
        pkg = types.ModuleType(pkg_name)
        pkg.__path__ = [str(vendor_dir)]
        sys.modules[pkg_name] = pkg
    spec = importlib.util.spec_from_file_location(
        f"{pkg_name}.face_restore", vendor_dir / "face_restore.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_extra_arches_registration_survives_a_prior_add(face_restore):
    """Simulate ComfyUI having registered the extra arches at startup, then
    assert the Fixer still reports them available instead of crashing on the
    duplicate add (the CodeFormer 'needs the package' false negative)."""
    from spandrel import MAIN_REGISTRY
    from spandrel_extra_arches import EXTRA_REGISTRY

    try:
        MAIN_REGISTRY.add(*EXTRA_REGISTRY)  # first add (like ComfyUI startup)
    except Exception:
        pass  # already registered by an earlier import — that's the scenario

    # Reset the module's one-shot memo so the guard logic actually runs.
    if hasattr(face_restore._extra_arches_registered, "_done"):
        del face_restore._extra_arches_registered._done

    assert face_restore._extra_arches_registered() is True
