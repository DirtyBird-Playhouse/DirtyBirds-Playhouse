"""DirtyBirds Playhouse — finishing passes for a rendered image.

Three passes over a finished image, in the only order that makes sense:

  1. **Upscale** — whole image, a model from ``models/upscale_models`` or a plain
     Lanczos resample.
  2. **Face restore** — GFPGAN / CodeFormer over every detected face. After the
     upscale, because upscalers soften and smear faces; restoring first means
     the upscaler undoes the work.
  3. **Sharpen** — unsharp mask. Last, for the same reason.

Every pass is off by default, so an unconfigured node passes the image straight
through.

Deliberately separate from 🖌️ Inpainting. Inpainting is an authored edit — you
describe a region, it is masked and repainted with your model and prompt.
These are finishing passes: global, automatic, and needing no model, VAE,
conditioning or mask. Merging them produced a node where twelve of twenty inputs
were inert unless you happened to be inpainting.

Because it needs nothing from the pipe, this node works anywhere an IMAGE
exists: after the Sampler, after Inpainting, or on a freshly loaded image. The
``db_pipe`` input is optional and only exists so the node can sit inside an
existing DirtyBirds chain without breaking the pipe; when connected it is passed
through with ``images`` updated.
"""

import copy

from .._compare import compare_preview, resolution
from .._pipe_type import PIPE_INPUT, PIPE_TYPE

# sharpen is pure torch and always available.
from .sharpen import (
    SHARPEN_MAX,
    SHARPEN_DEFAULT,
    SHARPEN_OFF,
    SHARPEN_STEP,
    sharpen_image,
)

# The other two reach into ComfyUI (folder_paths, comfy.utils) at import, and
# face restore additionally wants facexlib + spandrel_extra_arches. Guarded so a
# partial environment can't stop the node — and the whole pack — from loading.
# Selecting a pass that could not load raises at run time with the fix, rather
# than silently doing nothing: a control that quietly no-ops is worse than one
# that says why.
_FACE_RESTORE_ERROR = None
try:
    from .face_restore import (
        FACE_RESTORE_OFF,
        FACE_RESTORE_OPTIONS,
        FaceRestoreManager,
    )
except Exception as exc:  # noqa: BLE001
    _FACE_RESTORE_ERROR = exc
    FACE_RESTORE_OFF = "Off"
    FACE_RESTORE_OPTIONS = (FACE_RESTORE_OFF, "GFPGAN", "CodeFormer")
    FaceRestoreManager = None

_UPSCALE_ERROR = None
try:
    from .upscale import UPSCALE_OFF, upscale_image, upscale_options
except Exception as exc:  # noqa: BLE001
    _UPSCALE_ERROR = exc
    UPSCALE_OFF = "None"

    def upscale_options():
        return [UPSCALE_OFF]

    def upscale_image(image, choice, scale=0.0):  # noqa: ARG001
        return image


def _upscale_ratio(before, after):
    """How many times larger ``after`` is than ``before``. 1 when unchanged."""
    try:
        return max(1.0, float(after.shape[1]) / float(before.shape[1]))
    except (AttributeError, IndexError, TypeError, ValueError, ZeroDivisionError):
        return 1.0


def _summarize(upscale_model, method, sharpen, fidelity, image):
    """One line naming what actually ran, shown on the compare view."""
    parts = []

    if str(upscale_model or UPSCALE_OFF) != UPSCALE_OFF:
        parts.append(str(upscale_model))
    if str(method or FACE_RESTORE_OFF) != FACE_RESTORE_OFF:
        label = str(method)
        if label == "CodeFormer":
            label += f" {float(fidelity):.2f}"
        parts.append(label)
    try:
        if float(sharpen) > 0:
            parts.append(f"Sharpen {float(sharpen):.2f}")
    except (TypeError, ValueError):
        pass
    size = resolution(image)
    if size:
        parts.append(size)
    return " · ".join(parts)


