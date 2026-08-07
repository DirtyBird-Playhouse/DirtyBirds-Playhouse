"""UI contract guards.

Every assertion here quotes a snippet of real source. They read through
``read_source`` so that re-formatting a file (line wrapping, trailing commas,
hex-literal case) can't silently switch the guards off — see
``tests/_source_text.py``.
"""

import re
from pathlib import Path

from _source_text import read_source

ROOT = Path(__file__).resolve().parents[1]


def _load_module(name, relative_path):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


overlay_module = _load_module("db_text_overlay", "nodes/sampler/text_overlay.py")
PROMPT_JS = ROOT / "web" / "jsdirtybirds_prompt.js"
STYLE_CSS = ROOT / "web" / "css" / "style.css"
SHARED_JS = ROOT / "web" / "db_shared.js"


def test_dirty_talk_uses_comfyui_dom_widget_resize_contract():
    source = read_source(PROMPT_JS)

    assert (
        "getMinHeight: () => DB_PANEL_MIN_H + (toyboxExpanded ? DB_TOYBOX_EXPANDED_H : 0)"
        in source
    )
    assert "afterResize: (resizedNode)" in source
    assert "node.resizable = true" in source

    # ComfyUI's layout engine owns these values. Writing them from inside the
    # DOM widget creates a resize feedback loop and blocks normal drag-resize.
    assert "scriptPanelWidget.computedHeight" not in source
    assert "node.onResize = function" not in source
    # One user-driven Toybox resize and one versioned, one-shot migration are
    # allowed. There must be no recurring resize feedback loop.
    assert source.count("node.setSize(") == 2
    assert "db_prompt_layout_version" in source
    assert "const layoutVersion = 4" in source
    assert "node._dbMigratePromptLayout" in source
    assert "node.min_height = DB_MIN_H" in source
    assert "Math.max(node.min_height" not in source
    assert "height: DB_PANEL_MIN_H" not in source


def test_dirty_talk_panel_is_compact_without_an_inner_scrollbar():
    prompt_source = read_source(PROMPT_JS)
    shared_source = read_source(SHARED_JS)
    source = read_source(STYLE_CSS)
    block = source.split(".db-script-panel {", 1)[1].split("}", 1)[0]

    assert "previewExpanded" not in prompt_source
    assert "cyclerExpanded" not in prompt_source
    assert "openCyclerFlyout" in prompt_source
    assert 'title.textContent = "The Cycler"' in prompt_source
    assert 'editor.placeholder = "one prompt addition per line"' in prompt_source
    assert "previewSplit.style.display" not in prompt_source
    assert "height: 100%" in block
    assert "min-height: 0" in block
    assert "overflow: hidden" in block
    assert "overflow-y: auto" not in block
    assert "widget.computeSize = () => [0, -4]" in prompt_source
    assert "widget.computedHeight = 0" in prompt_source
    assert "w.computeSize    = () => [0, -4]" in shared_source
    assert "w.computedHeight = 0" in shared_source


def test_seed_row_is_first_and_cycler_travels_through_db_pipe():
    prompt_source = read_source(PROMPT_JS)
    loader_source = read_source(ROOT / "nodes" / "loader" / "__init__.py")
    sampler_source = read_source(ROOT / "nodes" / "sampler" / "__init__.py")

    prompt_backend = read_source(ROOT / "nodes" / "prompt" / "__init__.py")
    assert '"🗨️ Prompt Builder"' in prompt_backend
    assert "Dirty Talk · Prompt Builder" not in prompt_backend
    assert 'seedHead.textContent = "Seed"' in prompt_source
    assert 'wildcardHead.textContent = "Wildcard"' in prompt_source
    assert "primaryRow.append(seedCol, primaryDivider, wildcardCol)" in prompt_source
    assert 'primaryRow.className = "db-prompt-primary-row"' in prompt_source
    assert prompt_source.count('className = "db-prompt-primary-col"') == 2
    assert 'primaryDivider.className = "db-prompt-primary-divider"' in prompt_source
    assert (
        "toyboxGrid.append(loadBtn, booruBtn, captionBtn, cyclerBtn)" in prompt_source
    )
    assert 'makeSectionLabel("User Prompt")' in prompt_source
    assert 'makeCollapsibleSectionLabel("Prompt Tools"' in prompt_source
    assert "panel.append(scriptLabel, posTA, negTA, primaryRow" in prompt_source
    assert 'text || "_empty_"' not in prompt_source
    assert 'RETURN_NAMES = ("positive", "negative", "cycler_line")' in prompt_backend
    # The cycler line travels on its own socket, straight to Sampler & Picker.
    # It must never ride on the prompt string again: a str subclass is destroyed
    # by any node that rebuilds the prompt (Prompt Enhance, a reroute, even a
    # no-op .strip()), and the overlay then fails silently.
    assert "OUTPUT_IS_LIST = (True, False, True)" in prompt_backend
    assert '"cycler_line": ("STRING"' in sampler_source
    assert 'cycler_text = str(cycler_line or "").strip()' in sampler_source
    for source in (prompt_backend, loader_source, sampler_source):
        assert "db_cycler_text" not in source
        assert "CyclerPrompt" not in source


