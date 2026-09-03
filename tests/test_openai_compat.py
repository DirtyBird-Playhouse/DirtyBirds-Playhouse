"""Characterization tests for shared OpenAI-compatible protocol mechanics."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "dirtybirds_openai_compat", ROOT / "nodes" / "_openai_compat.py"
)
compat = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compat)


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("  plain text  ", "plain text"),
        ("<think>private</think>visible", "visible"),
        ("```text\ncaption\n```", "caption"),
        (None, ""),
    ],
)
def test_clean_completion_preserves_existing_cleanup_rules(content, expected):
    assert compat.clean_completion(content) == expected


def test_message_text_supports_string_and_multipart_content():
    assert compat.message_text({"content": " direct "}) == " direct "
    message = {"content": ["first", {"text": "second"}, {"image_url": {}}]}
    assert compat.message_text(message) == "first\nsecond"
    assert compat.message_text(message, strip=True) == "first\nsecond"


def test_reasoning_is_only_used_when_the_caller_requests_the_fallback():
    message = {"content": [], "reasoning_content": "reasoning"}
    assert compat.message_text(message) == ""
    assert compat.message_text(message, reasoning_fallback=True) == "reasoning"


def test_model_listing_keeps_order_filters_bad_records_and_sends_auth(monkeypatch):
    seen = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(
                {"data": [{"id": "first"}, None, {"name": "bad"}, {"id": "second"}]}
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["auth"] = request.headers["Authorization"]
        seen["timeout"] = timeout
        return Response()

    monkeypatch.setattr(compat.urllib.request, "urlopen", fake_urlopen)
    assert compat.list_models("http://host/v1/") == ["first", "second"]
    assert seen == {
        "url": "http://host/v1/models",
        "auth": "Bearer lm-studio",
        "timeout": 10,
    }


def test_first_model_resolution_preserves_the_caller_owned_error(monkeypatch):
    monkeypatch.setattr(compat, "list_models", lambda _endpoint: [])
    with pytest.raises(ValueError, match="nothing served"):
        compat.resolve_first_model(
            "", default_endpoint="http://default/v1", empty_message="nothing served"
        )
