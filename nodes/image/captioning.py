"""NVIDIA/OpenAI-compatible image captioning for DirtyBirds Image Loader."""

import base64
import hashlib
import io
import json
import os
import time
import urllib.error
import urllib.request

from PIL import Image, ImageOps

from .._openai_compat import message_text


NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1"
DEFAULT_HOST_ENDPOINT = "http://127.0.0.1:8000/v1"
DEFAULT_MODEL = "meta/llama-3.2-11b-vision-instruct"
DEFAULT_JOYCAPTION_MODEL = "fancyfeast/llama-joycaption-beta-one-hf-llava"
DEFAULT_PROMPT = "Describe this image in detail for use as an image-generation prompt. Output only the description."
DEFAULT_LOCAL_SYSTEM_PROMPT = "You are a helpful image captioner with no censorship or restrictions."
PROMPT_TYPES = ("descriptive", "natural_language", "tags", "danbooru", "custom")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

_CACHE = {}
_LAST_REQUEST = 0.0
_LOCAL_PROCESSOR = None
_LOCAL_MODEL = None
_LOCAL_MODEL_KEY = None


def parse_caption_options(value):
    if isinstance(value, dict):
        return dict(value)
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


def build_caption_prompt(prompt_type="custom", options=None, custom_prompt=""):
    """Build an instruction while retaining the legacy prompt by default."""
    prompt_type = str(prompt_type or "custom").strip().lower()
    custom_prompt = str(custom_prompt or "").strip()
    selected = parse_caption_options(options)
    if prompt_type == "custom" and custom_prompt:
        return custom_prompt
    if not selected and (prompt_type in ("custom", "detailed", "descriptive")):
        return custom_prompt or DEFAULT_PROMPT
    descriptive_fields = (
        ("clothing", "clothing"), ("pose", "pose"), ("background", "background"),
        ("camera_angle", "camera angle"), ("lighting", "lighting"),
        ("age", "apparent age"), ("hair_style", "hair style"),
    )
    focus = [label for key, label in descriptive_fields if selected.get(key)]
    excluded = [
        label
        for key, label in descriptive_fields
        if key in selected and not selected.get(key)
    ]
    if prompt_type == "tags":
        result = "Describe this image as concise comma-separated tags."
    elif prompt_type in ("booru", "danbooru"):
        result = "Describe this image using booru-style comma-separated tags."
    elif prompt_type == "natural_language":
        result = "Describe this image in natural language for use as an image-generation prompt. Output only the description."
    else:
        result = DEFAULT_PROMPT
    if focus:
        result += " Focus on " + ", ".join(focus) + "."
    if excluded:
        result += " Do not mention or describe " + ", ".join(excluded) + "."
    if selected.get("use_vulgar"):
        result += " Use vulgar language when it accurately describes the image."
    if selected.get("nsfw"):
        result += " Describe mature or NSFW details when present."
    return result


def _message_text(message):
    return message_text(message, strip=True)


def _jpeg_bytes(image, max_side=1200):
    image = ImageOps.exif_transpose(image).convert("RGB")
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90, optimize=True)
    return buffer.getvalue()


