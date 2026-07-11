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
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, hideWidget as hideWidgetShared,
  makeSectionLabel, nodeInnerW,
} from "./db_shared.js";

ensureStylesheet();

const NOISE_MODES = ["cpu", "both", "gpu"];
const NOISE_LABELS = { cpu: "CPU", both: "Both", gpu: "GPU" };

// ── Interactive image picker ────────────────────────────────────────────────
// After sampling, the Python node blocks and pushes the batch into a modal
// picker. Keeping selection outside the node avoids mixing ComfyUI's canvas
// preview widget with absolutely positioned DOM widgets.
const PICK_EVENT = "dirtybirds-sampler-pick";
const PICK_ROUTE = "/dirtybirds/sampler-pick";

let _pick = null; // { token, node }
let _fs = null;   // full-screen popup refs, when open

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
  if (!response?.ok) throw new Error(`Picker reply failed (${response?.status ?? "no response"})`);
  const result = await response.json();
  if (!result?.ok) throw new Error("Picker reply was not accepted by the active sampler");
}

async function finishPick(selection) {
  if (!_pick) return;
  const { token, node } = _pick;
  try {
    await postPick(token, selection);
  } catch (err) {
    console.error("[DirtyBirds] Sampler pick reply failed:", err);
    node?._dbPickStatus?.("Send failed — retry.");
    return;
  }
  closeFullScreen();
  node?._dbEndPick?.();
  _pick = null;
}
function sendPick() {
  if (!_pick?.node) return;
  const selection = [..._pick.node._dbSel].sort((a, b) => a - b);
  if (!selection.length) {
    _pick.node._dbPickStatus?.("Select at least one image, or Cancel.");
    return;
  }
  finishPick(selection);
}
function cancelPick() { if (_pick) finishPick([]); }