def test_sampler_buttons_report_the_real_picker_state():
    """The buttons must mirror should_bypass_picker() exactly.

    Batch mode or Text Overlay turns the picker off, and nothing else is
    consulted. The two sides drifted once — the UI checked whether cycler_line
    was wired while Python required a non-blank line, so an empty Cycler left
    the button saying "Picker off" while the picker still ran.
    """
    sampler = read_source(ROOT / "web" / "jsdirtybirds_sampler.js")
    # Python's rule, exercised rather than pattern-matched.
    assert overlay_module.should_bypass_picker(True, False)
    assert overlay_module.should_bypass_picker(False, True)
    assert not overlay_module.should_bypass_picker(False, False)
    # The JS mirror of it: the same two flags, no third condition.
    assert "_batchOn || overlayOn()" in sampler
    assert "cyclerWired()" not in sampler.split("const pickerOff")[1][:200]
    # The wire still decides whether a caption is drawn, so it is still checked
    # — for the tooltip only, never for the picker state.
    assert 'slot?.name === "cycler_line"' in sampler
    assert '"Text Overlay: ON · Picker off"' in sampler


def test_generation_setup_name_describes_the_loader_role():
    loader = read_source(ROOT / "nodes" / "loader" / "__init__.py")
    assert '"⚙️ Generation Setup"' in loader
    assert "Foreplay · Load & Encode" not in loader


def test_optional_panels_share_the_collapsible_ui_contract():
    shared = read_source(SHARED_JS)
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    image = read_source(ROOT / "web" / "jsdirtybirds_image.js")
    muse = read_source(ROOT / "web" / "jsdirtybirds_muse.js")
    savePrompt = read_source(ROOT / "web" / "jsdirtybirds_saveprompt.js")

    assert "export function addCollapsibleTitle" in shared
    assert "export function setDOMWidgetShown" in shared
    assert 'section("Embeddings", "embeddings", state, applyLayout)' in loader
    assert 'section("LoRAs", "loras", state, applyLayout)' in loader
    assert 'makeCollapsibleSectionLabel("Image Tools"' in image
    assert 'makeCollapsibleSectionLabel("LM Response"' in muse
    assert 'makeCollapsibleSectionLabel("Saved Output"' in savePrompt

    # Optional panels start closed and fixed state-based minimums avoid the
    # scrollHeight feedback loop that previously prevented manual resizing.
    for source in (image, muse, savePrompt):
        assert "expanded: false" in source
    assert "embeddings: Boolean(saved.embeddings)" in loader
    assert "optionalSection.isExpanded() ? 330 : 132" in image
    assert "const responseH = responseSection.isExpanded() ? 90 : 0" in muse
    # Save Prompt's minimum is now a named function over constants rather than an
    # inline ternary, because it also has to account for the saved image.
    assert "previewSection.isExpanded()" in savePrompt
    assert "PANEL_COLLAPSED" in savePrompt


