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
        if (dimensionWidget?.value === RANDOM_DIM) {
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
        const isRandom = dimensionWidget?.value === RANDOM_DIM;
        showResolutionFlyout(dimData, dimensionKeys,
          isRandom ? dimensionKeys[0] : (dimensionWidget?.value || dimensionKeys[0]),
          isRandom, (value) => {
            // Store the sentinel as-is so Python randomizes each run; otherwise
            // store the chosen resolution key.
            if (dimensionWidget) dimensionWidget.value = (value === RANDOM_DIM) ? RANDOM_DIM : value;
            refreshResSelect();
            node.setDirtyCanvas(true);
          });
      });
      addFixed("db_resselect", resSelect, 38);

      // Move batch_size widget to appear right after the resolution picker; clamp to min 1
      requestAnimationFrame(() => {
        const bsIdx  = node.widgets?.findIndex(w => w.name === "batch_size");
        const rsIdx  = node.widgets?.findIndex(w => w.name === "db_resselect");
        if (bsIdx > -1) {
          const bw = node.widgets[bsIdx];
          if (bw.value < 1) bw.value = 1;
          if (rsIdx > -1 && bsIdx !== rsIdx + 1) {
            node.widgets.splice(bsIdx, 1);
            const insertAt = node.widgets.findIndex(w => w.name === "db_resselect");
            node.widgets.splice(insertAt + 1, 0, bw);
          }
        }
        node.setDirtyCanvas(true);
      });

      function updateResolutionState() {
        const isT2I = (workflowWidget?.value ?? "Text2Image") === "Text2Image";
        // Random only applies to Text2Image; fall back to a concrete size for I2I.
        if (!isT2I && dimensionWidget?.value === RANDOM_DIM) {
          dimensionWidget.value = dimensionKeys[0];
        }
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

      // ── 4. THE CAST — positive / negative embedding picker ──────────────

      function buildEmbedCol(header, widget) {
        const col = document.createElement("div");
        col.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;";

        const hdr = document.createElement("div");
        hdr.className = "db-talent-col-header";
        hdr.textContent = header;

        const chipArea = document.createElement("div");
        chipArea.className = "db-sel-loras";
        chipArea.style.minHeight = "24px";

        const browseBtn = document.createElement("button");
        browseBtn.className = "db-lora-add-open-btn db-lib-btn";
        browseBtn.textContent = header.includes("Pos") ? "＋ Positive Embedding" : "＋ Negative Embedding";
        browseBtn.style.cssText = "width:100%;margin-top:3px;box-sizing:border-box;";

        let _embedList = null;

        browseBtn.addEventListener("click", async (e) => {
          if (!_embedList) {
            const data = await fetchJSON("/dirtybirds/embeddings");
            _embedList = Array.isArray(data) ? data : [];
          }
          const items = _embedList.length
            ? _embedList.map(n => ({ content: n, callback: () => {
                current = { name: n, strength: 1.0, active: true };
                if (widget) widget.value = serializeEmbed();
                renderChip();
                syncEmbedH();
              }}))
            : [{ content: "(no embeddings found)", disabled: true }];
          new LiteGraph.ContextMenu(items, {
            event: e,
            title: header,
            scale: Math.max(1, app.canvas?.ds?.scale || 1),
          });
        });

        col.append(hdr, chipArea, browseBtn);

        let current = { name: "", strength: 1.0, active: true };

        function serializeEmbed() {
          if (!current.name) return "";
          const base = Math.abs(current.strength - 1.0) < 0.001 ? current.name : `${current.name}:${current.strength.toFixed(2)}`;
          return current.active ? base : `!${base}`;
        }

        function renderChip() {
          chipArea.innerHTML = "";
          if (!current.name) return;

          const row = document.createElement("div");
          row.className = "db-sel-row" + (current.active ? "" : " db-inactive");

          const label = document.createElement("span");
          label.className = "db-sel-name";
          label.textContent = current.name;
          label.title = current.name;

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

          const slider = document.createElement("input");
          slider.type = "range";
          slider.className = "db-sel-slider";
          slider.min = "0.10"; slider.max = "2.00"; slider.step = "0.05";
          slider.value = current.strength.toFixed(2);

          const valEl = document.createElement("span");
          valEl.className = "db-sel-val";
          valEl.textContent = current.strength.toFixed(2);

          slider.addEventListener("input", () => {
            current.strength = parseFloat(slider.value);
            valEl.textContent = current.strength.toFixed(2);
            if (widget) widget.value = serializeEmbed();
          });

          const rmBtn = document.createElement("span");
          rmBtn.className = "db-sel-remove";
          rmBtn.textContent = "✕";
          rmBtn.addEventListener("click", () => {
            current = { name: "", strength: 1.0, active: true };
            if (widget) widget.value = "";
            renderChip();
            syncEmbedH();
          });

          row.append(toggle, label, slider, valEl, rmBtn);
          chipArea.appendChild(row);
        }

        function deserialize(raw) {
          raw = (raw || "").trim();
          if (!raw) { current = { name: "", strength: 1.0, active: true }; renderChip(); return; }
          const active = !raw.startsWith("!");
          const stripped = active ? raw : raw.slice(1);
          const parts = stripped.split(":");
          const strength = parts.length > 1 ? parseFloat(parts[parts.length - 1]) || 1.0 : 1.0;
          const name = parts.length > 1 ? parts.slice(0, -1).join(":") : stripped;
          current = { name, strength, active };
          renderChip();
        }

        col._set = (name, strength, active = true) => {
          current = { name, strength, active };
          if (widget) widget.value = serializeEmbed();
          renderChip();
          syncEmbedH();
        };
        col._deserialize = deserialize;
        return col;
      }

      const embedColsEl = document.createElement("div");
      embedColsEl.style.cssText = "display:flex;flex-direction:column;gap:6px;box-sizing:border-box;overflow:hidden;";

      const posEmbedCol = buildEmbedCol("Positive Embedding", posEmbedWidget);
      const negEmbedCol = buildEmbedCol("Negative Embedding", negEmbedWidget);
      embedColsEl.append(posEmbedCol, negEmbedCol);

      const embedColsWidget = node.addDOMWidget("db_embed_cols", "customhtml", embedColsEl, {
        serialize: false, height: 140,
        getMinHeight: () => Math.max(140, embedColsEl.scrollHeight || 140),
      });

      function syncEmbedH() {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const h = Math.max(140, embedColsEl.scrollHeight || 140);
          if (embedColsWidget) { embedColsWidget.height = h; embedColsWidget.computedHeight = h; }
          node.setDirtyCanvas(true);
        }));
      }
      syncEmbedH();

      // Override _dbApplyEmbedding to also refresh the UI chips
      node._dbApplyEmbedding = (slot, name, strength = 1.0) => {
        const s = Number(strength);
        const stored = (!isNaN(s) && Math.abs(s - 1.0) > 1e-3) ? `${name}:${s.toFixed(2)}` : name;
        if (slot === "positive") {
          if (posEmbedWidget) posEmbedWidget.value = stored;
          posEmbedCol._set(name, isNaN(s) ? 1.0 : s);
        }
        if (slot === "negative") {
          if (negEmbedWidget) negEmbedWidget.value = stored;
          negEmbedCol._set(name, isNaN(s) ? 1.0 : s);
        }
        node.setDirtyCanvas(true);
      };

      // ── 5. DIRTY TALK — prompt preview with click-to-edit ────────────────
      const dtHeaderRow = document.createElement("div");
      dtHeaderRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
      const dtLabel = makeSectionLabel("Dirty Talk");
      dtLabel.style.flex = "1";
      const editBtn = document.createElement("button");
      editBtn.title = "Edit prompts";
      editBtn.style.cssText = "background:none;border:none;color:#555;cursor:pointer;font-size:13px;padding:0 4px;line-height:1;flex-shrink:0;";
      editBtn.textContent = "✏";
      dtHeaderRow.append(dtLabel, editBtn);
      node.addDOMWidget("db_twlabel", "customhtml", dtHeaderRow, {
        serialize: false, height: 26, getMinHeight: () => 26,
      });

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
        editBtn.textContent = _editMode ? "✓" : "✏";
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
        if (posEmbedWidget?.value) posEmbedCol._deserialize(posEmbedWidget.value);
        if (negEmbedWidget?.value) negEmbedCol._deserialize(negEmbedWidget.value);
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
      const domEls = [workflowDOM, resSelect, talentColsEl, embedColsEl, previewPanelEl];
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
