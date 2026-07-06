"""Tests for the shared path helpers (nodes/utils/paths.py).

Pure stdlib module; loaded by file path. `user_files_dir` resolves relative to
`pack_root()`, so we monkeypatch that to point at a temporary tree and exercise
each resolution branch (directory marker, pointer file, legacy dir, fallback).
"""

import importlib.util
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paths = _load("dirtybirds_paths", "nodes/utils/paths.py")


def test_pack_root_points_at_the_repo_root():
    root = Path(paths.pack_root())
    assert (root / "nodes" / "utils" / "paths.py").is_file()
    assert (root / "nodes").is_dir()


def test_user_files_dir_prefers_a_directory_marker(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "pack_root", lambda: str(tmp_path))
    (tmp_path / "user-files").mkdir()
    assert paths.user_files_dir() == str(tmp_path / "user-files")


def test_pointer_file_with_absolute_path_is_followed(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "pack_root", lambda: str(tmp_path))
    target = tmp_path / "elsewhere"
    target.mkdir()
    (tmp_path / "user-files").write_text(str(target), encoding="utf-8")
    assert paths.user_files_dir() == os.path.abspath(str(target))


def test_pointer_file_with_relative_path_resolves_against_root(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "pack_root", lambda: str(tmp_path))
    (tmp_path / "user-files").write_text("data/mine", encoding="utf-8")
    assert paths.user_files_dir() == os.path.abspath(str(tmp_path / "data" / "mine"))


def test_quoted_pointer_is_stripped(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "pack_root", lambda: str(tmp_path))
    target = tmp_path / "quoted"
    target.mkdir()
    (tmp_path / "user-files").write_text(f'"{target}"', encoding="utf-8")
    assert paths.user_files_dir() == os.path.abspath(str(target))


def test_falls_back_to_legacy_underscore_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "pack_root", lambda: str(tmp_path))
    (tmp_path / "user_files").mkdir()
    assert paths.user_files_dir() == str(tmp_path / "user_files")


def test_final_fallback_is_the_marker_path(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "pack_root", lambda: str(tmp_path))
    # Neither a user-files marker nor a legacy user_files dir exists.
    assert paths.user_files_dir() == str(tmp_path / "user-files")
