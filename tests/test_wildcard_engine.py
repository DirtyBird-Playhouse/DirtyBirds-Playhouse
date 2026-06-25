"""Tests for the DirtyBirds wildcard engine, focused on the new roll-scoped
[[variable]] feature (register lock) plus backward-compatibility of the existing
{dynamic} / __wildcard__ syntax.

The engine module has no ComfyUI imports, so it is loaded directly from its file
path without importing the whole node package.
"""

import importlib.util
import os

_ENGINE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "utils", "wildcard_engine.py")
_spec = importlib.util.spec_from_file_location("db_wildcard_engine", _ENGINE_PATH)
engine = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(engine)


# A wildcard dict mirroring the user's register-split clothing structure. Keys are
# normalized (lowercase, slashes) exactly as the engine stores them.
WD = {
    "clothing/tops/casual": ["t-shirt"],
    "clothing/tops/business": ["blazer"],
    "clothing/bottoms/casual": ["jeans"],
    "clothing/bottoms/business": ["slacks"],
    "clothing/footwear/casual": ["sneakers"],
    "clothing/footwear/business": ["heels"],
}

CASUAL = {"t-shirt", "jeans", "sneakers"}
BUSINESS = {"blazer", "slacks", "heels"}


def test_register_lock_keeps_outfit_coherent_across_seeds():
    """Choosing the register once and reusing it via [[reg]] must never mix
    casual and business pieces, for any seed."""
    template = ("[[reg={Casual|Business}]]"
                "__clothing/tops/[[reg]]__, "
                "__clothing/bottoms/[[reg]]__, "
                "__clothing/footwear/[[reg]]__")
    saw_casual = saw_business = False
    for seed in range(60):
        out = engine.process(template, seed, WD)
        pieces = {p.strip() for p in out.split(",")}
        # Every piece must come from the same register.
        assert pieces <= CASUAL or pieces <= BUSINESS, (seed, out)
        saw_casual = saw_casual or pieces <= CASUAL
        saw_business = saw_business or pieces <= BUSINESS
    # Sanity: both registers actually occur across the seed range.
    assert saw_casual and saw_business


def test_without_register_lock_outfits_can_mix():
    """Control: rolling each piece independently DOES produce mixed registers,
    proving the lock above is what creates coherence (not the data)."""
    template = ("__clothing/tops/{Casual|Business}__, "
                "__clothing/bottoms/{Casual|Business}__, "
                "__clothing/footwear/{Casual|Business}__")
    mixed = False
    for seed in range(60):
        out = engine.process(template, seed, WD)
        pieces = {p.strip() for p in out.split(",")}
        if not (pieces <= CASUAL or pieces <= BUSINESS):
            mixed = True
            break
    assert mixed


def test_register_lock_inside_pulled_scenario_template():
    """A [[reg=...]] declaration stored inside a scenario template (pulled via a
    __token__ mid-roll) must still fire and keep the outfit coherent."""
    wd = dict(WD)
    wd["scene/professional"] = [
        "[[reg={Casual|Business}]]__clothing/tops/[[reg]]__ and "
        "__clothing/footwear/[[reg]]__"]
    saw_casual = saw_business = False
    for seed in range(40):
        out = engine.process("__scene/professional__", seed, wd)
        pieces = {p.strip() for p in out.replace(" and ", ", ").split(",")}
        assert pieces <= CASUAL or pieces <= BUSINESS, (seed, out)
        saw_casual = saw_casual or pieces <= CASUAL
        saw_business = saw_business or pieces <= BUSINESS
    assert saw_casual and saw_business


def test_declaration_emits_nothing():
    out = engine.process("[[reg=Business]]hello world", 0, WD)
    assert out == "hello world"


def test_reference_substitutes_stored_value():
    out = engine.process("[[reg=Business]]wearing [[reg]] attire", 0, WD)
    assert out == "wearing Business attire"


def test_unknown_reference_left_visible():
    out = engine.process("a [[missing]] token", 0, WD)
    assert out == "a [[missing]] token"


def test_multiple_independent_variables():
    """Several variables can be declared and each reused independently in the
    template (references inside another declaration are not supported -- by
    design, to keep the bracket parsing unambiguous)."""
    out = engine.process(
        "[[reg=Business]][[mood=serene]]a [[mood]] look in [[reg]] wear", 0, WD)
    assert out == "a serene look in Business wear"


def test_plain_dynamic_and_wildcard_still_work():
    assert engine.process("__clothing/tops/casual__", 0, WD) == "t-shirt"
    assert engine.process("{only}", 0, WD) == "only"


def test_no_variable_template_is_seed_reproducible():
    template = "{a|b|c|d}, __clothing/footwear/{Casual|Business}__"
    assert engine.process(template, 123, WD) == engine.process(template, 123, WD)


def test_empty_text_passthrough():
    assert engine.process("", 0, WD) == ""
    assert engine.process(None, 0, WD) is None
