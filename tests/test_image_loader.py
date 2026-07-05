import importlib.util
import sys
import io
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def _load_image_module():
    prior = sys.modules.get("folder_paths")
    sys.modules["folder_paths"] = SimpleNamespace(
        get_input_directory=lambda: "",
        get_annotated_filepath=lambda value: value,
        exists_annotated_filepath=lambda value: bool(value),
    )
    try:
        spec = importlib.util.spec_from_file_location(
            "dirtybirds_image_loader", ROOT / "nodes" / "image" / "__init__.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if prior is None:
            sys.modules.pop("folder_paths", None)
        else:
            sys.modules["folder_paths"] = prior


image_loader = _load_image_module()


def test_resize_fits_large_images_with_latent_friendly_dimensions():
    source = Image.new("RGB", (1600, 900))
    result = image_loader._resize_to_max(source, 1024)
    assert result.size == (1024, 576)


def test_resize_does_not_upscale_by_default():
    source = Image.new("RGB", (640, 360))
    assert image_loader._resize_to_max(source, 1024) is source


def test_resize_can_upscale_when_explicitly_enabled():
    source = Image.new("RGB", (640, 360))
    result = image_loader._resize_to_max(source, 1024, allow_upscale=True)
    assert result.size == (1024, 576)


def test_custom_resize_uses_exact_latent_friendly_dimensions(monkeypatch):
    source = Image.new("RGB", (640, 360))
    monkeypatch.setattr(image_loader, "_open_source", lambda *_: source)

    image, _, _, width, height = image_loader.DirtyBirdsLoadImage().load(
        image="ignored", resize=True, resize_mode="custom",
        resize_width=800, resize_height=600, sharpen="off",
    )

    assert (width, height) == (800, 600)
    assert tuple(image.shape[1:3]) == (600, 800)


def test_allow_upscale_is_an_additive_optional_input():
    optional = image_loader.DirtyBirdsLoadImage.INPUT_TYPES()["optional"]
    assert optional["allow_upscale"] == ("BOOLEAN", {"default": False})
    assert optional["sharpen"][1]["default"] == "auto"


def test_auto_sharpen_skips_native_size_images():
    source = Image.new("RGB", (64, 64), "gray")
    assert image_loader._sharpen_image(source, "auto", 1.0) is source


def test_sharpen_preserves_alpha_mask():
    source = Image.new("RGBA", (16, 16), (120, 120, 120, 0))
    for x in range(8):
        for y in range(16):
            source.putpixel((x, y), (20, 20, 20, 255))
    alpha = source.getchannel("A").tobytes()

    result = image_loader._sharpen_image(source, "high", 1.0)

    assert result.getchannel("A").tobytes() == alpha


class _FakeResponse:
    def __init__(self, body, content_type, url):
        self._body = body
        self._url = url
        self.headers = SimpleNamespace(
            get=lambda name, default=None: default,
            get_content_type=lambda: content_type,
        )

    def read(self, size=-1):
        return self._body if size < 0 else self._body[:size]

    def geturl(self):
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_webpage_url_resolves_og_image(monkeypatch):
    image_bytes = io.BytesIO()
    Image.new("RGB", (32, 24), "red").save(image_bytes, format="PNG")
    responses = iter([
        _FakeResponse(
            b'<html><meta property="og:image" content="/preview.png"></html>',
            "text/html",
            "https://example.test/page",
        ),
        _FakeResponse(image_bytes.getvalue(), "image/png", "https://example.test/preview.png"),
    ])
    requested = []

    def fake_urlopen(request, timeout):
        requested.append(request.full_url)
        return next(responses)

    monkeypatch.setattr(image_loader.urllib.request, "urlopen", fake_urlopen)

    result = image_loader._open_source(None, "HTTPS://example.test/page")

    assert result.size == (32, 24)
    assert requested == ["HTTPS://example.test/page", "https://example.test/preview.png"]
