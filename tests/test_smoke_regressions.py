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
import sys
import types
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


def test_trigger_word_sets_are_kept_whole():
    """A trained-words entry is one trigger set, not a list of separate tags.

    "FingerInside, fingering, ass, anal fingering" is a phrase the LoRA was
    trained on. Splitting it on the comma gave a tidy chip per word but lost the
    grouping: a LoRA shipping an "ass" set and a "pussy" set collapsed into one
    pile, and ticking words from both produced a combination the LoRA never saw.
    """
    from _comfy_env import ensure_comfy

    ensure_comfy()
    root = Path(__file__).resolve().parents[1]
    path = root / "nodes" / "loader" / "library_backend.py"
    package_name = "db_loader_backend_test"
    package = types.ModuleType(package_name)
    package.__path__ = [str(path.parent)]
    sys.modules[package_name] = package
    spec = importlib.util.spec_from_file_location(
        f"{package_name}.library_backend", path
    )
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)

    sets = backend._split_trigger_words(
        [
            "FingerInside, fingering, ass, anal fingering",
            "FingerInside, fingering, pussy, pussy fingering",
        ]
    )
    assert sets == [
        "FingerInside, fingering, ass, anal fingering",
        "FingerInside, fingering, pussy, pussy fingering",
    ]

    # Spacing is tidied inside a set, blanks dropped, duplicate sets removed.
    assert backend._split_trigger_words(["a ,  b ,, c", "a, b, c"]) == ["a, b, c"]
    assert backend._split_trigger_words([]) == []


# --------------------------------------------------------------------------- #
# 3. LoRA trigger words must not echo the filename
# --------------------------------------------------------------------------- #
def test_lora_trigger_words_never_come_from_ss_output_name():
    """`ss_output_name` is kohya's training OUTPUT FILENAME, not a trigger word.

    It sat in the safetensors-header fallback list, so a LoRA with no sidecar and
    no Civitai entry got a "trigger word" that was just its own filename minus
    the hash suffix ("Bondage_garrote-0aae" -> "Bondage_garrote"). Every such chip
    arrives ticked ON and is appended to the positive prompt.

    Measured against comfyui-lora-manager over all 270 installed LoRAs: it fired
    on 116. After removal, the two agree exactly — 124 matching, 0 disagreements,
    and neither side holds words the other lacks.
    """
    source = read_source(REPO_ROOT / "nodes" / "loader" / "library_backend.py")
    # The quoted form is the field lookup. The name still appears unquoted in the
    # comment above that list explaining why it was removed.
    assert '"ss_output_name"' not in source
    # The genuine trained-word header fields stay.
    for field in ("activation text", "trigger_phrase", "modelspec.trigger_phrase"):
        assert field in source


# --------------------------------------------------------------------------- #
# 4. Prompt Enhance talks to LM Studio only
# --------------------------------------------------------------------------- #
def test_prompt_enhance_has_no_backend_switch():
    """KoboldCpp was removed: LM Studio is the only backend.

    The node carried a `backend` widget and a two-button switcher whose second
    option was never used. Removing it also removes the whole notion of a
    per-backend endpoint/label, so nothing has to stay in step between the two
    sides any more.
    """
    backend = read_source(REPO_ROOT / "nodes" / "prompt_enhance" / "__init__.py")
    frontend = read_source(REPO_ROOT / "web" / "jsdirtybirds_prompt_enhance.js")
    css = read_source(REPO_ROOT / "web" / "css" / "style.css")

    for source in (backend, frontend, css):
        assert "kobold" not in source.lower()
    # No backend selector on either side.
    assert '"backend"' not in backend
    assert "BACKENDS" not in backend
    assert "_resolve_backend" not in backend
    assert "currentBackend" not in frontend
    assert "db-enhance-backend-row" not in css
    # The single endpoint survives, named once per side.
    assert 'DEFAULT_ENDPOINT = "http://127.0.0.1:1234/v1"' in backend
    assert "const LM_STUDIO" in frontend


