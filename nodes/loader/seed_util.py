"""Sampling-seed selection for the DirtyBirds Loader.

Deliberately dependency-free (no torch/ComfyUI imports) so it can be unit-tested
in isolation — the regression guard for the "stuck seed" bug where random mode
never actually re-rolled the sampling seed.
"""

import random

# 2**53 - 1: the largest integer a JS Number can hold exactly. Rolling within
# this range means the seed echoed to the browser UI round-trips without losing
# precision, so the "Last seed" recall reproduces the run exactly.
SEED_MAX = 0x1FFFFFFFFFFFFF


def resolve_seed(seed, seed_mode, rng=random):
    """Return the sampling seed for one run.

    ``seed_mode == "random"`` re-rolls a fresh seed every run so each generation
    differs; any other mode ("fixed") passes the widget value through unchanged
    for reproducibility. ``rng`` is injectable so tests can pin the sequence.
    """
    if seed_mode == "random":
        return rng.randint(0, SEED_MAX)
    return int(seed)
