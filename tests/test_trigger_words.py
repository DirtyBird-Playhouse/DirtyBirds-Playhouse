"""Tests for the Trigger Words node's trigger-word selection logic.

The module imports only json/logging, so it loads directly from its file path.
The dedup/active-filter logic lives in the pure helper `_active_trigger_words`.
"""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


trigger_words = _load("dirtybirds_trigger_words", "nodes/trigger_words/__init__.py")
active = trigger_words._active_trigger_words


def test_collects_active_words_in_order():
    data = (
        '[{"text": "sks woman", "active": true}, {"text": "vintage", "active": true}]'
    )
    assert active(data) == ["sks woman", "vintage"]


def test_inactive_chips_are_skipped():
    data = '[{"text": "on", "active": true}, {"text": "off", "active": false}]'
    assert active(data) == ["on"]


def test_missing_active_defaults_to_true():
    assert active('[{"text": "kept"}]') == ["kept"]


def test_dedup_is_case_insensitive_and_keeps_first_seen():
    data = '[{"text": "Sunset"}, {"text": "sunset"}, {"text": "SUNSET"}]'
    assert active(data) == ["Sunset"]


def test_whitespace_is_trimmed_and_empties_dropped():
    data = '[{"text": "  neon  "}, {"text": "   "}, {"text": ""}]'
    assert active(data) == ["neon"]


def test_bad_json_and_non_list_yield_empty():
    assert active("not json") == []
    assert active('{"text": "x"}') == []  # object, not a list
    assert active("") == []
    assert active("[]") == []
