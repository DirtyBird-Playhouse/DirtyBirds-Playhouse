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

// ── Media preview loader (image OR video) ─────────────────────────────────────
// Fills `mount` with an <img>; if the URL decodes as video (mp4/webm) instead,
// swaps in a muted looping <video>. Mirrors LoRA-Manager's card rendering so
// checkpoints shipping only a video preview still show something.
function loadMediaUrl(mount, url, onOk, onNone, fit = "cover") {
  const css = `width:100%;height:100%;object-fit:${fit};display:block;`;
  const img = document.createElement("img");
  img.style.cssText = css;
  img.onload = () => { mount.innerHTML = ""; mount.appendChild(img); onOk?.(); };
  img.onerror = () => {
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = css;
    v.onloadeddata = () => { mount.innerHTML = ""; mount.appendChild(v); v.play?.().catch(() => {}); onOk?.(); };
    v.onerror = () => { onNone?.(); };
    v.src = url;
  };
  img.src = url;
}
function loadModelMedia(mount, type, name, onOk, onNone) {
  loadMediaUrl(mount, `/dirtybirds/model-preview?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, onOk, onNone);
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

// ── Generic card-grid flyout (LoRA-Manager style) ─────────────────────────────
// Used by the checkpoint and embedding pickers. previewUrlFn(name) returns the
// preview endpoint (image or video); displayFn(name) the label text.
function showCardFlyout(title, names, current, previewUrlFn, displayFn, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel   = document.createElement("div"); panel.className   = "db-flyout";
  panel.style.width = "min(560px, 90vw)";
  panel.style.left  = Math.max(20, (window.innerWidth  - 560) / 2) + "px";
  panel.style.top   = Math.max(40, (window.innerHeight - 520) / 2) + "px";

  const header   = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl  = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;padding:8px;overflow:auto;max-height:64vh;";
  panel.appendChild(grid);

  if (!names.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:20px;color:#888;font-size:12px;";
    empty.textContent = "Nothing found";
    grid.appendChild(empty);
  }
  names.forEach(name => {
    const card = document.createElement("div");
    card.style.cssText = "position:relative;aspect-ratio:1/1;border-radius:6px;overflow:hidden;cursor:pointer;background:#181818;border:2px solid " + (name === current ? "#5aadff" : "transparent") + ";";
    const media = document.createElement("div");
    media.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;";
    media.textContent = "…";
    loadMediaUrl(media, previewUrlFn(name), null,
      () => { media.innerHTML = ""; media.textContent = "no preview"; }, "cover");
    const label = document.createElement("div");
    label.textContent = displayFn ? displayFn(name) : name; label.title = name;
    label.style.cssText = "position:absolute;left:0;right:0;bottom:0;padding:6px;font-size:10px;line-height:1.2;color:#eee;background:linear-gradient(transparent,rgba(0,0,0,.9));";
    card.append(media, label);
    card.addEventListener("click", () => { close(); onPick(name); });
    grid.appendChild(card);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

// ── Small options flyout (e.g. Seed: Fixed / Random) ──────────────────────────
function showOptionsFlyout(title, options, current, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel   = document.createElement("div"); panel.className   = "db-flyout";
  panel.style.left = Math.min(window.innerWidth / 2, window.innerWidth - 300) + "px";
  panel.style.top  = Math.max(40, window.innerHeight / 2 - 120) + "px";

  const header   = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl  = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const list = document.createElement("div"); list.className = "db-flyout-list"; panel.appendChild(list);
  options.forEach(opt => {
    const row = document.createElement("div");
    row.className = "db-res-opt" + (opt.value === current ? " db-selected" : "");
    row.innerHTML = `<span class="db-res-opt-glyph">${opt.glyph || ""}</span><span class="db-res-opt-label">${opt.label}</span>`;
    row.addEventListener("click", () => { close(); onPick(opt.value); });
    list.appendChild(row);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

// ── Scrollable name list flyout (no previews) — used by the embedding picker ──
function showListFlyout(title, names, current, displayFn, onPick) {
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

  if (!names.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:14px;color:#888;font-size:12px;";
    empty.textContent = "Nothing found";
    list.appendChild(empty);
  }
  names.forEach(name => {
    const row = document.createElement("div");
    row.className = "db-res-opt" + (name === current ? " db-selected" : "");
    const label = document.createElement("span");
    label.className = "db-res-opt-label";
    label.textContent = displayFn ? displayFn(name) : name;
    label.title = name;
    row.appendChild(label);
    row.addEventListener("click", () => { close(); onPick(name); });
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
      const thumb = document.createElement("div"); thumb.className="db-sel-thumb"; thumb.style.cssText="overflow:hidden;";
      loadMediaUrl(thumb, `/dirtybirds/lora-preview?name=${encodeURIComponent(entry.name)}`, null, () => { thumb.style.display="none"; });
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
    // ── LoRA Manager eligibility shim ────────────────────────────────────
    // comfyui-lora-manager only sends LoRAs to nodes its registry flags as
    // lora-capable (hardcoded to its own classes in workflow_registry.js).
    // It already lists our node (it has a ckpt_name widget) but with
    // supports_lora:false. Intercept its /api/lm/register-nodes POST and flip
    // our node's flag to true so "send to node" targets us. Self-contained;
    // no LoRA Manager files are edited.
    if (!window.__dbLoraRegisterPatched) {
      window.__dbLoraRegisterPatched = true;
      const _origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        try {
          const url = typeof input === "string" ? input : input?.url;
          if (url && url.indexOf("/api/lm/register-nodes") !== -1 &&
              init && typeof init.body === "string") {
            const data = JSON.parse(init.body);
            if (Array.isArray(data?.nodes)) {
              let changed = false;
              for (const n of data.nodes) {
                if ((n?.comfy_class === "DirtyBirdsLoader" || n?.type === "DirtyBirdsLoader")) {
                  n.capabilities = n.capabilities || {};
                  if (n.capabilities.supports_lora !== true) {
                    n.capabilities.supports_lora = true;
                    changed = true;
                  }
                }
              }
              if (changed) init = { ...init, body: JSON.stringify(data) };
            }
          }
        } catch (e) { /* fall through to original fetch unmodified */ }
        return _origFetch(input, init);
      };
    }

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
      const stackNames = message?.db_lora_stack;
      if (Array.isArray(stackNames)) {
        this._dbRefreshStackChips?.(stackNames);
      }
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.size[0] = 420;
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

      // ── 1. WORKFLOW TOGGLE (sliding switch) ──────────────────────────────
      const workflowDOM = document.createElement("div"); workflowDOM.className="db-workflow-switch";
      const wfKnob = document.createElement("div"); wfKnob.className="db-wf-knob";
      const wfOptT = document.createElement("div"); wfOptT.className="db-wf-opt"; wfOptT.textContent="Text → Image";
      const wfOptI = document.createElement("div"); wfOptI.className="db-wf-opt"; wfOptI.textContent="Image → Image";
      workflowDOM.append(wfKnob, wfOptT, wfOptI);

      // Paint visual state only (no side effects) — safe to call during init,
      // before denoise/resolution helpers below are wired up.
      function paintWorkflow(mode) {
        const isI2I = mode === "Image2Image";
        workflowDOM.classList.toggle("db-wf-right", isI2I);
        wfOptT.classList.toggle("db-wf-active", !isI2I);
        wfOptI.classList.toggle("db-wf-active", isI2I);
      }
      // Full select (visual + side effects) — only fired by user clicks, after
      // applyWorkflowDenoiseDefault / updateResolutionState are defined.
      function selectWorkflow(mode) {
        if (workflowWidget) workflowWidget.value = mode;
        paintWorkflow(mode);
        node.inputs?.forEach(inp => { if (inp.name==="image") inp.hidden=(mode!=="Image2Image"); });
        applyWorkflowDenoiseDefault();
        updateResolutionState();
        node.setDirtyCanvas(true);
      }
      wfOptT.addEventListener("click", () => selectWorkflow("Text2Image"));
      wfOptI.addEventListener("click", () => selectWorkflow("Image2Image"));
      paintWorkflow(workflowWidget?.value ?? "Text2Image");
      addFixed("db_workflow", workflowDOM, 40);
      const wIdx = node.widgets.findIndex(w=>w.name==="db_workflow");
      if (wIdx>0) { const [we]=node.widgets.splice(wIdx,1); node.widgets.unshift(we); }

      // ── 1b. THE MAIN ATTRACTION — checkpoint / vae styled flyout buttons ──
      addTitle("db_modellabel", makeSectionLabel("The Main Attraction"), 20);

      // Hide the native checkpoint combo; the styled button below drives it.
      // VAE is no longer a UI control — it is always baked from the checkpoint.
      const ckptWidget = hideWidget("ckpt_name");

      const ckptDisplay = (v) => (v || "(none)").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");

      // Checkpoint flyout button (TAG + name + caret). Clicking opens a
      // LoRA-Manager-style card grid; the selected checkpoint's preview
      // (image or video) renders in the panel beneath the button.
      const ckptBtn = document.createElement("div");
      ckptBtn.className = "db-sel-row"; ckptBtn.style.cursor = "pointer";
      const ckptTag   = document.createElement("span"); ckptTag.className = "db-model-tag"; ckptTag.textContent = "CKPT";
      const ckptName  = document.createElement("span"); ckptName.className = "db-sel-name"; ckptName.style.flex = "1";
      const ckptCaret = document.createElement("span"); ckptCaret.className = "db-model-caret"; ckptCaret.textContent = "▾";
      ckptBtn.append(ckptTag, ckptName, ckptCaret);

      // Selected-checkpoint preview (image or video) below the button.
      const ckptPreview = document.createElement("div");
      ckptPreview.className = "db-model-preview";
      ckptPreview.style.cssText = "display:none;margin-top:6px;";

      function refreshCkptName() {
        const v = ckptWidget?.value ?? "";
        ckptName.textContent = v ? ckptDisplay(v) : "Select checkpoint";
        ckptBtn.title = v || "";
      }
      function refreshCkptPreview() {
        const v = ckptWidget?.value ?? "";
        ckptPreview.style.display = "none";
        ckptPreview.innerHTML = "";
        if (v) {
          loadModelMedia(ckptPreview, "checkpoints", v,
            () => { ckptPreview.style.display = "block"; syncTopRowH(); },
            () => { ckptPreview.style.display = "none"; ckptPreview.innerHTML = ""; syncTopRowH(); });
        } else {
          syncTopRowH();
        }
      }
      ckptBtn.addEventListener("click", () => {
        showCardFlyout("Checkpoints", ckptWidget?.options?.values || [], ckptWidget?.value,
          (n) => `/dirtybirds/model-preview?type=checkpoints&name=${encodeURIComponent(n)}`,
          ckptDisplay, (name) => {
            if (ckptWidget) ckptWidget.value = name;
            refreshCkptName();
            refreshCkptPreview();
            node.setDirtyCanvas(true);
          });
      });
      refreshCkptName();

      // Left column: Checkpoint button + preview
      const leftCol = document.createElement("div");
      leftCol.style.cssText = "display:flex;flex-direction:column;flex:1;min-width:0;";
      leftCol.append(ckptBtn, ckptPreview);

      // Resolution is stored as "WIDTHxHEIGHT" or the RANDOM_DIM sentinel in the hidden `dimension` widget.
      const RESOLUTIONS = [
        { label: "1:1",  w: 1024, h: 1024 },
        { label: "16:9", w: 1344, h: 768  },
        { label: "9:16", w: 768,  h: 1344 },
        { label: "3:2",  w: 1216, h: 832  },
        { label: "2:3",  w: 832,  h: 1216 },
        { label: "4:3",  w: 1152, h: 896  },
      ];
      if (dimensionWidget && dimensionWidget.value !== RANDOM_DIM &&
          !/^\d+x\d+$/.test(dimensionWidget.value || "")) {
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
        if (cur === RANDOM_DIM) {
          resLabel.textContent = "🎲 Random";
        } else {
          const [w, h] = cur.split("x").map(Number);
          const res = RESOLUTIONS.find(r => r.w === w && r.h === h);
          resLabel.textContent = res ? `${res.label} (${w}×${h})` : `${w}×${h}`;
        }
      }
      // Flyout (same styled panel as the checkpoint picker); Random is an option.
      const resDimData = {}; RESOLUTIONS.forEach(r => { resDimData[r.label] = [r.w, r.h]; });
      const resKeys = RESOLUTIONS.map(r => r.label);
      function currentResKey() {
        const cur = dimensionWidget?.value;
        if (!cur || cur === RANDOM_DIM) return null;
        const [w, h] = cur.split("x").map(Number);
        const r = RESOLUTIONS.find(x => x.w === w && x.h === h);
        return r ? r.label : null;
      }
      resRow.addEventListener("click", () => {
        showResolutionFlyout(resDimData, resKeys, currentResKey(),
          dimensionWidget?.value === RANDOM_DIM, (pick) => {
            if (pick === "__random__") {
              if (dimensionWidget) dimensionWidget.value = RANDOM_DIM;
            } else if (resDimData[pick]) {
              const [w, h] = resDimData[pick];
              if (dimensionWidget) dimensionWidget.value = `${w}x${h}`;
            }
            refreshResRow();
            node.setDirtyCanvas(true);
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

      // ── 2. SIZE MATTERS controls — Batch / Seed / Denoise live in the right
      //    column beneath the Resolution button (appended to rightCol below).
      const batchWidget = hideWidget("batch_size");
      function clampBatch(v) { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 1; }
      const batchRow = document.createElement("div");
      batchRow.className = "db-slider-row";
      batchRow.style.justifyContent = "space-between";
      const batchLabel = document.createElement("span"); batchLabel.className = "db-slider-label"; batchLabel.textContent = "Batch";
      const batchSlider = document.createElement("input"); batchSlider.type = "range"; batchSlider.className = "db-sel-slider";
      batchSlider.min = "1"; batchSlider.max = "5"; batchSlider.step = "1"; batchSlider.style.flex = "0 0 50px";
      batchSlider.value = String(clampBatch(batchWidget?.value));
      const batchVal = document.createElement("span"); batchVal.className = "db-sel-val"; batchVal.textContent = batchSlider.value;
      batchSlider.addEventListener("input", () => {
        const bv = clampBatch(batchSlider.value);
        if (batchWidget) batchWidget.value = bv;
        batchVal.textContent = String(bv);
      });
      batchRow.append(batchLabel, batchSlider, batchVal);

      // ── Seed (flyout button) + Denoise (slider) — both ride the pipe to the
      //    DirtyBirds sampler. The seed value is hidden; the flyout toggles
      //    Fixed vs. Random (re-rolled every run by Python).
      const seedWidget     = hideWidget("seed");
      const seedModeWidget = hideWidget("seed_mode");
      const denoiseWidget  = hideWidget("denoise");
      // ComfyUI may auto-add a control_after_generate widget for an INT named
      // "seed"; hide it — seed mode is driven by the flyout below.
      hideWidget("control_after_generate");

      // Seed flyout button (same style as checkpoint / resolution).
      const seedRow = document.createElement("div");
      seedRow.className = "db-sel-row"; seedRow.style.cursor = "pointer";
      const seedTag       = document.createElement("span"); seedTag.className = "db-model-tag"; seedTag.textContent = "SEED";
      const seedModeLabel = document.createElement("span"); seedModeLabel.className = "db-sel-name"; seedModeLabel.style.flex = "1";
      const seedCaret     = document.createElement("span"); seedCaret.className = "db-model-caret"; seedCaret.textContent = "▾";
      seedRow.append(seedTag, seedModeLabel, seedCaret);

      function refreshSeedRow() {
        const mode = (seedModeWidget?.value === "random") ? "random" : "fixed";
        seedModeLabel.textContent = mode === "random" ? "🎲 Random" : "Fixed";
      }
      seedRow.addEventListener("click", () => {
        showOptionsFlyout("Seed", [
          { value: "fixed",  label: "Fixed",  glyph: "📌" },
          { value: "random", label: "Random", glyph: "🎲" },
        ], seedModeWidget?.value || "fixed", (mode) => {
          if (seedModeWidget) seedModeWidget.value = mode;
          // A fixed seed needs a concrete value; roll one if still unset.
          if (mode === "fixed" && seedWidget && !(parseInt(seedWidget.value, 10) > 0)) {
            seedWidget.value = Math.floor(Math.random() * 9007199254740991);
          }
          refreshSeedRow();
          node.setDirtyCanvas(true);
        });
      });
      refreshSeedRow();

      const denoiseRow = document.createElement("div");
      denoiseRow.className = "db-slider-row";
      denoiseRow.style.justifyContent = "space-between";
      const denoiseLabel = document.createElement("span"); denoiseLabel.className = "db-slider-label"; denoiseLabel.textContent = "Denoise";
      const denoiseSlider = document.createElement("input");
      denoiseSlider.type = "range"; denoiseSlider.className = "db-sel-slider";
      denoiseSlider.min = "0"; denoiseSlider.max = "1"; denoiseSlider.step = "0.01"; denoiseSlider.style.flex = "1";
      const denoiseVal = document.createElement("span"); denoiseVal.className = "db-sel-val";
      function setDenoise(v) {
        v = Math.max(0, Math.min(1, Number(v)));
        if (!Number.isFinite(v)) v = 1.0;
        denoiseSlider.value = String(v);
        denoiseVal.textContent = v.toFixed(2);
        if (denoiseWidget) denoiseWidget.value = v;
      }
      denoiseSlider.addEventListener("input", () => setDenoise(denoiseSlider.value));
      setDenoise(typeof denoiseWidget?.value === "number" ? denoiseWidget.value : 1.0);
      denoiseRow.append(denoiseLabel, denoiseSlider, denoiseVal);

      // Batch / Seed / Denoise sit in the right column, stacked under Resolution.
      rightCol.append(batchRow, seedRow, denoiseRow);
      syncTopRowH();

      // Denoise default per workflow: 1.0 for Text2Image, 0.7 for Image2Image.
      // Applied when the workflow toggle changes.
      function applyWorkflowDenoiseDefault() {
        const mode = workflowWidget?.value ?? "Text2Image";
        setDenoise(mode === "Image2Image" ? 0.7 : 1.0);
      }

      // T2I enables resolution picker; I2I disables it (image drives the size).
      let resEnabled = true;
      function updateResolutionState() {
        resEnabled = (workflowWidget?.value ?? "Text2Image") === "Text2Image";
        resRow.style.opacity = resEnabled ? "" : "0.4";
        resRow.style.pointerEvents = resEnabled ? "" : "none";
      }

      refreshResRow();
      updateResolutionState();

      // ── 3. THE CAST — positive / negative embedding picker (compact rows) ────
      addTitle("db_castlabel", makeSectionLabel("The Cast"), 20);

      function buildEmbedSlot(slot, widget) {
        // slot: "positive" or "negative"
        // Returns a single db-sel-row that expands/collapses based on state
        // Applies color-coded border stripe via db-emb-pos / db-emb-neg class

        const isPositive = slot === "positive";
        const slotClass = isPositive ? "db-emb-pos" : "db-emb-neg";

        // Wrapper holds the selector row + an on-node preview (same as checkpoint).
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;min-width:0;";

        const row = document.createElement("div");
        row.className = `db-sel-row ${slotClass}`;

        const preview = document.createElement("div");
        preview.className = "db-model-preview";
        preview.style.cssText = "display:none;margin-top:6px;";

        wrap.append(row, preview);

        let current = { name: "", strength: 1.0, active: true };
        let _embedList = null;

        // Medium preview of the selected embedding (mirrors refreshCkptPreview).
        function refreshEmbedPreview() {
          preview.style.display = "none";
          preview.innerHTML = "";
          if (current.name) {
            loadMediaUrl(preview, `/dirtybirds/embedding-preview?name=${encodeURIComponent(current.name)}`,
              () => { preview.style.display = "block"; syncEmbedH(); },
              () => { preview.style.display = "none"; preview.innerHTML = ""; syncEmbedH(); }, "cover");
          } else {
            syncEmbedH();
          }
        }

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
            refreshEmbedPreview();
            return;
          }

          // Populated state: mirror buildLoraPanel's row (controls; preview below).
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
          refreshEmbedPreview();
        }

        // Open embedding selection menu (LoRA-Manager-style card grid w/ previews)
        const embDisplay = (n) => (n || "").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
        async function openEmbedMenu() {
          if (!_embedList) {
            const data = await fetchJSON("/dirtybirds/embeddings");
            _embedList = Array.isArray(data) ? data : [];
          }
          showListFlyout(isPositive ? "Positive Embedding" : "Negative Embedding",
            _embedList, current.name, embDisplay, (n) => {
              current = { name: n, strength: 1.0, active: true };
              if (widget) widget.value = serializeEmbed();
              render();
              syncEmbedH();
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
        wrap._set = (name, strength, active = true) => {
          current = { name, strength, active };
          if (widget) widget.value = serializeEmbed();
          render();
          syncEmbedH();
        };

        wrap._deserialize = deserialize;

        // Initial render (empty state)
        render();

        return wrap;
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

      // Dirty Talk now lives on the sampler node (read-only markdown preview).

      // ── Restore saved state ──────────────────────────────────────────────
      requestAnimationFrame(() => {
        // Checkpoint button label + preview (native value restored post-onNodeCreated)
        refreshCkptName();
        refreshCkptPreview();

        // Resolution chip + batch slider reflect restored hidden-widget values
        refreshResRow();
        if (batchWidget) {
          const bv = clampBatch(batchWidget.value);
          batchSlider.value = String(bv); batchVal.textContent = String(bv);
        }

        // Seed mode + denoise reflect restored hidden-widget values
        refreshSeedRow();
        if (denoiseWidget && typeof denoiseWidget.value === "number") setDenoise(denoiseWidget.value);

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
      // The node exposes a single "db_pipe" output. Saved graphs built against
      // earlier versions may carry extra output sockets (e.g. "pipe",
      // "basic_pipe", "latent"); strip them so the node matches its def.
      requestAnimationFrame(() => {
        const allowed = new Set(["db_pipe"]);
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
      const domEls = [workflowDOM, topRow, embedColsEl, talentColsEl];
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
