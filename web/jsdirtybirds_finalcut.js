/**
 * DirtyBirds Playhouse — 🎬 Final Cut picker UI.
 *
 * Listens for the backend "dirtybirds-finalcut-images" websocket event, shows
 * the incoming batch in a multi-select grid modal, and POSTs the chosen indices
 * back to /dirtybirds/finalcut-message so the blocked node can continue.
 *
 * No window.prompt()/alert() (blocked in the desktop app) — inline DOM only.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, addTitle, bindWidthSync,
  hideWidget, makeSlider, makeFlyoutBtn,
} from "./db_shared.js";

ensureStylesheet();

const EVENT = "dirtybirds-finalcut-images";
const ROUTE = "/dirtybirds/finalcut-message";
const VIEW_KEY = "db.finalcut.lineupView"; // "full" | "small" — remembered picker size

let current = null; // { token, selection:Set, overlay, countdownEl, statusEl }

function viewURL(img) {
  const p = new URLSearchParams({
    filename: img.filename || "",
    subfolder: img.subfolder || "",
    type: img.type || "temp",
  });
  const path = "/view?" + p.toString();
  return api.apiURL ? api.apiURL(path) : path;
}

function closeModal() {
  current?.overlay?.remove();
  current = null;
}

async function confirmPick() {
  if (!current) return;
  const selection = [...current.selection].sort((a, b) => a - b);
  const token = current.token;
  current.statusEl.textContent = "Sending…";
  try {
    await api.fetchApi(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, selection }),
    });
  } catch (err) {
    console.error("[DirtyBirds] Final Cut reply failed:", err);
    if (current) current.statusEl.textContent = "Send failed — retry.";
    return;
  }
  closeModal();
}

function openModal(token, images) {
  closeModal();

  const overlay = document.createElement("div");
  overlay.className = "db-flyout-overlay";

  const panel = document.createElement("div");
  panel.className = "db-lora-flyout";
  panel.style.left = "50%";
  panel.style.top = "50%";
  panel.style.transform = "translate(-50%, -50%)";

  // Header
  const header = document.createElement("div");
  header.className = "db-flyout-header";
  const title = document.createElement("span");
  title.className = "db-flyout-title";
  title.textContent = "🎬 Final Cut — pick images to keep";
  const countdown = document.createElement("span");
  countdown.className = "db-flyout-title";
  countdown.style.opacity = "0.6";

  // Small / full-screen view toggle for The Lineup (remembered across runs).
  if (localStorage.getItem(VIEW_KEY) === "full") panel.classList.add("db-fc-full");
  const viewBtn = document.createElement("button");
  viewBtn.className = "db-fc-view-btn";
  const paintView = () => {
    viewBtn.textContent = panel.classList.contains("db-fc-full") ? "🗗 Small" : "⛶ Full screen";
  };
  viewBtn.addEventListener("click", () => {
    const nowFull = !panel.classList.contains("db-fc-full");
    panel.classList.toggle("db-fc-full", nowFull);
    try { localStorage.setItem(VIEW_KEY, nowFull ? "full" : "small"); } catch (e) { /* ignore */ }
    paintView();
  });
  paintView();

  const right = document.createElement("div");
  right.style.cssText = "display:flex;align-items:center;gap:10px;";
  right.append(countdown, viewBtn);
  header.append(title, right);
  panel.appendChild(header);

  // Grid of selectable cards
  const grid = document.createElement("div");
  grid.className = "db-lp-grid";
  const selection = new Set();

  images.forEach((img, i) => {
    const card = document.createElement("div");
    card.className = "db-lp-card";
    card.style.cursor = "pointer";
    const wrap = document.createElement("div");
    wrap.className = "db-lp-img-wrap";
    const thumb = document.createElement("img");
    thumb.className = "db-lp-thumb";
    thumb.src = viewURL(img);
    thumb.addEventListener("load", () => thumb.classList.add("db-lp-thumb-loaded"));
    const badge = document.createElement("div");
    badge.className = "db-lp-cat-badge";
    badge.textContent = "#" + i;
    wrap.append(thumb, badge);
    card.appendChild(wrap);

    card.addEventListener("click", () => {
      if (selection.has(i)) { selection.delete(i); card.style.borderColor = ""; }
      else { selection.add(i); card.style.borderColor = "#5aadff"; }
      updateStatus();
    });
    grid.appendChild(card);
  });
  panel.appendChild(grid);

  // Footer: status + confirm
  const footer = document.createElement("div");
  footer.className = "db-lp-pills";
  footer.style.justifyContent = "space-between";
  footer.style.alignItems = "center";
  const statusEl = document.createElement("span");
  statusEl.style.cssText = "font-size:11px;color:#888;";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "db-lora-add-open-btn";
  confirmBtn.style.width = "auto";
  confirmBtn.style.padding = "6px 16px";
  confirmBtn.textContent = "Confirm selection";
  confirmBtn.addEventListener("click", confirmPick);
  footer.append(statusEl, confirmBtn);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  current = { token, selection, overlay, countdownEl: countdown, statusEl };
  function updateStatus() {
    statusEl.textContent = selection.size
      ? `${selection.size} selected`
      : "Click images to keep (none = cancel run)";
  }
  updateStatus();
}