// ── Image picker popup ──────────────────────────────────────────────────────
function closeFullScreen() {
  if (_fs?.overlay && document.fullscreenElement === _fs.overlay) {
    document.exitFullscreen?.().catch?.(() => {});
  }
  _fs?.overlay?.remove();
  if (_fs?.relayout) window.removeEventListener("resize", _fs.relayout);
  document.removeEventListener("keydown", _fsKeydown);
  _fs = null;
}
function _fsKeydown(e) {
  if (!_fs || !_pick) return;
  const sel = _pick.node._dbSel;
  if (e.key === "Escape") { e.preventDefault(); cancelPick(); }
  else if (e.key === "Enter") { e.preventDefault(); sendPick(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    const all = sel.size < _fs.cards.length;
    _fs.cards.forEach((c, i) => {
      if (all) sel.add(i); else sel.delete(i);
      c.classList.toggle("db-lp-selected", sel.has(i));
    });
    _pick.node._dbRepaintInline?.();
    _fs.updateStatus();
  }
}
function openPickerPopup() {
  if (!_pick?.node) return;
  closeFullScreen();
  const node = _pick.node;
  const images = node._dbImages || [];
  const sel = node._dbSel;
  let relayout = () => {};

  const overlay = document.createElement("div");
  overlay.className = "db-flyout-overlay db-sampler-picker-overlay";
  const panel = document.createElement("div");
  panel.className = "db-lora-flyout db-sampler-picker-panel";

  const header = document.createElement("div");
  header.className = "db-flyout-header";
  const title = document.createElement("span");
  title.className = "db-flyout-title";
  title.textContent = "🎯 Pick images";
  const countdown = document.createElement("span");
  countdown.className = "db-flyout-title";
  countdown.style.opacity = "0.6";
  header.append(title, countdown);
  panel.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "db-lp-grid";
  const cards = [];
  const imageEls = [];
  images.forEach((img, i) => {
    const card = document.createElement("div");
    card.className = "db-lp-card";
    card.style.cursor = "pointer";
    if (sel.has(i)) card.classList.add("db-lp-selected");
    const wrap = document.createElement("div");
    wrap.className = "db-lp-img-wrap";
    const thumb = document.createElement("img");
    thumb.className = "db-lp-thumb";
    const reveal = () => {
      thumb.classList.add("db-lp-thumb-loaded");
      relayout();
    };
    thumb.addEventListener("load", reveal);
    thumb.addEventListener("error", () => { reveal(); thumb.style.opacity = "1"; });
    thumb.src = _viewURL(img);
    if (thumb.complete && thumb.naturalWidth > 0) reveal();
    const badge = document.createElement("div");
    badge.className = "db-lp-cat-badge";
    badge.textContent = "#" + i;
    wrap.append(thumb, badge);
    card.appendChild(wrap);
    card.addEventListener("click", () => {
      if (sel.has(i)) { sel.delete(i); card.classList.remove("db-lp-selected"); }
      else { sel.add(i); card.classList.add("db-lp-selected"); }
      node._dbRepaintInline?.();
      updateStatus();
    });
    grid.appendChild(card);
    cards.push(card);
    imageEls.push(thumb);
  });
  panel.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "db-lp-pills";
  footer.style.cssText += "justify-content:space-between;align-items:center;";
  const statusEl = document.createElement("span");
  statusEl.style.cssText = "font-size:11px;color:#888;";
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:8px;";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "db-lora-add-open-btn";
  cancelBtn.style.cssText = "width:auto;padding:6px 14px;";
  cancelBtn.textContent = "Cancel run";
  cancelBtn.addEventListener("click", cancelPick);
  const sendBtn = document.createElement("button");
  sendBtn.className = "db-lora-add-open-btn";
  sendBtn.style.cssText = "width:auto;padding:6px 16px;";
  sendBtn.textContent = "Send selection";
  sendBtn.addEventListener("click", sendPick);
  btns.append(cancelBtn, sendBtn);
  footer.append(statusEl, btns);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function imageSize() {
    const first = images[0] || {};
    const natural = imageEls.find((img) => img.naturalWidth > 0);
    return {
      width: Number(first.width || natural?.naturalWidth || 1),
      height: Number(first.height || natural?.naturalHeight || 1),
    };
  }
  relayout = () => {
    const box = grid.getBoundingClientRect();
    if (!box.width || !box.height || !images.length) return;
    const { width: imgW, height: imgH } = imageSize();
    let bestPerRow = 1;
    let bestScale = 0;
    for (let perRow = 1; perRow <= images.length; perRow++) {
      const rows = Math.ceil(images.length / perRow);
      const scale = Math.min(box.width / (imgW * perRow), box.height / (imgH * rows));
      if (scale > bestScale) {
        bestScale = scale;
        bestPerRow = perRow;
      }
    }
    const rows = Math.ceil(images.length / bestPerRow);
    grid.style.gridTemplateColumns = `repeat(${bestPerRow}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  };

  function updateStatus() {
    statusEl.textContent = sel.size
      ? `${sel.size} selected · Enter to send`
      : "Click images to keep · Esc cancels · Ctrl+A all";
  }
  updateStatus();
  requestAnimationFrame(relayout);
  window.addEventListener("resize", relayout);
  document.addEventListener("keydown", _fsKeydown);
  _fs = { overlay, countdownEl: countdown, statusEl, cards, updateStatus, relayout };
}

api.addEventListener(PICK_EVENT, (e) => {
  const d = e.detail || {};
  if (Array.isArray(d.images)) {
    const node = d.node_id != null
      ? (app.graph?.getNodeById?.(Number(d.node_id)) || app.graph?.getNodeById?.(d.node_id))
      : null;
    if (!node) {
      postPick(d.token, Array.from({ length: d.count || d.images.length }, (_, i) => i))
        .catch((err) => console.error("[DirtyBirds] Sampler pick fallback failed:", err));
      return;
    }
    _pick = { token: d.token, node };
    node?._dbStartPick?.(d.token, d.images);
    return;
  }
  if (!_pick || d.token !== _pick.token) return;
  if (d.timeout) { closeFullScreen(); _pick.node?._dbEndPick?.(); _pick = null; return; }
  if (typeof d.tick === "number") {
    const m = Math.floor(d.tick / 60), s = d.tick % 60;
    const txt = `${m}:${String(s).padStart(2, "0")}`;
    _pick.node?._dbTick?.(txt);
    if (_fs) _fs.countdownEl.textContent = txt;
  }
});

// Expose for the per-node inline controls (defined in onNodeCreated).
const PICK = { sendPick, cancelPick, openPickerPopup, viewURL: _viewURL };

// Compact list flyout (ported from the loader, reusing the global .db-flyout* CSS).
function showListFlyout(title, names, current, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel   = document.createElement("div"); panel.className   = "db-flyout";
  panel.style.width = "min(320px, 90vw)";
  panel.style.left  = Math.max(20, (window.innerWidth - 320) / 2) + "px";
  panel.style.top   = Math.max(40, window.innerHeight / 2 - 220) + "px";

  const header   = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl  = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const list = document.createElement("div"); list.className = "db-flyout-list";
  list.style.cssText = "max-height:60vh;overflow:auto;";
  panel.appendChild(list);

  (names || []).forEach(name => {
    const row = document.createElement("div");
    row.className = "db-res-opt" + (name === current ? " db-selected" : "");
    const label = document.createElement("span");
    label.className = "db-res-opt-label";
    label.textContent = name; label.title = name;
    row.appendChild(label);
    row.addEventListener("click", () => { close(); onPick(name); });
    list.appendChild(row);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

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
      node.color   = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      const DB_MIN_W = 360;
      node.size[0] = Math.max(node.size[0] || 0, DB_MIN_W);

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
        el.style.cssText += "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
        node.addDOMWidget(name, "customhtml", el, {
          serialize: false, height: TITLE_H, getMinHeight: () => TITLE_H,
        });
        widthEls.push(el);
      }
      function makeFlyoutBtn(tag, getLabel, getValues, getCurrent, onPick) {
        const row = document.createElement("div");
        row.className = "db-sel-row"; row.style.cursor = "pointer";
        const tagEl   = document.createElement("span"); tagEl.className = "db-model-tag"; tagEl.textContent = tag;
        const nameEl  = document.createElement("span"); nameEl.className = "db-sel-name"; nameEl.style.flex = "1";
        const caretEl = document.createElement("span"); caretEl.className = "db-model-caret"; caretEl.textContent = "▾";
        row.append(tagEl, nameEl, caretEl);
        function refresh() { nameEl.textContent = getLabel(); nameEl.title = getLabel(); }
        row.addEventListener("click", () => {
          showListFlyout(tag, getValues(), getCurrent(), (v) => { onPick(v); refresh(); node.setDirtyCanvas(true); });
        });
        refresh();
        return { row, refresh };
      }
      function makeSlider(label, min, max, step, getVal, setVal, fmt) {
        const row = document.createElement("div");
        row.className = "db-slider-row"; row.style.justifyContent = "space-between";
        const lbl = document.createElement("span"); lbl.className = "db-slider-label"; lbl.textContent = label;
        const sl  = document.createElement("input"); sl.type = "range"; sl.className = "db-sel-slider";
        sl.min = String(min); sl.max = String(max); sl.step = String(step); sl.style.flex = "1";
        const val = document.createElement("span"); val.className = "db-sel-val";
        function paint() { const v = getVal(); sl.value = String(v); val.textContent = fmt(v); }
        sl.addEventListener("input", () => { setVal(parseFloat(sl.value)); val.textContent = fmt(getVal()); });
        paint();
        row.append(lbl, sl, val);
        return { row, paint };
      }

      // ── hidden native widgets ─────────────────────────────────────────────
      const samplerWidget   = hideWidget("sampler_name");
      const schedulerWidget = hideWidget("scheduler");
      const stepsWidget     = hideWidget("steps");
      const cfgWidget       = hideWidget("cfg");
      const noiseWidget     = hideWidget("noise_mode");
      const batchModeWidget = hideWidget("batch_mode");
      const overlayWidget   = hideWidget("overlay_enabled");

      // ── 1. THE METHOD — buttons left | splitter | sliders right ───────────
      addTitle("db_methodlabel", "The Method");

      const samplerBtn = makeFlyoutBtn("SMPL",
        () => samplerWidget?.value ?? "—",
        () => samplerWidget?.options?.values || [],
        () => samplerWidget?.value,
        (v) => { if (samplerWidget) samplerWidget.value = v; });
      const schedulerBtn = makeFlyoutBtn("SCHD",
        () => schedulerWidget?.value ?? "—",
        () => schedulerWidget?.options?.values || [],
        () => schedulerWidget?.value,
        (v) => { if (schedulerWidget) schedulerWidget.value = v; });

      // Noise: 3-segment toggle (CPU / CPU+GPU / GPU) instead of a slider.
      const noise = (() => {
        const row = document.createElement("div");
        row.className = "db-slider-row";
        const seg = document.createElement("div"); seg.className = "db-seg"; seg.style.flex = "1";
        const opts = NOISE_MODES.map(mode => {
          const o = document.createElement("div");
          o.className = "db-seg-opt"; o.textContent = NOISE_LABELS[mode]; o.dataset.mode = mode;
          o.addEventListener("click", () => { if (noiseWidget) noiseWidget.value = mode; paint(); node.setDirtyCanvas(true); });
          seg.appendChild(o);
          return o;
        });
        function paint() {
          const cur = noiseWidget?.value ?? "both";
          opts.forEach(o => o.classList.toggle("db-seg-active", o.dataset.mode === cur));
        }
        row.append(seg);
        return { row, paint };
      })();
      const steps = makeSlider("Steps", 1, 100, 1,
        () => parseInt(stepsWidget?.value ?? 20, 10) || 20,
        (v) => { if (stepsWidget) stepsWidget.value = Math.round(v); },
        (v) => String(Math.round(v)));
      const cfg = makeSlider("CFG", 0, 20, 0.1,
        () => Number(cfgWidget?.value ?? 7.0),
        (v) => { if (cfgWidget) cfgWidget.value = v; },
        (v) => Number(v).toFixed(1));

      const cols = document.createElement("div");
      cols.className = "db-talent-columns";
      // A fixed three-track grid keeps the Method panel genuinely two-column.
      // Flex allowed the slider column's intrinsic content to steal width from
      // the sampler column at narrower saved node sizes.
      cols.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) 1px minmax(0,1fr);box-sizing:border-box;overflow:hidden;align-items:stretch;";

      // Left column: sampler controls only. Output behavior lives in its own
      // bottom section so it is not mistaken for part of the sampling method.
      const leftCol = document.createElement("div"); leftCol.className = "db-talent-loras";
      leftCol.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      const batchBtn = document.createElement("button");
      batchBtn.className = "db-lib-btn db-lora-add-open-btn";
      batchBtn.style.cssText = "height:24px;min-height:24px;padding:0 8px;font-size:11px;width:100%;box-sizing:border-box;";
      let _batchOn = !!batchModeWidget?.value;
      function paintBatchMode() {
        batchBtn.textContent = _batchOn ? "Pick Image: OFF" : "Pick Image: ON";
        batchBtn.dataset.tone = _batchOn ? "fixed" : "random";
      }
      const overlayBtn = document.createElement("button");
      overlayBtn.className = "db-lib-btn db-lora-add-open-btn";
      overlayBtn.style.cssText = "height:24px;min-height:24px;padding:0 8px;font-size:11px;width:100%;box-sizing:border-box;";
      function paintOverlay() {
        const enabled = !!overlayWidget?.value;
        overlayBtn.textContent = enabled ? "Text Overlay: ON" : "Text Overlay: OFF";
        overlayBtn.dataset.tone = enabled ? "random" : "fixed";
      }
      overlayBtn.addEventListener("click", () => {
        if (overlayWidget) overlayWidget.value = !overlayWidget.value;
        paintOverlay();
        node.setDirtyCanvas(true, true);
      });
      paintOverlay();
      function syncPickerVisibility() {
        const showSelect = !_batchOn && !!node._dbActivePick;
        const names = ["db_payofflabel", "db_payoff_imgs", "db_payoff_pick"];
        for (const w of node.widgets || []) {
          if (!names.includes(w.name)) continue;
          // The pick controls row is driven by the active pick (_dbStartPick /
          // _dbEndPick), not by batch mode — never force it visible here. When
          // batch turns on, hide it; otherwise leave its current state alone.
          if (w.name === "db_payoff_pick") {
            if (!showSelect) { if (w.element) w.element.style.display = "none"; w.computedHeight = 0; }
            else { w.computedHeight = (w.element && w.element.style.display !== "none") ? undefined : 0; }
            continue;
          }
          if (w.element) w.element.style.display = showSelect ? "" : "none";
          w.computedHeight = showSelect ? undefined : 0;
        }
        node.setSize(node.computeSize());
      }
      batchBtn.addEventListener("click", () => {
        _batchOn = !_batchOn;
        if (batchModeWidget) batchModeWidget.value = _batchOn;
        paintBatchMode();
        syncPickerVisibility();
        node.setDirtyCanvas(true, true);
      });
      paintBatchMode();
      leftCol.append(samplerBtn.row, schedulerBtn.row);

      const divider = document.createElement("div"); divider.className = "db-talent-divider";
      divider.style.cssText = "width:1px;margin:0;align-self:stretch;";

      // Right column: stacked Noise / Steps / CFG sliders.
      const rightCol = document.createElement("div"); rightCol.className = "db-talent-triggerwords";
      rightCol.style.cssText = "display:flex;flex-direction:column;min-width:0;";
      rightCol.append(noise.row, steps.row, cfg.row);

      cols.append(leftCol, divider, rightCol);
      const METHOD_H = 84;
      cols.style.height = METHOD_H + "px";
      node.addDOMWidget("db_method_cols", "customhtml", cols, {
        serialize: false, height: METHOD_H, getMinHeight: () => METHOD_H,
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
      imgEmpty.style.cssText += "display:flex;align-items:center;justify-content:center;color:#3a3a3a;font-style:italic;font-size:11px;";
      imgEmpty.textContent = "— run to preview —";
      imgPanel.appendChild(imgEmpty);

      const imgWidget = node.addDOMWidget("db_payoff_imgs", "customhtml", imgPanel, {
        serialize: false, height: 96, getMinHeight: () => Math.max(96, imgPanel.scrollHeight || 96),
      });
      widthEls.push(imgPanel);

      // The image-select area exists only while the sampler is waiting for a
      // selection. In every other state (including captioning), reserve no
      // layout height beneath ComfyUI's live preview.
      function setImageSelectShown(shown) {
        for (const w of node.widgets || []) {
          if (w.name !== "db_payofflabel" && w.name !== "db_payoff_imgs") continue;
          if (w.element) w.element.style.display = shown ? "" : "none";
          w.computedHeight = shown ? undefined : 0;
          if (!w._dbOpenComputeSize) w._dbOpenComputeSize = w.computeSize;
          if (!w._dbOpenMinHeight) w._dbOpenMinHeight = w.getMinHeight;
          w.computeSize = shown ? w._dbOpenComputeSize : (() => [0, -4]);
          w.getMinHeight = shown ? w._dbOpenMinHeight : (() => -4);
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          node.setSize(node.computeSize());
          node.setDirtyCanvas(true, true);
        }));
      }
      setImageSelectShown(false);

      // ── 3. OUTPUT — post-generation behavior ─────────────────────────────
      // These settings affect what happens after sampling, so keep them
      // together at the bottom instead of mixing them into The Method.
      addTitle("db_outputlabel", "Output");
      const outputControls = document.createElement("div");
      outputControls.className = "db-sampler-output-controls";
      outputControls.append(batchBtn, overlayBtn);
      node.addDOMWidget("db_output_controls", "customhtml", outputControls, {
        serialize: false, height: 30, getMinHeight: () => 30,
      });
      widthEls.push(outputControls);

      function syncImgH() {
        requestAnimationFrame(() => {
          const h = Math.max(96, imgPanel.scrollHeight || 96);
          if (imgWidget) imgWidget.computedHeight = h;
          node.setDirtyCanvas(true);
        });
      }

      function sizeImageCards() {
        const cards = [...imgPanel.querySelectorAll(".db-pick-card")];
        imgPanel.style.gridTemplateColumns = cards.length > 1
          ? "repeat(2, minmax(0, 1fr))"
          : "minmax(0, 1fr)";
      }
      function dimsLabel(info) {
        const w = Number(info.width), h = Number(info.height);
        return (Number.isFinite(w) && Number.isFinite(h) && w && h) ? `${w} × ${h}` : "";
      }

      // Inline pick controls — hidden until a run blocks for a selection.
      node._dbSel = new Set();
      node._dbImages = [];
      const pickRow = document.createElement("div");
      pickRow.className = "db-pick-controls";
      pickRow.style.display = "none";
      const pBtns = document.createElement("div");
      pBtns.className = "db-pick-btns";
      const pSend = document.createElement("button");
      pSend.className = "db-lib-btn db-lora-add-open-btn";
      pSend.style.cssText += "width:auto;padding:3px 14px;font-size:10px;flex:0 0 auto;";
      pSend.textContent = "Send";
      const pCancel = document.createElement("button");
      pCancel.className = "db-lib-btn db-lora-add-open-btn";
      pCancel.style.cssText += "width:auto;padding:3px 12px;font-size:10px;flex:0 0 auto;";
      pCancel.textContent = "Cancel";
      const pFull = document.createElement("button");
      pFull.className = "db-lib-btn db-lora-add-open-btn";
      pFull.style.cssText += "width:auto;padding:3px 12px;font-size:10px;flex:0 0 auto;";
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
      const pickWidget = node.addDOMWidget("db_payoff_pick", "customhtml", pickRow, {
        serialize: false, height: 46, getMinHeight: () => 46,
      });
      widthEls.push(pickRow);
      // Show/hide the pick controls row as a unit: toggle DOM display AND the
      // widget's reserved height so it doesn't leave dead space (collapsed) or
      // render with zero clickable height (expanded). syncPickerVisibility set
      // computedHeight=0 while idle, so _dbStartPick must restore it.
      function setPickRowShown(shown) {
        pickRow.style.display = shown ? "flex" : "none";
        if (pickWidget) {
          if (!pickWidget._dbOpenComputeSize) pickWidget._dbOpenComputeSize = pickWidget.computeSize;
          if (!pickWidget._dbOpenMinHeight) pickWidget._dbOpenMinHeight = pickWidget.getMinHeight;
          pickWidget.computedHeight = shown ? undefined : 0;
          pickWidget.computeSize = shown ? pickWidget._dbOpenComputeSize : (() => [0, -4]);
          pickWidget.getMinHeight = shown ? pickWidget._dbOpenMinHeight : (() => -4);
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
        pStatus.textContent = n ? `${n} selected · click to keep` : "Click images to keep";
      }
      function inlineCard(info, i) {
        const card = document.createElement("div");
        card.className = "db-pick-card" + (node._dbSel.has(i) ? " db-pick-sel" : "");
        const img = document.createElement("img");
        // Build /view URL directly (same construction as _dbRenderImages, which
        // renders reliably) rather than routing through api.apiURL.
        const q = `filename=${encodeURIComponent(info.filename || "")}&subfolder=${encodeURIComponent(info.subfolder || "")}&type=${encodeURIComponent(info.type || "temp")}`;
        img.src = `/view?${q}`;
        img.onload = syncImgH;
        img.onerror = () => { console.error("[DirtyBirds] picker image failed:", img.src, info); };
        const badge = document.createElement("span");
        badge.className = "db-pick-badge";
        badge.textContent = "#" + i;
        const check = document.createElement("span");
        check.className = "db-pick-check";
        check.textContent = "✓";
        card.append(img, badge, check);
        const dims = dimsLabel(info);
        if (dims) {
          const d = document.createElement("span");
          d.className = "db-pick-dims";
          d.textContent = dims;
          card.appendChild(d);
        }
        card.addEventListener("click", () => {
          const sel = node._dbSel;
          if (sel.has(i)) { sel.delete(i); card.classList.remove("db-pick-sel"); }
          else { sel.add(i); card.classList.add("db-pick-sel"); }
          inlineStatus();
        });
        return card;
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
      node._dbEndPick = () => { node._dbActivePick = false; setPickRowShown(false); setImageSelectShown(false); };
      node._dbRepaintInline = () => {
        [...imgPanel.querySelectorAll(".db-pick-card")].forEach((card, i) => {
          card.classList.toggle("db-pick-sel", node._dbSel.has(i));
        });
        inlineStatus();
      };
      node._dbTick = (txt) => { pCount.textContent = txt; };
      node._dbPickStatus = (t) => { pStatus.textContent = t; };

      // Static render of the final / picked image(s) after the run completes.
      node._dbRenderImages = (imgs) => {
        // Run is finished here (onExecuted) so the node is no longer the running
        // node — core's preview is already suppressed by onDrawBackground. No
        // flag needed; just make sure any active-pick state is cleared.
        node._dbActivePick = false;
        setPickRowShown(false);
        setImageSelectShown(false);
        imgPanel.innerHTML = "";
        if (!imgs || !imgs.length) { imgPanel.appendChild(imgEmpty); syncImgH(); return; }
        const rand = Date.now();
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
          card.addEventListener("click", () => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
            const full = document.createElement("img");
            full.src = img.src;
            full.style.cssText = "max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;";
            overlay.appendChild(full);
            overlay.addEventListener("click", () => overlay.remove());
            document.body.appendChild(overlay);
          });
          imgPanel.appendChild(card);
        });
        sizeImageCards();
        syncImgH();
      };

      // ── width sync — constrain DOM widgets to the node's inner width so wide
      //    controls reflow instead of overflowing and being clipped ───────────
      function applyWidths() {
        const w = nodeInnerW(node);
        widthEls.forEach(el => { if (el) el.style.width = w + "px"; });
      }
      const _origResize = node.onResize;
      node.onResize = function (size) {
        if (size[0] < DB_MIN_W) size[0] = DB_MIN_W;
        _origResize?.call(this, size);
        applyWidths();
      };

      // ── restore styled controls from saved widget values ──────────────────
      requestAnimationFrame(() => requestAnimationFrame(() => {
        applyWidths();
        samplerBtn.refresh(); schedulerBtn.refresh();
        noise.paint(); steps.paint(); cfg.paint();
        // Workflows persist the node's previous expanded preview height. Once
        // the empty UI has been rebuilt, collapse back to its natural widget
        // height; image/picker rendering will grow it again when needed.
        if (!node._dbImages?.length && !node.imgs?.length && !node._dbActivePick) {
          node.setSize(node.computeSize());
        }
      }));
    };
  },
});
