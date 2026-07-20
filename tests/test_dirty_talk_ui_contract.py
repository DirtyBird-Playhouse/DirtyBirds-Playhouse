from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROMPT_JS = ROOT / "web" / "jsdirtybirds_prompt.js"
STYLE_CSS = ROOT / "web" / "css" / "style.css"
SHARED_JS = ROOT / "web" / "db_shared.js"


def test_dirty_talk_uses_comfyui_dom_widget_resize_contract():
    source = PROMPT_JS.read_text(encoding="utf-8")

    assert "getMinHeight: () => DB_PANEL_MIN_H + (toyboxExpanded ? DB_TOYBOX_EXPANDED_H : 0)" in source
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
    assert "const layoutVersion = 3" in source
    assert "node._dbMigratePromptLayout" in source
    assert "node.min_height = DB_MIN_H" in source
    assert "Math.max(node.min_height" not in source
    assert "height: DB_PANEL_MIN_H" not in source


def test_dirty_talk_panel_is_compact_without_an_inner_scrollbar():
    prompt_source = PROMPT_JS.read_text(encoding="utf-8")
    shared_source = SHARED_JS.read_text(encoding="utf-8")
    source = STYLE_CSS.read_text(encoding="utf-8")
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
    prompt_source = PROMPT_JS.read_text(encoding="utf-8")
    loader_source = (ROOT / "nodes" / "loader" / "__init__.py").read_text(encoding="utf-8")
    sampler_source = (ROOT / "nodes" / "sampler" / "__init__.py").read_text(encoding="utf-8")

    prompt_backend = (ROOT / "nodes" / "prompt" / "__init__.py").read_text(encoding="utf-8")
    assert '"🗨️ Prompt Builder"' in prompt_backend
    assert "Dirty Talk · Prompt Builder" not in prompt_backend
    assert 'seedHead.textContent = "Seed"' in prompt_source
    assert 'wildcardHead.textContent = "Wildcard"' in prompt_source
    assert "primaryRow.append(seedCol, primaryDivider, wildcardCol)" in prompt_source
    assert 'primaryRow.className = "db-prompt-primary-row"' in prompt_source
    assert prompt_source.count('className = "db-prompt-primary-col"') == 2
    assert 'primaryDivider.className = "db-prompt-primary-divider"' in prompt_source
    assert "toyboxGrid.append(loadBtn, booruBtn, captionBtn, cyclerBtn)" in prompt_source
    assert 'makeSectionLabel("User Prompt")' in prompt_source
    assert 'makeCollapsibleSectionLabel("Prompt Tools"' in prompt_source
    assert "panel.append(scriptLabel, posTA, negTA, primaryRow" in prompt_source
    assert 'text || "_empty_"' not in prompt_source
    assert 'RETURN_NAMES = ("positive", "negative")' in prompt_backend
    assert 'getattr(positive, "db_cycler_text", "")' in loader_source
    assert '"cycler_text":   ("STRING"' not in loader_source
    assert '"db_cycler_text": str(cycler_text or "")' in loader_source
    assert 'pipe.get("db_cycler_text")' in sampler_source
    assert 'pipe.get("loader_settings", {}).get("db_cycler_text")' in sampler_source


def test_generation_setup_name_describes_the_loader_role():
    loader = (ROOT / "nodes" / "loader" / "__init__.py").read_text(encoding="utf-8")
    assert '"⚙️ Generation Setup"' in loader
    assert "Foreplay · Load & Encode" not in loader


def test_optional_panels_share_the_collapsible_ui_contract():
    shared = SHARED_JS.read_text(encoding="utf-8")
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    image = (ROOT / "web" / "jsdirtybirds_image.js").read_text(encoding="utf-8")
    muse = (ROOT / "web" / "jsdirtybirds_muse.js").read_text(encoding="utf-8")
    archive = (ROOT / "web" / "jsdirtybirds_saveprompt.js").read_text(encoding="utf-8")

    assert "export function addCollapsibleTitle" in shared
    assert "export function setDOMWidgetShown" in shared
    assert 'section("Embeddings", "embeddings", state, applyLayout)' in loader
    assert 'section("LoRAs", "loras", state, applyLayout)' in loader
    assert 'makeCollapsibleSectionLabel("Image Tools"' in image
    assert 'makeCollapsibleSectionLabel("LM Response"' in muse
    assert 'makeCollapsibleSectionLabel("Saved Output"' in archive

    # Optional panels start closed and fixed state-based minimums avoid the
    # scrollHeight feedback loop that previously prevented manual resizing.
    for source in (image, muse, archive):
        assert "expanded: false" in source
    assert "embeddings: Boolean(saved.embeddings)" in loader
    assert "optionalSection.isExpanded() ? 330 : 132" in image
    assert "const responseH = responseSection.isExpanded() ? 90 : 0" in muse
    assert "previewSection.isExpanded() ? 420 : 210" in archive


