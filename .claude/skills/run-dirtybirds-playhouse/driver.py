#!/usr/bin/env python
"""DirtyBirds-Playhouse driver: exercise the three real surfaces of this
ComfyUI custom-node package without needing a full workflow render.

  engine  - load nodes/prompt/utils/wildcard_engine.py by path and resolve a
            template. This is the pure-Python layer most PRs touch (register
            lock, {a|b} dynamics, __wildcard__ lookups). No ComfyUI import.
  api     - query a *running* ComfyUI (default http://127.0.0.1:8188) and print
            the live I/O contract for each DirtyBirds* node. Proves the package
            imported cleanly into ComfyUI and registered its widgets.
  all     - engine, then api (api is skipped gracefully if ComfyUI is down).

Usage (from repo root):
  python .claude/skills/run-dirtybirds-playhouse/driver.py all
  python .claude/skills/run-dirtybirds-playhouse/driver.py engine
  python .claude/skills/run-dirtybirds-playhouse/driver.py api  [--url http://127.0.0.1:8188]

Run with the ComfyUI venv python so deps are present:
  C:/Users/mpick/My_AI_Tools/Comfyui/venv/Scripts/python.exe <this> all
"""
import argparse
import importlib.util
import json
import os
import sys
import urllib.request

# Force UTF-8 stdout: node display names contain emoji and the Windows console
# defaults to cp1252, which raises UnicodeEncodeError on print.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ENGINE = os.path.join(REPO, "nodes", "prompt", "utils", "wildcard_engine.py")


def load_engine():
    spec = importlib.util.spec_from_file_location("db_wildcard_engine", ENGINE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_engine():
    eng = load_engine()
    # In-memory wildcard dict so the demo is deterministic and self-contained;
    # the node itself loads these from user_files/wildcards/*.yaml at runtime.
    wd = {
        "clothing/tops/casual": ["t-shirt"],
        "clothing/tops/business": ["blazer"],
        "clothing/footwear/casual": ["sneakers"],
        "clothing/footwear/business": ["heels"],
    }
    tmpl = ("[[reg={Casual|Business}]]a woman, "
            "__clothing/tops/[[reg]]__, __clothing/footwear/[[reg]]__")
    print("== engine: register lock stays coherent across seeds ==")
    for seed in range(5):
        out = eng.process(tmpl, seed, wd)
        pieces = {p.strip() for p in out.split(",")[1:]}
        coherent = pieces <= {"t-shirt", "sneakers"} or pieces <= {"blazer", "heels"}
        assert coherent, "outfit register mixed styles: " + out
        print(f"  seed {seed}: {out}")
    print("  weighted {7::likely|3::rare} @seed1 ->", eng.process("{7::likely|3::rare}", 1, {}))
    print("  OK")


def run_api(url):
    base = url.rstrip("/")
    try:
        with urllib.request.urlopen(base + "/object_info", timeout=6) as r:
            info = json.load(r)
    except Exception as e:  # ComfyUI not running / unreachable
        print(f"== api: SKIPPED (no ComfyUI at {base}: {e}) ==")
        print("   Launch it with Start_ComfyUI.bat, then re-run.")
        return False
    db = {k: v for k, v in info.items() if k.startswith("DirtyBirds")}
    print(f"== api: {len(info)} nodes registered, {len(db)} DirtyBirds ==")
    for name in sorted(db):
        d = db[name]
        req = list(d["input"].get("required", {}))
        opt = list(d["input"].get("optional", {}))
        print(f"  {name}  [{d.get('display_name')}]  cat={d.get('category')}")
        print(f"      required={req}")
        if opt:
            print(f"      optional={opt}")
        print(f"      outputs={d.get('output_name')}")
    assert db, "no DirtyBirds nodes registered in the running ComfyUI"
    print("  OK")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", nargs="?", default="all", choices=["engine", "api", "all"])
    ap.add_argument("--url", default="http://127.0.0.1:8188")
    a = ap.parse_args()
    if a.mode in ("engine", "all"):
        run_engine()
    if a.mode in ("api", "all"):
        run_api(a.url)


if __name__ == "__main__":
    main()
