# Performance

Optimization notes for a ComfyUI node suite. Performance here means GPU/VRAM,
tensor work, and UI responsiveness, not web request throughput.

## Python / tensors

- Keep tensors on-device; avoid round-tripping to CPU/numpy unless required.
- Vectorize over the batch dim instead of Python loops where possible.
- Avoid unnecessary `.clone()`/copies of large IMAGE/LATENT tensors.
- Do heavy model loads lazily and cache them; do not reload per execution.
- Implement `IS_CHANGED` so ComfyUI can skip re-running a node when inputs are
  unchanged (big win for expensive nodes).
- Release large intermediates; mind VRAM on the RTX 4060 Ti 16GB target.

## LLM (Prompt Enhance / LM Studio)

- Vision tokens scale with image resolution; uncapped high-res images can
  overflow context and slow generation. Resize or cap image size (in the LM
  Studio UI) before sending.
- Keep maxTokens reasonable per preset; see memory `[[lmstudio-presets]]`.

## JS / UI

- Avoid heavy work in `onDrawForeground` / per-frame callbacks; cache computed
  layout and only recompute on resize or data change.
- Debounce expensive widget updates triggered by typing.

## SAM3

- Load the model once and reuse; segmentation model init is the expensive step.