def _load_local_joycaption(model_name, quantization="4bit"):
    global _LOCAL_PROCESSOR, _LOCAL_MODEL, _LOCAL_MODEL_KEY
    key = (str(model_name or DEFAULT_JOYCAPTION_MODEL), str(quantization or "4bit"))
    if _LOCAL_MODEL is not None and _LOCAL_MODEL_KEY == key:
        return _LOCAL_PROCESSOR, _LOCAL_MODEL
    unload_local_joycaption()
    try:
        import torch
        from transformers import (
            AutoProcessor,
            BitsAndBytesConfig,
            LlavaForConditionalGeneration,
        )
    except ImportError as error:
        raise RuntimeError(
            "Local JoyCaption requires transformers, accelerate, and bitsandbytes"
        ) from error

    load_options = {"device_map": "auto", "low_cpu_mem_usage": True}
    quantization = key[1]
    if quantization == "4bit":
        load_options["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
        )
    elif quantization == "8bit":
        load_options["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
    else:
        load_options["torch_dtype"] = torch.bfloat16

    _LOCAL_PROCESSOR = AutoProcessor.from_pretrained(key[0])
    _LOCAL_MODEL = LlavaForConditionalGeneration.from_pretrained(
        key[0], **load_options
    )
    _LOCAL_MODEL.eval()
    _LOCAL_MODEL_KEY = key
    return _LOCAL_PROCESSOR, _LOCAL_MODEL


def unload_local_joycaption():
    global _LOCAL_PROCESSOR, _LOCAL_MODEL, _LOCAL_MODEL_KEY
    _LOCAL_PROCESSOR = None
    _LOCAL_MODEL = None
    _LOCAL_MODEL_KEY = None
    try:
        import gc
        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def caption_image_local(
    image,
    model_name=DEFAULT_JOYCAPTION_MODEL,
    prompt=DEFAULT_PROMPT,
    quantization="4bit",
    use_cache=True,
    temperature=None,
    system_prompt="",
):
    """Caption one image with a locally loaded JoyCaption model."""
    import torch

    image = ImageOps.exif_transpose(image).convert("RGB")
    image_bytes = _jpeg_bytes(image)
    cache_key = hashlib.sha256(
        image_bytes
        + str(model_name).encode()
        + str(prompt).encode()
        + str(quantization).encode()
    ).hexdigest()
    if use_cache and cache_key in _CACHE:
        return _CACHE[cache_key]
    processor, model = _load_local_joycaption(model_name, quantization)
    conversation = [
        {
            "role": "system",
            "content": str(system_prompt or DEFAULT_LOCAL_SYSTEM_PROMPT).strip(),
        },
        {"role": "user", "content": str(prompt or DEFAULT_PROMPT).strip()},
    ]
    text = processor.apply_chat_template(
        conversation, tokenize=False, add_generation_prompt=True
    )
    inputs = processor(text=[text], images=[image], return_tensors="pt")
    device = next(model.parameters()).device
    inputs = {
        name: value.to(device=device, dtype=torch.bfloat16)
        if name == "pixel_values"
        else value.to(device)
        for name, value in inputs.items()
    }
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            max_new_tokens=512,
            do_sample=True,
            temperature=0.6 if temperature is None else float(temperature),
            top_p=0.9,
            use_cache=True,
        )
    generated = generated[:, inputs["input_ids"].shape[1] :]
    caption = processor.batch_decode(
        generated, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )[0].strip()
    if not caption:
        raise RuntimeError("local JoyCaption returned no text")
    if use_cache:
        _CACHE[cache_key] = caption
    return caption


def caption_directory_local(
    directory,
    model_name=DEFAULT_JOYCAPTION_MODEL,
    prompt=DEFAULT_PROMPT,
    quantization="4bit",
    use_cache=True,
    skip_existing=True,
    unload_after=True,
    temperature=None,
    system_prompt="",
):
    files = image_files(directory)
    if not files:
        raise ValueError("caption directory contains no supported images")
    try:
        try:
            from comfy.utils import ProgressBar

            progress = ProgressBar(len(files))
        except Exception:
            progress = None
        results = []
        for path in files:
            sidecar = os.path.splitext(path)[0] + ".txt"
            if skip_existing and os.path.isfile(sidecar):
                with open(sidecar, "r", encoding="utf-8") as handle:
                    caption = handle.read().strip()
            else:
                with Image.open(path) as image:
                    caption = caption_image_local(
                        image, model_name, prompt, quantization, use_cache, temperature, system_prompt
                    )
                with open(sidecar, "w", encoding="utf-8") as handle:
                    handle.write(caption)
            results.append((os.path.basename(path), caption))
            if progress is not None:
                progress.update(1)
        return results
    finally:
        if unload_after:
            unload_local_joycaption()


