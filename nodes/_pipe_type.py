"""The socket type for the DirtyBirds pipe.

The pipe has always been an Easy-Use ``PIPE_LINE`` dict in everything but name:
``model, clip, vae, positive, negative, samples, images, seed, loader_settings``,
matching ``comfyui-easy-use/py/nodes/pipe.py`` key for key (DirtyBirds adds
``denoise``, which Easy-Use ignores). Only the declared type string differed,
and LiteGraph matches types by exact string — so two interchangeable payloads
could never be wired together.

Outputs now emit ``PIPE_LINE``, making DirtyBirds pipes accepted by Easy-Use
nodes. Inputs accept either name so graphs saved against ``DIRTYBIRDS_PIPE``
keep loading;
ComfyUI resolves comma-separated unions natively
(``comfy_execution/validation.py::validate_node_input``).
"""

# What every DirtyBirds pipe output declares.
PIPE_TYPE = "PIPE_LINE"

# What every DirtyBirds pipe input accepts. Order matters for the socket colour
# LiteGraph picks, so the canonical name comes first.
PIPE_INPUT = "PIPE_LINE,DIRTYBIRDS_PIPE"
