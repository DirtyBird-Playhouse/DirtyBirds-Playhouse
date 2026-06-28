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
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, addTitle, bindWidthSync,
  hideWidget, makeSlider, makeFlyoutBtn,
} from "./db_shared.js";

ensureStylesheet();

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
        rfS._paint(); upS._paint(); rmS._paint();
        paint();
      }));
    };
  },
});
