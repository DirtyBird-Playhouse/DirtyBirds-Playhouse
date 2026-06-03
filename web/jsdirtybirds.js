/**
 * DirtyBirds Playhouse – Loader Node UI
 *
 * Sections (top → bottom):
 *   1. Workflow toggle        (Text2Image / Image2Image)
 *   2. The Main Attraction    (native checkpoint / vae dropdowns)
 *   [native positive / negative STRING widgets]
 *   3. Size Matters           (SDXL resolution pills)
 *   4. The Talent             (LoRA Selected | Lora Trigger Words — two columns)
 *   5. Dirty Talk             (read-only preview of positive / negative prompts)
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// ── Stylesheet (idempotent) ───────────────────────────────────────────────────
(function () {
  const HREF = "/extensions/DirtyBirds-Playhouse/css/style.css";
  if (!document.querySelector(`link[href="${HREF}"]`)) {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = HREF;
    document.head.appendChild(link);
  }
})();

// ── Node theme ────────────────────────────────────────────────────────────────
const DB_COLOR   = "#1e1328";
const DB_BGCOLOR = "#131313";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error("[DirtyBirds]", e);
    return null;
  }
}

function nodeInnerW(node) {
  return Math.max(100, (node.size[0] || 380) - 32);
}

// ── Section label  ─────────── TITLE ─────────────────────────────────────────
function makeSectionLabel(text) {
  const el = document.createElement("div");
  el.className = "db-section-label";
  const l = document.createElement("span"); l.className = "db-sep-line";
  const t = document.createElement("span"); t.className = "db-sep-text"; t.textContent = text;
  const r = document.createElement("span"); r.className = "db-sep-line";
  el.append(l, t, r);
  return el;
}

// ── Aspect-ratio SVG visual ───────────────────────────────────────────────────
function makeAspectSVG(w, h) {
  const BOX = 18;
  let rw, rh;
  if (w >= h) { rw = BOX; rh = Math.max(2, Math.round((h / w) * BOX)); }
  else         { rh = BOX; rw = Math.max(2, Math.round((w / h) * BOX)); }
  const svg  = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width",  BOX);
  svg.setAttribute("height", BOX);
  svg.setAttribute("viewBox", `0 0 ${BOX} ${BOX}`);
  svg.style.cssText = "display:block;margin:0 auto 3px;flex-shrink:0;";
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x",      Math.floor((BOX - rw) / 2));
  rect.setAttribute("y",      Math.floor((BOX - rh) / 2));
  rect.setAttribute("width",  rw);
  rect.setAttribute("height", rh);
  rect.setAttribute("rx", "1");
  rect.setAttribute("fill", "currentColor");
  svg.appendChild(rect);
  return svg;
}

// ── Preview cache  (race-condition safe) ──────────────────────────────────────
const _previewCache = new Map();
const _pendingImgs  = new Map();

function loadPreviewInto(img, name) {
  const url   = `/dirtybirds/lora-preview?name=${encodeURIComponent(name)}`;
  const state = _previewCache.get(name);
  if (state === "none") return;
  if (state === "ok")   { img.src = url; img.classList.add("db-lp-thumb-loaded"); return; }
  if (state === "loading") { _pendingImgs.get(name)?.push(img); return; }
  _previewCache.set(name, "loading");
  _pendingImgs.set(name, [img]);
  const test   = new Image();
  test.onload  = () => {
    _previewCache.set(name, "ok");
    const q = _pendingImgs.get(name) || [];
    _pendingImgs.delete(name);
    q.forEach(i => { i.src = url; i.classList.add("db-lp-thumb-loaded"); });
  };
  test.onerror = () => { _previewCache.set(name, "none"); _pendingImgs.delete(name); };
  test.src = url;
}

// ── LoRA helpers ──────────────────────────────────────────────────────────────
function loraCategory(f)    { const p = f.replace(/\\/g,"/").split("/"); return p.length>1?p[0]:"(root)"; }
function loraDisplayName(f) { return f.replace(/\\/g,"/").split("/").pop().replace(/\.[^.]+$/,""); }

// ── Resolution dropdown flyout ────────────────────────────────────────────────
function showResolutionFlyout(dimData, keys, current, randomActive, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel   = document.createElement("div"); panel.className   = "db-flyout";
  panel.style.left = Math.min(window.innerWidth/2, window.innerWidth-300) + "px";
  panel.style.top  = Math.max(40, window.innerHeight/2-200) + "px";

  const header = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = "Size Matters";
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const list = document.createElement("div"); list.className = "db-flyout-list"; panel.appendChild(list);

  const randomRow = document.createElement("div");
  randomRow.className = "db-res-opt db-res-random" + (randomActive ? " db-selected" : "");
  randomRow.innerHTML = '<span class="db-res-opt-glyph">🎲</span><span class="db-res-opt-label">Random</span>';
  randomRow.addEventListener("click", () => { close(); onPick("__random__"); });
  list.appendChild(randomRow);

  const sep = document.createElement("div"); sep.className = "db-res-sep"; list.appendChild(sep);

  keys.forEach(key => {
    const [w, h] = dimData[key] || [1024, 1024];
    const row = document.createElement("div");
    row.className = "db-res-opt" + (!randomActive && key === current ? " db-selected" : "");
    const g = document.createElement("span"); g.className = "db-res-opt-glyph"; g.appendChild(makeAspectSVG(w, h));
    const l = document.createElement("span"); l.className = "db-res-opt-label"; l.textContent = key;
    const d = document.createElement("span"); d.className = "db-res-opt-dim"; d.textContent = `${w}×${h}`;
    row.append(g, l, d);
    row.addEventListener("click", () => { close(); onPick(key); });
    list.appendChild(row);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

// ── In-node selected-lora rows ────────────────────────────────────────────────
const SEL_ROW_H = 34;
const SEL_PAD   = 6;

function buildLoraPanel(node, entries, onChange, onLoraRemoved) {
  const container = document.createElement("div"); container.className = "db-sel-loras";
  function refresh() {
    container.innerHTML = "";
    if (!entries.length) {
      const hint = document.createElement("div"); hint.className="db-sel-empty"; hint.textContent="No LoRAs selected"; container.appendChild(hint); return;
    }
    entries.forEach((entry, idx) => {
      const row = document.createElement("div"); row.className = "db-sel-row" + (entry.active?"":" db-inactive");
      const thumb = document.createElement("img"); thumb.className="db-sel-thumb"; thumb.alt=""; loadPreviewInto(thumb, entry.name);
      const toggle = document.createElement("button"); toggle.className="db-sel-toggle"; toggle.textContent=entry.active?"●":"○"; toggle.title=entry.active?"Disable":"Enable";
      toggle.addEventListener("click", () => { entry.active=!entry.active; onChange(); refresh(); });
      const nameEl = document.createElement("span"); nameEl.className="db-sel-name"; nameEl.textContent=loraDisplayName(entry.name); nameEl.title=entry.name;
      const valEl  = document.createElement("span"); valEl.className="db-sel-val"; valEl.textContent=entry.strength.toFixed(2);
      const slider = document.createElement("input"); slider.type="range"; slider.className="db-sel-slider"; slider.min="0"; slider.max="2"; slider.step="0.05"; slider.value=String(entry.strength);
      slider.addEventListener("input", () => { entry.strength=entry.clip_strength=parseFloat(slider.value); valEl.textContent=entry.strength.toFixed(2); onChange(); });
      const rmBtn = document.createElement("button"); rmBtn.className="db-sel-remove"; rmBtn.textContent="✕"; rmBtn.title="Remove";
      rmBtn.addEventListener("click", () => {
        const removedName = entry.name;
        entries.splice(idx,1);
        onChange();
        refresh();
        onLoraRemoved?.(removedName);
        node.setDirtyCanvas(true);
      });
      row.append(thumb, toggle, nameEl, slider, valEl, rmBtn); container.appendChild(row);
    });
  }
  refresh();
  return { el: container, refresh };
}

// ── Trigger word chip panel ───────────────────────────────────────────────────
const TW_CHIP_H     = 28;
const TW_ROW_PAD    = 10;
const TW_MIN_H      = TW_CHIP_H + TW_ROW_PAD;

function buildTWPanel(node, twEntries, onChange) {
  const container = document.createElement("div"); container.className = "db-tw-panel";

  function refresh() {
    container.innerHTML = "";
    if (!twEntries.length) {
      const hint = document.createElement("div"); hint.className="db-tw-empty"; hint.textContent="No trigger words"; container.appendChild(hint); return;
    }
    twEntries.forEach((entry, idx) => {
      const chip = document.createElement("span");
      chip.className = "db-tw-chip" + (entry.active?" db-tw-active":" db-tw-inactive");
      chip.title = `LoRA: ${loraDisplayName(entry.lora)}\nDouble-click to edit`;

      const textEl = document.createElement("span"); textEl.className="db-tw-text"; textEl.textContent=entry.text;
      chip.appendChild(textEl);

      chip.addEventListener("click", (e) => {
        if (chip.classList.contains("db-tw-editing")) return;
        entry.active = !entry.active;
        chip.classList.toggle("db-tw-active",   entry.active);
        chip.classList.toggle("db-tw-inactive", !entry.active);
        onChange();
      });

      chip.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (chip.classList.contains("db-tw-editing")) return;
        chip.classList.add("db-tw-editing");
        const input = document.createElement("input");
        input.className = "db-tw-input";
        input.value = entry.text;
        input.style.width = Math.max(80, entry.text.length * 7) + "px";
        chip.innerHTML = "";
        chip.appendChild(input);

        function commit() {
          const val = input.value.trim();
          if (val) entry.text = val;
          chip.classList.remove("db-tw-editing");
          onChange();
          refresh();
        }
        input.addEventListener("keydown", (ev) => { if (ev.key==="Enter") { ev.preventDefault(); input.blur(); } if (ev.key==="Escape") { input.value=entry.text; input.blur(); } });
        input.addEventListener("blur", commit);
        setTimeout(() => { input.focus(); input.select(); }, 10);
      });

      container.appendChild(chip);
    });
  }

  refresh();
  return { el: container, refresh };
}

// ── Extension ─────────────────────────────────────────────────────────────────

app.registerExtension({
  name: "DirtyBirds.Loader",

  setup() {
    api.addEventListener("dirtybirds_set_loras", (event) => {
      const d = event?.detail || {};
      const node = app.graph?.getNodeById?.(Number(d.node_id)) ||
                   app.graph?.getNodeById?.(d.node_id);
      if (!node || node.comfyClass !== "DirtyBirdsLoader") return;
      if (typeof node._dbApplyLoras === "function") {
        node._dbApplyLoras(d.loras || [], d.mode || "append");
      }
    });

    api.addEventListener("dirtybirds_set_embedding", (event) => {
      const d = event?.detail || {};
      const node = app.graph?.getNodeById?.(Number(d.node_id)) ||
                   app.graph?.getNodeById?.(d.node_id);
      if (!node || node.comfyClass !== "DirtyBirdsLoader") return;
      if (typeof node._dbApplyEmbedding === "function") {
        node._dbApplyEmbedding(d.slot, d.name, d.strength);
      }
    });
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsLoader") return;

    const dimensions    = await fetchJSON("/dirtybirds/dimensions");
    const dimData       = dimensions || { "1024x1024": [1024, 1024] };
    const dimensionKeys = Object.keys(dimData);

    // Receive executed prompt text → update the "Dirty Talk" preview
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const p = message?.db_prompts;
      if (Array.isArray(p)) {
        this._dbLastPrompts = { pos: p[0] ?? "", neg: p[1] ?? "" };
        this._dbRefreshPreview?.();
      }
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.size[0] = 380;
      node.color   = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;

      // ── Hide backing STRING widgets (not positive/negative — those stay native) ──
      function hideWidget(name) {
        const w = node.widgets?.find(w => w.name === name);
        if (!w) return undefined;
        w.computeSize    = () => [0, 0];
        w.serializeValue = () => w.value;
        if (typeof w.setHidden === "function") w.setHidden(true);
        else if ("hidden" in w) w.hidden = true;
        return w;
      }

      const workflowWidget  = hideWidget("workflow");
      const dimensionWidget = hideWidget("dimension");
      const posEmbedWidget  = hideWidget("pos_embedding");
      const negEmbedWidget  = hideWidget("neg_embedding");
      const lorasDataWidget = hideWidget("loras_data");
      const twDataWidget    = hideWidget("trigger_words_data");
      // positive / negative are intentionally left as visible native widgets

      let _randomActive = false;

      // ── DOM widget helpers ───────────────────────────────────────────────
      function addFixed(name, el, h) {
        el.style.cssText += "box-sizing:border-box;overflow:hidden;";
        node.addDOMWidget(name, "customhtml", el, { serialize:false, height:h, getMinHeight:()=>h });
      }
      function addTitle(name, el, h) {
        el.style.cssText += "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
        node.addDOMWidget(name, "customhtml", el, { serialize:false, height:h, getMinHeight:()=>h });
      }

      // ── 1. WORKFLOW TOGGLE ───────────────────────────────────────────────
      const workflowDOM = document.createElement("div"); workflowDOM.className="db-workflow-group";
      ["Text2Image","Image2Image"].forEach(mode => {
        const btn = document.createElement("button");
        btn.className = "db-workflow-btn"+((workflowWidget?.value??"Text2Image")===mode?" db-active":"");
        btn.textContent = mode==="Text2Image"?"🖼  Text → Image":"🔄  Image → Image";
        btn.addEventListener("click", () => {
          workflowDOM.querySelectorAll(".db-workflow-btn").forEach(b=>b.classList.remove("db-active"));
          btn.classList.add("db-active");
          if (workflowWidget) workflowWidget.value=mode;
          node.inputs?.forEach(inp => { if (inp.name==="image") inp.hidden=(mode!=="Image2Image"); });
          updateResolutionState(); node.setDirtyCanvas(true);
        });
        workflowDOM.appendChild(btn);
      });
      addFixed("db_workflow", workflowDOM, 48);
      const wIdx = node.widgets.findIndex(w=>w.name==="db_workflow");
      if (wIdx>0) { const [we]=node.widgets.splice(wIdx,1); node.widgets.unshift(we); }

      // ── 1b. MODEL TITLE ──────────────────────────────────────────────────
      addTitle("db_modellabel", makeSectionLabel("The Main Attraction"), 20);
      {
        const mlIdx = node.widgets.findIndex(w=>w.name==="db_modellabel");
        const ckIdx = node.widgets.findIndex(w=>w.name==="ckpt_name");
        if (mlIdx>-1 && ckIdx>-1 && mlIdx!==ckIdx-1) {
          const [ml] = node.widgets.splice(mlIdx,1);
          const insertAt = node.widgets.findIndex(w=>w.name==="ckpt_name");
          node.widgets.splice(insertAt, 0, ml);
        }
      }

      // ── Embedding apply method (from Casting Coach event) ────────────────
      node._dbApplyEmbedding = (slot, name, strength = 1.0) => {
        // Store as "name" (strength 1) or "name:strength" so the node can
        // emit a weighted (embedding:name:strength) token at encode time.
        const s = Number(strength);
        const stored = (!isNaN(s) && Math.abs(s - 1.0) > 1e-3) ? `${name}:${s.toFixed(2)}` : name;
        if (slot === "positive" && posEmbedWidget) posEmbedWidget.value = stored;
        if (slot === "negative" && negEmbedWidget) negEmbedWidget.value = stored;
        node.setDirtyCanvas(true);
      };

      // ── 2. RESOLUTION (compact dropdown) ─────────────────────────────────
      addTitle("db_reslabel", makeSectionLabel("Size Matters"), 20);

      if (dimensionWidget && !dimensionWidget.value) dimensionWidget.value = dimensionKeys[0];

      const resSelect = document.createElement("button");
      resSelect.className = "db-res-select";

      function refreshResSelect() {
        const isT2I = (workflowWidget?.value ?? "Text2Image") === "Text2Image";
        resSelect.disabled = !isT2I;
        resSelect.classList.toggle("db-disabled", !isT2I);
        if (_randomActive) {
          resSelect.innerHTML = '<span class="db-res-sel-glyph">🎲</span>' +
            '<span class="db-res-sel-label">Random</span><span class="db-res-sel-caret">▾</span>';
          return;
        }
        const key = dimensionWidget?.value || dimensionKeys[0];
        const [w, h] = dimData[key] || [1024, 1024];
        resSelect.innerHTML = "";
        const g = document.createElement("span"); g.className = "db-res-sel-glyph"; g.appendChild(makeAspectSVG(w, h));
        const l = document.createElement("span"); l.className = "db-res-sel-label"; l.textContent = `${key}  ·  ${w}×${h}`;
        const c = document.createElement("span"); c.className = "db-res-sel-caret"; c.textContent = "▾";
        resSelect.append(g, l, c);
      }

      resSelect.addEventListener("click", () => {
        if (resSelect.disabled) return;
        showResolutionFlyout(dimData, dimensionKeys, dimensionWidget?.value || dimensionKeys[0],
          _randomActive, (value) => {
            if (value === "__random__") {
              _randomActive = true;
              if (dimensionWidget) {
                dimensionWidget.value = dimensionKeys[Math.floor(Math.random()*dimensionKeys.length)];
              }
            } else {
              _randomActive = false;
              if (dimensionWidget) dimensionWidget.value = value;
            }
            refreshResSelect();
            node.setDirtyCanvas(true);
          });
      });
      addFixed("db_resselect", resSelect, 38);

      function updateResolutionState() {
        const isT2I = (workflowWidget?.value ?? "Text2Image") === "Text2Image";
        if (!isT2I) _randomActive = false;
        refreshResSelect();
      }
      refreshResSelect();
      updateResolutionState();

      // ── 3. THE TALENT — two-column layout ────────────────────────────────
      addTitle("db_loralabel", makeSectionLabel("The Talent"), 20);
      let loraEntries = [];
      let twEntries   = [];

      function serializeLoras() { if (lorasDataWidget) lorasDataWidget.value=JSON.stringify(loraEntries); }
      function serializeTW()    { if (twDataWidget)    twDataWidget.value   =JSON.stringify(twEntries);   }

      // Library button
      const libBtn = document.createElement("button"); libBtn.className = "db-lora-add-open-btn db-lib-btn";
      libBtn.textContent = "🍑  The Casting Couch";
      libBtn.addEventListener("click", () => {
        const gid = node.graph?.id ? `&graph_id=${encodeURIComponent(node.graph.id)}` : "";
        window.open(`/dirtybirds/library?node_id=${encodeURIComponent(node.id)}${gid}`,
                    "_blank", "noopener");
      });
      addFixed("db_loader_lib_btn", libBtn, 38);

      // Two-column container
      const talentColsEl = document.createElement("div");
      talentColsEl.className = "db-talent-columns";
      talentColsEl.style.cssText = "box-sizing:border-box;overflow:hidden;";

      // Left: LoRA list
      const loraColEl = document.createElement("div");
      loraColEl.className = "db-talent-loras";
      const loraColHeader = document.createElement("div");
      loraColHeader.className = "db-talent-col-header";
      loraColHeader.textContent = "Lora Selected";

      const loraPanel = buildLoraPanel(node, loraEntries,
        () => { serializeLoras(); syncTalentH(); syncTWToLoras(); },
        (removedName) => { syncTWToLoras(); }
      );
      loraColEl.append(loraColHeader, loraPanel.el);

      // Vertical divider
      const dividerEl = document.createElement("div");
      dividerEl.className = "db-talent-divider";

      // Right: trigger words
      const twColEl = document.createElement("div");
      twColEl.className = "db-talent-triggerwords";
      const twColHeader = document.createElement("div");
      twColHeader.className = "db-talent-col-header";
      twColHeader.textContent = "Lora Trigger Words";

      const twPanel = buildTWPanel(node, twEntries, () => { serializeTW(); syncTalentH(); });
      twColEl.append(twColHeader, twPanel.el);

      talentColsEl.append(loraColEl, dividerEl, twColEl);

      const talentColsWidget = node.addDOMWidget("db_talent_cols", "customhtml", talentColsEl, {
        serialize: false, height: 60,
        getMinHeight: () => Math.max(60, talentColsEl.scrollHeight || 60),
      });

      function syncTalentH() {
        requestAnimationFrame(() => {
          const h = Math.max(60, talentColsEl.scrollHeight || 60);
          if (talentColsWidget) { talentColsWidget.height = h; talentColsWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        });
      }

      function syncTWToLoras() {
        const alive = new Set(loraEntries.map(e=>e.name));
        const before = twEntries.length;
        twEntries = twEntries.filter(e=>alive.has(e.lora));
        if (twEntries.length !== before) { serializeTW(); twPanel.refresh(); syncTalentH(); }
      }

      async function addTWForLora(loraName) {
        const meta = await fetchJSON(`/dirtybirds/lora-meta?name=${encodeURIComponent(loraName)}`);
        const words = meta?.trigger_words || [];
        if (!words.length) return;
        let changed = false;
        words.forEach(w => {
          const text = w.trim();
          if (text && !twEntries.find(e=>e.lora===loraName && e.text===text)) {
            twEntries.push({ lora:loraName, text, active:true });
            changed = true;
          }
        });
        if (changed) { serializeTW(); twPanel.refresh(); syncTalentH(); node.setDirtyCanvas(true); }
      }

      function addLoraEntry(name, strength = 1.0, clip = null, active = true) {
        if (!name) return false;
        if (loraEntries.some(e => e.name === name)) return false;
        loraEntries.push({
          name,
          strength: Number(strength),
          clip_strength: clip == null ? Number(strength) : Number(clip),
          active: !!active,
        });
        serializeLoras(); loraPanel.refresh(); syncTalentH();
        addTWForLora(name);
        return true;
      }

      node._dbApplyLoras = (loras, mode = "append") => {
        if (mode === "replace") {
          loraEntries.splice(0, loraEntries.length);
          twEntries.splice(0, twEntries.length);
          serializeTW(); twPanel.refresh(); syncTalentH();
        }
        let added = 0;
        (loras || []).forEach(l => {
          if (addLoraEntry(l.name, l.strength, l.clip_strength, l.active)) added++;
        });
        node.setDirtyCanvas(true);
        return added;
      };

      // ── 4. DIRTY TALK — read-only prompt preview ─────────────────────────
      addTitle("db_twlabel", makeSectionLabel("Dirty Talk"), 20);

      const previewPanelEl = document.createElement("div");
      previewPanelEl.className = "db-preview-panel";
      previewPanelEl.style.cssText = "box-sizing:border-box;overflow:hidden;";

      const posPreviewLabel = document.createElement("div");
      posPreviewLabel.className = "db-preview-label"; posPreviewLabel.textContent = "POSITIVE";
      const posPreviewBlock = document.createElement("div");
      posPreviewBlock.className = "db-preview-block db-pos";

      const negPreviewLabel = document.createElement("div");
      negPreviewLabel.className = "db-preview-label"; negPreviewLabel.textContent = "NEGATIVE";
      const negPreviewBlock = document.createElement("div");
      negPreviewBlock.className = "db-preview-block db-neg";

      previewPanelEl.append(posPreviewLabel, posPreviewBlock, negPreviewLabel, negPreviewBlock);

      // Prompts arrive at execution time via the input sockets; the node
      // stores the last executed values and renders them here.
      node._dbLastPrompts = node._dbLastPrompts || { pos: "", neg: "" };

      const EMPTY_PREVIEW = '<span style="color:#3a3a3a;font-style:italic">— run to preview —</span>';

      function updatePreviews(posV, negV) {
        if (posV === undefined) posV = node._dbLastPrompts.pos || "";
        if (negV === undefined) negV = node._dbLastPrompts.neg || "";
        if (posV) { posPreviewBlock.textContent = posV; posPreviewBlock.classList.remove("db-preview-empty"); }
        else      { posPreviewBlock.innerHTML = EMPTY_PREVIEW; posPreviewBlock.classList.add("db-preview-empty"); }
        if (negV) { negPreviewBlock.textContent = negV; negPreviewBlock.classList.remove("db-preview-empty"); }
        else      { negPreviewBlock.innerHTML = EMPTY_PREVIEW; negPreviewBlock.classList.add("db-preview-empty"); }
      }

      node._dbRefreshPreview = () => {
        updatePreviews(node._dbLastPrompts.pos, node._dbLastPrompts.neg);
        syncPreviewH();
      };

      function syncPreviewH() {
        requestAnimationFrame(() => {
          const h = Math.max(60, previewPanelEl.scrollHeight || 60);
          if (previewWidget) { previewWidget.height = h; previewWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        });
      }

      const previewWidget = node.addDOMWidget("db_preview_panel", "customhtml", previewPanelEl, {
        serialize: false, height: 60,
        getMinHeight: () => Math.max(60, previewPanelEl.scrollHeight || 60),
      });

      // ── Restore saved state ──────────────────────────────────────────────
      requestAnimationFrame(() => {
        // positive/negative are input sockets — preview is filled after a run
        // via onExecuted. Render the last-known (or empty) state now.
        node._dbRefreshPreview();

        // LoRAs
        const savedL = lorasDataWidget?.value;
        if (savedL && savedL !== "[]") {
          try {
            const parsed = JSON.parse(savedL);
            if (Array.isArray(parsed) && parsed.length) {
              loraEntries.splice(0, loraEntries.length, ...parsed);
              loraPanel.refresh(); syncTalentH();
            }
          } catch (e) { console.warn("[DirtyBirds] Could not restore LoRAs:", e); }
        }
        // Trigger words
        const savedTW = twDataWidget?.value;
        if (savedTW && savedTW !== "[]") {
          try {
            const parsed = JSON.parse(savedTW);
            if (Array.isArray(parsed) && parsed.length) {
              twEntries.splice(0, twEntries.length, ...parsed);
              twPanel.refresh(); syncTalentH();
            }
          } catch (e) { console.warn("[DirtyBirds] Could not restore trigger words:", e); }
        }
      });

      // ── Width sync ───────────────────────────────────────────────────────
      const domEls = [workflowDOM, resSelect, libBtn, talentColsEl, previewPanelEl];
      function applyWidths() {
        const w = nodeInnerW(node);
        domEls.forEach(el => { el.style.width=w+"px"; });
        node.widgets.forEach(ww => {
          if (ww.element?.classList?.contains("db-section-label")) ww.element.style.width=w+"px";
        });
      }
      requestAnimationFrame(() => requestAnimationFrame(applyWidths));
      const origResize = node.onResize;
      node.onResize = function(size) { origResize?.call(this,size); applyWidths(); };
    };
  },
});