def test_generation_setup_has_truthful_grouping_and_stable_resizing():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    style = read_source(STYLE_CSS)

    assert loader.count("node.addDOMWidget(") == 1
    assert "hideWidgetShared(node, name)" in loader
    assert "hideWidgetShared(node, widgets[name])" not in loader
    assert 'makeSectionLabel("Generation")' in loader
    assert 'section("Embeddings", "embeddings", state, applyLayout)' in loader
    assert 'section("LoRAs", "loras", state, applyLayout)' in loader
    assert 'section("Advanced", "advanced", state, applyLayout)' not in loader
    assert "Optional lora_stack input remains available" not in loader
    assert "No external LoRA stack connected" not in loader
    assert "denoise.disabled = !isI2I" in loader
    assert "if (input) input.hidden = !isI2I" in loader
    assert "Connect an image to use Image → Image." in loader
    assert "input?.link != null" in loader
    assert "node.resizable = true" in loader

    # Section headings reuse the same centered "═ TITLE ▸ expand ═" convention
    # every other DirtyBirds node uses, instead of a bespoke non-centered toggle.
    assert "makeCollapsibleSectionLabel" in loader
    assert "heading.setTitle(count ? `${title} · ${count}` : title)" in loader

    # Section height is a formula over known state (item counts, whether a
    # preview is reserved), not a flat per-section constant, so short sections
    # don't reserve dead space and long lists don't clip — they scroll instead.
    assert "const PANEL_BASE_HEIGHT =" in loader
    assert (
        "const SECTION_HEIGHTS = { embeddings: 142, loras: 290, advanced: 86 }"
        not in loader
    )
    assert "function embeddingsHeight()" in loader
    assert "function lorasHeight()" in loader
    # The numbers themselves are measured against a live node and may change;
    # what must not change is that the height follows the real item counts and
    # caps at a scroll rather than growing without limit.
    assert "Math.min(loras.length, LORA_ROW_CAP)" in loader
    assert "Math.min(triggerWords.length, TRIGGER_ROW_CAP)" in loader
    # An empty list is a one-line placeholder, not a reserved row. Treating it
    # as a row left ~100px of blank space under a collapsed LoRA section.
    assert "LORA_EMPTY_H" in loader
    assert "Math.max(loras.length, 1)" not in loader
    assert "Math.max(triggerWords.length, 1)" not in loader

    assert "db-generation-workspace" in loader
    assert "db-generation-model-column" in loader
    assert "db-generation-settings-column" in loader
    assert "db-generation-lora-columns" in loader
    assert 'showCardPicker("Checkpoints"' in loader
    assert 'showCardPicker("Add LoRA"' in loader
    assert "showResolutionPicker(dimensions" in loader
    assert 'showResolutionEditor("Edit Resolutions"' in loader
    # Live width tracking during an interactive drag-resize uses the DOM
    # widget's own afterResize hook (matches jsdirtybirds_prompt.js) instead of
    # hooking node.onResize, which doesn't reliably fire for DOM-widget content.
    assert "afterResize: (resizedNode) => syncPanelWidth(resizedNode)" in loader
    assert "node.onResize = function" not in loader
    assert "node.min_height = minimumHeight" in loader
    assert "let previousPanelHeight = currentPanelHeight()" in loader
    assert "const panelDelta = panelHeight - previousPanelHeight" in loader
    assert "currentHeight + panelDelta" in loader
    assert (
        "normalizeSavedHeight ? minimumHeight : Math.max(minimumHeight, currentHeight)"
        in loader
    )
    assert "forceExact" not in loader
    assert "scrollHeight" not in loader
    assert "getBoundingClientRect" not in loader
    assert '"positive", "negative", "workflow"' in loader
    assert (
        "const savedUiVersion = Number(node.properties?.db_generation_ui_version || 0)"
        in loader
    )
    assert "function naturalNodeHeight(panelHeight)" in loader
    assert "node.min_height = 0" in loader
    assert "applyLayout(false, savedUiVersion < UI_VERSION)" in loader
    # Only the plain label builder is reused, never the widget-registering
    # helpers (a comment documents why; check the call form, not the mention).
    assert "addCollapsibleTitle(" not in loader
    assert "setDOMWidgetShown(" not in loader
    assert "formerWidgetNames" not in loader
    assert "db_generation_ui_version" in loader
    assert ".db-generation-panel" in style
    assert ".db-generation-workspace" in style
    assert ".db-generation-lora-columns" in style
    assert ".db-generation-card-grid" in style
    assert ".db-generation-warning" in style
    assert ".db-generation-section-body[hidden]" in style


def test_generation_setup_previews_fall_back_to_video_and_never_go_blank():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    style = read_source(STYLE_CSS)

    # A single loader shared by checkpoint/LoRA/embedding previews, so none of
    # them silently go blank when the only preview asset is a video.
    assert loader.count("function loadMedia(mount, url, onMissing, onLoaded)") == 1
    assert "video.onloadeddata" in loader
    assert loader.count("loadMedia(") >= 4
    assert "updateEmbeddingPreview(card, name)" in loader
    assert "updateEmbeddingPreview(card, parsed.name)" in loader
    assert (
        "loadMedia(thumb, `/dirtybirds/lora-preview?name=${encodeURIComponent(item.name)}`"
        in loader
    )
    assert ".db-generation-embed-preview" in style
    assert ".db-generation-lora-thumb" in style
    assert ".db-generation-preview img," in style
    assert ".db-generation-preview video" in style


