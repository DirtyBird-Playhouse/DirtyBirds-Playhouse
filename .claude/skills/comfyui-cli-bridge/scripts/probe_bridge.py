#!/usr/bin/env python3
"""Probe an already-running ComfyUI Agent Panel CLI bridge.

Validates two things and reports them, without ever launching a ComfyUI server:

  1. The WebSocket bridge accepts a connection AND returns a `models`
     handshake frame (a bare socket connection is treated as failure).
  2. The active ComfyUI HTTP endpoint is reachable, and — optionally — that a
     given custom-node class key is present in /object_info.

Exit codes:
  0  bridge handshake OK, ComfyUI reachable, and (if --node given) node present
  1  probe failed (no handshake, ComfyUI unreachable, or node missing)
  2  bad usage / missing dependency
"""

import argparse
import asyncio
import json
import socket
import sys
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

try:
    import websockets
except ImportError:
    print(
        "ERROR: the 'websockets' package is required. Run this with a Python "
        "environment that has it installed (the ComfyUI venv normally does).",
        file=sys.stderr,
    )
    sys.exit(2)


HANDSHAKE_TIMEOUT = 10  # seconds to wait for the models frame
HTTP_TIMEOUT = 10


def check_port(host: str, port: int) -> bool:
    """Return True if a TCP connection to host:port succeeds."""
    try:
        with socket.create_connection((host, port), timeout=5):
            return True
    except OSError:
        return False


async def probe_bridge(bridge_url: str, backend: str):
    """Connect to the bridge and wait for a `models` handshake frame.

    Returns (ok, backend_name, model_count, detail).
    """
    try:
        async with websockets.connect(bridge_url, open_timeout=8) as ws:
            # Announce the backend so the orchestrator routes us correctly.
            try:
                await ws.send(json.dumps({
                    "type": "hello",
                    "tab_id": f"codex-probe-{uuid.uuid4()}",
                    "title": "Codex bridge probe",
                    "backend": backend,
                }))
            except Exception:
                # Some orchestrators push the handshake unprompted; ignore.
                pass

            deadline = asyncio.get_event_loop().time() + HANDSHAKE_TIMEOUT
            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    return (False, None, None, "no models handshake frame received")
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    return (False, None, None, "no models handshake frame received")

                try:
                    frame = json.loads(raw)
                except (TypeError, ValueError):
                    continue  # not JSON; keep waiting for the handshake

                ftype = frame.get("type") or frame.get("event")
                if ftype == "models" or "models" in frame:
                    models = frame.get("models", frame.get("data", []))
                    count = len(models) if isinstance(models, (list, dict)) else None
                    fbackend = frame.get("backend", backend)
                    return (True, fbackend, count, "models handshake received")
    except Exception as exc:  # noqa: BLE001 - report any connect/handshake failure
        return (False, None, None, f"connection error: {exc}")


def check_comfyui(comfyui_url: str, node: str | None):
    """Return (reachable, node_present_or_None, detail)."""
    info_url = comfyui_url.rstrip("/") + "/object_info"
    if node:
        info_url += "/" + node
    try:
        with urllib.request.urlopen(info_url, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        if node and exc.code == 404:
            return (True, False, f"node '{node}' not found (404)")
        return (False, None, f"HTTP {exc.code} from /object_info")
    except (urllib.error.URLError, OSError) as exc:
        return (False, None, f"ComfyUI unreachable: {exc}")

    if not node:
        return (True, None, "ComfyUI reachable")

    try:
        data = json.loads(body)
    except ValueError:
        return (True, None, "ComfyUI reachable (unparseable /object_info)")

    present = bool(data) and (node in data if isinstance(data, dict) else True)
    detail = (
        f"node '{node}' is registered" if present else f"node '{node}' is NOT registered"
    )
    return (True, present, detail)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bridge", required=True, help="Bridge WS URL, e.g. ws://127.0.0.1:9180")
    ap.add_argument("--comfyui", required=True, help="Active ComfyUI URL, e.g. http://127.0.0.1:8188")
    ap.add_argument("--backend", default="codex", help="Backend name to announce (default: codex)")
    ap.add_argument("--node", default=None, help="Custom node class key to check in /object_info")
    args = ap.parse_args()

    parsed = urlparse(args.bridge)
    if parsed.scheme not in ("ws", "wss") or not parsed.hostname:
        print(f"ERROR: --bridge must be a ws:// or wss:// URL, got {args.bridge!r}", file=sys.stderr)
        return 2
    port = parsed.port or (443 if parsed.scheme == "wss" else 80)

    print(f"Bridge:  {args.bridge}")
    print(f"ComfyUI: {args.comfyui}")
    print(f"Backend: {args.backend}")
    print("-" * 48)

    # 1. TCP port listening.
    listening = check_port(parsed.hostname, port)
    print(f"[{'OK' if listening else 'FAIL'}] TCP {parsed.hostname}:{port} listening")
    if not listening:
        print("\nBridge port is not accepting connections. Is the Agent Panel CLI bridge running?")
        return 1

    # 2. WebSocket handshake.
    ok, backend_name, model_count, detail = asyncio.run(probe_bridge(args.bridge, args.backend))
    print(f"[{'OK' if ok else 'FAIL'}] WebSocket handshake: {detail}")
    if ok:
        print(f"       backend={backend_name}  models={model_count}")
    if not ok:
        print("\nBridge did not complete a models handshake. A bare socket is insufficient.")
        return 1

    # 3. ComfyUI reachability + optional node check.
    reachable, node_present, comfy_detail = check_comfyui(args.comfyui, args.node)
    print(f"[{'OK' if reachable else 'FAIL'}] ComfyUI: {comfy_detail}")
    if not reachable:
        return 1

    if args.node is not None:
        if node_present:
            print(f"[OK] Node '{args.node}' registered.")
        else:
            print(f"[FAIL] Node '{args.node}' is not registered.")
            print(
                "\nRestart the EXISTING ComfyUI process to load the new node. "
                "Do not launch a second ComfyUI server."
            )
            return 1

    print("-" * 48)
    print("Bridge verified: handshake OK, ComfyUI reachable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
