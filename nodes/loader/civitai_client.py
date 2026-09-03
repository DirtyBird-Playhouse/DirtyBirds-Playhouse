"""Civitai lookup and download transport for the loader library backend."""

import hashlib
import json
import logging
import os
import re
import urllib.request


logger = logging.getLogger(__name__)
USER_AGENT = "DirtyBirds-Playhouse/1.0"


def sha256_file(path, chunk=65536):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def lookup_by_hash(sha256):
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{sha256}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except Exception as error:
        logger.debug(
            "[DirtyBirds] Civitai lookup failed (%s...): %s", sha256[:8], error
        )
        return None


def model_url(model_id, version_id=None, nsfw=False):
    """Build a Civitai model page URL. Mature models live on civitai.red."""
    if not model_id:
        return ""
    domain = "civitai.red" if nsfw else "civitai.com"
    url = f"https://{domain}/models/{model_id}"
    if version_id:
        url += f"?modelVersionId={version_id}"
    return url


def download_file(url, dest):
    """Best-effort preview download; failures remain non-fatal."""
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=15) as response:
            with open(dest, "wb") as handle:
                handle.write(response.read())
        return True
    except Exception as error:
        logger.debug("[DirtyBirds] Download failed %s: %s", url, error)
        return False


def api_get(url, token=None):
    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read())


def parse_ids(url):
    """Extract ``(model_id, version_id)`` from Civitai page/API URLs."""
    model_id = None
    version_id = None
    match = re.search(r"/models/(\d+)", url)
    if match:
        model_id = match.group(1)
    match = re.search(r"[?&]modelVersionId=(\d+)", url)
    if match:
        version_id = match.group(1)
    match = re.search(r"/api/download/models/(\d+)", url)
    if match:
        version_id = match.group(1)
    return model_id, version_id


def resolve_download(url, token):
    """Return ``(download_url, filename, model_type, version_id)``."""
    model_id, version_id = parse_ids(url)
    if not model_id and not version_id:
        raise ValueError("Could not find a model id in that URL")

    if version_id:
        version = api_get(
            f"https://civitai.com/api/v1/model-versions/{version_id}", token
        )
    else:
        model = api_get(f"https://civitai.com/api/v1/models/{model_id}", token)
        versions = model.get("modelVersions") or []
        if not versions:
            raise ValueError("Model has no downloadable versions")
        version = versions[0]
        version_id = str(version.get("id"))

    model_type = ((version.get("model") or {}).get("type") or "").lower()
    files = version.get("files") or []
    chosen = next((item for item in files if item.get("primary")), None)
    if chosen is None and files:
        chosen = files[0]
    if not chosen:
        raise ValueError("Version has no files")

    download_url = chosen.get("downloadUrl") or (
        f"https://civitai.com/api/download/models/{version_id}"
    )
    filename = chosen.get("name") or f"model_{version_id}.safetensors"
    return download_url, filename, model_type, version_id


def stream_download(url, dest, token, chunk=1 << 20):
    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    temporary = dest + ".part"
    request = urllib.request.Request(url, headers=headers)
    total = 0
    with urllib.request.urlopen(request, timeout=60) as response:
        with open(temporary, "wb") as handle:
            while True:
                block = response.read(chunk)
                if not block:
                    break
                handle.write(block)
                total += len(block)
    os.replace(temporary, dest)
    return total
