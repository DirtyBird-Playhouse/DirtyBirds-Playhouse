"""Native text cycling helpers used by Dirty Talk.

Each physical line produces one output, with a hard limit that prevents an
accidental paste from scheduling an unbounded ComfyUI list.
"""

MAX_CYCLER_LINES = 50


class CyclerPrompt(str):
    """A normal STRING carrying the active cycler line between native nodes."""

    def __new__(cls, value, cycler_text=""):
        instance = super().__new__(cls, value)
        instance.db_cycler_text = str(cycler_text or "")
        return instance


def cycle_text(text):
    """Return at most 50 lines in source order.

    Empty text still yields one empty item so an existing non-cycler workflow
    executes once rather than producing an empty ComfyUI output list.
    """
    lines = str(text or "").splitlines()
    return (lines or [""])[:MAX_CYCLER_LINES]


def append_positive(base, addition):
    """Append a non-empty item using Dirty Talk's existing comma separator."""
    base = str(base or "")
    addition = str(addition or "").strip()
    if not addition:
        return base
    return (base + ", " + addition) if base else addition


def with_cycler_metadata(value, cycler_text):
    """Keep the public output a STRING while privately carrying pipe metadata."""
    return CyclerPrompt(value, cycler_text)
