# Node Patterns (Python backend)

How DirtyBirds node backends are structured. Each `dirtybirds_*.py` module
defines node classes and exports mappings; `__init__.py` merges them.

## Class skeleton

```python
class DB_SomeNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"image": ("IMAGE",), "strength": ("FLOAT", {"default": 1.0})},
            "optional": {"mask": ("MASK",)},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "DirtyBirds/..."

    def run(self, image, strength, mask=None):
        # IMAGE: torch.Tensor [B, H, W, C], float32, 0-1
        return (image,)
```

## Mappings (every module)

```python
NODE_CLASS_MAPPINGS = {"DB_SomeNode": DB_SomeNode}
NODE_DISPLAY_NAME_MAPPINGS = {"DB_SomeNode": "DirtyBirds Some Node"}
```

## Rules

- Tensor contract: IMAGE `[B,H,W,C]` float32 0-1; MASK `[B,H,W]`; LATENT
  `{"samples": tensor}`. Respect batch dim; never assume B=1.
- Device: honor the input tensor's device; do not hardcode `.cuda()`.
- Backward compat: do not rename INPUT_TYPES keys / RETURN_NAMES without reason -
  it breaks saved workflows.
- Side-effect modules (`dirtybirds_booru.py`, `dirtybirds_folders.py`) are
  imported for registration only - keep that pattern.
- SAM3 (`dirtybirds_sam3.py`) must stay self-contained (no venv sam package).
- Banned: never read or reference `master.yaml` or `user_files/`.

## Data flow

Prompt -> Loader (encodes) -> Sampler pipe. The Pipe module bundles/routes;
Fixer optionally performs face correction.
