/**
 * DirtyBirds Playhouse — Sampler node UI.
 *
 * Styled to match the Loader: titled sections, flyout pickers, sliders.
 *   • The Method — Sampler | Scheduler (two columns w/ splitter), noise slider
 *     (CPU / CPU+GPU / GPU), steps, cfg.
 *   • The Audition — full-width in-node preview of the generated image(s).
 *   • Output — image-picking and cycler text-overlay behavior.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  hideWidget as hideWidgetShared,
  makeSectionLabel,
  nodeInnerW,
  makeButton,
  makeSegment,
  makeTwoColumn,
  makeFlyoutBtn as makeSharedFlyoutBtn,
  makeSlider as makeSharedSlider,
  openPickerModal,
  openImageViewer,
} from "./db_shared.js";

ensureStylesheet();

const NOISE_MODES = ["cpu", "both", "gpu"];
const NOISE_LABELS = { cpu: "CPU", both: "Both", gpu: "GPU" };

// ── No downstream muting ────────────────────────────────────────────────────
// This node used to mute the DirtyBirdsFinish / DirtyBirdsSavePrompt nodes
// hanging off it whenever the picker was off, on the theory that a batch has no
// single chosen image worth finishing. Do not bring that back.
//
// A muted node is stripped from the prompt before it reaches the server, so
// those two node types simply stopped existing as far as ComfyUI was concerned
// — while an ordinary PreviewImage on the image output kept working, which made
// it look like the pipe was failing to carry the image. Worse, `mode` is saved
// into the workflow but the marker recording which sampler set it is not, so
// after one save/reload the mute could never be lifted again.
//
// Both outputs always carry the generation. Whether a downstream node should
// run on a whole batch is the user's decision, made with Ctrl+M, not this
// node's to make for them.

// ── Interactive image picker ────────────────────────────────────────────────
// After sampling, the Python node blocks and pushes the batch into a modal
// picker. Keeping selection outside the node avoids mixing ComfyUI's canvas
// preview widget with absolutely positioned DOM widgets.
const PICK_EVENT = "dirtybirds-sampler-pick";
const PICK_ROUTE = "/dirtybirds/sampler-pick";

let _pick = null; // { token, node }
let _fs = null; // full-screen popup refs, when open

function _viewURL(img) {
  const p = new URLSearchParams({
    filename: img.filename || "",
    subfolder: img.subfolder || "",
    type: img.type || "temp",
  });
  const path = "/view?" + p.toString();
  return api.apiURL ? api.apiURL(path) : path;
}

async function postPick(token, selection) {
  const response = await api.fetchApi(PICK_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, selection }),
  });
  if (!response?.ok)
    throw new Error(
      `Picker reply failed (${response?.status ?? "no response"})`,
    );
  const result = await response.json();
  if (!result?.ok)
    throw new Error("Picker reply was not accepted by the active sampler");
}

// Every message the picker has for the user goes through here.
//
// It used to write only to node._dbPickStatus, which is the inline pick row's
// status line -- and _dbStartPick hides that row before opening the modal. So
// a rejected or failed send updated an element nobody could see: the picker
// stayed open, Send and Cancel looked dead, and there was nothing on screen
// saying why. The modal is the visible surface while it is up; the inline row
// still gets the text for when it isn't.
function pickStatus(text) {
  _fs?.setStatus?.(text);
  _pick?.node?._dbPickStatus?.(text);
}

async function finishPick(selection, { forceCloseOnError = false } = {}) {
  if (!_pick) return;
  const { token, node } = _pick;
  try {
    await postPick(token, selection);
  } catch (err) {
    console.error("[DirtyBirds] Sampler pick reply failed:", err);
    if (!forceCloseOnError) {
      // Say what actually went wrong. "Send failed — retry." hid the useful
      // half: a stale token (a second browser tab answered first, or the run
      // already timed out) needs a different response from a dead connection.
      pickStatus(`Send failed: ${err?.message || err} · Esc to abandon`);
      return;
    }
    // A cancel that cannot reach the server still has to let go of the UI --
    // the alternative is a modal with no working exit. The sampler is still
    // blocked; it stops on its own when the pick timeout expires.
    console.warn(
      "[DirtyBirds] Cancel could not reach the sampler; closing the picker. " +
        "The run stops when its Pick Timeout expires.",
    );
  }
  closeFullScreen();
  node?._dbEndPick?.();
  _pick = null;
}
function sendPick() {
  if (!_pick?.node) return;
  const selection = [...(_pick.node._dbSel || [])].sort((a, b) => a - b);
  if (!selection.length) {
    pickStatus("Select at least one image, or Cancel.");
    return;
  }
  pickStatus(`Sending ${selection.length}…`);
  finishPick(selection);
}
function cancelPick() {
  if (!_pick) return;
  pickStatus("Cancelling…");
  finishPick([], { forceCloseOnError: true });
}

// ── Image picker popup ──────────────────────────────────────────────────────
// Built on the shared modal (openPickerModal). The Sampler owns the selection
// Set (node._dbSel) so its inline pick-row and the modal stay in sync via the
// onToggle -> _dbRepaintInline callback.
function closeFullScreen() {
  _fs?.close();
  _fs = null;
}
function openPickerPopup() {
  if (!_pick?.node) return;
  closeFullScreen();
  const node = _pick.node;
  _fs = openPickerModal({
    images: node._dbImages || [],
    selection: node._dbSel,
    title: "🎯 Pick images",
    viewURL: _viewURL,
    sendLabel: "Send selection",
    cancelLabel: "Cancel run",
    onToggle: () => node._dbRepaintInline?.(),
    onSend: sendPick,
    onCancel: cancelPick,
  });
}

api.addEventListener(PICK_EVENT, (e) => {
  const d = e.detail || {};
  if (Array.isArray(d.images)) {
    const node =
      d.node_id != null
        ? app.graph?.getNodeById?.(Number(d.node_id)) ||
          app.graph?.getNodeById?.(d.node_id)
        : null;
    if (!node) {
      // Stay silent. This used to answer "keep every image" on the user's
      // behalf, which is a confirmation gate failing OPEN -- and send_sync
      // broadcasts the pick to EVERY connected client, not just the one
      // driving the run. A second ComfyUI tab, a stale tab, or any tab with a
      // different workflow loaded cannot resolve node_id, so it auto-approved
      // the whole batch milliseconds after the picker opened. _PickState locks
      // the token on the first reply, so the real user's Cancel then landed on
      // a spent token and was rejected: the picker appeared, Cancel did
      // nothing, and every image went downstream anyway.
      //
      // Answering nothing is the safe move and needs no fallback of its own:
      // the sampler stops waiting at its Pick Timeout and treats no reply as
      // an empty selection, which raises InterruptProcessingException and ends
      // the run cleanly. A client that cannot see the node has no business
      // deciding what that node keeps.
      console.debug(
        `[DirtyBirds] Sampler pick for node ${d.node_id} ignored: not in this ` +
          `tab's graph. If this is the tab running the graph, the picker will ` +
          `not open and the run stops at its Pick Timeout.`,
      );
      return;
    }
    _pick = { token: d.token, node };
    node?._dbStartPick?.(d.token, d.images);
    return;
  }
  if (!_pick || d.token !== _pick.token) return;
  if (d.timeout) {
    closeFullScreen();
    _pick.node?._dbEndPick?.();
    _pick = null;
    return;
  }
  if (typeof d.tick === "number") {
    const m = Math.floor(d.tick / 60),
      s = d.tick % 60;
    const txt = `${m}:${String(s).padStart(2, "0")}`;
    _pick.node?._dbTick?.(txt);
    _fs?.setCountdown(txt);
  }
});

// Expose for the per-node inline controls (defined in onNodeCreated).
const PICK = { sendPick, cancelPick, openPickerPopup, viewURL: _viewURL };

app.registerExtension({
  name: "DirtyBirds.Sampler",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsSampler") return;

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const imgs = message?.db_images;
      if (Array.isArray(imgs)) this._dbRenderImages?.(imgs);
      // Do not recompute the node here. Core has just reserved the correct
      // height for its native preview; shrinking to DOM-widget height makes
      // that preview render through the bottom of the node.
    };

    // Keep ComfyUI's native preview visible during sampling and after the run.
    // Image Select is a separate conditional DOM section beneath it.

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;

      const staleWidgets = new Set(["db_dtlabel", "db_dtpanel", "db_save_btn"]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      // ── helpers ───────────────────────────────────────────────────────────
      function hideWidget(name) {
        return hideWidgetShared(node, name);
      }
      const widthEls = [];
      // The title needs its full line box; hidden native widgets—not headings—
      // must cancel LiteGraph's four-pixel widget-row spacing.
      const TITLE_H = 26;
      function addTitle(name, text) {
        const el = makeSectionLabel(text);
        el.style.cssText +=
          "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
        node.addDOMWidget(name, "customhtml", el, {
          serialize: false,
          height: TITLE_H,
          getMinHeight: () => TITLE_H,
        });
        widthEls.push(el);
      }
      // ── hidden native widgets ─────────────────────────────────────────────
      const samplerWidget = hideWidget("sampler_name");
      const schedulerWidget = hideWidget("scheduler");
      const stepsWidget = hideWidget("steps");
      const cfgWidget = hideWidget("cfg");
      const noiseWidget = hideWidget("noise_mode");
      const batchModeWidget = hideWidget("batch_mode");
      const overlayWidget = hideWidget("overlay_enabled");
      const pickTimeoutWidget = hideWidget("pick_timeout");

      // ── 1. THE METHOD — buttons left | splitter | sliders right ───────────
      addTitle("db_methodlabel", "The Method");

      const samplerBtn = makeSharedFlyoutBtn(node, "SMPL", {
        getLabel: () => samplerWidget?.value ?? "—",
        getValues: () => samplerWidget?.options?.values || [],
        getCurrent: () => samplerWidget?.value,
        onPick: (v) => {
          if (samplerWidget) samplerWidget.value = v;
        },
      });
      const schedulerBtn = makeSharedFlyoutBtn(node, "SCHD", {
        getLabel: () => schedulerWidget?.value ?? "—",
        getValues: () => schedulerWidget?.options?.values || [],
        getCurrent: () => schedulerWidget?.value,
        onPick: (v) => {
          if (schedulerWidget) schedulerWidget.value = v;
        },
      });

      // Noise: 3-segment toggle (CPU / CPU+GPU / GPU) instead of a slider.
      const noise = (() => {
        const row = document.createElement("div");
        row.className = "db-slider-row";
        const seg = makeSegment();
        seg.style.flex = "1";
        const opts = NOISE_MODES.map((mode) => {
          const o = document.createElement("div");
          o.className = "db-seg-opt";
          o.textContent = NOISE_LABELS[mode];
          o.dataset.mode = mode;
          o.addEventListener("click", () => {
            if (noiseWidget) noiseWidget.value = mode;
            paint();
            node.setDirtyCanvas(true);
          });
          seg.appendChild(o);
          return o;
        });
        function paint() {
          const cur = noiseWidget?.value ?? "both";
          opts.forEach((o) =>
            o.classList.toggle("db-seg-active", o.dataset.mode === cur),
          );
        }
        row.append(seg);
        return { row, paint };
      })();
      const steps = makeSharedSlider(
        "Steps",
        1,
        100,
        1,
        () => parseInt(stepsWidget?.value ?? 20, 10) || 20,
        (v) => {
          if (stepsWidget) stepsWidget.value = Math.round(v);
        },
        (v) => String(Math.round(v)),
      );
      const cfg = makeSharedSlider(
        "CFG",
        0,
        20,
        0.1,
        () => Number(cfgWidget?.value ?? 7.0),
        (v) => {
          if (cfgWidget) cfgWidget.value = v;
        },
        (v) => Number(v).toFixed(1),
      );

      const cols = makeTwoColumn("db-talent-columns");
      // A fixed three-track grid keeps the Method panel genuinely two-column.
      // Flex allowed the slider column's intrinsic content to steal width from
      // the sampler column at narrower saved node sizes.
      cols.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) 1px minmax(0,1fr);box-sizing:border-box;overflow:hidden;align-items:stretch;";

      // Left column: sampler controls only. Output behavior lives in its own
      // bottom section so it is not mistaken for part of the sampling method.
      const leftCol = document.createElement("div");
      leftCol.className = "db-talent-loras";
      leftCol.style.cssText =
        "display:flex;flex-direction:column;gap:6px;min-width:0;";
      const batchBtn = makeButton();
      batchBtn.className = "db-lib-btn db-lora-add-open-btn";
      batchBtn.style.cssText =
        "height:24px;min-height:24px;padding:0 8px;font-size:11px;width:100%;box-sizing:border-box;";
      // Read the widget, every time. This was a `let _batchOn` copy taken here,
      // at node creation — which runs BEFORE ComfyUI restores a saved
      // workflow's widget values. Loading a graph saved with batch_mode on left
      // the copy at its default false, so the button painted "Pick Image: ON"
      // while the queued prompt carried batch_mode true and
      // should_bypass_picker() skipped the picker: the label promised a picker
      // that could never appear. overlayOn() was already a live read; this now
      // matches it, and the widget is the single source of truth.
      const batchOn = () => !!batchModeWidget?.value;
      // The two buttons ARE the decision: Batch mode or Text Overlay turns the
      // picker off. Nothing else is consulted — not whether cycler_line is
      // wired, not what the Cycler contains. Python applies the same rule in
      // should_bypass_picker() (nodes/sampler/text_overlay.py); the two must
      // stay identical or the UI promises one thing and the run does another.
      const cyclerWired = () =>
        !!(node.inputs || []).find((slot) => slot?.name === "cycler_line")
          ?.link;
      const overlayOn = () => !!overlayWidget?.value;
      const pickerOff = () => batchOn() || overlayOn();
      function paintBatchMode() {
        const off = pickerOff();
        batchBtn.textContent = off ? "Pick Image: OFF" : "Pick Image: ON";
        // db-lib-btn only styles .db-active; data-tone does nothing here.
        batchBtn.classList.toggle("db-active", !off);
        batchBtn.title = !off
          ? ""
          : (batchOn()
              ? "Batch mode is on, so every image is kept — there is nothing to pick."
              : "Text Overlay is on with a cycler line, so every captioned image is kept — there is nothing to pick.") +
            " Finish and Save Image & Prompt downstream of this node are muted while it is off.";
      }
      const overlayBtn = makeButton();
      overlayBtn.className = "db-lib-btn db-lora-add-open-btn";
      overlayBtn.style.cssText =
        "height:24px;min-height:24px;padding:0 8px;font-size:11px;width:100%;box-sizing:border-box;";
      function paintOverlay() {
        const enabled = overlayOn();
        const wired = cyclerWired();
        // The label states the picker consequence, which is what the button
        // controls. The wire only decides whether a caption gets drawn, so an
        // unwired overlay is called out in the tooltip rather than the label —
        // the picker is off either way.
        overlayBtn.textContent = enabled
          ? "Text Overlay: ON · Picker off"
          : "Text Overlay: OFF";
        // db-lib-btn only styles .db-active; data-tone does nothing here.
        overlayBtn.classList.toggle("db-active", enabled);
        overlayBtn.title =
          enabled && !wired
            ? "The picker is off, but no caption will be drawn: wire Prompt Builder's cycler_line output into this node's cycler_line input."
            : "";
      }
      // One-time repair for graphs saved while the old muting existed. `mode`
      // was written into the workflow but the marker naming the responsible
      // sampler was not, so those nodes stay muted forever with nothing left to
      // undo it. Anything still carrying the marker in this session is restored
      // too. A node the user muted by hand is left alone — only nodes this
      // feature is known to have touched are revived.
      function clearLegacyMuting() {
        let changed = false;
        for (const target of Object.values(app.graph?._nodes_by_id || {})) {
          if (target?._dbMutedBy === undefined) continue;
          target.mode = target._dbPrevMode ?? 0;
          delete target._dbPrevMode;
          delete target._dbMutedBy;
          changed = true;
        }
        if (changed) app.graph?.setDirtyCanvas(true, true);
      }

      // Both buttons describe one shared state, so they always repaint together.
      // They describe it only — no downstream node is touched. See the note at
      // the top of this file.
      function paintOutputButtons() {
        paintOverlay();
        paintBatchMode();
      }
      overlayBtn.addEventListener("click", () => {
        if (overlayWidget) overlayWidget.value = !overlayWidget.value;
        paintOutputButtons();
        // Same collapse as the batch button — Text Overlay turns the picker off,
        // so the results panel must fold away with it.
        syncPickerVisibility();
        node.setDirtyCanvas(true, true);
      });
      paintOutputButtons();
      // onNodeCreated runs before ComfyUI restores a saved graph's links, so the
      // first paint above cannot see the cycler_line wire. Repaint once restore
      // has happened or a loaded workflow reads "no cycler" when it is wired.
      requestAnimationFrame(() => {
        paintOutputButtons();
        clearLegacyMuting();
      });
      // Connecting or dropping the cycler_line link changes whether the picker
      // runs, so the buttons have to follow the wire, not just the toggles.
      const originalConnectionsChange = node.onConnectionsChange;
      node.onConnectionsChange = function () {
        const result = originalConnectionsChange?.apply(this, arguments);
        paintOutputButtons();
        node.setDirtyCanvas(true, true);
        return result;
      };
      function syncPickerVisibility() {
        // pickerOff(), not batchOn(): Text Overlay suppresses the picker too, so
        // checking batch mode alone left the results panel expanded after an
        // overlay run with nothing to pick.
        const showSelect = !pickerOff() && !!node._dbActivePick;
        const names = ["db_payofflabel", "db_payoff_imgs", "db_payoff_pick"];
        for (const w of node.widgets || []) {
          if (!names.includes(w.name)) continue;
          // The pick controls row is driven by the active pick (_dbStartPick /
          // _dbEndPick), not by batch mode — never force it visible here. When
          // batch turns on, hide it; otherwise leave its current state alone.
          if (w.name === "db_payoff_pick") {
            if (!showSelect) {
              if (w.element) w.element.style.display = "none";
              w.computedHeight = 0;
            } else {
              w.computedHeight =
                w.element && w.element.style.display !== "none" ? undefined : 0;
            }
            continue;
          }
          if (w.element) w.element.style.display = showSelect ? "" : "none";
          w.computedHeight = showSelect ? undefined : 0;
        }
        node.setSize(node.computeSize());
      }
      batchBtn.addEventListener("click", () => {
        if (batchModeWidget) batchModeWidget.value = !batchOn();
        paintOutputButtons();
        syncPickerVisibility();
        node.setDirtyCanvas(true, true);
      });
      leftCol.append(samplerBtn.row, schedulerBtn.row);

      const divider = document.createElement("div");
      divider.className = "db-talent-divider";
      divider.style.cssText = "width:1px;margin:0;align-self:stretch;";

      // Right column: stacked Noise / Steps / CFG sliders.
      const rightCol = document.createElement("div");
      rightCol.className = "db-talent-triggerwords";
      rightCol.style.cssText =
        "display:flex;flex-direction:column;min-width:0;";
      rightCol.append(noise.row, steps.row, cfg.row);

      cols.append(leftCol, divider, rightCol);
      const METHOD_H = 84;
      cols.style.height = METHOD_H + "px";
      node.addDOMWidget("db_method_cols", "customhtml", cols, {
        serialize: false,
        height: METHOD_H,
        getMinHeight: () => METHOD_H,
      });
      widthEls.push(cols);

      // ── 2. THE AUDITION — in-node preview of the picked image(s) ──────────
      // Selection happens in the popup modal (see openPickModal); this just
      // shows the result after the run completes.
      addTitle("db_payofflabel", "The Audition");
      const imgPanel = document.createElement("div");
      imgPanel.className = "db-pick-grid";
      const imgEmpty = document.createElement("div");
      imgEmpty.className = "db-model-preview";
      imgEmpty.style.cssText +=
        "display:flex;align-items:center;justify-content:center;color:#3a3a3a;font-style:italic;font-size:11px;";
      imgEmpty.textContent = "— run to preview —";
      imgPanel.appendChild(imgEmpty);

      const imgWidget = node.addDOMWidget(
        "db_payoff_imgs",
        "customhtml",
        imgPanel,
        {
          serialize: false,
          height: 96,
          getMinHeight: () => panelHeight(),
        },
      );
      widthEls.push(imgPanel);

      // The image-select area exists only while the sampler is waiting for a
      // selection. In every other state (including captioning), reserve no
      // layout height beneath ComfyUI's live preview.
      function setImageSelectShown(shown) {
        for (const w of node.widgets || []) {
          if (w.name !== "db_payofflabel" && w.name !== "db_payoff_imgs")
            continue;
          if (w.element) w.element.style.display = shown ? "" : "none";
          w.computedHeight = shown ? undefined : 0;
          if (!w._dbOpenComputeSize) w._dbOpenComputeSize = w.computeSize;
          if (!w._dbOpenMinHeight) w._dbOpenMinHeight = w.getMinHeight;
          w.computeSize = shown ? w._dbOpenComputeSize : () => [0, -4];
          w.getMinHeight = shown ? w._dbOpenMinHeight : () => -4;
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const needed = node.computeSize();
            // Grow-only while the panel is up. This used to setSize()
            // unconditionally, one frame AFTER syncImgH had already grown the
            // node for the cards — and at that point the <img> elements have not
            // loaded, so imgPanel.scrollHeight is still the 96px floor. The node
            // snapped back to the empty height and ComfyUI kept drawing Output,
            // the mode buttons and Pick Timeout at their old offsets, on top of
            // the images, with the last card outside the node body.
            if (shown) {
              if ((node.size?.[1] || 0) < needed[1])
                node.setSize([node.size[0], needed[1]]);
            } else {
              node.setSize(needed);
            }
            node.setDirtyCanvas(true, true);
          }),
        );
      }
      setImageSelectShown(false);

      // ── 3. OUTPUT — post-generation behavior ─────────────────────────────
      // These settings affect what happens after sampling, so keep them
      // together at the bottom instead of mixing them into The Method.
      addTitle("db_outputlabel", "Output");
      const outputControls = document.createElement("div");
      outputControls.className = "db-sampler-output-controls";
      outputControls.append(batchBtn, overlayBtn);
      // Matches .db-sampler-output-controls in style.css. Both must move together
      // or the row is cropped by the widget, or floats inside it.
      const OUTPUT_ROW_H = 34;
      node.addDOMWidget("db_output_controls", "customhtml", outputControls, {
        serialize: false,
        height: OUTPUT_ROW_H,
        getMinHeight: () => OUTPUT_ROW_H,
      });
      widthEls.push(outputControls);

      // Picker timeout — how long a blocking pick waits before sending no images.
      const pickTimeout = makeSharedSlider(
        "Pick Timeout",
        5,
        600,
        5,
        () => parseInt(pickTimeoutWidget?.value ?? 30, 10) || 30,
        (v) => {
          if (pickTimeoutWidget) pickTimeoutWidget.value = Math.round(v);
        },
        (v) => `${Math.round(v)}s`,
      );
      node.addDOMWidget("db_pick_timeout", "customhtml", pickTimeout.row, {
        serialize: false,
        height: 26,
        getMinHeight: () => 26,
      });
      widthEls.push(pickTimeout.row);

      // One result card: the 150px image cap in .db-pick-card img, plus its
      // 1px border top and bottom. Kept in sync with style.css by
      // test_sampler_audition_panel.py.
      const CARD_H = 152;
      const CARD_GAP = 6;

      // Cached, because getMinHeight is on LiteGraph's per-frame layout path.
      // Reading imgPanel.scrollHeight there forces a synchronous layout flush
      // on every frame the node is visible, which stalls the whole canvas once
      // you zoom in close enough for the node to be drawn at size. The height
      // only changes when the card set changes, so recompute it there instead.
      let panelH = 96;

      function panelHeight() {
        return panelH;
      }

      function recomputePanelHeight() {
        // Computed from the card count, not measured. imgPanel.scrollHeight is
        // read inside a rAF that can land before the grid's row heights
        // resolve, and a short reading means the widget reserves less than the
        // grid paints — .db-pick-grid is overflow:visible, so the images then
        // render straight over Output, the mode buttons and Pick Timeout.
        const cards = imgPanel.querySelectorAll(".db-pick-card").length;
        if (!cards) {
          panelH = 96;
          return panelH;
        }
        const rows = Math.ceil(cards / (cards > 1 ? 2 : 1));
        panelH = Math.max(
          96,
          rows * CARD_H + (rows - 1) * CARD_GAP,
          imgPanel.scrollHeight || 0,
        );
        return panelH;
      }

      function syncImgH() {
        requestAnimationFrame(() => {
          const h = recomputePanelHeight();
          if (imgWidget) imgWidget.computedHeight = h;
          // Grow the NODE too. Reserving space on the widget alone left the node
          // at its empty height, so ComfyUI kept drawing Output, the mode
          // buttons and Pick Timeout at their old offsets — over the images —
          // and the last thumbnail fell outside the node body. Grow-only, so it
          // never fights a manual resize.
          const needed = node.computeSize();
          if ((node.size?.[1] || 0) < needed[1])
            node.setSize([node.size[0], needed[1]]);
          node.setDirtyCanvas(true, true);
        });
      }

      function sizeImageCards() {
        const cards = [...imgPanel.querySelectorAll(".db-pick-card")];
        imgPanel.style.gridTemplateColumns =
          cards.length > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)";
      }
      function dimsLabel(info) {
        const w = Number(info.width),
          h = Number(info.height);
        return Number.isFinite(w) && Number.isFinite(h) && w && h
          ? `${w} × ${h}`
          : "";
      }

      // Inline pick controls — hidden until a run blocks for a selection.
      node._dbSel = new Set();
      node._dbImages = [];
      const pickRow = document.createElement("div");
      pickRow.className = "db-pick-controls";
      pickRow.style.display = "none";
      const pBtns = document.createElement("div");
      pBtns.className = "db-pick-btns";
      const pSend = makeButton();
      pSend.className = "db-lib-btn db-lora-add-open-btn";
      pSend.style.cssText +=
        "width:auto;padding:3px 14px;font-size:10px;flex:0 0 auto;";
      pSend.textContent = "Send";
      const pCancel = makeButton();
      pCancel.className = "db-lib-btn db-lora-add-open-btn";
      pCancel.style.cssText +=
        "width:auto;padding:3px 12px;font-size:10px;flex:0 0 auto;";
      pCancel.textContent = "Cancel";
      const pFull = makeButton();
      pFull.className = "db-lib-btn db-lora-add-open-btn";
      pFull.style.cssText +=
        "width:auto;padding:3px 12px;font-size:10px;flex:0 0 auto;";
      pFull.textContent = "⛶ Full screen";
      pBtns.append(pSend, pCancel, pFull);
      const pMeta = document.createElement("div");
      pMeta.className = "db-pick-meta";
      const pStatus = document.createElement("span");
      pStatus.className = "db-pick-status";
      const pCount = document.createElement("span");
      pCount.className = "db-pick-count";
      pMeta.append(pStatus, pCount);
      pickRow.append(pBtns, pMeta);
      const pickWidget = node.addDOMWidget(
        "db_payoff_pick",
        "customhtml",
        pickRow,
        {
          serialize: false,
          height: 46,
          getMinHeight: () => 46,
        },
      );
      widthEls.push(pickRow);
      // Show/hide the pick controls row as a unit: toggle DOM display AND the
      // widget's reserved height so it doesn't leave dead space (collapsed) or
      // render with zero clickable height (expanded). syncPickerVisibility set
      // computedHeight=0 while idle, so _dbStartPick must restore it.
      function setPickRowShown(shown) {
        pickRow.style.display = shown ? "flex" : "none";
        if (pickWidget) {
          if (!pickWidget._dbOpenComputeSize)
            pickWidget._dbOpenComputeSize = pickWidget.computeSize;
          if (!pickWidget._dbOpenMinHeight)
            pickWidget._dbOpenMinHeight = pickWidget.getMinHeight;
          pickWidget.computedHeight = shown ? undefined : 0;
          pickWidget.computeSize = shown
            ? pickWidget._dbOpenComputeSize
            : () => [0, -4];
          pickWidget.getMinHeight = shown
            ? pickWidget._dbOpenMinHeight
            : () => -4;
        }
        node.setSize(node.computeSize());
      }
      pSend.addEventListener("click", () => PICK.sendPick());
      pCancel.addEventListener("click", () => PICK.cancelPick());
      pFull.addEventListener("click", () => PICK.openPickerPopup());
      setPickRowShown(false);
      syncPickerVisibility();

      function inlineStatus() {
        const n = node._dbSel.size;
        pStatus.textContent = n
          ? `${n} selected · click to keep`
          : "Click images to keep";
      }
      // Pick start: keep the node compact and open the image picker as a
      // standalone modal, avoiding canvas/DOM widget layout conflicts.
      node._dbStartPick = (token, images) => {
        node._dbActivePick = true;
        node._dbSel = new Set();
        node._dbImages = images || [];
        setImageSelectShown(false);
        setPickRowShown(false);
        pCount.textContent = "";
        inlineStatus();
        PICK.openPickerPopup();
      };
      node._dbEndPick = () => {
        node._dbActivePick = false;
        setPickRowShown(false);
        setImageSelectShown(false);
      };
      node._dbRepaintInline = () => {
        [...imgPanel.querySelectorAll(".db-pick-card")].forEach((card, i) => {
          card.classList.toggle("db-pick-sel", node._dbSel.has(i));
        });
        inlineStatus();
      };
      node._dbTick = (txt) => {
        pCount.textContent = txt;
      };
      node._dbPickStatus = (t) => {
        pStatus.textContent = t;
      };

      // Static render of the final / picked image(s) after the run completes.
      node._dbRenderImages = (imgs) => {
        // Run is finished here (onExecuted) so the node is no longer the running
        // node — core's preview is already suppressed by onDrawBackground. No
        // flag needed; just make sure any active-pick state is cleared.
        node._dbActivePick = false;
        setPickRowShown(false);
        imgPanel.innerHTML = "";
        // Picker off (Batch mode or Text Overlay) means the run was never about
        // choosing an image, so the results panel has no job to do. Showing it
        // anyway grew the node by a card's height on every queue during
        // batch testing. The images still flow downstream untouched.
        if (pickerOff()) {
          recomputePanelHeight();
          setImageSelectShown(false);
          imgPanel.appendChild(imgEmpty);
          return;
        }
        if (!imgs || !imgs.length) {
          setImageSelectShown(false);
          imgPanel.appendChild(imgEmpty);
          syncImgH();
          return;
        }
        // The Audition has to be visible to show the result; hiding it here was
        // rendering the picked/batch images into a zero-height widget.
        setImageSelectShown(true);
        const rand = Date.now();
        const cardImages = [];
        imgs.forEach((info) => {
          const card = document.createElement("div");
          card.className = "db-pick-card";
          const img = document.createElement("img");
          const q = `filename=${encodeURIComponent(info.filename)}&subfolder=${encodeURIComponent(info.subfolder || "")}&type=${encodeURIComponent(info.type || "temp")}&rand=${rand}`;
          img.src = `/view?${q}`;
          img.onload = syncImgH;
          card.appendChild(img);
          const dims = dimsLabel(info);
          if (dims) {
            const d = document.createElement("span");
            d.className = "db-pick-dims";
            d.textContent = dims;
            card.appendChild(d);
          }
          card.addEventListener("click", () =>
            openImageViewer(node, cardImages, cardImages.indexOf(img)),
          );
          cardImages.push(img);
          imgPanel.appendChild(card);
        });
        sizeImageCards();
        syncImgH();
      };

      // ── width sync — constrain DOM widgets to the node's inner width so wide
      //    controls reflow instead of overflowing and being clipped ───────────
      function applyWidths() {
        const w = nodeInnerW(node);
        widthEls.forEach((el) => {
          if (el) el.style.width = w + "px";
        });
      }
      const _origResize = node.onResize;
      node.onResize = function (size) {
        _origResize?.call(this, size);
        applyWidths();
      };

      // ── restore styled controls from saved widget values ──────────────────
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          applyWidths();
          samplerBtn.refresh();
          schedulerBtn.refresh();
          noise.paint();
          steps.paint();
          cfg.paint();
          pickTimeout.paint();
          // Workflows persist the node's previous expanded preview height. Once
          // the empty UI has been rebuilt, collapse back to its natural widget
          // height; image/picker rendering will grow it again when needed.
          if (
            !node._dbImages?.length &&
            !node.imgs?.length &&
            !node._dbActivePick
          ) {
            node.setSize(node.computeSize());
          }
        }),
      );
    };
  },
});
