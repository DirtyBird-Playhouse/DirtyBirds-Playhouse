# API Design (node interface + HTTP routes)

There is no REST/GraphQL app here. "API" means two things in this suite: the
node interface contract (the graph-facing API) and the small HTTP routes some
nodes register on the ComfyUI server.

## Node interface = the public API

The stable contract other workflows depend on:

- `INPUT_TYPES` keys (input names + types)
- `RETURN_TYPES` and `RETURN_NAMES` (output names + types)
- The node's registered class key in `NODE_CLASS_MAPPINGS`

Treat these as versioned: renaming or reordering breaks saved workflows. Add new
optional inputs rather than changing existing ones.

## Types as the contract

Match producer/consumer types exactly: IMAGE, LATENT, MASK, CONDITIONING, MODEL,
CLIP, VAE, STRING, INT, FLOAT, BOOLEAN, or a list of strings for a dropdown.
Custom pipe types must be consistent across the nodes that pass them.

## HTTP routes (server side)

Some integrations register aiohttp routes on the ComfyUI `PromptServer`. Known
example: the LoRA Manager integration exposes a universal `/api/lm/previews`
endpoint, gated by a registry, with a fetch interceptor on the JS side. See
memory `[[lora-manager-integration]]`.

When adding a route:

- Namespace it clearly (e.g. `/api/db/...`).
- Validate inputs; never read banned paths (`master.yaml`, `user_files/`).
- Return JSON the JS extension can consume; surface errors as status text.
