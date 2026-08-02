import importlib.util
from pathlib import Path

import pytest

from _source_text import read_source

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "nodes" / "loader" / "dimension_store.py"
SPEC = importlib.util.spec_from_file_location("dirtybirds_dimension_store", MODULE_PATH)
dimension_store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dimension_store)


def test_dimensions_require_latent_safe_multiples_of_eight():
    with pytest.raises(ValueError, match="divisible by 8"):
        dimension_store.validate_dimensions({"unsafe": [1025, 1024]})


def test_user_dimensions_override_packaged_defaults_without_modifying_them(tmp_path):
    default_path = tmp_path / "package" / "dimensions.json"
    user_path = tmp_path / "user" / "DirtyBirds-Playhouse" / "dimensions.json"
    default_path.parent.mkdir()
    default_path.write_text('{"default": [1024, 1024]}', encoding="utf-8")

    saved = dimension_store.save_dimensions({"portrait": [832, 1216]}, str(user_path))

    assert saved == {"portrait": [832, 1216]}
    assert dimension_store.load_dimensions(str(default_path), str(user_path)) == saved
    assert default_path.read_text(encoding="utf-8") == '{"default": [1024, 1024]}'


def test_invalid_user_file_falls_back_to_packaged_defaults(tmp_path):
    default_path = tmp_path / "dimensions.json"
    user_path = tmp_path / "user-dimensions.json"
    default_path.write_text('{"square": [1024, 1024]}', encoding="utf-8")
    user_path.write_text("not json", encoding="utf-8")

    assert dimension_store.load_dimensions(str(default_path), str(user_path)) == {
        "square": [1024, 1024]
    }


def test_legacy_runtime_dimensions_are_clamped_and_snapped():
    assert dimension_store.normalize_runtime_dimensions(1025, 9000) == (1024, 8192)
    assert dimension_store.normalize_runtime_dimensions("bad", 31) == (1024, 64)


def test_loader_routes_use_comfyui_user_data_for_custom_dimensions():
    backend = read_source(ROOT / "nodes" / "loader" / "__init__.py")

    assert "folder_paths.get_user_directory()" in backend
    assert '"DirtyBirds-Playhouse", "dimensions.json"' in backend
    assert "persist_dimensions(data, _user_dimensions_path())" in backend
    assert "normalize_runtime_dimensions(*wh)" in backend


PRESETS = {
    "square": [1024, 1024],
    "wide": [1344, 768],
    "tall": [768, 1344],
}


def test_random_sentinels_are_recognized_and_plain_labels_are_not():
    assert dimension_store.is_random("__random__")
    assert dimension_store.is_random("__random_portrait__")
    assert not dimension_store.is_random("1024x1024")
    assert not dimension_store.is_random("")


def test_shape_filtered_random_only_picks_that_shape():
    for _ in range(20):
        assert (
            dimension_store.pick_random_dimension("__random_portrait__", PRESETS)
            == "tall"
        )
        assert (
            dimension_store.pick_random_dimension("__random_landscape__", PRESETS)
            == "wide"
        )
        assert (
            dimension_store.pick_random_dimension("__random_square__", PRESETS)
            == "square"
        )


def test_unfiltered_random_can_reach_every_preset():
    picks = {
        dimension_store.pick_random_dimension("__random__", PRESETS) for _ in range(200)
    }
    assert picks == set(PRESETS)


def test_random_falls_back_when_the_requested_shape_has_no_presets():
    only_square = {"square": [1024, 1024]}
    assert (
        dimension_store.pick_random_dimension("__random_portrait__", only_square)
        == "square"
    )
    assert dimension_store.pick_random_dimension("__random__", {}) == "1024x1024"


def test_random_sentinels_agree_between_backend_and_ui():
    """The widget stores these strings; both sides must read the same set."""
    store = read_source(ROOT / "nodes" / "loader" / "dimension_store.py")
    loader = read_source(ROOT / "nodes" / "loader" / "__init__.py")
    frontend = read_source(ROOT / "web" / "jsdirtybirds.js")

    for sentinel in (
        "__random__",
        "__random_portrait__",
        "__random_landscape__",
        "__random_square__",
    ):
        assert sentinel in store
        assert sentinel in frontend

    # Every random shape must force re-execution and re-roll, not just the
    # unfiltered one — that was the original "stuck resolution" shape of bug.
    assert "is_random_dimension(dimension) or seed_mode ==" in loader
    assert "pick_random_dimension(dimension, dims_data)" in loader
    assert 'dimension == "__random__"' not in loader


def test_loader_reports_the_resolution_it_actually_used():
    """🎲 Random picks server-side, so the UI can only show it if it's echoed."""
    backend = read_source(ROOT / "nodes" / "loader" / "__init__.py")
    frontend = read_source(ROOT / "web" / "jsdirtybirds.js")

    # Echoed after the roll and after the multiple-of-8 snap, so the caption
    # shows the size the latent was really built at.
    assert '"db_dimension_used"' in backend
    assert backend.index("normalize_runtime_dimensions(*wh)") < backend.index(
        '"db_dimension_used"'
    )
    assert "db_dimension_used" in frontend
    assert "_dbLastDimension" in frontend