# --------------------------------------------------------------------------- #
# 5. Trigger Words chips must keep toggling after "Send to Prompt Builder"
# --------------------------------------------------------------------------- #
def test_trigger_words_send_does_not_orphan_the_chip_handlers():
    """`activeText()` must not re-parse the chip JSON.

    `restoreChips()` rebinds `chips` to freshly parsed objects. Every chip's
    click/dblclick/contextmenu handler closed over the PREVIOUS objects, so once
    `activeText()` ran the handlers were mutating entries the array no longer
    held and `serialize()` wrote the untouched new array back. Observed live:
    chips toggled true->false->true normally, then after one press of "Send to
    Prompt Builder" every chip stopped toggling for the rest of the session,
    with no error.

    `chips` is already authoritative — every mutation calls serialize() — so the
    restore was never needed here. renderChips() still restores, because it
    rebuilds the handlers against the new objects in the same breath.
    """
    source = read_source(REPO_ROOT / "web" / "jsdirtybirds_trigger_words.js")
    active = source.split("function activeText()", 1)[1].split("}", 1)[0]
    assert "restoreChips()" not in active
    # The one safe caller keeps it: it re-renders immediately afterwards.
    render = source.split("function renderChips()", 1)[1]
    assert "restoreChips();" in render.split("panel.innerHTML", 1)[0]


# --------------------------------------------------------------------------- #
# 6. The "Custom Nodes" folder button must open ComfyUI's custom_nodes
# --------------------------------------------------------------------------- #
def test_custom_nodes_folder_comes_from_comfyui_not_from_our_parent():
    r"""`dirname(pack_root())` is only custom_nodes when the pack lives there.

    This install (and the layout AGENTS.md documents) has
    custom_nodes/DirtyBirds-Playhouse as a SYMLINK to a separate source
    workspace, so pack_root() resolves to the workspace and its parent is an
    unrelated folder. Measured live: the button opened
    C:\Users\mpick\My_AI_Tools instead of ...\ComfyUI\custom_nodes.
    """
    source = read_source(REPO_ROOT / "nodes" / "folders" / "__init__.py")
    assert 'folder_paths.get_folder_paths("custom_nodes")' in source
    # The old derivation must not be what the allow-list returns.
    allow = source.split("def _known_folders()", 1)[1]
    assert "os.path.dirname(_NODE_DIR)" not in allow


# --------------------------------------------------------------------------- #
# 7. Narrowing a combo must not orphan values already saved in workflows
# --------------------------------------------------------------------------- #
def test_loader_accepts_a_vae_name_the_combo_no_longer_offers():
    """`vae_name` used to be a hardcoded ``[BAKED_VAE, ""]``.

    Graphs saved against that build serialized ``vae_name: ""`` — invisibly,
    because the widget is hidden. Rebuilding the list from the real models/vae
    listing removed ``""`` from it, and ComfyUI's combo check then refused to
    queue those graphs at all: "Value not in list".

    Naming `vae_name` in VALIDATE_INPUTS' signature is what makes ComfyUI skip
    its built-in check for that ONE input (execution.py gates the whole
    value_not_in_list block on `x not in validate_function_inputs`). Verified
    against the real validator: '' / 'Baked VAE' / a real VAE / a deleted VAE all
    validate, while bad ckpt_name, workflow and seed_mode are still rejected.
    """
    import inspect

    source = read_source(REPO_ROOT / "nodes" / "loader" / "__init__.py")
    assert "def VALIDATE_INPUTS(cls, vae_name" in source
    # Built from the real listing; the blank option must NOT come back, since it
    # is what created the orphan value in the first place. Matched on the combo
    # declaration itself — the retired literal is still quoted in the docstring
    # above, which is exactly where it belongs.
    assert '"vae_name": ([BAKED_VAE, *_vae_options()]' in source
    assert '"vae_name": ([BAKED_VAE, ""]' not in source
    # process() must still treat a blank/unknown name as "use the baked VAE".
    assert 'if vae_name and vae_name != BAKED_VAE:' in source
