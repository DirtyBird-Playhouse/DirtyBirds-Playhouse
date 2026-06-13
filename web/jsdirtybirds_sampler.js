/**
 * DirtyBirds Playhouse — Sampler node UI.
 *
 * Styled to match the Loader: titled sections, flyout pickers, sliders.
 *   • The Method — Sampler | Scheduler (two columns w/ splitter), noise slider
 *     (CPU / CPU+GPU / GPU), steps, cfg.
 *   • The Payoff — full-width in-node preview of the generated image(s).
 *   • Dirty Talk — read-only markdown of the final prompts + Save Prompt.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, makeSectionLabel } from "./db_shared.js";

ensureStylesheet();

const EMPTY_PREVIEW = '<span style="color:#3a3a3a;font-style:italic">— run to preview —</span>';
const NOISE_MODES = ["cpu", "both", "gpu"];
const NOISE_LABELS = { cpu: "CPU", both: "CPU+GPU", gpu: "GPU" };

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
      const md = message?.db_prompts_md;
      if (Array.isArray(md)) {
        this._dbLastPrompts = { pos: md[0] ?? "", neg: md[1] ?? "", loras: md[2] ?? "" };
        this._dbRefreshPrompts?.();
      }
      const imgs = message?.db_images;
      if (Array.isArray(imgs)) this._dbRenderImages?.(imgs);
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color   = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = Math.max(node.size[0] || 0, 360);

      node._dbLastPrompts = node._dbLastPrompts || { pos: "", neg: "", loras: "" };

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
      function addTitle(name, text) {
        const el = makeSectionLabel(text);
        el.style.cssText += "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
        node.addDOMWidget(name, "customhtml", el, { serialize: false, height: 26, getMinHeight: () => 26 });
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
        row.className = "db-slider-row"; row.style.justifyContent = "space-between";
        const lbl = document.createElement("span"); lbl.className = "db-slider-label"; lbl.textContent = "Noise";
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
        row.append(lbl, seg);
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
      cols.style.cssText = "box-sizing:border-box;overflow:hidden;align-items:stretch;";

      // Left column: stacked Sampler + Scheduler buttons.
      const leftCol = document.createElement("div"); leftCol.className = "db-talent-loras";
      leftCol.style.cssText = "display:flex;flex-direction:column;gap:4px;justify-content:center;min-width:0;";
      leftCol.append(samplerBtn.row, schedulerBtn.row);

      const divider = document.createElement("div"); divider.className = "db-talent-divider";

      // Right column: stacked Noise / Steps / CFG sliders.
      const rightCol = document.createElement("div"); rightCol.className = "db-talent-triggerwords";
      rightCol.style.cssText = "display:flex;flex-direction:column;min-width:0;";
      rightCol.append(noise.row, steps.row, cfg.row);

      cols.append(leftCol, divider, rightCol);
      node.addDOMWidget("db_method_cols", "customhtml", cols, {
        serialize: false, height: 84, getMinHeight: () => Math.max(84, cols.scrollHeight || 84),
      });

      // ── 2. THE PAYOFF — image preview ─────────────────────────────────────
      addTitle("db_payofflabel", "The Payoff");
      const imgPanel = document.createElement("div");
      imgPanel.style.cssText = "display:flex;flex-direction:column;gap:6px;box-sizing:border-box;overflow:hidden;";
      const imgEmpty = document.createElement("div");
      imgEmpty.className = "db-model-preview";
      imgEmpty.style.cssText += "display:flex;align-items:center;justify-content:center;color:#3a3a3a;font-style:italic;font-size:11px;";
      imgEmpty.textContent = "— run to preview —";
      imgPanel.appendChild(imgEmpty);

      const imgWidget = node.addDOMWidget("db_payoff_imgs", "customhtml", imgPanel, {
        serialize: false, height: 96, getMinHeight: () => Math.max(96, imgPanel.scrollHeight || 96),
      });
      function syncImgH() {
        requestAnimationFrame(() => {
          const h = Math.max(96, imgPanel.scrollHeight || 96);
          if (imgWidget) { imgWidget.height = h; imgWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        });
      }
      node._dbRenderImages = (imgs) => {
        imgPanel.innerHTML = "";
        if (!imgs || !imgs.length) { imgPanel.appendChild(imgEmpty); syncImgH(); return; }
        const rand = Date.now();
        imgs.forEach(info => {
          const img = document.createElement("img");
          img.style.cssText = "width:100%;border-radius:8px;border:1px solid #34343a;display:block;";
          const q = `filename=${encodeURIComponent(info.filename)}&subfolder=${encodeURIComponent(info.subfolder || "")}&type=${encodeURIComponent(info.type || "temp")}&rand=${rand}`;
          img.src = `/view?${q}`;
          img.onload = syncImgH;
          imgPanel.appendChild(img);
        });
        syncImgH();
      };

      // ── 3. DIRTY TALK ─────────────────────────────────────────────────────
      addTitle("db_dtlabel", "Dirty Talk");

      const panel = document.createElement("div");
      panel.className = "db-preview-panel";
      panel.style.cssText = "box-sizing:border-box;overflow:hidden;";

      const posLabel = document.createElement("div"); posLabel.className = "db-preview-label"; posLabel.textContent = "POSITIVE";
      const posBlock = document.createElement("div"); posBlock.className = "db-preview-block db-pos";
      const negLabel = document.createElement("div"); negLabel.className = "db-preview-label"; negLabel.textContent = "NEGATIVE";
      const negBlock = document.createElement("div"); negBlock.className = "db-preview-block db-neg";
      const loraLabel = document.createElement("div"); loraLabel.className = "db-preview-label"; loraLabel.textContent = "ACTIVE LORAS";
      const loraBlock = document.createElement("div"); loraBlock.className = "db-preview-block";

      const saveBtn = document.createElement("button");
      saveBtn.className = "db-lib-btn db-lora-add-open-btn";
      saveBtn.textContent = "💾  Save Prompt";
      saveBtn.style.cssText += "box-sizing:border-box;width:100%;margin-top:4px;";

      panel.append(posLabel, posBlock, negLabel, negBlock, loraLabel, loraBlock, saveBtn);

      const previewWidget = node.addDOMWidget("db_dtpanel", "customhtml", panel, {
        serialize: false, height: 80, getMinHeight: () => Math.max(80, panel.scrollHeight || 80),
      });
      function syncH() {
        requestAnimationFrame(() => {
          const h = Math.max(80, panel.scrollHeight || 80);
          if (previewWidget) { previewWidget.height = h; previewWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        });
      }
      function fill(block, value) {
        if (value) { block.textContent = value; block.classList.remove("db-preview-empty"); }
        else       { block.innerHTML = EMPTY_PREVIEW; block.classList.add("db-preview-empty"); }
      }
      node._dbRefreshPrompts = () => {
        const p = node._dbLastPrompts || { pos: "", neg: "", loras: "" };
        fill(posBlock, p.pos);
        fill(negBlock, p.neg);
        loraBlock.textContent = p.loras || "none";
        loraBlock.classList.toggle("db-preview-empty", !p.loras);
        syncH();
      };

      saveBtn.addEventListener("click", async () => {
        const p = node._dbLastPrompts || { pos: "", neg: "" };
        if (!p.pos && !p.neg) { alert("Run the graph first — nothing to save yet."); return; }
        const name = prompt("Save prompt as:", "");
        if (!name) return;
        try {
          const r = await fetch("/dirtybirds/save-prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, positive: p.pos, negative: p.neg }),
          });
          const data = await r.json();
          saveBtn.textContent = data?.ok ? "✓  Saved" : "✕  Failed";
        } catch (e) {
          console.error("[DirtyBirds] save-prompt failed", e);
          saveBtn.textContent = "✕  Failed";
        }
        setTimeout(() => { saveBtn.textContent = "💾  Save Prompt"; }, 1500);
      });

      // ── restore styled controls from saved widget values ──────────────────
      requestAnimationFrame(() => {
        samplerBtn.refresh(); schedulerBtn.refresh();
        noise.paint(); steps.paint(); cfg.paint();
        node._dbRefreshPrompts();
      });
    };
  },
});
