import importlib.util
from pathlib import Path

import pytest


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
    backend = (ROOT / "nodes" / "loader" / "__init__.py").read_text(encoding="utf-8")

    assert "folder_paths.get_user_directory()" in backend
    assert '"DirtyBirds-Playhouse", "dimensions.json"' in backend
    assert "persist_dimensions(data, _user_dimensions_path())" in backend
    assert "normalize_runtime_dimensions(*wh)" in backend