def test_generation_setup_has_truthful_grouping_and_stable_resizing():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    style = STYLE_CSS.read_text(encoding="utf-8")

    assert loader.count("node.addDOMWidget(") == 1
    assert "hideWidgetShared(node, name)" in loader
    assert "hideWidgetShared(node, widgets[name])" not in loader
    assert 'makeSectionLabel("Generation")' in loader
    assert 'section("Embeddings", "embeddings", state, applyLayout)' in loader
    assert 'section("LoRAs", "loras", state, applyLayout)' in loader
    assert 'section("Advanced", "advanced", state, applyLayout)' not in loader
    assert "Optional lora_stack input remains available" not in loader
    assert "No external LoRA stack connected" not in loader
    assert 'denoise.disabled = !isI2I' in loader
    assert 'if (input) input.hidden = !isI2I' in loader
    assert 'Connect an image to use Image → Image.' in loader
    assert 'input?.link != null' in loader
    assert 'node.resizable = true' in loader

    # Section headings reuse the same centered "═ TITLE ▸ expand ═" convention
    # every other DirtyBirds node uses, instead of a bespoke non-centered toggle.
    assert "makeCollapsibleSectionLabel" in loader
    assert 'heading.setTitle(count ? `${title} · ${count}` : title)' in loader

    # Section height is a formula over known state (item counts, whether a
    # preview is reserved), not a flat per-section constant, so short sections
    # don't reserve dead space and long lists don't clip — they scroll instead.
    assert 'const PANEL_BASE_HEIGHT = 340' in loader
    assert "const SECTION_HEIGHTS = { embeddings: 142, loras: 290, advanced: 86 }" not in loader
    assert "function embeddingsHeight()" in loader
    assert "function lorasHeight()" in loader
    assert "Math.min(Math.max(loras.length, 1), LORA_ROW_CAP)" in loader
    assert "Math.min(Math.max(triggerWords.length, 1), TRIGGER_ROW_CAP)" in loader

    assert 'db-generation-workspace' in loader
    assert 'db-generation-model-column' in loader
    assert 'db-generation-settings-column' in loader
    assert 'db-generation-lora-columns' in loader
    assert 'showCardPicker("Checkpoints"' in loader
    assert 'showCardPicker("Add LoRA"' in loader
    assert 'showResolutionPicker(dimensions' in loader
    assert 'showResolutionEditor("Edit Resolutions"' in loader
    # Live width tracking during an interactive drag-resize uses the DOM
    # widget's own afterResize hook (matches jsdirtybirds_prompt.js) instead of
    # hooking node.onResize, which doesn't reliably fire for DOM-widget content.
    assert "afterResize: (resizedNode) => syncPanelWidth(resizedNode)" in loader
    assert "node.onResize = function" not in loader
    assert 'node.min_height = minimumHeight' in loader
    assert "let previousPanelHeight = currentPanelHeight()" in loader
    assert "const panelDelta = panelHeight - previousPanelHeight" in loader
    assert "currentHeight + panelDelta" in loader
    assert "normalizeSavedHeight ? minimumHeight : Math.max(minimumHeight, currentHeight)" in loader
    assert "forceExact" not in loader
    assert "scrollHeight" not in loader
    assert "getBoundingClientRect" not in loader
    assert '"positive", "negative", "workflow"' in loader
    assert "const savedUiVersion = Number(node.properties?.db_generation_ui_version || 0)" in loader
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
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    style = STYLE_CSS.read_text(encoding="utf-8")

    # A single loader shared by checkpoint/LoRA/embedding previews, so none of
    # them silently go blank when the only preview asset is a video.
    assert loader.count("function loadMedia(mount, url, onMissing, onLoaded)") == 1
    assert "video.onloadeddata" in loader
    assert loader.count("loadMedia(") >= 4
    assert "updateEmbeddingPreview(card, name)" in loader
    assert "updateEmbeddingPreview(card, parsed.name)" in loader
    assert 'loadMedia(thumb, `/dirtybirds/lora-preview?name=${encodeURIComponent(item.name)}`' in loader
    assert ".db-generation-embed-preview" in style
    assert ".db-generation-lora-thumb" in style
    assert ".db-generation-preview img," in style
    assert ".db-generation-preview video" in style


