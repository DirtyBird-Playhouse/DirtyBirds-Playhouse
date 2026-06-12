/**
 * DirtyBirds Playhouse – Loader Node UI
 *
 * Sections (top → bottom):
 *   1. Workflow toggle        (Text2Image / Image2Image)
 *   2. The Main Attraction    (checkpoint / vae styled flyout buttons)
 *   [native positive / negative STRING widgets]
 *   3. Size Matters           (SDXL resolution pills)
 *   4. The Talent             (LoRA Selected | Lora Trigger Words — two columns)
 *   5. Dirty Talk             (read-only preview of positive / negative prompts)
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel,
} from "./db_shared.js";

ensureStylesheet();

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

// ── Model preview cache (checkpoint / vae) ────────────────────────────────────
// Keyed by `${type}:${name}`. Calls onOk when an image exists, onNone otherwise,
// so the caller can hide the thumbnail when a model has no sibling preview.
const _modelPreviewCache = new Map();
const _modelPendingImgs  = new Map();

function loadModelPreviewInto(img, type, name, onOk, onNone) {
  const url   = `/dirtybirds/model-preview?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`;
  const key   = `${type}:${name}`;
  const state = _modelPreviewCache.get(key);
  if (state === "none") { onNone?.(); return; }
  if (state === "ok")   { img.src = url; img.classList.add("db-lp-thumb-loaded"); onOk?.(); return; }
  if (state === "loading") { _modelPendingImgs.get(key)?.push({ img, onOk, onNone }); return; }
  _modelPreviewCache.set(key, "loading");
  _modelPendingImgs.set(key, [{ img, onOk, onNone }]);
  const test  = new Image();
  test.onload = () => {
    _modelPreviewCache.set(key, "ok");
    const q = _modelPendingImgs.get(key) || [];
    _modelPendingImgs.delete(key);
    q.forEach(e => { e.img.src = url; e.img.classList.add("db-lp-thumb-loaded"); e.onOk?.(); });
  };
  test.onerror = () => {
    _modelPreviewCache.set(key, "none");
    const q = _modelPendingImgs.get(key) || [];
    _modelPendingImgs.delete(key);
    q.forEach(e => e.onNone?.());
  };
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

    // ── LoRA Manager integration ─────────────────────────────────────────
    // Receives <lora:name:strength> or <lora:name:strength:clip_strength>
    // syntax from the comfyui-lora-manager "Send to node" action.
    api.addEventListener("lora_code_update", (event) => {
      const d = event?.detail || {};
      const nodeId = d.node_id ?? d.id;
      const loraCode = d.lora_code ?? "";
      const mode = d.mode ?? "append";

      const numericId = typeof nodeId === "string" ? Number(nodeId) : nodeId;

      // Collect target DB loader nodes
      const targets = [];
      if (numericId === -1) {
        // Broadcast — find all DirtyBirdsLoader nodes
        const allNodes = app.graph?._nodes || Object.values(app.graph?._nodes_by_id || {});
        (Array.isArray(allNodes) ? allNodes : []).forEach(n => {
          if (n?.comfyClass === "DirtyBirdsLoader") targets.push(n);
        });
      } else {
        const n = app.graph?.getNodeById?.(numericId);
        if (n?.comfyClass === "DirtyBirdsLoader") targets.push(n);
      }

      if (!targets.length) return;

      // Parse <lora:name:model_strength> or <lora:name:model_strength:clip_strength>
      const loraPattern = /<lora:([^:>]+):([-\d.]+)(?::([-\d.]+))?>/g;
      const loras = [];
      let match;
      while ((match = loraPattern.exec(loraCode)) !== null) {
        const strength = parseFloat(match[2]);
        const clipStrength = match[3] != null ? parseFloat(match[3]) : null;
        loras.push({
          name: match[1],
          strength: isNaN(strength) ? 1.0 : strength,
          clip_strength: (clipStrength != null && !isNaN(clipStrength)) ? clipStrength : null,
          active: true,
        });
      }

      if (!loras.length) return;

      targets.forEach(n => {
        if (typeof n._dbApplyLoras === "function") {
          n._dbApplyLoras(loras, mode);
        }
      });
    });

    // ── Register DirtyBirdsLoader as lora-capable in LoRA Manager's registry ─────
    // Replaces LM's refreshRegistry so DirtyBirdsLoader appears in "Send to node".
    // We must include DirtyBirds in the SAME register-nodes POST that LM makes,
    // because the server waits for exactly one POST and returns immediately after.
    //
    // The install is load-order safe: if LM's extension hasn't registered yet
    // when this setup() runs, we retry briefly until it appears. refreshRegistry
    // is only invoked on a user "Send to node" action, so installing within a
    // couple seconds of load is always in time.
    function installLMRegistryOverride() {
      const lmExt = app.extensions?.find(e => e.name === "LoraManager.WorkflowRegistry");
      if (!lmExt || typeof lmExt.refreshRegistry !== "function") return false;
      if (lmExt._dbOverrideInstalled) return true;  // idempotent
      lmExt._dbOverrideInstalled = true;

      const LM_LORA_CLASSES = new Set([
        "Lora Loader (LoraManager)",
        "Lora Stacker (LoraManager)",
        "WanVideo Lora Select (LoraManager)",
      ]);
      const LM_TARGET_WIDGETS = new Set(["ckpt_name", "unet_name"]);

      lmExt.refreshRegistry = async function () {
        try {
          const workflowNodes = [];

          function collectNodes(g, visited = new Set()) {
            const gid = String(g?.id ?? "root");
            if (!g || visited.has(gid)) return;
            visited.add(gid);

            if (Array.isArray(g._nodes)) {
              const graphName = typeof g.name === "string" && g.name.trim() ? g.name : null;
              for (const node of g._nodes) {
                if (!node) continue;
                const widgetNames = Array.isArray(node.widgets)
                  ? node.widgets.map(w => w?.name).filter(n => typeof n === "string" && n)
                  : [];
                const isLMNode = LM_LORA_CLASSES.has(node.comfyClass);
                const isDBNode = node.comfyClass === "DirtyBirdsLoader";
                const hasTargetWidget = widgetNames.some(n => LM_TARGET_WIDGETS.has(n));
                if (!isLMNode && !isDBNode && !hasTargetWidget) continue;

                workflowNodes.push({
                  node_id: node.id,
                  graph_id: gid,
                  graph_name: graphName,
                  bgcolor: node.bgcolor ?? node.color ?? null,
                  title: node.title || node.comfyClass,
                  type: node.comfyClass,
                  comfy_class: node.comfyClass,
                  mode: node.mode,
                  capabilities: {
                    supports_lora: isLMNode || isDBNode,
                    widget_names: widgetNames,
                  },
                });
              }
            }

            // Walk subgraphs (mirrors LM's traverseGraphs logic)
            const subs = g._subgraphs;
            if (subs) {
              const subArr = typeof subs.values === "function"
                ? [...subs.values()] : Object.values(subs);
              for (const sg of subArr) {
                const sub = sg?.graph || sg?._graph || sg;
                if (sub && sub !== g) collectNodes(sub, visited);
              }
            }
          }

          collectNodes(app.graph);

          const resp = await fetch("/api/lm/register-nodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nodes: workflowNodes }),
          });
          if (!resp.ok) console.warn("[DirtyBirds] LM register-nodes failed:", resp.statusText);
        } catch (e) {
          console.warn("[DirtyBirds] Error in LM registry refresh:", e);
        }
      };
      return true;
    }

    // Try now; if LoRA Manager hasn't registered yet, retry (~2s @ 50ms).
    if (!installLMRegistryOverride()) {
      let tries = 0;
      const lmTimer = setInterval(() => {
        if (installLMRegistryOverride() || ++tries > 40) clearInterval(lmTimer);
      }, 50);
    }

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
    // Also receive external lora_stack names → show as read-only chips.
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const p = message?.db_prompts;
      if (Array.isArray(p)) {
        this._dbLastPrompts = { pos: p[0] ?? "", neg: p[1] ?? "" };
        this._dbRefreshPreview?.();
      }
      const stackNames = message?.db_lora_stack;
      if (Array.isArray(stackNames)) {
        this._dbRefreshStackChips?.(stackNames);
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
      // positive / negative are hidden — edited via the Dirty Talk panel below
      const posWidget = hideWidget("positive");
      const negWidget = hideWidget("negative");

      // Random resolution is stored as the sentinel "__random__" in the
      // dimension widget so Python re-picks a fresh size on every run.
      const RANDOM_DIM = "__random__";

      // ── DOM widget helpers ───────────────────────────────────────────────
      function addFixed(name, el, h) {
        el.style.cssText += "box-sizing:border-box;overflow:hidden;";
        node.addDOMWidget(name, "customhtml", el, { serialize:false, height:h, getMinHeight:()=>h });
      }
      function addTitle(name, el, h) {
        h = Math.max(h || 0, 26); // enough height so centered section text isn't clipped
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

      // ── 1b. THE MAIN ATTRACTION — checkpoint / vae styled flyout buttons ──
      addTitle("db_modellabel", makeSectionLabel("The Main Attraction"), 20);

      // Hide the native combos; we drive their values from styled buttons below.
      const ckptWidget = hideWidget("ckpt_name");
      const vaeWidget  = hideWidget("vae_name");

      // Minimal selector row (TAG · current value · caret) that opens a ContextMenu
      // flyout of the hidden combo's options. Understated so the model pickers don't
      // dominate the node.
      // LoRA-row style: model preview thumbnail + TAG + name + caret. The thumb
      // shows the model's sibling preview image (via /dirtybirds/model-preview)
      // and is hidden when no image exists on disk. previewType is the
      // folder_paths type ("checkpoints" / "vae") the backend route resolves.
      function makeComboFlyout(widget, tag, title, displayFn, emptyLabel, previewType, onRefresh) {
        const row = document.createElement("div");
        row.className = "db-sel-row";
        row.style.cursor = "pointer";
        const thumb = document.createElement("img");
        thumb.className = "db-sel-thumb"; thumb.alt = ""; thumb.style.display = "none";
        const tagEl = document.createElement("span"); tagEl.className = "db-model-tag"; tagEl.textContent = tag;
        const nameEl = document.createElement("span"); nameEl.className = "db-sel-name"; nameEl.style.flex = "1";
        const caret = document.createElement("span"); caret.className = "db-model-caret"; caret.textContent = "▾";
        row.append(thumb, tagEl, nameEl, caret);

        function refreshThumb() {
          const v = widget?.value ?? "";
          thumb.style.display = "none";
          thumb.classList.remove("db-lp-thumb-loaded");
          // No preview for an unset value or the "Baked VAE" sentinel (no file).
          if (v && previewType && v !== "Baked VAE") {
            loadModelPreviewInto(thumb, previewType, v,
              () => { thumb.style.display = ""; },   // onOk → show
              () => { thumb.style.display = "none"; } // onNone → keep hidden
            );
          }
        }

        function refresh() {
          const v = widget?.value ?? "";
          nameEl.textContent = v ? displayFn(v) : emptyLabel;
          row.title = v || "";
          refreshThumb();
          onRefresh?.(v);
        }
        row.addEventListener("click", (e) => {
          const opts = widget?.options?.values || [];
          const items = opts.length
            ? opts.map(name => ({ content: displayFn(name), callback: () => {
                if (widget) widget.value = name;
                refresh();
                node.setDirtyCanvas(true);
              }}))
            : [{ content: "(none found)", disabled: true }];
          new LiteGraph.ContextMenu(items, {
            event: e,
            title,
            scale: Math.max(1, app.canvas?.ds?.scale || 1),
          });
        });
        refresh();
        return { btn: row, refresh };
      }

      const ckptDisplay = (v) => (v || "(none)").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
      const vaeDisplay  = (v) => v || "Baked VAE";
      
      const ckptFlyout = makeComboFlyout(ckptWidget, "CKPT", "Checkpoint", ckptDisplay, "Select checkpoint", null, (v) => {
        refreshCkptPreview();
      });
      const vaeFlyout  = makeComboFlyout(vaeWidget,  "VAE",  "VAE",        vaeDisplay,  "Select VAE",        "vae");

      // Checkpoint preview image (larger, under checkpoint loader)
      const ckptPreview = document.createElement("img");
      ckptPreview.className = "db-ckpt-preview";
      ckptPreview.style.cssText = "width:100%;height:140px;object-fit:cover;border-radius:6px;background:#181818;border:1px solid #333;display:none;margin-top:4px;";

      // Left column: Checkpoint Loader + Checkpoint Preview
      const leftCol = document.createElement("div");
      leftCol.style.cssText = "display:flex;flex-direction:column;flex:1.2;min-width:0;";
      leftCol.append(ckptFlyout.btn, ckptPreview);

      // Resolution is stored as "WIDTHxHEIGHT" or "RANDOM" in the hidden `dimension` widget.
      const RESOLUTIONS = [
        { label: "1:1",  w: 1024, h: 1024 },
        { label: "16:9", w: 1344, h: 768  },
        { label: "9:16", w: 768,  h: 1344 },
        { label: "3:2",  w: 1216, h: 832  },
        { label: "2:3",  w: 832,  h: 1216 },
        { label: "4:3",  w: 1152, h: 896  },
      ];
      if (dimensionWidget && !/^\d+x\d+$|^RANDOM$/.test(dimensionWidget.value || "")) {
        dimensionWidget.value = "1024x1024";
      }

      // Resolution picker row (styled like checkpoint loader button: Tag + Name + Caret)
      const resRow = document.createElement("div");
      resRow.className = "db-sel-row";
      resRow.style.cursor = "pointer";
      
      const resTag = document.createElement("span");
      resTag.className = "db-model-tag";
      resTag.textContent = "RES";
      
      const resLabel = document.createElement("span");
      resLabel.className = "db-sel-name";
      resLabel.style.flex = "1";
      
      const resCaret = document.createElement("span");
      resCaret.className = "db-model-caret";
      resCaret.textContent = "▾";
      
      resRow.append(resTag, resLabel, resCaret);

      function refreshResRow() {
        const cur = dimensionWidget?.value || "1024x1024";
        if (cur === "RANDOM") {
          resLabel.textContent = "Random";
        } else {
          const [w, h] = cur.split("x").map(Number);
          const res = RESOLUTIONS.find(r => r.w === w && r.h === h);
          resLabel.textContent = res ? `${res.label} (${w}×${h})` : `${w}×${h}`;
        }
      }
      resRow.addEventListener("click", (e) => {
        const items = RESOLUTIONS.map(r => ({
          content: `${r.label}  ·  ${r.w}×${r.h}`,
          callback: () => {
            if (dimensionWidget) dimensionWidget.value = `${r.w}x${r.h}`;
            refreshResRow();
            node.setDirtyCanvas(true);
          }
        }));
        items.push(null);
        items.push({
          content: "🎲 Random",
          callback: () => {
            if (dimensionWidget) dimensionWidget.value = "RANDOM";
            refreshResRow();
            node.setDirtyCanvas(true);
          }
        });
        new LiteGraph.ContextMenu(items, {
          event: e,
          title: "Resolution",
          scale: Math.max(1, app.canvas?.ds?.scale || 1),
        });
      });

      // Right column: Resolutions selector
      const rightCol = document.createElement("div");
      rightCol.style.cssText = "display:flex;flex-direction:column;flex:1;min-width:0;";
      rightCol.appendChild(resRow);

      // Top row container (flex)
      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;gap:6px;align-items:flex-start;width:100%;";
      topRow.append(leftCol, rightCol);

      // Add topRow widget
      const topRowWidget = node.addDOMWidget("db_ckpt_res_row", "customhtml", topRow, {
        serialize: false,
        height: 30,
        getMinHeight: () => Math.max(30, topRow.scrollHeight || 30),
      });

      function syncTopRowH() {
        requestAnimationFrame(() => {
          const h = Math.max(30, topRow.scrollHeight || 30);
          if (topRowWidget) { topRowWidget.height = h; topRowWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        });
      }

      function refreshCkptPreview() {
        const v = ckptWidget?.value ?? "";
        ckptPreview.style.display = "none";
        ckptPreview.classList.remove("db-lp-thumb-loaded");
        if (v && v !== "Baked VAE") {
          loadModelPreviewInto(ckptPreview, "checkpoints", v,
            () => {
              ckptPreview.style.display = "block";
              syncTopRowH();
            },
            () => {
              ckptPreview.style.display = "none";
              syncTopRowH();
            }
          );
        } else {
          syncTopRowH();
        }
      }

      addFixed("db_vae_btn",  vaeFlyout.btn,  30);

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

      // ── 2. SIZE MATTERS — resolution picker (embedding style) + batch + random ──
      addTitle("db_reslabel", makeSectionLabel("Size Matters"), 20);

      // Batch slider + Random toggle row.
      const batchWidget = hideWidget("batch_size");
      const batchRow = document.createElement("div");
      batchRow.className = "db-slider-row";
      batchRow.style.justifyContent = "space-between";
      const batchLabel = document.createElement("span"); batchLabel.className = "db-slider-label"; batchLabel.textContent = "Batch";
      const batchSlider = document.createElement("input"); batchSlider.type = "range"; batchSlider.className = "db-sel-slider";
      batchSlider.min = "1"; batchSlider.max = "5"; batchSlider.step = "1"; batchSlider.style.flex = "0 0 60px";
      batchSlider.value = String(Math.max(1, Math.min(5, batchWidget?.value || 1)));
      const batchVal = document.createElement("span"); batchVal.className = "db-sel-val"; batchVal.textContent = batchSlider.value;
      batchSlider.addEventListener("input", () => {
        if (batchWidget) batchWidget.value = parseInt(batchSlider.value, 10);
        batchVal.textContent = batchSlider.value;
      });

      // Random toggle (checkbox on the right side of batch row).
      const randomToggle = document.createElement("input");
      randomToggle.type = "checkbox";
      randomToggle.style.cssText = "width:16px;height:16px;cursor:pointer;accent-color:#5aadff;flex-shrink:0;";
      randomToggle.title = "Randomize resolution each run";
      randomToggle.addEventListener("change", () => {
        if (randomToggle.checked) {
          if (dimensionWidget) dimensionWidget.value = "RANDOM";
          refreshResRow();
        } else {
          if (dimensionWidget) dimensionWidget.value = "1024x1024";
          refreshResRow();
        }
        node.setDirtyCanvas(true);
      });

      batchRow.append(batchLabel, batchSlider, batchVal, randomToggle);
      addFixed("db_batch_row", batchRow, 26);

      // T2I enables resolution picker; I2I disables it (image drives the size).
      let resEnabled = true;
      function updateResolutionState() {
        resEnabled = (workflowWidget?.value ?? "Text2Image") === "Text2Image";
        resRow.style.opacity = resEnabled ? "" : "0.4";
        resRow.style.pointerEvents = resEnabled ? "" : "none";
      }

      function syncRandomToggle() {
        randomToggle.checked = (dimensionWidget?.value === "RANDOM");
      }

      refreshResRow();
      syncRandomToggle();
      updateResolutionState();

      // ── 3. THE CAST — positive / negative embedding picker (compact rows) ────
      addTitle("db_castlabel", makeSectionLabel("The Cast"), 20);

      function buildEmbedSlot(slot, widget) {
        // slot: "positive" or "negative"
        // Returns a single db-sel-row that expands/collapses based on state
        // Applies color-coded border stripe via db-emb-pos / db-emb-neg class

        const isPositive = slot === "positive";
        const slotClass = isPositive ? "db-emb-pos" : "db-emb-neg";

        const row = document.createElement("div");
        row.className = `db-sel-row ${slotClass}`;

        let current = { name: "", strength: 1.0, active: true };
        let _embedList = null;

        // Serialize to widget value: "name", "name:strength", or "!name:strength"
        function serializeEmbed() {
          if (!current.name) return "";
          const base = Math.abs(current.strength - 1.0) < 0.001 ? current.name : `${current.name}:${current.strength.toFixed(2)}`;
          return current.active ? base : `!${base}`;
        }

        // Render the row state (empty add-button or populated LoRA-style row)
        function render() {
          row.innerHTML = "";
          row.style.cssText = "";

          if (!current.name) {
            // Empty state: slim dashed add-button that fits a half-width column.
            // Header already says Positive/Negative, so the label is just "＋ Add".
            row.className = `db-emb-add ${slotClass}`;
            row.textContent = "＋ Add";
            row.title = isPositive ? "Add positive embedding" : "Add negative embedding";
            row.addEventListener("click", openEmbedMenu);
            return;
          }

          // Populated state: mirror buildLoraPanel's row (class-driven, no thumb).
          row.className = "db-sel-row " + slotClass + (current.active ? "" : " db-inactive");

          const toggle = document.createElement("button");
          toggle.className = "db-sel-toggle";
          toggle.textContent = current.active ? "●" : "○";
          toggle.title = current.active ? "Disable" : "Enable";
          toggle.addEventListener("click", () => {
            current.active = !current.active;
            toggle.textContent = current.active ? "●" : "○";
            toggle.title = current.active ? "Disable" : "Enable";
            row.classList.toggle("db-inactive", !current.active);
            if (widget) widget.value = serializeEmbed();
          });

          const nameEl = document.createElement("span");
          nameEl.className = "db-sel-name";
          nameEl.textContent = current.name;
          nameEl.title = current.name;

          const slider = document.createElement("input");
          slider.type = "range";
          slider.className = "db-sel-slider";
          slider.min = "0.10";
          slider.max = "2.00";
          slider.step = "0.05";
          slider.value = current.strength.toFixed(2);
          slider.title = `Weight: ${current.strength.toFixed(2)}`;

          const valEl = document.createElement("span");
          valEl.className = "db-sel-val";
          valEl.textContent = current.strength.toFixed(2);

          slider.addEventListener("input", () => {
            current.strength = parseFloat(slider.value);
            valEl.textContent = current.strength.toFixed(2);
            slider.title = `Weight: ${current.strength.toFixed(2)}`;
            if (widget) widget.value = serializeEmbed();
          });

          const rmBtn = document.createElement("button");
          rmBtn.className = "db-sel-remove";
          rmBtn.textContent = "✕";
          rmBtn.title = "Remove";
          rmBtn.addEventListener("click", () => {
            current = { name: "", strength: 1.0, active: true };
            if (widget) widget.value = "";
            render();
            syncEmbedH();
          });

          row.append(toggle, nameEl, slider, valEl, rmBtn);
        }

        // Open embedding selection menu
        async function openEmbedMenu(e) {
          if (!_embedList) {
            const data = await fetchJSON("/dirtybirds/embeddings");
            _embedList = Array.isArray(data) ? data : [];
          }
          const items = _embedList.length
            ? _embedList.map(n => ({
                content: n,
                callback: () => {
                  current = { name: n, strength: 1.0, active: true };
                  if (widget) widget.value = serializeEmbed();
                  render();
                  syncEmbedH();
                }
              }))
            : [{ content: "(no embeddings found)", disabled: true }];
          new LiteGraph.ContextMenu(items, {
            event: e,
            title: isPositive ? "Positive Embedding" : "Negative Embedding",
            scale: Math.max(1, app.canvas?.ds?.scale || 1),
          });
        }

        // Deserialize from widget value
        function deserialize(raw) {
          raw = (raw || "").trim();
          if (!raw) {
            current = { name: "", strength: 1.0, active: true };
            render();
            return;
          }
          const active = !raw.startsWith("!");
          const stripped = active ? raw : raw.slice(1);
          const parts = stripped.split(":");
          const strength = parts.length > 1 ? parseFloat(parts[parts.length - 1]) || 1.0 : 1.0;
          const name = parts.length > 1 ? parts.slice(0, -1).join(":") : stripped;
          current = { name, strength, active };
          render();
        }

        // Public methods for compatibility with old API
        row._set = (name, strength, active = true) => {
          current = { name, strength, active };
          if (widget) widget.value = serializeEmbed();
          render();
          syncEmbedH();
        };

        row._deserialize = deserialize;

        // Initial render (empty state)
        render();

        return row;
      }

      // Two-column container mirroring "The Talent" — Positive | divider | Negative
      const embedColsEl = document.createElement("div");
      embedColsEl.className = "db-talent-columns";
      embedColsEl.style.cssText = "box-sizing:border-box;overflow:hidden;";

      const posEmbedRow = buildEmbedSlot("positive", posEmbedWidget);
      const negEmbedRow = buildEmbedSlot("negative", negEmbedWidget);

      // Left column: Positive
      const posColEl = document.createElement("div");
      posColEl.className = "db-talent-loras";
      const posColHeader = document.createElement("div");
      posColHeader.className = "db-talent-col-header db-emb-head-pos";
      posColHeader.textContent = "Positive";
      posColEl.append(posColHeader, posEmbedRow);

      // Vertical divider
      const embedDividerEl = document.createElement("div");
      embedDividerEl.className = "db-talent-divider";

      // Right column: Negative
      const negColEl = document.createElement("div");
      negColEl.className = "db-talent-triggerwords";
      const negColHeader = document.createElement("div");
      negColHeader.className = "db-talent-col-header db-emb-head-neg";
      negColHeader.textContent = "Negative";
      negColEl.append(negColHeader, negEmbedRow);

      embedColsEl.append(posColEl, embedDividerEl, negColEl);

      const embedColsWidget = node.addDOMWidget("db_embed_cols", "customhtml", embedColsEl, {
        serialize: false, height: 60,
        getMinHeight: () => Math.max(60, embedColsEl.scrollHeight || 60),
      });

      function syncEmbedH() {
        requestAnimationFrame(() => {
          const h = Math.max(60, embedColsEl.scrollHeight || 60);
          if (embedColsWidget) { embedColsWidget.height = h; embedColsWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        });
      }
      syncEmbedH();

      // Override _dbApplyEmbedding to refresh UI slots
      node._dbApplyEmbedding = (slot, name, strength = 1.0) => {
        const s = Number(strength);
        const stored = (!isNaN(s) && Math.abs(s - 1.0) > 1e-3) ? `${name}:${s.toFixed(2)}` : name;
        if (slot === "positive") {
          if (posEmbedWidget) posEmbedWidget.value = stored;
          posEmbedRow._set(name, isNaN(s) ? 1.0 : s);
        }
        if (slot === "negative") {
          if (negEmbedWidget) negEmbedWidget.value = stored;
          negEmbedRow._set(name, isNaN(s) ? 1.0 : s);
        }
        node.setDirtyCanvas(true);
      };

      // ── 4. THE TALENT — two-column layout ────────────────────────────────
      addTitle("db_loralabel", makeSectionLabel("The Talent"), 20);
      let loraEntries = [];
      let twEntries   = [];

      function serializeLoras() { if (lorasDataWidget) lorasDataWidget.value=JSON.stringify(loraEntries); }
      function serializeTW()    { if (twDataWidget)    twDataWidget.value   =JSON.stringify(twEntries);   }

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
      // Read-only section for loras arriving via the lora_stack input socket
      const stackSectionEl = document.createElement("div");
      stackSectionEl.style.cssText = "display:none;margin-top:4px;";
      const stackSepEl = document.createElement("div");
      stackSepEl.style.cssText = "font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;";
      stackSepEl.textContent = "via lora_stack";
      const stackListEl = document.createElement("div");
      stackSectionEl.append(stackSepEl, stackListEl);
      loraColEl.append(loraColHeader, loraPanel.el, stackSectionEl);

      node._dbRefreshStackChips = (names) => {
        stackListEl.innerHTML = "";
        if (!names || !names.length) { stackSectionEl.style.display = "none"; syncTalentH(); return; }
        stackSectionEl.style.display = "";
        names.forEach(n => {
          const chip = document.createElement("div");
          chip.style.cssText = "font-size:10px;color:#888;padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          chip.textContent = n;
          chip.title = n;
          stackListEl.appendChild(chip);
        });
        syncTalentH();
      };

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
        // Mutate in place (splice) so the array reference captured by
        // buildTWPanel's closure stays valid — reassigning would orphan it.
        for (let i = twEntries.length - 1; i >= 0; i--) {
          if (!alive.has(twEntries[i].lora)) twEntries.splice(i, 1);
        }
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

      // ── 5. DIRTY TALK — prompt preview with click-to-edit ────────────────
      // Built via addTitle (same path as every other section title) so it centers
      // identically; the edit pencil floats over the label's right edge. An inline
      // SVG (not an emoji) avoids the tofu-box glyph some fonts render for ✏.
      const dtLabel = makeSectionLabel("Dirty Talk");
      dtLabel.style.position = "relative";
      const editBtn = document.createElement("button");
      editBtn.title = "Edit prompts";
      editBtn.style.cssText = "position:absolute;right:0;top:50%;transform:translateY(-50%);z-index:2;background:none;border:none;color:#555;cursor:pointer;padding:0 2px;line-height:0;display:flex;align-items:center;";
      editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      dtLabel.appendChild(editBtn);
      addTitle("db_twlabel", dtLabel, 26);

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

      // Edit-mode textareas (created once, swapped in/out)
      function makeEditArea(extraClass) {
        const ta = document.createElement("textarea");
        ta.className = "db-preview-block " + extraClass;
        ta.style.cssText = "resize:none;width:100%;box-sizing:border-box;font-family:inherit;font-size:inherit;min-height:40px;";
        ta.rows = 3;
        return ta;
      }
      const posEditArea = makeEditArea("db-pos");
      const negEditArea = makeEditArea("db-neg");

      previewPanelEl.append(posPreviewLabel, posPreviewBlock, negPreviewLabel, negPreviewBlock);

      node._dbLastPrompts = node._dbLastPrompts || { pos: "", neg: "" };
      let _editMode = false;
      const EMPTY_PREVIEW = '<span style="color:#3a3a3a;font-style:italic">— run to preview —</span>';

      function updatePreviews(posV, negV) {
        if (_editMode) return; // don't overwrite while user is typing
        if (posV === undefined) posV = node._dbLastPrompts.pos || "";
        if (negV === undefined) negV = node._dbLastPrompts.neg || "";
        if (posV) { posPreviewBlock.textContent = posV; posPreviewBlock.classList.remove("db-preview-empty"); }
        else      { posPreviewBlock.innerHTML = EMPTY_PREVIEW; posPreviewBlock.classList.add("db-preview-empty"); }
        if (negV) { negPreviewBlock.textContent = negV; negPreviewBlock.classList.remove("db-preview-empty"); }
        else      { negPreviewBlock.innerHTML = EMPTY_PREVIEW; negPreviewBlock.classList.add("db-preview-empty"); }
      }

      posEditArea.addEventListener("input", () => { if (posWidget) posWidget.value = posEditArea.value; syncPreviewH(); });
      negEditArea.addEventListener("input", () => { if (negWidget) negWidget.value = negEditArea.value; syncPreviewH(); });

      editBtn.addEventListener("click", () => {
        _editMode = !_editMode;
        // stroke="currentColor" on the SVG → color drives the pencil tint.
        editBtn.style.color  = _editMode ? "#5acc8a" : "#555";
        editBtn.title = _editMode ? "Done editing" : "Edit prompts";
        if (_editMode) {
          posEditArea.value = posWidget?.value || node._dbLastPrompts.pos || "";
          negEditArea.value = negWidget?.value || node._dbLastPrompts.neg || "";
          posPreviewBlock.replaceWith(posEditArea);
          negPreviewBlock.replaceWith(negEditArea);
        } else {
          posEditArea.replaceWith(posPreviewBlock);
          negEditArea.replaceWith(negPreviewBlock);
          updatePreviews(posWidget?.value || "", negWidget?.value || "");
        }
        syncPreviewH();
      });

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

        // Checkpoint / VAE button labels (native values are restored after onNodeCreated)
        ckptFlyout.refresh();
        vaeFlyout.refresh();

        // Resolution chip + batch slider reflect restored hidden-widget values
        refreshResRow();
        if (batchWidget) {
          const bv = Math.max(1, Math.min(5, batchWidget.value || 1));
          batchSlider.value = String(bv); batchVal.textContent = String(bv);
        }

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
        // Embeddings
        if (posEmbedWidget?.value) posEmbedRow._deserialize(posEmbedWidget.value);
        if (negEmbedWidget?.value) negEmbedRow._deserialize(negEmbedWidget.value);
        syncEmbedH();

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

      // ── Prune stale outputs from older workflows ─────────────────────────
      // The node only exposes "pipe" and "latent". Saved graphs built against
      // earlier versions may carry extra output sockets (e.g. "lora_stack",
      // "trigger_words"); strip them so the node matches its current def.
      requestAnimationFrame(() => {
        const allowed = new Set(["pipe", "basic_pipe", "latent"]);
        if (Array.isArray(node.outputs)) {
          for (let i = node.outputs.length - 1; i >= 0; i--) {
            if (!allowed.has(node.outputs[i]?.name)) {
              try { node.removeOutput(i); } catch (e) {}
            }
          }
          node.setDirtyCanvas(true, true);
        }
      });

      // ── Width sync ───────────────────────────────────────────────────────
      const domEls = [workflowDOM, topRow, vaeFlyout.btn, batchRow, embedColsEl, talentColsEl, previewPanelEl];
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