def test_generation_setup_revision_is_searchable_current_and_truthful():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    style = read_source(STYLE_CSS)

    # One visual surface: the panel inherits the same background as the node.
    assert 'panel.style.setProperty("--db-node-bg", DB_BGCOLOR)' in loader
    assert "background: var(--db-node-bg, #131313)" in style

    # Large model libraries remain navigable without loading every preview.
    assert "search.placeholder = `Search ${title.toLowerCase()}`" in loader
    assert '["All folders", ...folders]' in loader
    assert "new IntersectionObserver" in loader
    assert 'rootMargin: "180px"' in loader

    # Workflow warnings update when the image socket is connected or removed.
    assert "node._dbRefreshGenerationConnections = refreshWorkflowState" in loader
    assert "originalConnectionsChange" in loader
    assert "this._dbRefreshGenerationConnections?.()" in loader

    # Counts describe enabled selections, not stale or inactive records.
    assert ".filter((item) => item.name && item.active).length" in loader
    assert "loras.filter((item) => item.active !== false).length" in loader
    assert "externalLoras" not in loader

    # Custom resolution controls communicate the backend's latent-safe step.
    assert "width.step = 8" in loader
    assert "height.step = 8" in loader


def test_generation_setup_lora_trigger_words_are_renameable_inline():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    assert 'chip.addEventListener("dblclick"' in loader
    assert "db-generation-trigger-input" in loader
    assert "if (value) item.text = value" in loader


def test_generation_setup_prunes_orphaned_lora_trigger_words_on_load():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    assert "const selectedLoraNames = new Set" in loader
    assert "selectedLoraNames.has(item?.lora)" in loader


def test_generation_setup_rereads_loras_after_saved_widgets_restore():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    sync = loader.split("function syncFromWidgets()", 1)[1].split("}", 1)[0]
    assert "syncLoraStateFromWidgets();" in sync


def test_the_fixer_node_is_retired():
    """Face restore, upscale and sharpen are passes of the ✨ Finish node now.

    The Fixer duplicated the edit surface, and its diffusion path duplicated a
    sampler the Inpainting node already had. Retiring it is what let the vendored
    Forbidden Vision tree go with it.
    """
    assert not (ROOT / "nodes" / "fixer").exists()
    assert not (ROOT / "web" / "jsdirtybirds_fixer.js").exists()
    assert "fixer" not in read_source(ROOT / "nodes" / "__init__.py")
    finish = read_source(ROOT / "nodes" / "finish" / "__init__.py")
    for pass_name in ("upscale_image", "FaceRestoreManager", "sharpen_image"):
        assert pass_name in finish


def test_no_node_module_shadows_a_shared_import():
    """A local declaration reusing an imported name is silently fatal.

    jsdirtybirds_inpaint.js declared `function makeSelect(label, widget)` while
    also importing `makeSelect` from db_shared.js. The local one shadowed the
    import, so its own `makeSelect()` call recursed into itself — a stack
    overflow inside onNodeCreated. The node still listed in the Add Node menu
    but could not be added to the graph, with nothing in the ComfyUI log,
    because the failure is entirely browser-side.
    """
    shared = read_source(ROOT / "web" / "db_shared.js")
    exported = set(re.findall(r"^export (?:function|const) (\w+)", shared, re.M))

    offenders = []
    for path in (ROOT / "web").glob("jsdirtybirds*.js"):
        source = read_source(path)
        imported = set()
        for block in re.findall(
            r'import\s*\{(.*?)\}\s*from\s*"\./db_shared\.js"', source, re.S
        ):
            imported |= {
                name.strip().split(" as ")[-1].strip()
                for name in block.split(",")
                if name.strip()
            }
        for name in sorted(imported & exported):
            if re.search(
                rf"^\s*(?:function|const|let|var)\s+{re.escape(name)}\b", source, re.M
            ):
                offenders.append(f"{path.name}:{name}")

    assert not offenders, f"local declarations shadow shared imports: {offenders}"


def test_no_node_reintroduces_a_measure_resize_loop():
    """Panel heights come from hand-maintained constants on purpose.

    A ResizeObserver that measures content and calls setSize re-triggers itself,
    because resizing a node resizes the very widget elements being observed. That
    loop pegged the canvas and clipped in-node previews; it must not come back.
    """
    shared = read_source(ROOT / "web" / "db_shared.js")
    assert "new ResizeObserver" not in shared
    assert "installContentSizeGuard" not in shared
    for path in (ROOT / "web").glob("jsdirtybirds*.js"):
        assert "new ResizeObserver" not in read_source(path), path.name


