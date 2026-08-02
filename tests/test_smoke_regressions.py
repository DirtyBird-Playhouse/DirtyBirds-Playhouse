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


from _source_text import read_source

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
    loader_source = read_source(REPO_ROOT / "nodes" / "loader" / "__init__.py")
    process_source = loader_source.split("def process(self,", 1)[1]
    assert process_source.count("resolve_seed(seed, seed_mode)") == 1
    assert 'if seed_mode == "random":' not in process_source


def test_seed_max_is_js_safe_so_last_recall_round_trips():
    # Seeds echoed to the browser must fit in a JS Number (<= 2**53-1), or the
    # "Last" recall restores a different integer and reproduces a new image.
    assert seed_util.SEED_MAX == 0x1FFFFFFFFFFFFF
    assert seed_util.SEED_MAX <= (2**53 - 1)


def test_prompt_builder_echoes_and_caps_the_wildcard_seed():
    """The Prompt Builder must roll within the JS-safe range and echo the seed
    it used, so the node UI's "Last" can reproduce the wildcard roll."""
    prompt_source = read_source(REPO_ROOT / "nodes" / "prompt" / "__init__.py")
    assert "random.randint(0, 0x1fffffffffffff)" in prompt_source
    assert "random.randint(0, 0xffffffffffffffff)" not in prompt_source
    assert '"db_seed_used": [seed]' in prompt_source

    prompt_js = read_source(REPO_ROOT / "web" / "jsdirtybirds_prompt.js")
    # The UI captures the echoed seed, not the (unused-in-reroll) widget value.
    assert "message?.db_seed_used?.[0]" in prompt_js
    assert "node._dbLastQueuedSeed = used" in prompt_js


def test_loader_ignores_trigger_words_without_an_active_lora():
    loader_source = read_source(REPO_ROOT / "nodes" / "loader" / "__init__.py")
    assert "active_inline_loras.add(name)" in loader_source
    assert 'if entry.get("lora") not in active_inline_loras:' in loader_source


# --------------------------------------------------------------------------- #
# 2. The GAN face-restore guards moved with the code.
#    face_restore.py now lives at nodes/finish/face_restore.py (the Fixer and
#    the Forbidden Vision vendor tree are retired), and its tests — including the
#    CodeFormer extra-arch duplicate-registration guard — are in
#    tests/test_face_restore.py.
# --------------------------------------------------------------------------- #
