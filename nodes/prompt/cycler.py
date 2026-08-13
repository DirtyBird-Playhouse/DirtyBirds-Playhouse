"""Native text cycling helpers used by Prompt Builder.

Each physical line produces one output, with a hard limit that prevents an
accidental paste from scheduling an unbounded ComfyUI list.

The active line reaches Sampler & Picker over a real ``cycler_line`` socket, not
by riding on the prompt string. An earlier design smuggled it on a ``str``
subclass; any node that rebuilt the prompt — even ``.strip()``, which always
returns a fresh plain ``str`` — silently dropped it and the text overlay died
with no error. Don't reintroduce that.
"""

MAX_CYCLER_LINES = 50


def cycle_text(text):
    """Return at most 50 lines in source order.

    Empty text still yields one empty item so an existing non-cycler workflow
    executes once rather than producing an empty ComfyUI output list.
    """
    lines = str(text or "").splitlines()
    return (lines or [""])[:MAX_CYCLER_LINES]


def append_positive(base, addition):
    """Append a non-empty item using Prompt Builder's existing comma separator."""
    base = str(base or "")
    addition = str(addition or "").strip()
    if not addition:
        return base
    return (base + ", " + addition) if base else addition
