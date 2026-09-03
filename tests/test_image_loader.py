import importlib.util
import sys
import io
import json
import tempfile
from pathlib import Path
from types import ModuleType, SimpleNamespace

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def _ensure_image_package():
    parent_name = "dirtybirds_caption_nodes"
    parent = sys.modules.get(parent_name)
    if parent is None:
        parent = ModuleType(parent_name)
        parent.__path__ = [str(ROOT / "nodes")]
        sys.modules[parent_name] = parent
    package_name = f"{parent_name}.image"
    package = sys.modules.get(package_name)
    if package is None:
        package = ModuleType(package_name)
        package.__path__ = [str(ROOT / "nodes" / "image")]
        sys.modules[package_name] = package
    return package_name


def _load_image_module():
    prior = sys.modules.get("folder_paths")
    sys.modules["folder_paths"] = SimpleNamespace(
        get_input_directory=lambda: "",
        get_annotated_filepath=lambda value: value,
        exists_annotated_filepath=lambda value: bool(value),
    )
    try:
        spec = importlib.util.spec_from_file_location(
            _ensure_image_package(),
            ROOT / "nodes" / "image" / "__init__.py",
            submodule_search_locations=[str(ROOT / "nodes" / "image")],
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


def _load_caption_module():
    package_name = _ensure_image_package()
    spec = importlib.util.spec_from_file_location(
        f"{package_name}.captioning", ROOT / "nodes" / "image" / "captioning.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


captioning = _load_caption_module()


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

    image, _mask, _caption, _all_captions = image_loader.DirtyBirdsLoadImage().load(
        image="ignored",
        resize=True,
        resize_mode="custom",
        resize_width=800,
        resize_height=600,
        sharpen="off",
    )

    # Outputs are just image + mask now; verify the resize via the image tensor
    # shape ([B, H, W, C]).
    assert tuple(image.shape[1:3]) == (600, 800)


def test_allow_upscale_is_an_additive_optional_input():
    optional = image_loader.DirtyBirdsLoadImage.INPUT_TYPES()["optional"]
    assert "allow_upscale" in optional
    assert optional["allow_upscale"][1]["default"] is False
    assert optional["sharpen"][1]["default"] == "auto"
    assert optional["caption_mode"][0] == ["off", "single", "batch_folder"]
    assert optional["caption_provider"][0] == [
        "joycaption_local",
        "openai_host",
        "nvidia",
    ]
    assert optional["caption_provider"][1]["default"] == "joycaption_local"
    assert optional["caption_quantization"][1]["default"] == "4bit"
    assert optional["caption_temperature"][1] == {
        "default": 0.6,
        "min": 0.0,
        "max": 2.0,
        "step": 0.05,
    }
    assert image_loader.DirtyBirdsLoadImage.RETURN_NAMES == (
        "image",
        "mask",
        "caption",
        "all_captions",
    )


def test_single_caption_uses_nvidia_chat_completions(monkeypatch):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps(
                {"choices": [{"message": {"content": "a red square"}}]}
            ).encode()

    seen = {}

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["payload"] = json.loads(request.data)
        seen["auth"] = request.headers["Authorization"]
        return Response()

    monkeypatch.setattr(captioning.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(captioning.time, "sleep", lambda *_: None)
    captioning._CACHE.clear()
    captioning._LAST_REQUEST = 0.0

    result = captioning.caption_image(
        Image.new("RGB", (16, 16), "red"), "secret", use_cache=False
    )

    assert result == "a red square"
    assert seen["url"].endswith("/v1/chat/completions")
    assert seen["auth"] == "Bearer secret"
    image_part = seen["payload"]["messages"][0]["content"][1]
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_image_loader_passes_assembled_style_prompt_to_caption_backend(monkeypatch):
    source = Image.new("RGB", (16, 16), "red")
    seen = {}

    def fake_caption(_image, _model, prompt, *_args, **_kwargs):
        seen["prompt"] = prompt
        return "caption"

    monkeypatch.setitem(
        sys.modules, f"{_ensure_image_package()}.captioning", captioning
    )
    monkeypatch.setattr(image_loader, "_open_source", lambda *_: source)
    monkeypatch.setattr(captioning, "caption_image_local", fake_caption)

    image_loader.DirtyBirdsLoadImage().load(
        image="ignored",
        caption_mode="single",
        caption_provider="joycaption_local",
        caption_prompt_type="danbooru",
        caption_options=json.dumps({"clothing": True, "pose": True}),
        caption_unload_after=False,
    )

    assert seen["prompt"].startswith(
        "Describe this image using booru-style comma-separated tags."
    )
    assert "Focus on clothing, pose." in seen["prompt"]


def test_disabled_caption_field_is_explicitly_excluded():
    prompt = captioning.build_caption_prompt(
        "descriptive",
        {"clothing": True, "background": False},
    )

    assert "Focus on clothing." in prompt
    assert "Do not mention or describe background." in prompt


def test_batch_caption_writes_sidecars_and_skips_existing(monkeypatch):
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        Image.new("RGB", (8, 8), "red").save(folder / "A.PNG")
        Image.new("RGB", (8, 8), "blue").save(folder / "b.jpg")
        (folder / "A.txt").write_text("already done", encoding="utf-8")
        calls = []
        monkeypatch.setattr(
            captioning,
            "caption_image",
            lambda image, *args, **kwargs: calls.append(image.getpixel((0, 0)))
            or "new caption",
        )

        results = captioning.caption_directory(folder, "secret", skip_existing=True)

        assert results == [("A.PNG", "already done"), ("b.jpg", "new caption")]
        assert len(calls) == 1
        assert (folder / "b.txt").read_text(encoding="utf-8") == "new caption"


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
    responses = iter(
        [
            _FakeResponse(
                b'<html><meta property="og:image" content="/preview.png"></html>',
                "text/html",
                "https://example.test/page",
            ),
            _FakeResponse(
                image_bytes.getvalue(), "image/png", "https://example.test/preview.png"
            ),
        ]
    )
    requested = []

    def fake_urlopen(request, timeout):
        requested.append(request.full_url)
        return next(responses)

    monkeypatch.setattr(image_loader.urllib.request, "urlopen", fake_urlopen)

    result = image_loader._open_source(None, "HTTPS://example.test/page")

    assert result.size == (32, 24)
    assert requested == [
        "HTTPS://example.test/page",
        "https://example.test/preview.png",
    ]
