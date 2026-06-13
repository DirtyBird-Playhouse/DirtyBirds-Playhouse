/**
 * DirtyBirds Playhouse — Muse node UI.
 *
 * Themed like the loader/sampler. Replaces the native `model` text widget with a
 * styled MODEL flyout populated from the local LM Studio server (proxied via
 * /dirtybirds/lm-models to dodge browser CORS). Other fields stay native.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, makeSectionLabel, fetchJSON, nodeInnerW } from "./db_shared.js";

ensureStylesheet();

// Compact list flyout reusing the global .db-flyout* CSS.
function showListFlyout(title, names, current, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel   = document.createElement("div"); panel.className   = "db-flyout";
  panel.style.width = "min(420px, 90vw)";
  panel.style.left  = Math.max(20, (window.innerWidth - 420) / 2) + "px";
  panel.style.top   = Math.max(40, window.innerHeight / 2 - 220) + "px";

  const header   = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl  = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const list = document.createElement("div"); list.className = "db-flyout-list";
  list.style.cssText = "max-height:60vh;overflow:auto;";
  panel.appendChild(list);

  if (!names || !names.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:14px;color:#888;font-size:12px;";
    empty.textContent = "No models — is LM Studio's server running?";
    list.appendChild(empty);
  }
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
  name: "DirtyBirds.Muse",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsMuse") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color   = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      const DB_MIN_W = 340;
      node.size[0] = Math.max(node.size[0] || 0, DB_MIN_W);

      function hideWidget(name) {
        const w = node.widgets?.find(w => w.name === name);
        if (!w) return undefined;
        w.computeSize    = () => [0, 0];
        w.serializeValue = () => w.value;
        if (typeof w.setHidden === "function") w.setHidden(true);
        else if ("hidden" in w) w.hidden = true;
        return w;
      }

      const modelWidget    = hideWidget("model");
      const endpointWidget = node.widgets?.find(w => w.name === "endpoint");

      const widthEls = [];

      // Title
      const titleEl = makeSectionLabel("The Eye");
      titleEl.style.cssText += "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
      node.addDOMWidget("db_muselabel", "customhtml", titleEl, {
        serialize: false, height: 26, getMinHeight: () => 26,
      });
      widthEls.push(titleEl);

      // MODEL flyout button
      const row = document.createElement("div");
      row.className = "db-sel-row"; row.style.cursor = "pointer";
      const tag   = document.createElement("span"); tag.className = "db-model-tag"; tag.textContent = "MODEL";
      const name  = document.createElement("span"); name.className = "db-sel-name"; name.style.flex = "1";
      const caret = document.createElement("span"); caret.className = "db-model-caret"; caret.textContent = "▾";
      row.append(tag, name, caret);
      function refresh() {
        const v = modelWidget?.value || "";
        name.textContent = v || "Select model";
        name.title = v;
      }
      async function openMenu() {
        const ep = encodeURIComponent(endpointWidget?.value || "http://localhost:1234/v1");
        const data = await fetchJSON(`/dirtybirds/lm-models?endpoint=${ep}`);
        showListFlyout("LM Studio Models", data?.models || [], modelWidget?.value, (v) => {
          if (modelWidget) modelWidget.value = v;
          refresh();
          node.setDirtyCanvas(true);
        });
      }
      row.addEventListener("click", openMenu);
      refresh();

      const rowWrap = document.createElement("div");
      rowWrap.style.cssText = "box-sizing:border-box;overflow:hidden;width:100%;padding:0 2px;";
      rowWrap.appendChild(row);
      node.addDOMWidget("db_muse_model", "customhtml", rowWrap, {
        serialize: false, height: 34, getMinHeight: () => 34,
      });
      widthEls.push(rowWrap);

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
      requestAnimationFrame(() => requestAnimationFrame(() => { applyWidths(); refresh(); }));
    };
  },
});