def test_generation_setup_revision_is_searchable_current_and_truthful():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    style = STYLE_CSS.read_text(encoding="utf-8")

    # One visual surface: the panel inherits the same background as the node.
    assert 'panel.style.setProperty("--db-node-bg", DB_BGCOLOR)' in loader
    assert "background: var(--db-node-bg, #131313)" in style

    # Large model libraries remain navigable without loading every preview.
    assert 'search.placeholder = `Search ${title.toLowerCase()}`' in loader
    assert '["All folders", ...folders]' in loader
    assert "new IntersectionObserver" in loader
    assert 'rootMargin: "180px"' in loader

    # Workflow warnings update when the image socket is connected or removed.
    assert "_dbRefreshGenerationConnections=refreshWorkflowState" in loader.replace(" ", "")
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
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    assert 'chip.addEventListener("dblclick"' in loader
    assert "db-generation-trigger-input" in loader
    assert 'if (value) item.text = value' in loader


def test_generation_setup_prunes_orphaned_lora_trigger_words_on_load():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    assert "const selectedLoraNames = new Set" in loader
    assert "selectedLoraNames.has(item?.lora)" in loader


def test_generation_setup_rereads_loras_after_saved_widgets_restore():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    sync = loader.split("function syncFromWidgets()", 1)[1].split("}", 1)[0]
    assert "syncLoraStateFromWidgets();" in sync


def test_fixer_picker_routes_missing_legacy_node_id_to_the_only_fixer():
    fixer = (ROOT / "web" / "jsdirtybirds_fixer.js").read_text(encoding="utf-8")
    assert 'd.node_id !== "None"' in fixer
    assert "fixers.length === 1" in fixer


def test_fixer_all_compare_selects_all_three_methods_by_default():
    fixer = (ROOT / "web" / "jsdirtybirds_fixer.js").read_text(encoding="utf-8")
    # Keep-all default: every method starts selected in the shared picker modal.
    assert "const sel = new Set(cards.map((_, i) => i));" in fixer


def test_fixer_delegates_content_height_to_shared_guard():
    fixer = (ROOT / "web" / "jsdirtybirds_fixer.js").read_text(encoding="utf-8")
    assert "function fitNodeToContent" not in fixer
    assert 'im.addEventListener("load",()=>node._dbFitContent?.()' in fixer


def test_every_dirtybirds_node_installs_shared_content_size_guard():
    guard = (ROOT / "web" / "jsdirtybirds_sizeguard.js").read_text(encoding="utf-8")
    shared = (ROOT / "web" / "db_shared.js").read_text(encoding="utf-8")
    assert 'startsWith("DirtyBirds")' in guard
    assert "installContentSizeGuard(this" in guard
    assert "export function installContentSizeGuard" in shared
    assert "height = Math.max(required" in shared
    assert "DIRTYBIRDS_NODE_WIDTH" in guard
    assert "MIN_WIDTHS" not in guard
    assert "export const DIRTYBIRDS_NODE_WIDTH = 360" in shared


