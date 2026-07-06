---
name: run-dirtybirds-playhouse
description: Build, run, and drive the DirtyBirds-Playhouse ComfyUI custom-node package. Use when asked to run, launch, start, test, smoke-test, screenshot, or verify DirtyBirds — its wildcard prompt engine or its ComfyUI nodes (Prompt Builder, Loader, Sampler, Inpaint, Fixer, Muse, Wardrobe, Pipe, SavePrompt, Image Loader).
---

# Run DirtyBirds-Playhouse

DirtyBirds-Playhouse is **not a standalone app** — it is a ComfyUI custom-node
package (Python nodes in `nodes/`, browser extensions in `web/`) that loads
into a host ComfyUI at `http://127.0.0.1:8188`. There are three driveable
surfaces, none of which need a full model render:

1. **The wildcard engine** (`nodes/prompt/utils/wildcard_engine.py`) — pure
   Python, no ComfyUI import. This is the layer most PRs touch (register lock
   `[[reg=...]]`, `{a|b}` / `{7::x|3::y}` dynamics, `__wildcard__` lookups).
2. **The pytest suite** (`tests/`) — 63 tests, all pure-Python.
3. **The live node contracts** — query a running ComfyUI's `/object_info` to
   confirm all 11 `DirtyBirds*` nodes imported and registered their widgets.

The driver [`driver.py`](.claude/skills/run-dirtybirds-playhouse/driver.py)
covers 1 and 3 in one command. Paths below are relative to the repo root.

## Prerequisites

Use the **ComfyUI venv** python — it already has ComfyUI, pytest, and deps.
No `pip install` needed. The system `python` (3.13) also works for the engine
and API checks (they only use the stdlib), but run pytest with the venv:

```
VENV="C:/Users/mpick/My_AI_Tools/Comfyui/venv/Scripts/python.exe"
```

## Run (agent path) — the driver

From the repo root, drive both the engine and the live node contracts:

```
"$VENV" .claude/skills/run-dirtybirds-playhouse/driver.py all
```

Expected: the register-lock demo prints coherent outfits across 5 seeds
(never mixes casual/business), then lists 11 `DirtyBirds*` nodes with their
required/optional inputs and outputs, ending `OK`. If ComfyUI is not running,
the `api` section prints `SKIPPED` and the engine section still passes.

Sub-commands:

```
"$VENV" .claude/skills/run-dirtybirds-playhouse/driver.py engine   # just the pure-Python engine
"$VENV" .claude/skills/run-dirtybirds-playhouse/driver.py api      # just the live /object_info contract
```

Point `api` at a non-default host with `--url http://HOST:PORT`.

## Test

pytest writes tmp files, and this machine's `%TEMP%` is not writable by the
sandbox — you **must** redirect basetemp and disable the cache, or 2 tests
error with `WinError 5 Access is denied`:

```
"$VENV" -m pytest -q -p no:cacheprovider --basetemp=./.pytest-bt
```

Expected: `63 passed`.

## Is ComfyUI already running?

```
curl -s -m 5 http://127.0.0.1:8188/system_stats
```

Returns JSON with `comfyui_version` when up. If it errors, start the host
(human path below), then re-run the driver's `api` mode.

## Run (human path) — full app in ComfyUI

`Start_ComfyUI.bat` launches the host ComfyUI from
`C:\Users\mpick\My_AI_Tools\Comfyui` and opens `http://127.0.0.1:8188`. In the
canvas, right-click → Add Node → **DirtyBirds** category to place a node
(e.g. `🗨️ Prompt Builder`). This is a Windows-only, GPU-backed, interactive
path — useless for headless verification. Use the driver instead to confirm
the nodes load; use this only to eyeball actual image output.

## Gotchas

- **Emoji in display names.** Every node's `display_name` contains an emoji
  (`🗨️ Prompt Builder`). Printing `/object_info` through the default Windows
  cp1252 console raises `UnicodeEncodeError`. The driver forces UTF-8 stdout;
  if you curl+python by hand, prefix `PYTHONUTF8=1`.
- **`__init__.py` returns empty mappings under pytest.** When pytest imports
  the package entrypoint as a top-level `__init__` (no package anchor), it
  exposes empty `NODE_CLASS_MAPPINGS`. Tests load their target modules by file
  path instead (see `tests/test_wildcard_engine.py`) — don't `import` the
  package to get the engine; load `wildcard_engine.py` by path.
- **The engine has no ComfyUI dependency.** You can resolve templates with the
  system python 3.13, no venv — handy for quick checks.
- **`IPAAdapterFaceIDBatch` also shows up** when grepping `/object_info` for
  DirtyBirds-ish names, but it's a third-party dependency node, not ours. The
  driver filters on the `DirtyBirds` prefix; there are exactly **11** ours.
- **Wildcards are re-read every run** from `nodes/prompt/user_files/wildcards/`
  and `user_files/wildcards/`. No ComfyUI restart needed to see edited lists.

## Troubleshooting

- `PermissionError: [WinError 5] ... pytest-of-mpick` — pytest's default
  basetemp. Fix: `--basetemp=./.pytest-bt -p no:cacheprovider` (see Test).
- `api: SKIPPED (no ComfyUI ...)` — host isn't running. Launch
  `Start_ComfyUI.bat`, wait for `system_stats` to return JSON, re-run.
- `no DirtyBirds nodes registered` assertion — ComfyUI is up but loaded this
  package from a different path or failed to import a node. Check the ComfyUI
  console for a `DirtyBirds` import traceback.
