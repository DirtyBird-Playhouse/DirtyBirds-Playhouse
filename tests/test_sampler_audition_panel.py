"""Contract guards for the Sampler's "The Audition" result panel.

Two bugs lived here undetected because nothing checked them:

* ``_dbRenderImages`` hid the panel and *then* filled it, so every finished
  run — batch or picked-from-the-popup — rendered its images into a
  zero-height widget and the node looked empty.
* The result cards were bound to ``dblclick``, so a normal click on a preview
  did nothing at all.

Both are pure JavaScript, so these assert against the source text the same
way the other UI contract tests do.
"""

from pathlib import Path

from _source_text import Source, canon, read_source

ROOT = Path(__file__).resolve().parents[1]
SAMPLER_JS = ROOT / "web" / "jsdirtybirds_sampler.js"
SAMPLER_PY = ROOT / "nodes" / "sampler" / "__init__.py"


def _render_images_body():
    """The body of node._dbRenderImages, isolated from the rest of the file."""
    source = read_source(SAMPLER_JS)
    start = source.index("node._dbRenderImages = (imgs) => {")
    # The function ends at the call pair that closes the arrow assignment.
    end = source.index("sizeImageCards();syncImgH();};")
    return Source(canon(source)[start:end])


def test_fullscreen_picker_uses_high_resolution_previews():
    source = read_source(SAMPLER_PY)
    assert "PICKER_PREVIEW_MAX_EDGE = 1024" in source
    assert "save_preview(image, max_edge=PICKER_PREVIEW_MAX_EDGE)" in source


def test_audition_panel_is_shown_when_there_are_images_to_render():
    """The panel must be made visible before the cards go in.

    Hiding it unconditionally at the top of _dbRenderImages meant the picked
    images were appended to a widget with zero computed height — the run
    finished, the DOM was correct, and the node still showed nothing.
    """
    body = _render_images_body()
    assert "setImageSelectShown(true)" in body


def test_the_panel_is_only_hidden_on_early_return_paths():
    """Every setImageSelectShown(false) must sit in a branch that returns.

    There are exactly two: the picker-off collapse and the no-images case. A
    third one, or one on the fall-through path, blanks the panel for real
    results — which is how the picked images once rendered into a zero-height
    widget.
    """
    body = _render_images_body()
    picker_off_at = body.index("if(pickerOff()){")
    empty_branch_start = body.index("if(!imgs||!imgs.length){")
    show_at = body.index("setImageSelectShown(true)")
    assert picker_off_at < empty_branch_start < show_at
    assert body.count("setImageSelectShown(false)") == 2
    # Neither hide call may appear after the show call.
    assert body.split("setImageSelectShown(true)")[1].count(
        "setImageSelectShown(false)"
    ) == 0


def test_result_previews_open_the_viewer_on_a_single_click():
    """A plain click opens the full viewer. dblclick left the previews dead."""
    body = _render_images_body()
    assert 'card.addEventListener("click",()=>openImageViewer(' in body
    assert "dblclick" not in body


def _set_image_select_shown_body():
    """The body of setImageSelectShown, isolated from the rest of the file."""
    source = read_source(SAMPLER_JS)
    start = source.index("function setImageSelectShown(shown){")
    end = source.index("setImageSelectShown(false);")
    return Source(canon(source)[start:end])


def test_showing_the_panel_never_shrinks_the_node():
    """Revealing the Audition panel must grow the node, never snap it back.

    setImageSelectShown queued an unconditional node.setSize(node.computeSize())
    inside a double rAF. That landed one frame AFTER syncImgH had already grown
    the node for the result cards — and at that point the <img> elements have
    not loaded, so imgPanel.scrollHeight is still the 96px floor. The node
    shrank to its empty height, so Output, the mode buttons and Pick Timeout
    kept their old offsets and drew over the images, with the last card falling
    outside the node body.
    """
    body = _set_image_select_shown_body()
    assert "if(shown){" in body
    assert "if((node.size?.[1]||0)<needed[1])node.setSize([node.size[0],needed[1]])" in body


def test_hiding_the_panel_still_reclaims_the_space():
    """The shrink is still allowed — only on the hide path."""
    body = _set_image_select_shown_body()
    hide_at = body.index("}else{node.setSize(needed)")
    grow_at = body.index("if((node.size?.[1]||0)<needed[1])")
    assert grow_at < hide_at


def test_the_panel_reserves_height_from_the_card_count_not_scrollheight():
    """Reserved height must be computed, not measured.

    imgPanel.scrollHeight is read inside a rAF that can land before the grid's
    row heights resolve. A short reading means the widget reserves less than
    the grid paints, and .db-pick-grid is overflow:visible — so the result
    images render straight over Output, the mode buttons and Pick Timeout.
    """
    source = read_source(SAMPLER_JS)
    assert "getMinHeight:()=>panelHeight()" in source
    assert "consth=recomputePanelHeight()" in source
    assert 'imgPanel.querySelectorAll(".db-pick-card").length' in source


def test_the_card_height_constant_matches_the_stylesheet():
    """CARD_H is the CSS image cap plus its 1px border top and bottom."""
    css = read_source(ROOT / "web" / "css" / "style.css")
    card_img = css.split(".db-pick-card img{")[1].split("}")[0]
    assert "height:150px" in card_img
    assert "constCARD_H=152" in read_source(SAMPLER_JS)


def test_results_panel_stays_collapsed_when_the_picker_is_off():
    """Batch mode / Text Overlay runs must not expand the node.

    With the picker off the run was never about choosing an image, so the
    results panel has no job. Rendering it anyway grew the node by a card's
    height on every queue during batch testing.
    """
    body = _render_images_body()
    assert "if(pickerOff()){recomputePanelHeight();setImageSelectShown(false)" in body
    # Collapse decided before anything is rendered.
    assert body.index("if(pickerOff())") < body.index("setImageSelectShown(true)")


def test_text_overlay_collapses_the_panel_like_batch_mode_does():
    """Both picker-suppressing buttons must fold the panel away.

    syncPickerVisibility keyed off batchOn() alone, so an overlay run left the
    panel expanded with nothing to pick, and the overlay button never called it.
    """
    source = read_source(SAMPLER_JS)
    assert "constshowSelect=!pickerOff()&&!!node._dbActivePick" in source
    overlay_handler = source.split('overlayBtn.addEventListener("click",()=>{')[1]
    assert "syncPickerVisibility()" in overlay_handler.split("});")[0]


def test_the_layout_path_never_reads_the_dom():
    """getMinHeight must not measure. It is on LiteGraph's per-frame layout
    path, and reading imgPanel.scrollHeight there forces a synchronous layout
    flush on every frame the node is drawn — which pinned a CPU core and froze
    the canvas whenever the node was zoomed in close enough to render at size.
    """
    source = read_source(SAMPLER_JS)
    assert "getMinHeight:()=>panelHeight()" in source
    # panelHeight is a cache read, nothing more.
    body = Source(
        canon(source)[
            source.index("functionpanelHeight(){") : source.index(
                "functionrecomputePanelHeight(){"
            )
        ]
    )
    assert "scrollHeight" not in body
    assert "querySelectorAll" not in body
    assert "returnpanelH" in body
    # The single remaining measurement lives in the recompute path.
    assert source.count("imgPanel.scrollHeight||0") == 1