class DirtyBirdsFinish:
    """Upscale, face-restore and sharpen a finished image."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "upscale_model": (
                    upscale_options(),
                    {
                        "default": UPSCALE_OFF,
                        "tooltip": "Whole-image upscale. 'Fast' options are a plain "
                        "Lanczos resample (more pixels, no new detail); anything "
                        "else is a model from models/upscale_models.",
                    },
                ),
                "face_restore": (
                    list(FACE_RESTORE_OPTIONS),
                    {
                        "default": FACE_RESTORE_OFF,
                        "tooltip": "Dedicated face-restore GANs, applied to every "
                        "face found. Prompt-independent, and trained on real "
                        "photographs — they pull stylised faces toward photoreal.",
                    },
                ),
                "codeformer_fidelity": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.05,
                        "tooltip": "CodeFormer only. 0 = maximum quality (may drift "
                        "from the original face), 1 = maximum fidelity to it.",
                    },
                ),
                # One slider with the Sharpen blueprint's own range and default.
                "sharpen": (
                    "FLOAT",
                    {
                        "default": SHARPEN_DEFAULT,
                        "min": 0.0,
                        "max": SHARPEN_MAX,
                        "step": SHARPEN_STEP,
                        "tooltip": "Edge sharpen strength. 0 is off.",
                    },
                ),
                # LAST on purpose. ComfyUI stores a saved workflow's widget
                # values positionally, so inserting an input anywhere but the
                # end shifts every value after it into the wrong widget — this
                # one was added in the middle first, and codeformer_fidelity's
                # 0.45 landed in face_restore ("Value not in list"). New inputs
                # go here.
                "upscale_scale": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 8.0,
                        "step": 0.25,
                        "tooltip": "Final size relative to the input, whatever "
                        "the model is built for — a 4x model set to 2 gives 2x. "
                        "The model still runs at its own factor and the result "
                        "is resampled, so the detail it added survives. "
                        "0 means use the model's own scale.",
                    },
                ),
            },
            # Both optional, because either one can supply the image. Marking
            # `image` required makes ComfyUI refuse to queue a graph that feeds
            # the node entirely through the pipe, which is the normal way to
            # wire it inside a DirtyBirds chain. The check for "neither is
            # connected" is in finish() instead, same as 💾 Save Prompt.
            "optional": {
                "image": ("IMAGE",),
                "db_pipe": (PIPE_INPUT,),
            },
        }

    RETURN_TYPES = (PIPE_TYPE, "IMAGE")
    RETURN_NAMES = ("db_pipe", "image")
    FUNCTION = "finish"
    CATEGORY = "DirtyBirds"
    # Required, not cosmetic. ComfyUI only executes nodes on the dependency path
    # of an output node. Without this, a Finish whose outputs go nowhere — the
    # normal way to use it, since it saves nothing itself — is pruned before the
    # run: it never receives the image, and the compare preview it returns below
    # can never appear. A Preview Image wired to the sampler still worked, which
    # made it look like the pipe was at fault.
    OUTPUT_NODE = True

    def finish(
        self,
        upscale_model=UPSCALE_OFF,
        upscale_scale=0.0,
        face_restore=FACE_RESTORE_OFF,
        codeformer_fidelity=0.5,
        sharpen=SHARPEN_OFF,
        image=None,
        db_pipe=None,
    ):
        # The image socket wins when both are connected, so an explicit wire
        # always overrides whatever the chain happens to be carrying.
        if image is None and db_pipe is not None:
            image = db_pipe.get("images")
        if image is None:
            raise ValueError(
                "✨ Finish has no image: connect the image input, or connect a "
                "db_pipe that carries one."
            )

        final_image = image

        # 1. Upscale first: everything downstream then works at final resolution.
        if str(upscale_model or UPSCALE_OFF) != UPSCALE_OFF and _UPSCALE_ERROR:
            raise RuntimeError(f"Upscaling is unavailable: {_UPSCALE_ERROR}")
        final_image = upscale_image(final_image, upscale_model, upscale_scale)

        # 2. Face restore after the upscale, which softens faces.
        method = str(face_restore or FACE_RESTORE_OFF)
        if method != FACE_RESTORE_OFF:
            if FaceRestoreManager is None:
                raise RuntimeError(
                    f"Face restore is unavailable ({_FACE_RESTORE_ERROR}). Run "
                    "`pip install -r requirements.txt` in the DirtyBirds-Playhouse "
                    "folder, or set Faces to 'Off'."
                )
            try:
                fidelity = float(codeformer_fidelity)
            except (TypeError, ValueError):
                fidelity = 0.5
            final_image = FaceRestoreManager.get_instance().restore(
                final_image, method, fidelity, align=True
            )

        # 3. Sharpen last, for the same reason. Its stencil has to widen by
        # however much the upscale enlarged the image, or the same strength
        # setting means something much weaker after an upscale than without one.
        final_image = sharpen_image(
            final_image, sharpen, spacing=_upscale_ratio(image, final_image)
        )

        # Pass the pipe through untouched apart from the new image, so this node
        # can sit mid-chain. Never mutate the caller's dict.
        pipe = dict(db_pipe or {})
        pipe["images"] = final_image
        if "loader_settings" in pipe:
            pipe["loader_settings"] = copy.copy(pipe["loader_settings"])
        result = (pipe, final_image)

        preview = compare_preview(
            image,
            final_image,
            _summarize(
                upscale_model, method, sharpen, codeformer_fidelity, final_image
            ),
        )
        return {"ui": preview, "result": result} if preview else result


NODE_CLASS_MAPPINGS = {"DirtyBirdsFinish": DirtyBirdsFinish}
NODE_DISPLAY_NAME_MAPPINGS = {"DirtyBirdsFinish": "✨ Finish"}