api.addEventListener(EVENT, (e) => {
  const d = e.detail || {};
  // Initial batch push.
  if (Array.isArray(d.images)) { openModal(d.token, d.images); return; }
  // Only act on ticks/timeouts for the modal we're currently showing.
  if (!current || d.token !== current.token) return;
  if (d.timeout) { closeModal(); return; }
  if (typeof d.tick === "number") {
    const m = Math.floor(d.tick / 60), s = d.tick % 60;
    current.countdownEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }
});

console.log("[DirtyBirds] Final Cut picker module loaded");

// ── Themed on-canvas node UI (suite controls) ────────────────────────────────
const _baseName = (v) => (v || "").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");

app.registerExtension({
  name: "DirtyBirds.FinalCut",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsFinalCut") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      const DB_MIN_W = 300;
      node.size[0] = Math.max(node.size[0] || 0, DB_MIN_W);

      // Hide every native widget; styled DOM controls below drive them.
      const W = {};
      for (const n of ["timeout", "ontimeout", "restore_faces", "restore_model",
        "facedetection", "visibility", "upscale", "upscale_model",
        "rescale_mode", "rescale_percent", "longer_side"]) {
        W[n] = hideWidget(node, n);
      }

      const els = [];
      const addRow = (name, el, h) => {
        el.style.cssText += "box-sizing:border-box;overflow:hidden;";
        node.addDOMWidget(name, "customhtml", el, { serialize: false, height: h, getMinHeight: () => h });
        els.push(el);
        return el;
      };
      const title = (name, text) => { els.push(addTitle(node, name, text, 28)); };

      // Segmented control bound to a widget. opts: [[value,label],...].
      const seg = (labelText, w, opts, onChange) => {
        const row = document.createElement("div");
        row.className = "db-slider-row"; row.style.justifyContent = "space-between";
        const lbl = document.createElement("span"); lbl.className = "db-slider-label"; lbl.textContent = labelText;
        const box = document.createElement("div"); box.className = "db-seg"; box.style.flex = "1";
        const cells = opts.map(([val, txt]) => {
          const o = document.createElement("div");
          o.className = "db-seg-opt"; o.textContent = txt; o.dataset.val = String(val);
          o.addEventListener("click", () => { if (w) w.value = val; paintSeg(); onChange?.(); node.setDirtyCanvas(true); });
          box.appendChild(o);
          return o;
        });
        function paintSeg() {
          const cur = w ? String(w.value) : "";
          cells.forEach((o) => o.classList.toggle("db-seg-active", o.dataset.val === cur));
        }
        row.append(lbl, box); row._paint = paintSeg; paintSeg();
        return row;
      };

      // Flyout picker for a combo widget.
      const picker = (tag, w) => makeFlyoutBtn(node, tag, {
        getLabel: () => _baseName(w?.value) || "(none)",
        getValues: () => (w?.options?.values || []),
        getCurrent: () => w?.value,
        onPick: (v) => { if (w) w.value = v; },
        displayFn: _baseName,
      }).row;

      // ── The Lineup ──
      title("db_fc_lineup", "The Lineup");
      const toS = seg("On timeout", W.ontimeout,
        [["send none", "None"], ["send all", "All"], ["send first", "First"], ["send last", "Last"]]);
      addRow("db_fc_ontimeout", toS, 34);

      // ── The Touch-Up ──
      title("db_fc_touchup", "The Touch-Up");
      const rfS = seg("Restore", W.restore_faces, [[false, "Off"], [true, "On"]], () => paint());
      addRow("db_fc_restore", rfS, 34);
      addRow("db_fc_restore_model", picker("FACE MODEL", W.restore_model), 32);
      addRow("db_fc_detector", picker("DETECTOR", W.facedetection), 32);
      const visS = makeSlider("Visibility", 0, 1, 0.05,
        () => Number(W.visibility?.value ?? 1), (v) => { if (W.visibility) W.visibility.value = v; },
        (v) => Number(v).toFixed(2));
      addRow("db_fc_visibility", visS.row, 34);

      // ── The Blow-Up ──
      title("db_fc_blowup", "The Blow-Up");
      const upS = seg("Upscale", W.upscale, [[false, "Off"], [true, "On"]], () => paint());
      addRow("db_fc_upscale", upS, 34);
      addRow("db_fc_upscale_model", picker("UPSCALE MODEL", W.upscale_model), 32);
      const rmS = seg("Resize", W.rescale_mode,
        [["model only", "Model"], ["by percent", "Percent"], ["to longer side", "Longer"]], () => paint());
      addRow("db_fc_rescale_mode", rmS, 34);
      const pctS = makeSlider("Percent", 10, 400, 5,
        () => Number(W.rescale_percent?.value ?? 200), (v) => { if (W.rescale_percent) W.rescale_percent.value = Math.round(v); },
        (v) => Math.round(v) + "%");
      addRow("db_fc_percent", pctS.row, 34);
      const lsS = makeSlider("Longer side", 64, 8192, 8,
        () => Number(W.longer_side?.value ?? 2048), (v) => { if (W.longer_side) W.longer_side.value = Math.round(v); },
        (v) => Math.round(v) + "px");
      addRow("db_fc_longer", lsS.row, 34);

      // Stage-aware dimming. `paint` is hoisted so the seg callbacks above can call it.
      const dim = (el, on) => { if (!el) return; el.style.opacity = on ? "" : "0.4"; el.style.pointerEvents = on ? "" : "none"; };
      const byName = (n) => node.widgets.find((w) => w.name === n)?.element;
      function paint() {
        const ron = !!W.restore_faces?.value;
        ["db_fc_restore_model", "db_fc_detector", "db_fc_visibility"].forEach((n) => dim(byName(n), ron));
        const uon = !!W.upscale?.value;
        ["db_fc_upscale_model", "db_fc_rescale_mode", "db_fc_percent", "db_fc_longer"].forEach((n) => dim(byName(n), uon));
        const mode = W.rescale_mode?.value;
        dim(byName("db_fc_percent"), uon && mode === "by percent");
        dim(byName("db_fc_longer"), uon && mode === "to longer side");
      }

      bindWidthSync(node, els, DB_MIN_W);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        visS.paint(); pctS.paint(); lsS.paint();
        toS._paint(); rfS._paint(); upS._paint(); rmS._paint();
        paint();
      }));
    };
  },
});
