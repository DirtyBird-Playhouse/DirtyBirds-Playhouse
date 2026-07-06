---
name: comfyui-cli-bridge
description: Connect Codex to an already-running ComfyUI Agent Panel CLI bridge, verify the WebSocket handshake and active ComfyUI node registry, and avoid launching duplicate ComfyUI servers. Use when the user mentions a ComfyUI bridge URL such as ws://127.0.0.1:9180, says the panel or CLI is connected, asks Codex to connect to the running canvas, or needs confirmation that newly installed custom nodes are registered.
---

# ComfyUI CLI Bridge

Connect to the user's existing ComfyUI process. Never start another ComfyUI server merely to test connectivity.

## Workflow

1. Treat the bridge URL shown by the user or Agent Panel as authoritative. Do not substitute a provider's conventional port.
2. Confirm the TCP port is listening.
3. Run `scripts/probe_bridge.py` with the supplied bridge URL, `--backend codex`, and the active ComfyUI URL.
4. Require both a successful WebSocket connection and a `models` handshake frame. A bare socket connection is insufficient.
5. Query `<comfyui-url>/object_info` when checking whether a custom node is loaded. Use `--node <class-key>` for a focused check.
6. If a new Python node is absent, tell the user a restart of their existing ComfyUI process is required. Do not launch a competing process.
7. Use browser control separately when graph or visual verification is needed; the bridge probe validates connectivity and registry state, not appearance.

## Commands

Use a Python environment containing `websockets`. The ComfyUI virtual environment normally qualifies:

```powershell
& "<ComfyUI venv>\Scripts\python.exe" scripts/probe_bridge.py `
  --bridge ws://127.0.0.1:9180 `
  --comfyui http://127.0.0.1:8188 `
  --backend codex
```

Check one registered class key:

```powershell
& "<ComfyUI venv>\Scripts\python.exe" scripts/probe_bridge.py `
  --bridge ws://127.0.0.1:9180 `
  --comfyui http://127.0.0.1:8188 `
  --backend codex `
  --node DirtyBirdsInpaint
```

Report the handshake backend, model count, ComfyUI availability, and requested node registration state. Never claim the bridge provides arbitrary shell or graph access; it is the Agent Panel orchestrator transport.
