# LLM Integration (Muse / LM Studio)

DirtyBirds nodes that call a local LLM (e.g. Muse) use LM Studio's
OpenAI-compatible HTTP endpoint, not the llama.cpp CLI.

## Endpoint

- LM Studio serves an OpenAI-compatible API locally. Send chat completions to it.
- Do not shell out to llama.cpp; do not assume a specific binary.

## Presets

The user maintains a per-category preset library (system prompt + temperature +
maxTokens only; load/vision settings are owned by the LM Studio UI). See memory
`[[lmstudio-presets]]` and `[[local-llm-lm-studio]]` for the model lineup
(caption / story / coder models) and hardware (RTX 4060 Ti 16GB).

## Hardware / context

- Vision tokens scale with image resolution; uncapped high-res images can
  overflow context. Resolve in the LM Studio UI (context length, image-size
  limit, or pre-resize), not in preset files.

## Constraints

- Models are uncensored by design for this workflow; do not inject refusals or
  disclaimers into node-side prompts unless asked.