def test_save_prompt_does_not_resize_itself_from_onResize():
    """The other half of the measure/resize loop, without a ResizeObserver.

    Save Prompt measured panel.scrollHeight and called setSize to match, from
    inside its own onResize. Dragging the resize handle fired onResize, which
    immediately overwrote the new height with the measured one — the node looked
    like it refused to resize and snapped back. Reported 2026-07-31.

    onResize may adjust widths (read from the node) but must not set the node's
    size, and the panel height must come from constants.
    """
    source = read_source(ROOT / "web" / "jsdirtybirds_saveprompt.js")

    body = source.split("node.onResize = function", 1)
    assert len(body) == 2, "expected Save Prompt to still hook onResize"
    handler = body[1].split("};", 1)[0]
    assert "setSize" not in handler, "onResize must not resize the node"
    assert "syncPanelH" not in handler, "that path resizes the node"

    # Heights are named constants, not measurements.
    assert re.search(r"const PANEL_COLLAPSED = \d+;", source)
    assert re.search(r"const PANEL_EXPANDED = \d+;", source)
    assert re.search(r"const PANEL_WITH_IMAGE = \d+;", source)
    assert "panel.scrollHeight" not in source.replace("panel.scrollHeight and", "")


def test_every_dirtybirds_node_gets_the_shared_control_surface():
    surface = read_source(ROOT / "web" / "jsdirtybirds_surface.js")
    shared = read_source(ROOT / "web" / "db_shared.js")
    assert 'startsWith("DirtyBirds")' in surface
    assert "applyControlSurface(this" in surface
    assert "export function applyControlSurface" in shared
    assert "DIRTYBIRDS_NODE_WIDTH" in surface
    assert "MIN_WIDTHS" not in surface
    assert "export const DIRTYBIRDS_NODE_WIDTH = 360" in shared


def test_collapsed_dom_widgets_use_the_frontend_hidden_type():
    """ComfyUI sizes DOM widgets via computeLayoutSize(), which only zero-sizes a
    widget whose `type` is "hidden". Setting computeSize/getMinHeight alone is a
    no-op on current frontends, which is how the Fixer preview kept vanishing."""
    shared = read_source(ROOT / "web" / "db_shared.js")
    assert 'widget.type = shown ? widget._dbOpenType : "hidden";' in shared
    # Capture the open state behind a dedicated flag: a truthiness check on the
    # captured value re-captures the collapsed stub and latches the widget shut.
    assert "if (!widget._dbOpenCaptured) {" in shared


def test_every_custom_widget_receives_the_shared_design_system():
    shared = read_source(ROOT / "web" / "db_shared.js")
    css = read_source(ROOT / "web" / "css" / "style.css")
    assert 'classList?.add("db-control-surface")' in shared
    assert "--db-font:" in css
    assert ".db-control-surface button" in css
    assert '.db-control-surface input[type="range"]' in css
    assert "--db-column-gap:" in css
    assert "--db-preview-max-height:" in css
    assert "@container (max-width:" not in css


def test_node_modules_use_shared_form_components():
    offenders = []
    for path in (ROOT / "web").glob("jsdirtybirds*.js"):
        if path.name == "jsdirtybirds_prompt_helpers.js":
            # Helpers are part of the node UI surface and follow the same rule.
            pass
        source = read_source(path)
        if 'document.createElement("button")' in source:
            offenders.append(f"{path.name}:button")
        if 'document.createElement("textarea")' in source:
            offenders.append(f"{path.name}:textarea")
        if 'document.createElement("input")' in source:
            offenders.append(f"{path.name}:input")
        if 'document.createElement("select")' in source:
            offenders.append(f"{path.name}:select")
    assert not offenders, f"controls bypass shared components: {offenders}"


def test_prompt_builder_has_no_local_node_width():
    prompt = read_source(ROOT / "web" / "jsdirtybirds_prompt.js")
    assert "DB_MIN_W" not in prompt
    assert "node.min_width" not in prompt


def test_node_modules_have_no_local_width_authority():
    offenders = []
    for path in (ROOT / "web").glob("jsdirtybirds*.js"):
        if path.name == "jsdirtybirds_surface.js":
            continue
        source = read_source(path)
        for marker in ("node.min_width", "DB_MIN_W", "MIN_W =", "size[0] <"):
            if marker in source:
                offenders.append(f"{path.name}:{marker}")
    assert not offenders, f"local node width sizing found: {offenders}"


def test_generation_setup_disabled_controls_explain_themselves():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    assert (
        'denoise.title = isI2I ? "" : "Denoise only applies in Image → Image mode"'
        in loader
    )
    assert "resolution.title = isI2I ?" in loader


