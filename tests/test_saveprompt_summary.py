"""Save Image & Prompt's how-it-was-made record.

Guards the reason it exists: 🎲 Random rolls the resolution at run time, so if
the saved record loses it, a picture you liked can't be reproduced.
"""

import importlib.util
from pathlib import Path

from _source_text import read_source

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "dirtybirds_saveprompt_summary", ROOT / "nodes" / "saveprompt" / "summary.py"
)
summary_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(summary_module)


def _pipe(**overrides):
    pipe = {
        "seed": 4242,
        "denoise": 1.0,
        "loader_settings": {
            "ckpt_name": "SDXL\\dreamy_xl.safetensors",
            "empty_latent_width": 832,
            "empty_latent_height": 1216,
            "lora_stack": [("styles\\filmgrain.safetensors", 0.8, 0.8)],
            "db_workflow": "Text2Image",
        },
        "db_sampler_settings": {
            "sampler_name": "dpmpp_2m",
            "scheduler": "karras",
            "steps": 30,
            "cfg": 6.5,
            "noise_mode": "cpu",
        },
    }
    pipe.update(overrides)
    return pipe


def test_summary_records_the_resolution_that_was_actually_used():
    assert summary_module.generation_summary(_pipe())["resolution"] == "832x1216"


def test_summary_records_seed_checkpoint_loras_and_sampler():
    got = summary_module.generation_summary(_pipe())
    assert got["seed"] == 4242
    assert got["checkpoint"] == "dreamy_xl"
    assert got["loras"] == ["filmgrain:0.80"]
    assert got["sampler_name"] == "dpmpp_2m"
    assert got["scheduler"] == "karras"
    assert got["steps"] == 30
    assert got["cfg"] == 6.5


def test_summary_is_empty_without_a_pipe():
    assert summary_module.generation_summary(None) == {}
    assert summary_module.summary_line({}) == ""


def test_summary_survives_a_pipe_that_never_reached_the_sampler():
    pipe = _pipe()
    pipe.pop("db_sampler_settings")
    got = summary_module.generation_summary(pipe)
    assert got["resolution"] == "832x1216"
    assert "sampler_name" not in got


def test_summary_skips_malformed_lora_entries_instead_of_failing():
    pipe = _pipe()
    pipe["loader_settings"]["lora_stack"] = [("ok.safetensors", 1.0, 1.0), ("broken",)]
    assert summary_module.generation_summary(pipe)["loras"] == ["ok:1.00"]


def test_summary_line_is_readable_and_leads_with_the_resolution():
    line = summary_module.summary_line(summary_module.generation_summary(_pipe()))
    assert line.startswith("832 × 1216")
    assert "seed 4242" in line
    assert "30 steps" in line
    assert "CFG 6.5" in line
    assert "dpmpp_2m/karras" in line
    assert "LoRA filmgrain:0.80" in line


def test_saveprompt_writes_the_record_to_the_png_and_the_node_ui():
    backend = read_source(ROOT / "nodes" / "saveprompt" / "__init__.py")
    frontend = read_source(ROOT / "web" / "jsdirtybirds_saveprompt.js")
    sampler = read_source(ROOT / "nodes" / "sampler" / "__init__.py")

    assert 'metadata.add_text("db_generation", json.dumps(summary))' in backend
    assert 'metadata.add_text("db_settings", settings_line)' in backend
    assert '"db_settings_md": [settings_line]' in backend
    # The sampler's own settings only reach this node through the pipe.
    assert 'pipe["db_sampler_settings"] = sampler_settings' in sampler
    assert "db_settings_md" in frontend
    assert "## Settings" in frontend
