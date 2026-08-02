"""Validation and user-scoped persistence for Generation Setup resolutions."""

import json
import os
import random as _random

DEFAULT_DIMENSIONS = {"1024x1024": [1024, 1024]}
MIN_DIMENSION = 64
MAX_DIMENSION = 8192
DIMENSION_STEP = 8

# Sentinel widget values for the 🎲 Random picks. The shape-filtered variants
# exist because an unfiltered roll mixes portrait and landscape, which rarely
# suits the subject you're generating.
RANDOM_ANY = "__random__"
RANDOM_PORTRAIT = "__random_portrait__"
RANDOM_LANDSCAPE = "__random_landscape__"
RANDOM_SQUARE = "__random_square__"

_RANDOM_SHAPES = {
    RANDOM_ANY: lambda width, height: True,
    RANDOM_PORTRAIT: lambda width, height: height > width,
    RANDOM_LANDSCAPE: lambda width, height: width > height,
    RANDOM_SQUARE: lambda width, height: width == height,
}


def is_random(dimension):
    """True for any of the 🎲 Random sentinels."""
    return str(dimension) in _RANDOM_SHAPES


def pick_random_dimension(dimension, dimensions, rng=_random):
    """Choose a preset label matching the sentinel's shape.

    Falls back to the full preset list when the requested shape has no presets
    (rather than failing), and to a safe square when there are none at all.
    """
    matches = _RANDOM_SHAPES.get(str(dimension))
    presets = dimensions or {}
    candidates = [
        label
        for label, value in presets.items()
        if matches and len(value) == 2 and matches(int(value[0]), int(value[1]))
    ]
    if not candidates:
        candidates = list(presets.keys())
    if not candidates:
        return next(iter(DEFAULT_DIMENSIONS))
    return rng.choice(sorted(candidates))


def _validate_axis(value, label):
    try:
        axis = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid resolution value for {label}") from exc
    if not MIN_DIMENSION <= axis <= MAX_DIMENSION:
        raise ValueError(f"resolution out of range for {label}")
    if axis % DIMENSION_STEP:
        raise ValueError(f"resolution must be divisible by 8 for {label}")
    return axis


def validate_dimensions(data):
    if not isinstance(data, dict):
        raise ValueError("dimensions must be an object")

    cleaned = {}
    for raw_label, value in data.items():
        label = str(raw_label or "").strip()
        if not label or len(label) > 64:
            raise ValueError("invalid resolution label")
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise ValueError(f"invalid resolution value for {label}")
        cleaned[label] = [
            _validate_axis(value[0], label),
            _validate_axis(value[1], label),
        ]

    if not cleaned:
        raise ValueError("at least one resolution is required")
    return cleaned


def load_dimensions(default_path, user_path=None):
    """Load a valid user override, then packaged defaults, then safe defaults."""
    for path in (user_path, default_path):
        if not path:
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return validate_dimensions(json.load(handle))
        except (OSError, json.JSONDecodeError, ValueError):
            continue
    return {label: list(value) for label, value in DEFAULT_DIMENSIONS.items()}


def save_dimensions(data, user_path):
    """Atomically write validated presets to ComfyUI's user-data area."""
    cleaned = validate_dimensions(data)
    directory = os.path.dirname(user_path)
    os.makedirs(directory, exist_ok=True)
    temporary_path = f"{user_path}.tmp"
    with open(temporary_path, "w", encoding="utf-8") as handle:
        json.dump(cleaned, handle, indent=2)
        handle.write("\n")
    os.replace(temporary_path, user_path)
    return cleaned


def normalize_runtime_dimensions(width, height):
    """Keep legacy/raw workflow values safe for latent creation."""

    def normalize(value):
        try:
            numeric = int(value)
        except (TypeError, ValueError):
            numeric = 1024
        numeric = max(MIN_DIMENSION, min(MAX_DIMENSION, numeric))
        return max(
            MIN_DIMENSION,
            min(MAX_DIMENSION, round(numeric / DIMENSION_STEP) * DIMENSION_STEP),
        )

    return normalize(width), normalize(height)