def test_generation_setup_seed_buttons_use_truthful_modes():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")

    # Fixed / Random / Last render as one segmented control (each cell carries
    # the shared "db-generation-segment-btn" class), still driving the truthful
    # fixed/random seed modes rather than fake "⚄ Each/New" labels.
    # "Fixed" mimics rgthree's "New Fixed Random": roll a fresh seed, then hold it.
    assert "setWidget(widgets.seed, newRandomSeed(), node)" in loader
    assert 'setSeedMode("fixed")' in loader
    assert (
        'button("Random", () => setSeedMode("random"), "db-generation-segment-btn")'
        in loader
    )
    assert 'button("Last", () =>' in loader
    assert "db-generation-segment" in loader
    assert 'fixedSeed.classList.toggle("is-active", value !== "random")' in loader
    assert 'randomSeed.classList.toggle("is-active", value === "random")' in loader
    assert 'button("⚄ Each"' not in loader
    assert 'button("⚄ New"' not in loader


def test_sampler_output_controls_are_grouped_at_the_bottom():
    sampler = read_source(ROOT / "web" / "jsdirtybirds_sampler.js")
    style = read_source(STYLE_CSS)

    assert 'addTitle("db_outputlabel", "Output")' in sampler
    assert 'outputControls.className = "db-sampler-output-controls"' in sampler
    assert "outputControls.append(batchBtn, overlayBtn)" in sampler
    assert "leftCol.append(samplerBtn.row, schedulerBtn.row)" in sampler
    assert (
        "leftCol.append(samplerBtn.row, schedulerBtn.row, batchBtn, overlayBtn)"
        not in sampler
    )
    assert sampler.index('addTitle("db_outputlabel", "Output")') > sampler.index(
        "setImageSelectShown(false)"
    )
    assert ".db-sampler-output-controls" in style
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in style
    assert "const TITLE_H = 26" in sampler
    assert "height: TITLE_H, getMinHeight: () => TITLE_H" in sampler
    assert "height: 30px;" in style
    assert "padding: 0 0 2px;" in style
    assert "hideWidget as hideWidgetShared" in sampler
    assert "return hideWidgetShared(node, name)" in sampler
    assert "w.computeSize    = () => [0, 0]" not in sampler


def test_sampler_picker_only_closes_after_multi_selection_is_accepted():
    sampler = read_source(ROOT / "web" / "jsdirtybirds_sampler.js")

    assert "body: JSON.stringify({ token, selection })" in sampler
    assert "const result = await response.json()" in sampler
    assert "if (!result?.ok) throw new Error" in sampler


def test_generation_setup_has_no_external_custom_node_dependency():
    loader = read_source(ROOT / "web" / "jsdirtybirds.js")
    backend = read_source(ROOT / "nodes" / "loader" / "__init__.py")
    library_backend = read_source(ROOT / "nodes" / "loader" / "library_backend.py")
    assert 'folder_paths.get_filename_list_("loras")' in library_backend
    assert 'folder_paths.filename_list_cache["loras"]' in library_backend
    # LoRA Manager integration is intentional and OPTIONAL: the loader monkey-
    # patches LoRA Manager's registry only if it is installed and listens for its
    # "lora_code_update" event, degrading silently when it is absent. So a
    # reference to lora-manager is allowed; hard deps on other packs are not.
    banned = ("comfyroll", "itools", "rgthree", "impact_pack")
    for term in banned:
        assert term not in loader.lower()
    for source in (backend, library_backend):
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                assert "comfyroll" not in stripped.lower()
                assert "itools" not in stripped.lower()
                assert "rgthree" not in stripped.lower()
                assert "impact" not in stripped.lower()


def test_image_tools_include_the_url_source_control():
    image = read_source(ROOT / "web" / "jsdirtybirds_image.js")
    assert (
        "panel.append(fileInput, sourceLabel, sourceRow, urlWrap, sourceSummary, status"
        in image
    )
    assert 'makeSectionLabel("Source")' in image
    assert 'makeCollapsibleSectionLabel("Image Tools"' in image
    assert 'urlInput.value = ""' in image
    assert image.count('new CustomEvent("dirtybirds:image-source-changed")') >= 3


