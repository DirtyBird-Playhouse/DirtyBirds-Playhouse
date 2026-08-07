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


def _render_images_body():
    """The body of node._dbRenderImages, isolated from the rest of the file."""
    source = read_source(SAMPLER_JS)
    start = source.index("node._dbRenderImages = (imgs) => {")
    # The function ends at the call pair that closes the arrow assignment.
    end = source.index("sizeImageCards();syncImgH();};")
    return Source(canon(source)[start:end])


def test_audition_panel_is_shown_when_there_are_images_to_render():
    """The panel must be made visible before the cards go in.

    Hiding it unconditionally at the top of _dbRenderImages meant the picked
    images were appended to a widget with zero computed height — the run
    finished, the DOM was correct, and the node still showed nothing.
    """
    body = _render_images_body()
    assert "setImageSelectShown(true)" in body


def test_the_panel_is_only_hidden_on_the_empty_result_path():
    """setImageSelectShown(false) belongs inside the no-images branch only."""
    body = _render_images_body()
    empty_branch_start = body.index("if(!imgs||!imgs.length){")
    show_at = body.index("setImageSelectShown(true)")
    hide_at = body.index("setImageSelectShown(false)")
    assert empty_branch_start < hide_at < show_at, (
        "the hide call escaped the empty-result branch; it will blank the "
        "panel for real results again"
    )
    assert body.count("setImageSelectShown(false)") == 1


def test_result_previews_open_the_viewer_on_a_single_click():
    """A plain click opens the full viewer. dblclick left the previews dead."""
    body = _render_images_body()
    assert 'card.addEventListener("click",()=>openImageViewer(' in body
    assert "dblclick" not in body
