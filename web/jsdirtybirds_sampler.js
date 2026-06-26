/**
 * DirtyBirds Playhouse — Sampler node UI.
 *
 * Styled to match the Loader: titled sections, flyout pickers, sliders.
 *   • The Method — Sampler | Scheduler (two columns w/ splitter), noise slider
 *     (CPU / CPU+GPU / GPU), steps, cfg.
 *   • The Payoff — full-width in-node preview of the generated image(s).
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, makeSectionLabel, nodeInnerW } from "./db_shared.js";

ensureStylesheet();

const NOISE_MODES = ["cpu", "both", "gpu"];
const NOISE_LABELS = { cpu: "CPU", both: "Both", gpu: "GPU" };

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
    };

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
        const w = node.widgets?.find(w => w.name === name);
        if (!w) return undefined;
        w.computeSize    = () => [0, 0];
        w.serializeValue = () => w.value;
        if (typeof w.setHidden === "function") w.setHidden(true);
        else if ("hidden" in w) w.hidden = true;
        return w;
      }
      const widthEls = [];
      function addTitle(name, text) {
        const el = makeSectionLabel(text);
        el.style.cssText += "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
        node.addDOMWidget(name, "customhtml", el, { serialize: false, height: 26, getMinHeight: () => 26 });
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
      cols.style.cssText = "box-sizing:border-box;overflow:hidden;align-items:flex-start;";

      // Left column: stacked Sampler + Scheduler buttons (top-aligned).
      const leftCol = document.createElement("div"); leftCol.className = "db-talent-loras";
      leftCol.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      leftCol.append(samplerBtn.row, schedulerBtn.row);

      const divider = document.createElement("div"); divider.className = "db-talent-divider";

      // Right column: stacked Noise / Steps / CFG sliders.
      const rightCol = document.createElement("div"); rightCol.className = "db-talent-triggerwords";
      rightCol.style.cssText = "display:flex;flex-direction:column;min-width:0;";
      rightCol.append(noise.row, steps.row, cfg.row);

      cols.append(leftCol, divider, rightCol);
      const METHOD_H = 78;
      cols.style.height = METHOD_H + "px";
      node.addDOMWidget("db_method_cols", "customhtml", cols, {
        serialize: false, height: METHOD_H, getMinHeight: () => METHOD_H,
      });
      widthEls.push(cols);

      // ── 2. THE PAYOFF — image preview ─────────────────────────────────────
      addTitle("db_payofflabel", "The Payoff");
      const imgPanel = document.createElement("div");
      imgPanel.style.cssText = "display:flex;flex-direction:row;gap:6px;box-sizing:border-box;overflow:hidden;align-items:flex-start;";
      const imgEmpty = document.createElement("div");
      imgEmpty.className = "db-model-preview";
      imgEmpty.style.cssText += "display:flex;align-items:center;justify-content:center;color:#3a3a3a;font-style:italic;font-size:11px;";
      imgEmpty.textContent = "— run to preview —";
      imgPanel.appendChild(imgEmpty);

      const imgWidget = node.addDOMWidget("db_payoff_imgs", "customhtml", imgPanel, {
        serialize: false, height: 96, getMinHeight: () => Math.max(96, imgPanel.scrollHeight || 96),
      });
      widthEls.push(imgPanel);
      function syncImgH() {
        requestAnimationFrame(() => {
          const h = Math.max(96, imgPanel.scrollHeight || 96);
          if (imgWidget) imgWidget.computedHeight = h;
          node.setDirtyCanvas(true);
        });
      }
      node._dbRenderImages = (imgs) => {
        imgPanel.innerHTML = "";
        if (!imgs || !imgs.length) { imgPanel.appendChild(imgEmpty); syncImgH(); return; }
        const rand = Date.now();
        imgs.forEach(info => {
          const img = document.createElement("img");
          // Share the row width so multiple passes sit side by side.
          img.style.cssText = "flex:1;min-width:0;width:0;border-radius:8px;border:1px solid #34343a;display:block;";
          const q = `filename=${encodeURIComponent(info.filename)}&subfolder=${encodeURIComponent(info.subfolder || "")}&type=${encodeURIComponent(info.type || "temp")}&rand=${rand}`;
          img.src = `/view?${q}`;
          img.onload = syncImgH;
          imgPanel.appendChild(img);
        });
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
      }));
    };
  },
});
