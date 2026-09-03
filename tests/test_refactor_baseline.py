"""Pass 0 characterization gate for public DirtyBirds contracts.

These checks parse source instead of importing node packages. A public API
refactor gate must still run when optional ComfyUI or model dependencies are not
installed. Runtime behavior remains covered by the focused node tests.
"""

import ast
import importlib.util
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "refactor_baseline"
BASELINE = json.loads((FIXTURES / "public_api.json").read_text(encoding="utf-8"))


def _tree(relative_path):
    return ast.parse((ROOT / relative_path).read_text(encoding="utf-8"))


def _class(tree, name):
    return next(
        node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == name
    )


def _assignment(nodes, name):
    for node in nodes:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and target.id == name:
            return node.value
    raise AssertionError(f"Missing assignment: {name}")


def _module_constants(tree):
    constants = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        try:
            constants[target.id] = ast.literal_eval(node.value)
        except (ValueError, TypeError):
            pass
    constants.update({"PIPE_TYPE": "PIPE_LINE", "PIPE_INPUT": "PIPE_LINE,DIRTYBIRDS_PIPE"})
    return constants


def _literal(node, constants):
    if isinstance(node, ast.Name) and node.id in constants:
        return constants[node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        return [_literal(item, constants) for item in node.elts]
    return ast.literal_eval(node)


def _input_names(node_class):
    method = next(
        node
        for node in node_class.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == "INPUT_TYPES"
    )
    returned = next(
        node.value
        for node in ast.walk(method)
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict)
    )
    groups = {}
    for group_node, values_node in zip(returned.keys, returned.values):
        if not isinstance(group_node, ast.Constant) or not isinstance(values_node, ast.Dict):
            continue
        groups[group_node.value] = [
            key.value for key in values_node.keys if isinstance(key, ast.Constant)
        ]
    return groups


def _mapping_keys(tree, mapping_name):
    value = _assignment(tree.body, mapping_name)
    return [key.value for key in value.keys if isinstance(key, ast.Constant)]


def test_public_node_api_matches_the_reviewed_snapshot():
    by_file = {}
    for registration_key, expected in BASELINE["nodes"].items():
        tree = by_file.setdefault(expected["file"], _tree(expected["file"]))
        node_class = _class(tree, expected["class"])
        constants = _module_constants(tree)

        assert registration_key in _mapping_keys(tree, "NODE_CLASS_MAPPINGS")
        assert registration_key in _mapping_keys(tree, "NODE_DISPLAY_NAME_MAPPINGS")
        display_map = ast.literal_eval(_assignment(tree.body, "NODE_DISPLAY_NAME_MAPPINGS"))
        assert display_map[registration_key] == expected["display"]
        assert _input_names(node_class) == expected["inputs"]
        assert _literal(_assignment(node_class.body, "RETURN_TYPES"), constants) == expected["return_types"]
        assert _literal(_assignment(node_class.body, "RETURN_NAMES"), constants) == expected["return_names"]
        assert _literal(_assignment(node_class.body, "FUNCTION"), constants) == expected["function"]
        assert _literal(_assignment(node_class.body, "CATEGORY"), constants) == expected["category"]
        try:
            output_node = _literal(_assignment(node_class.body, "OUTPUT_NODE"), constants)
        except AssertionError:
            output_node = False
        assert output_node is expected["output_node"]


def test_snapshot_covers_the_aggregators_complete_node_roster():
    tree = _tree("nodes/__init__.py")
    packages = ast.literal_eval(_assignment(tree.body, "_NODE_PACKAGES"))
    mapped = set()
    for package in packages:
        package_tree = _tree(f"nodes/{package}/__init__.py")
        mapped.update(_mapping_keys(package_tree, "NODE_CLASS_MAPPINGS"))
    assert mapped == set(BASELINE["nodes"])


def test_http_routes_match_the_reviewed_snapshot():
    actual = set()
    for path in (ROOT / "nodes").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        constants = _module_constants(tree)
        for node in ast.walk(tree):
            for decorator in getattr(node, "decorator_list", []):
                if not isinstance(decorator, ast.Call) or not decorator.args:
                    continue
                func = decorator.func
                if not isinstance(func, ast.Attribute) or func.attr not in {"get", "post"}:
                    continue
                rendered = ast.unparse(func)
                if "PromptServer.instance.routes" not in rendered:
                    continue
                route = _literal(decorator.args[0], constants)
                actual.add((func.attr.upper(), route))
    assert actual == {tuple(route) for route in BASELINE["routes"]}


def test_server_browser_events_have_both_ends():
    for event in BASELINE["events"]:
        producer = (ROOT / event["producer"]).read_text(encoding="utf-8")
        consumer = (ROOT / event["consumer"]).read_text(encoding="utf-8")
        assert event["name"] in producer
        assert "send_sync" in producer
        assert event["name"] in consumer
        assert "addEventListener" in consumer


def test_pipe_contract_and_legacy_workflow_fixture_stay_compatible():
    pipe_tree = _tree("nodes/_pipe_type.py")
    constants = _module_constants(pipe_tree)
    assert constants["PIPE_TYPE"] == BASELINE["pipe"]["output_type"]
    assert constants["PIPE_INPUT"] == BASELINE["pipe"]["input_type"]

    fixture = json.loads(
        (FIXTURES / "workflows" / "legacy_pipe_type.json").read_text(encoding="utf-8")
    )
    assert fixture["links"][0][5] == "DIRTYBIRDS_PIPE"
    assert "DIRTYBIRDS_PIPE" in constants["PIPE_INPUT"].split(",")
    assert fixture["nodes"][0]["outputs"][0]["type"] == constants["PIPE_TYPE"]

    parent_name = "refactor_baseline_nodes"
    parent = types.ModuleType(parent_name)
    parent.__path__ = [str(ROOT / "nodes")]
    sys.modules[parent_name] = parent
    module_name = f"{parent_name}.pipe"
    spec = importlib.util.spec_from_file_location(
        module_name,
        ROOT / "nodes" / "pipe" / "__init__.py",
        submodule_search_locations=[str(ROOT / "nodes" / "pipe")],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    built = module.DirtyBirdsPipeIn().pack()[0]
    assert set(built) == set(BASELINE["pipe"]["keys"])


def test_prompt_widget_fixture_matches_source_order_and_repair_contract():
    fixture = json.loads(
        (FIXTURES / "workflows" / "prompt_widget_order.json").read_text(encoding="utf-8")
    )
    prompt = BASELINE["nodes"]["DirtyBirdsPrompt"]
    assert fixture["ordered_widgets"] == prompt["inputs"]["required"]
    source = (ROOT / prompt["file"]).read_text(encoding="utf-8")
    assert "if step_enabled is True or step_enabled == 1:" in source
    assert fixture["legacy_shift_value"] != "true"
