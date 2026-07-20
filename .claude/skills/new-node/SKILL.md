---
name: new-node
description: Scaffold a new DirtyBirds node — Python package, mappings registration, web/ JS stub, and a test — wired up so it registers in ComfyUI on first restart.
disable-model-invocation: true
---

# New DirtyBirds node

Scaffold a node across all four places it has to exist. Missing any one of them
is the usual reason a new node doesn't appear in the menu.

## Ask first

If not given in the invocation, ask for:

1. **Class name** — `DirtyBirds<Thing>`, e.g. `DirtyBirdsWardrobe`.
2. **Package name** — lowercase dir under `nodes/`, e.g. `wardrobe`.
3. **Menu label** — with emoji, matching the house style (`📤 Pipe Out`, `👗 Wardrobe`).
4. **What it does** — one sentence, plus its inputs and outputs if known.

Don't guess the label or the emoji. Ask.

## Steps

Do these in order. Each one is load-bearing.

1. **Create `nodes/<package>/__init__.py`** from `templates/node.py.template`.
   Substitute the class name, label, and docstring. Keep the module docstring
   explaining *why the node exists*, not what the code does — that is the
   convention in every existing package (see `nodes/pipe/__init__.py`).

2. **Register in the aggregator.** Add the package name to `_NODE_PACKAGES` in
   `nodes/__init__.py`, in the position it should occupy in the menu. This is
   the step that silently ruins everything if skipped — the aggregator only
   imports what is in that tuple.

3. **Add to the smoke test roster.** Add the class name to `EXPECTED_NODES` in
   `tests/test_node_registration_smoke.py`. Without this the node can vanish
   from registration and no test will notice.

4. **Create `web/jsdirtybirds_<package>.js`** from `templates/widget.js.template`
   only if the node needs custom frontend behaviour. A node with plain widgets
   needs no JS at all — skip this step rather than leaving a dead file.

5. **Create `tests/test_<package>.py`** from `templates/test.py.template`.
   Prefer the file-path loading pattern from `tests/test_pipe_roundtrip.py` when
   the node imports only stdlib — it is faster and needs no ComfyUI. If the node
   imports torch or comfy, use `tests/_comfy_env.py` and skip cleanly when no
   ComfyUI checkout is present.

6. **Run the tests**: `pytest tests/test_<package>.py tests/test_node_registration_smoke.py -q`

## Conventions to match

- `CATEGORY = "DirtyBirds"` on every node.
- `RETURN_NAMES` whenever there is more than one output — unnamed sockets are
  unreadable on the canvas.
- Pipe-aware nodes take and return `DIRTYBIRDS_PIPE`, and must **not** mutate the
  incoming pipe dict — shallow-copy it, and copy `loader_settings` too. See the
  `pack` method in `nodes/pipe/__init__.py`.
- Heavy or optional imports (cv2, ultralytics, timm) go **inside** the function
  that needs them, not at module top level. A top-level import failure gets the
  whole package skipped by the aggregator.
