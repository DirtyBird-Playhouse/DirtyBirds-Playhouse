"""Prompt Builder step mode — walking a wildcard file one entry per run.

The node itself imports ComfyUI, so the wiring is checked at source level; the
picking behaviour is covered directly in tests/test_wildcard_engine.py.
"""

from pathlib import Path

from _source_text import read_source

ROOT = Path(__file__).resolve().parents[1]


def test_node_exposes_the_step_widgets_last_so_saved_workflows_survive():
    backend = read_source(ROOT / "nodes" / "prompt" / "__init__.py")

    assert '"step_enabled": ("BOOLEAN", {"default": False})' in backend
    # ComfyUI restores widget values by order: new widgets must come after the
    # existing ones or every saved graph shifts.
    assert backend.index('"cycler_text"') < backend.index('"step_enabled"')
    assert backend.index('"step_enabled"') < backend.index('"wildcard_step"')


def test_step_stays_off_when_an_old_graph_shifts_a_string_into_its_slot():
    """Removing dress_state shifts saved values by one position.

    A pre-removal graph lands "(off)" on step_enabled. A bare truth test would
    read that as on and silently switch stepping on for every old workflow.
    """
    backend = read_source(ROOT / "nodes" / "prompt" / "__init__.py")
    frontend = read_source(ROOT / "web" / "jsdirtybirds_prompt.js")

    assert "if step_enabled is True or step_enabled == 1:" in backend
    assert 'typeof stepEnabledWidget.value !== "boolean"' in frontend


def test_dress_state_is_fully_removed():
    backend = read_source(ROOT / "nodes" / "prompt" / "__init__.py")
    frontend = read_source(ROOT / "web" / "jsdirtybirds_prompt.js")

    assert '"dress_state"' not in backend
    assert "_dress_declaration" not in backend
    assert "_dress_labels" not in backend
    assert "DRESS_REG" not in backend
    assert "dressWidget" not in frontend
    assert "Dress State" not in frontend


def test_roll_step_control_sits_in_the_seed_column():
    frontend = read_source(ROOT / "web" / "jsdirtybirds_prompt.js")

    assert "seedCol.append(seedHead, seedRow, stepRow)" in frontend
    assert "wildcardCol.append(wildcardHead, btn)" in frontend


def test_stepped_runs_are_not_cached_as_identical():
    backend = read_source(ROOT / "nodes" / "prompt" / "__init__.py")
    changed = backend.split("def IS_CHANGED(")[1].split("def process(")[0]

    # With a fixed seed the step number is the only thing that changes between
    # runs, so IS_CHANGED must include it or the walk never advances.
    assert "wildcard_step" in changed
    assert "step_enabled" in changed


def test_step_is_off_unless_enabled_and_rides_into_the_engine():
    backend = read_source(ROOT / "nodes" / "prompt" / "__init__.py")

    assert "step = None" in backend
    assert "step = max(0, int(wildcard_step))" in backend
    assert "resolve(positive, seed, wd, step)" in backend
    assert 'ui["db_step_used"] = [step, int(step_total)]' in backend


def test_ui_advances_the_step_once_per_queued_run():
    frontend = read_source(ROOT / "web" / "jsdirtybirds_prompt.js")

    # afterQueued fires once per queued item, so a batch count walks that many
    # entries; onExecuted is the fallback and must not double-advance.
    assert "stepWidget.afterQueued" in frontend
    assert "node._dbStepAdvancedOnQueue = true" in frontend
    assert "if (!node._dbStepAdvancedOnQueue) advanceStep()" in frontend
    assert 'hideWidget("step_enabled")' in frontend
    assert 'hideWidget("wildcard_step")' in frontend
    assert "db_step_used" in frontend