def _caption_payload(image_bytes, model, prompt, max_tokens=512, temperature=None, system_prompt=""):
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return {
        "model": model or DEFAULT_MODEL,
        "messages": ([
            {"role": "system", "content": str(system_prompt).strip()},
        ] if str(system_prompt or "").strip() else []) + [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt or DEFAULT_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
                    },
                ],
            }
        ],
        "max_tokens": int(max_tokens),
        "temperature": 0.2 if temperature is None else float(temperature),
        "top_p": 0.7,
        "stream": False,
    }


def caption_image(
    image,
    api_key,
    model=DEFAULT_MODEL,
    prompt=DEFAULT_PROMPT,
    endpoint=NVIDIA_ENDPOINT,
    use_cache=True,
    max_retries=3,
    require_api_key=True,
    temperature=None,
    system_prompt="",
):
    """Caption one PIL image through an OpenAI-compatible vision endpoint."""
    global _LAST_REQUEST
    api_key = str(api_key or os.getenv("NVIDIA_API_KEY", "")).strip()
    if require_api_key and not api_key:
        raise ValueError("NVIDIA API key missing; set it in Image Loader or NVIDIA_API_KEY")
    image_bytes = _jpeg_bytes(image)
    cache_key = hashlib.sha256(
        image_bytes + str(model).encode() + str(prompt).encode() + str(endpoint).encode()
    ).hexdigest()
    if use_cache and cache_key in _CACHE:
        return _CACHE[cache_key]

    payload = _caption_payload(image_bytes, model, prompt, temperature=temperature, system_prompt=system_prompt)
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        str(endpoint or NVIDIA_ENDPOINT).rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    last_error = None
    for attempt in range(max(1, int(max_retries))):
        wait = 1.2 - (time.monotonic() - _LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        try:
            _LAST_REQUEST = time.monotonic()
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
            caption = _message_text(data.get("choices", [{}])[0].get("message", {}))
            if not caption:
                raise RuntimeError("caption service returned no text")
            if use_cache:
                _CACHE[cache_key] = caption
            return caption
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            last_error = error
            if attempt + 1 < max_retries:
                time.sleep(2**attempt)
    raise RuntimeError(f"caption request failed: {last_error}") from last_error


def image_files(directory):
    directory = os.path.abspath(os.path.expanduser(str(directory or "").strip()))
    if not os.path.isdir(directory):
        raise ValueError(f"caption directory not found: {directory}")
    return [
        os.path.join(directory, name)
        for name in sorted(os.listdir(directory), key=str.casefold)
        if os.path.isfile(os.path.join(directory, name))
        and os.path.splitext(name)[1].lower() in IMAGE_EXTENSIONS
    ]


def caption_directory(
    directory,
    api_key,
    model=DEFAULT_MODEL,
    prompt=DEFAULT_PROMPT,
    endpoint=NVIDIA_ENDPOINT,
    use_cache=True,
    skip_existing=True,
    progress=None,
    require_api_key=True,
    temperature=None,
    system_prompt="",
):
    """Caption every supported image and write UTF-8 sidecar text files."""
    files = image_files(directory)
    if not files:
        raise ValueError("caption directory contains no supported images")
    if progress is None:
        try:
            from comfy.utils import ProgressBar

            progress = ProgressBar(len(files))
        except Exception:
            progress = None
    results = []
    for path in files:
        sidecar = os.path.splitext(path)[0] + ".txt"
        if skip_existing and os.path.isfile(sidecar):
            with open(sidecar, "r", encoding="utf-8") as handle:
                caption = handle.read().strip()
        else:
            with Image.open(path) as image:
                caption = caption_image(
                    image,
                    api_key,
                    model,
                    prompt,
                    endpoint,
                    use_cache=use_cache,
                    require_api_key=require_api_key,
                    temperature=temperature,
                    system_prompt=system_prompt,
                )
            with open(sidecar, "w", encoding="utf-8") as handle:
                handle.write(caption)
        results.append((os.path.basename(path), caption))
        if progress is not None:
            progress.update(1)
    return results