def test_image_loader_ui_has_truthful_resize_state():
    image = read_source(ROOT / "web" / "jsdirtybirds_image.js")
    style = read_source(STYLE_CSS)

    assert 'sourceSummary.className = "db-image-source-summary"' in image
    assert "if (!src) { restoreSelectedFilePreview(); return; }" in image
    assert 'toolsSplit.className = "db-image-tools-grid"' in image
    assert "db-prompt-toybox-split" not in image
    assert '"Longest Side", 256, 2048' in image
    assert '["long_side", "Long Side"]' in image
    assert '["custom", "Custom"]' in image
    assert 'sizeControls.style.opacity = on ? "1" : "0.35"' in image
    assert 'optionalSection.setTitle("Image Tools")' in image
    assert 'makeSectionLabel("Segmentation")' not in image
    assert ".db-image-tools-grid" in style


def test_dirty_talk_optional_tool_states_are_clear_and_persisted():
    prompt = read_source(PROMPT_JS)
    image = read_source(ROOT / "web" / "jsdirtybirds_image.js")
    style = read_source(STYLE_CSS)

    # Collapsed Toybox communicates active cycler content.
    assert (
        'toyboxSection.setTitle(count ? `Prompt Tools · Cycler: ${count}` : "Prompt Tools")'
        in prompt
    )

    image_backend = read_source(ROOT / "nodes" / "image" / "__init__.py")
    assert '"📸 Image Loader"' in image_backend
    assert "Peep Show" not in image_backend

    # Image-dependent tools are unavailable until Image Loader has an image.
    assert "button.disabled = !available" in prompt
    assert (
        'button.title = available ? "" : "Load an image in Image Loader first"'
        in prompt
    )
    assert 'new CustomEvent("dirtybirds:image-source-changed")' in image
    assert ".db-prompt-tool-grid .db-lib-btn:disabled" in style

    # The preview is named for what it shows and empty headings are subdued.
    assert 'makeSectionLabel("Preview")' in prompt
    assert 'classList.toggle("db-prompt-md-empty"' in prompt
    assert 'classList.toggle("db-prompt-md-all-empty"' in prompt
    assert ".db-prompt-md-box.db-prompt-md-empty h3" in style
    assert ".db-prompt-md-split.db-prompt-md-all-empty" in style

    # LiteGraph serializes node.properties with the workflow.
    assert "node.properties.db_toybox_expanded = toyboxExpanded" in prompt
    assert "!!node.properties?.db_toybox_expanded" in prompt
    assert "node._dbRestoreToyboxState" in prompt


def test_prompt_enhance_is_a_plain_text_in_text_out_node():
    backend = read_source(ROOT / "nodes" / "muse" / "__init__.py")
    frontend = read_source(ROOT / "web" / "jsdirtybirds_muse.js")

    assert '"✍️ Prompt Enhance"' in backend
    assert "The Muse · LLM Prompt Writer" not in backend
    # A real STRING input and output, wired through the graph like any node.
    assert '"text_in": ("STRING"' in backend
    assert 'RETURN_TYPES = ("STRING",)' in backend
    assert 'RETURN_NAMES = ("text",)' in backend
    assert '"result": (pos_out,)' in backend

    assert 'makeSectionLabel("Prompt Enhance")' in frontend
    assert 'makeSectionLabel("Enhancement Instructions")' in frontend
    assert 'generateBtn.textContent = "Enhance Prompt"' in frontend
    assert "function wiredTextIn()" in frontend
    assert "text_in: sourceText" in frontend
    assert 'responseBox.addEventListener("input"' in frontend
    assert "node.resizable = true" in frontend

    # The old auto-detect-and-apply-to-Prompt-Builder machinery is gone.
    assert "promptBuildersByDistance" not in frontend
    assert "db_muse_source_node_id" not in frontend
    assert "db_muse_apply_mode" not in frontend
    assert "Apply to Prompt Builder" not in frontend
    assert "sendToDirtyTalk" not in frontend
    assert '["preview", "Preview Only"]' not in frontend
    assert 'makeCollapsibleSectionLabel("Advanced Input"' not in frontend


# ── Stylesheet colour drift ──────────────────────────────────────────────────
# The Loader once carried a second, near-identical palette (its own blue, its
# own border grey, its own control background) beside the shared one, so the
# same control looked like two controls depending on which node drew it. These
# guards stop that growing back.

# Values retired when the Loader was folded into the shared tokens. Each one is
# a near-duplicate of a token that already existed; re-introducing any of them
# means someone hand-picked a colour instead of using the token.
RETIRED_COLOURS = {
    "#51aef0": "--db-accent",
    "#3a9de0": "--db-accent",
    "#227ec0": "--db-accent-bg",
    "#155387": "--db-accent-bg",
    "#238bd0": "--db-accent",
    "#4784a8": "--db-accent",
    "#383b40": "--db-border",
    "#393d42": "--db-border",
    "#202226": "--db-control",
    "#25262a": "--db-control",
    "#202125": "--db-surface",
}