def test_every_custom_widget_receives_the_shared_design_system():
    shared = (ROOT / "web" / "db_shared.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "css" / "style.css").read_text(encoding="utf-8")
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
        source = path.read_text(encoding="utf-8")
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
    prompt = (ROOT / "web" / "jsdirtybirds_prompt.js").read_text(encoding="utf-8")
    assert "DB_MIN_W" not in prompt
    assert "node.min_width" not in prompt


def test_node_modules_have_no_local_width_authority():
    offenders = []
    for path in (ROOT / "web").glob("jsdirtybirds*.js"):
        if path.name == "jsdirtybirds_sizeguard.js":
            continue
        source = path.read_text(encoding="utf-8")
        for marker in ("node.min_width", "DB_MIN_W", "MIN_W =", "size[0] <"):
            if marker in source:
                offenders.append(f"{path.name}:{marker}")
    assert not offenders, f"local node width sizing found: {offenders}"


def test_generation_setup_disabled_controls_explain_themselves():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    assert 'denoise.title = isI2I ? "" : "Denoise only applies in Image → Image mode"' in loader
    assert "resolution.title = isI2I ?" in loader


def test_generation_setup_seed_buttons_use_truthful_modes():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")

    # Fixed / Random / Last render as one segmented control (each cell carries
    # the shared "db-generation-segment-btn" class), still driving the truthful
    # fixed/random seed modes rather than fake "⚄ Each/New" labels.
    assert 'button("Fixed", () => setSeedMode("fixed"), "db-generation-segment-btn")' in loader
    assert 'button("Random", () => setSeedMode("random"), "db-generation-segment-btn")' in loader
    assert 'button("Last", () =>' in loader
    assert 'db-generation-segment' in loader
    assert 'fixedSeed.classList.toggle("is-active", value !== "random")' in loader
    assert 'randomSeed.classList.toggle("is-active", value === "random")' in loader
    assert 'button("⚄ Each"' not in loader
    assert 'button("⚄ New"' not in loader


def test_sampler_output_controls_are_grouped_at_the_bottom():
    sampler = (ROOT / "web" / "jsdirtybirds_sampler.js").read_text(encoding="utf-8")
    style = STYLE_CSS.read_text(encoding="utf-8")

    assert 'addTitle("db_outputlabel", "Output")' in sampler
    assert 'outputControls.className = "db-sampler-output-controls"' in sampler
    assert "outputControls.append(batchBtn, overlayBtn)" in sampler
    assert "leftCol.append(samplerBtn.row, schedulerBtn.row)" in sampler
    assert "leftCol.append(samplerBtn.row, schedulerBtn.row, batchBtn, overlayBtn)" not in sampler
    assert sampler.index('addTitle("db_outputlabel", "Output")') > sampler.index("setImageSelectShown(false)")
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
    sampler = (ROOT / "web" / "jsdirtybirds_sampler.js").read_text(encoding="utf-8")

    assert "body: JSON.stringify({ token, selection })" in sampler
    assert "const result = await response.json()" in sampler
    assert "if (!result?.ok) throw new Error" in sampler


def test_generation_setup_has_no_external_custom_node_dependency():
    loader = (ROOT / "web" / "jsdirtybirds.js").read_text(encoding="utf-8")
    backend = (ROOT / "nodes" / "loader" / "__init__.py").read_text(encoding="utf-8")
    library_backend = (ROOT / "nodes" / "loader" / "library_backend.py").read_text(encoding="utf-8")
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
    image = (ROOT / "web" / "jsdirtybirds_image.js").read_text(encoding="utf-8")
    assert "panel.append(fileInput, sourceLabel, sourceRow, urlWrap, sourceSummary, status" in image
    assert 'makeSectionLabel("Source")' in image
    assert 'makeCollapsibleSectionLabel("Image Tools"' in image
    assert 'urlInput.value = ""' in image
    assert image.count('new CustomEvent("dirtybirds:image-source-changed")') >= 3


def test_image_loader_ui_has_truthful_resize_state():
    image = (ROOT / "web" / "jsdirtybirds_image.js").read_text(encoding="utf-8")
    style = STYLE_CSS.read_text(encoding="utf-8")

    assert 'sourceSummary.className = "db-image-source-summary"' in image
    assert 'if (!src) { restoreSelectedFilePreview(); return; }' in image
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
    prompt = PROMPT_JS.read_text(encoding="utf-8")
    image = (ROOT / "web" / "jsdirtybirds_image.js").read_text(encoding="utf-8")
    style = STYLE_CSS.read_text(encoding="utf-8")

    # Collapsed Toybox communicates active cycler content.
    assert 'toyboxSection.setTitle(count ? `Prompt Tools · Cycler: ${count}` : "Prompt Tools")' in prompt

    image_backend = (ROOT / "nodes" / "image" / "__init__.py").read_text(encoding="utf-8")
    assert '"📸 Image Loader"' in image_backend
    assert "Peep Show" not in image_backend

    # Image-dependent tools are unavailable until Image Loader has an image.
    assert "button.disabled = !available" in prompt
    assert 'button.title = available ? "" : "Load an image in Image Loader first"' in prompt
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


def test_prompt_enhance_auto_reads_the_nearest_prompt_builder():
    backend = (ROOT / "nodes" / "muse" / "__init__.py").read_text(encoding="utf-8")
    frontend = (ROOT / "web" / "jsdirtybirds_muse.js").read_text(encoding="utf-8")

    assert '"✍️ Prompt Enhance"' in backend
    assert "The Muse · LLM Prompt Writer" not in backend
    assert 'makeSectionLabel("Prompt Enhance")' in frontend
    assert "promptBuildersByDistance" in frontend
    assert "return distance(a) - distance(b)" in frontend
    assert 'text_in: sourceText' in frontend
    assert "db_muse_source_node_id" in frontend
    assert 'showPromptFlyout("Prompt Source"' not in frontend  # formatted across lines
    assert '"Prompt Source",' in frontend
    assert 'sourcePreview.className = "db-muse-source-preview"' in frontend
    assert 'makeSectionLabel("Enhancement Instructions")' in frontend
    assert '["preview", "Preview Only"]' in frontend
    assert '["replace", "Replace"]' in frontend
    assert '["append", "Append"]' in frontend
    assert 'responseBox.addEventListener("input"' in frontend
    assert 'makeCollapsibleSectionLabel("Advanced Input"' in frontend
    assert "input.hidden = !visible && input.link == null" in frontend
    assert 'generateBtn.textContent = "Enhance Prompt"' in frontend
    assert 'sendBtn.textContent = "Apply to Prompt Builder"' in frontend
    assert "panelWidget.computedHeight" not in frontend
    assert "node.size[1] =" not in frontend
    assert "node.resizable = true" in frontend
    # Retained as an optional input so previously wired workflows still load.
    assert '"text_in": ("STRING"' in backend
