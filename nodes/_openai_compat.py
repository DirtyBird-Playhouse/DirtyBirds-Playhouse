"""Small protocol helpers shared by OpenAI-compatible integrations.

Provider policy stays in each node module. This module owns only response-shape
normalization and the standard ``GET /models`` discovery call.
"""

import json
import re
import urllib.request


_THINK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


def clean_completion(content):
    """Strip inline reasoning blocks and one surrounding Markdown fence."""
    text = _THINK_RE.sub("", content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def message_text(message, *, reasoning_fallback=False, strip=False):
    """Extract text from string or multipart OpenAI-compatible content."""
    message = message or {}
    content = message.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        text = "\n".join(parts)
    else:
        text = ""
    if not text and reasoning_fallback:
        reasoning = message.get("reasoning_content")
        text = reasoning if isinstance(reasoning, str) else ""
    return text.strip() if strip else text


def list_models(endpoint, *, authorization="Bearer lm-studio", timeout=10):
    """Return served model IDs from an OpenAI-compatible ``/models`` route."""
    url = str(endpoint or "").strip().rstrip("/") + "/models"
    headers = {"Authorization": authorization} if authorization else {}
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    return [
        item["id"]
        for item in data.get("data", [])
        if isinstance(item, dict) and item.get("id")
    ]


def resolve_first_model(
    endpoint,
    *,
    default_endpoint,
    empty_message="OpenAI-compatible server returned no served model",
):
    """Resolve the first served model while leaving endpoint policy to callers."""
    models = list_models((endpoint or default_endpoint).strip())
    if models:
        return models[0]
    raise ValueError(empty_message)