# Distinct hex literals in web/css/style.css at the time the Loader palette was
# merged. The stylesheet still hand-codes plenty of one-off decoration colours
# (badges, warnings, category chips); the point of this ceiling is that the
# number goes DOWN over time, never up. Adding a colour means either using an
# existing token or promoting the new colour to one in :root.
STYLESHEET_COLOUR_CEILING = 103


def _stylesheet_hex_literals():
    css = read_source(ROOT / "web" / "css" / "style.css")
    return [value.lower() for value in re.findall(r"#[0-9a-fA-F]{3,8}\b", css)]


def test_stylesheet_does_not_reintroduce_retired_colours():
    present = set(_stylesheet_hex_literals())
    offenders = {
        colour: token for colour, token in RETIRED_COLOURS.items() if colour in present
    }
    assert not offenders, (
        "hand-picked colours are back in web/css/style.css; use the shared token "
        f"instead: {offenders}"
    )


def test_stylesheet_colour_count_does_not_grow():
    distinct = set(_stylesheet_hex_literals())
    assert len(distinct) <= STYLESHEET_COLOUR_CEILING, (
        f"web/css/style.css now uses {len(distinct)} distinct colours, over the "
        f"{STYLESHEET_COLOUR_CEILING} ceiling. Reuse a --db-* token, or promote the "
        "new colour to :root and lower the ceiling deliberately."
    )


def test_every_slider_shares_one_appearance():
    css = read_source(ROOT / "web" / "css" / "style.css")

    # The custom track/thumb lives on the shared control surface, keyed on the
    # input type, so a node cannot opt out by inventing a class name.
    assert '.db-control-surface input[type="range"]::-webkit-slider-thumb' in css
    assert '.db-control-surface input[type="range"]::-moz-range-thumb' in css

    # The Loader's slider class is layout only — it used to set its own
    # accent-color, which is what made it render as the native widget.
    match = re.search(r"\.db-generation-range \{(.*?)\}", css, re.S)
    assert match, ".db-generation-range rule missing"
    assert "accent-color" not in match.group(1)
    assert "#" not in match.group(1)


def test_stylesheet_has_no_unreachable_rules():
    """Every db-* class in the stylesheet is applied by some JS or HTML.

    Dead CSS accumulated here for a long time — retired nodes and older UI
    iterations left ~1,000 lines of rules nothing could ever match, which is
    exactly the kind of thing that makes a stylesheet look like two competing
    design systems. Adding a rule now means wiring it up in the same change.
    """
    css = read_source(ROOT / "web" / "css" / "style.css")
    runtime = "\n".join(
        read_source(path)
        for path in sorted((ROOT / "web").rglob("*"))
        if path.suffix in {".js", ".html"}
    )
    classes = {
        name
        for name in re.findall(r"\.(db-[a-zA-Z0-9_-]+)", css)
        # trailing-hyphen hits come from prose comments like ".db-finish-*"
        if not name.endswith("-")
    }
    unused = sorted(
        name
        for name in classes
        if not re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", runtime)
    )
    assert not unused, (
        "stylesheet rules that nothing can ever match — delete them, or apply the "
        f"class in the node module that needs it: {unused}"
    )


def test_hidden_widget_numeric_repair_never_guesses_from_the_value():
    r"""hideWidget must decide "is this numeric?" from the widget, not its text.

    It installs a serializeValue that emits a number, so that a blank INT from
    an older saved workflow cannot reach ComfyUI and fail on int(""). Deciding
    that by testing parseFloat(w.value) misfires on strings that merely start
    with digits: parseFloat("832x1216") is 832, so the loader's STRING
    `dimension` widget serialized as 832. The backend could not parse that,
    silently fell back to 1024x1024, and the node still displayed 832 x 1216 —
    the resolution control looked correct and was ignored.
    """
    shared = read_source(SHARED_JS)

    # The classification chain must end at null, not fall through to parsing the
    # text. parseFloat is still used *inside* the repair below, which is fine —
    # by then the widget is known to be numeric.
    assert (
        'typeof w.value === "number" && Number.isFinite(w.value) ? w.value : null'
        in shared
    ), (
        "hideWidget is classifying a widget as numeric by parsing its value; "
        "any string starting with digits will be truncated on serialize"
    )
    # The legitimate signals: the widget's declared default, or a value that is
    # already a number.
    assert 'typeof w.options?.default === "number"' in shared
