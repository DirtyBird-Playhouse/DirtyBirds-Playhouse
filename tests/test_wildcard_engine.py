"""Tests for the DirtyBirds wildcard engine, focused on the new roll-scoped
[[variable]] feature (register lock) plus backward-compatibility of the existing
{dynamic} / __wildcard__ syntax.

The engine module has no ComfyUI imports, so it is loaded directly from its file
path without importing the whole node package.
"""

import importlib.util
import os

_ENGINE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "nodes",
    "prompt",
    "utils",
    "wildcard_engine.py",
)
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
    "hair/style/short": ["bob"],
    "hair/style/long": ["ponytail"],
    "hair/style-curly": ["ringlets"],
    "hair/color/blonde": ["blonde hair"],
}

CASUAL = {"t-shirt", "jeans", "sneakers"}
BUSINESS = {"blazer", "slacks", "heels"}


def test_register_lock_keeps_outfit_coherent_across_seeds():
    """Choosing the register once and reusing it via [[reg]] must never mix
    casual and business pieces, for any seed."""
    template = (
        "[[reg={Casual|Business}]]"
        "__clothing/tops/[[reg]]__, "
        "__clothing/bottoms/[[reg]]__, "
        "__clothing/footwear/[[reg]]__"
    )
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
    template = (
        "__clothing/tops/{Casual|Business}__, "
        "__clothing/bottoms/{Casual|Business}__, "
        "__clothing/footwear/{Casual|Business}__"
    )
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
        "__clothing/footwear/[[reg]]__"
    ]
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
        "[[reg=Business]][[mood=serene]]a [[mood]] look in [[reg]] wear", 0, WD
    )
    assert out == "a serene look in Business wear"


def test_plain_dynamic_and_wildcard_still_work():
    assert engine.process("__clothing/tops/casual__", 0, WD) == "t-shirt"
    assert engine.process("{only}", 0, WD) == "only"


def test_folder_wildcard_picks_from_child_lists():
    seen = {engine.process("__hair/style__", seed, WD) for seed in range(30)}
    assert seen <= {"bob", "ponytail"}
    assert seen == {"bob", "ponytail"}


def test_glob_wildcard_picks_from_matching_lists():
    seen = {engine.process("__hair/style*__", seed, WD) for seed in range(60)}
    assert seen <= {"bob", "ponytail", "ringlets"}
    assert seen == {"bob", "ponytail", "ringlets"}


def test_unknown_glob_left_visible():
    assert engine.process("__hair/texture*__", 0, WD) == "__hair/texture*__"


def test_no_variable_template_is_seed_reproducible():
    template = "{a|b|c|d}, __clothing/footwear/{Casual|Business}__"
    assert engine.process(template, 123, WD) == engine.process(template, 123, WD)


def test_empty_text_passthrough():
    assert engine.process("", 0, WD) == ""
    assert engine.process(None, 0, WD) is None


# ---------------------------------------------------------------------------
# Step mode: walk a wildcard file one entry per run instead of rolling it.
# ---------------------------------------------------------------------------

STEP_WD = {"outfits": ["one", "two", "three"]}


def test_step_walks_entries_in_order_one_per_step():
    got = [engine.process("__outfits__", 0, STEP_WD, step=n) for n in range(3)]
    assert got == ["one", "two", "three"]


def test_step_wraps_around_the_end_of_the_file():
    assert engine.process("__outfits__", 0, STEP_WD, step=3) == "one"
    assert engine.process("__outfits__", 0, STEP_WD, step=7) == "two"


def test_step_ignores_the_seed_so_the_walk_is_the_same_every_time():
    assert engine.process("__outfits__", 1, STEP_WD, step=1) == "two"
    assert engine.process("__outfits__", 99999, STEP_WD, step=1) == "two"


def test_step_also_walks_dynamic_groups():
    got = [engine.process("{a|b|c}", 0, STEP_WD, step=n) for n in range(4)]
    assert got == ["a", "b", "c", "a"]


def test_step_reports_the_length_of_the_longest_list_it_walked():
    _, picker = engine.resolve("__outfits__", 0, STEP_WD, step=0)
    assert picker.longest == 3


def test_step_none_keeps_the_original_random_behaviour():
    text, picker = engine.resolve("__outfits__", 5, STEP_WD)
    assert text in {"one", "two", "three"}
    assert not hasattr(picker, "longest")


def test_step_covers_every_entry_where_rolling_need_not():
    walked = {engine.process("__outfits__", 0, STEP_WD, step=n) for n in range(3)}
    assert walked == set(STEP_WD["outfits"])


def test_step_counts_options_inside_a_group_not_just_list_entries():
    # The common file shape: one wildcard key holding a single string that is
    # itself a {a|b|c} group. Counting only list entries would report 1 and the
    # UI would say "1 of 1" while actually walking three variants.
    wd = {"look": ["{soft|harsh|golden} light"]}
    _, picker = engine.resolve("__look__", 0, wd, step=0)
    assert picker.longest == 3
    walked = {engine.process("__look__", 0, wd, step=n) for n in range(3)}
    assert walked == {"soft light", "harsh light", "golden light"}


def test_step_records_where_each_count_came_from():
    wd = {"look": ["{soft|harsh|golden} light"]}
    _, picker = engine.resolve("__look__", 0, wd, step=0)
    assert {"kind": "list", "size": 1} in picker.counts
    assert {"kind": "options", "size": 3} in picker.counts


def test_back_to_back_tokens_resolve_separately():
    r"""Two tokens written with no gap must resolve to two values.

    Michael authors them this way on purpose: a space between tokens would put a
    space in the rendered prompt, and stacked YAML options already contribute a
    fold space. The regex was greedy and `\w` matches `_`, so `__a____b__`
    matched as ONE key whose name contained the separating underscores. No such
    key exists, so the resolver handed the token back untouched and the whole
    run printed literally.
    """
    assert (
        engine.process("__clothing/tops/casual____clothing/bottoms/casual__", 0, WD)
        == "t-shirtjeans"
    )


def test_keys_containing_underscores_still_resolve():
    """The non-greedy fix must not break a key with single underscores in it.

    `+?` expands until it finds the closing `__`, so `my_key` is unaffected —
    this is the case a lazy quantifier could plausibly have broken.
    """
    wd = {"hair/wavy_long": ["beach waves"]}
    assert engine.process("__hair/wavy_long__", 0, wd) == "beach waves"
