"""Characterization tests for the loader library's extracted boundaries."""

import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name):
    path = ROOT / "nodes" / "loader" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"dirtybirds_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


store_module = _load("library_store")
civitai = _load("civitai_client")


class RecordingLogger:
    def __init__(self):
        self.warnings = []

    def warning(self, message):
        self.warnings.append(message)


def test_json_store_round_trips_indented_utf8_json():
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "settings.json"
        logger = RecordingLogger()
        store = store_module.JsonStore(path, logger, "save failed")
        value = {"token": "sëcret", "nested": {"enabled": True}}
        store.save(value)
        assert store.load() == value
        assert json.loads(path.read_text(encoding="utf-8")) == value
        assert logger.warnings == []


def test_json_store_preserves_empty_fallback_for_missing_or_invalid_files():
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "cache.json"
        store = store_module.JsonStore(path, RecordingLogger(), "save failed")
        assert store.load() == {}
        path.write_text("not json", encoding="utf-8")
        assert store.load() == {}


def test_json_store_keeps_save_failures_non_fatal():
    with tempfile.TemporaryDirectory() as directory:
        logger = RecordingLogger()
        store = store_module.JsonStore(
            Path(directory) / "missing" / "settings.json", logger, "save failed"
        )
        assert store.save({"value": 1}) is None
        assert len(logger.warnings) == 1
        assert "[DirtyBirds] save failed:" in logger.warnings[0]


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://civitai.com/models/123/name", ("123", None)),
        ("https://civitai.red/models/123?modelVersionId=456", ("123", "456")),
        ("https://civitai.com/api/download/models/789", ("789", "789")),
        ("https://example.com/no-id", (None, None)),
    ],
)
def test_civitai_id_parsing_preserves_supported_url_shapes(url, expected):
    assert civitai.parse_ids(url) == expected


def test_civitai_model_links_preserve_mature_domain_and_version():
    assert civitai.model_url(None) == ""
    assert civitai.model_url(12) == "https://civitai.com/models/12"
    assert (
        civitai.model_url(12, 34, nsfw=True)
        == "https://civitai.red/models/12?modelVersionId=34"
    )


def test_download_resolution_prefers_the_primary_file(monkeypatch):
    monkeypatch.setattr(
        civitai,
        "api_get",
        lambda _url, _token: {
            "id": 456,
            "model": {"type": "LORA"},
            "files": [
                {"name": "fallback.safetensors"},
                {
                    "name": "primary.safetensors",
                    "primary": True,
                    "downloadUrl": "https://download/primary",
                },
            ],
        },
    )
    assert civitai.resolve_download(
        "https://civitai.com/models/123?modelVersionId=456", "token"
    ) == (
        "https://download/primary",
        "primary.safetensors",
        "lora",
        "456",
    )


def test_file_hashing_is_chunk_independent():
    payload = b"dirtybirds" * 100
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "model.bin"
        path.write_bytes(payload)
        assert civitai.sha256_file(path, chunk=7) == hashlib.sha256(payload).hexdigest()
