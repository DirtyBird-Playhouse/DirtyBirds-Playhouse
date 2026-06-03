/**
 * DirtyBirds Playhouse – Prompt (Dirty Talk) Node UI
 *
 * Native positive / negative multiline widgets + a "Load Wildcards" button that
 * lists wildcard keys (from the node's wildcards/*.yaml folder, expanded by
 * the pack's built-in processor) and inserts __key__ tokens at the cursor. After a run
 * the resolved (wildcard-expanded) prompts are shown in a read-only preview.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel } from "./db_shared.js";

ensureStylesheet();

// Resolve the underlying <textarea> for a multiline STRING widget across
// ComfyUI versions (element may be the textarea or a wrapper containing one).
function getTextarea(widget) {
  if (!widget) return null;
  const el = widget.element || widget.inputEl;
  if (!el) return null;
  if (el.tagName === "TEXTAREA") return el;
  return el.querySelector?.("textarea") || null;
}

function insertAtCursor(textarea, widget, token) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end   = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after  = textarea.value.slice(end);
  const sep = before && !/[\s,]$/.test(before) ? ", " : "";
  const newVal = before + sep + token + after;
  textarea.value = newVal;
  if (widget) widget.value = newVal;
  const caret = (before + sep + token).length;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

// Simple searchable flyout listing wildcard keys.
function showWildcardFlyout(anchorEl, keys, onPick) {
  document.querySelector(".db-wc-flyout")?.remove();

  const fly = document.createElement("div");
  fly.className = "db-wc-flyout";
  fly.style.cssText =
    "position:fixed;z-index:10000;background:#1a1320;border:1px solid #3a2a48;" +
    "border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);" +
    "width:240px;max-height:320px;display:flex;flex-direction:column;gap:6px;";

  const search = document.createElement("input");
  search.placeholder = "Filter wildcards…";
  search.style.cssText =
    "background:#0d0a12;border:1px solid #3a2a48;border-radius:6px;color:#eee;" +
    "padding:6px 8px;font-size:12px;outline:none;";
  fly.appendChild(search);

  const list = document.createElement("div");
  list.style.cssText = "overflow-y:auto;display:flex;flex-direction:column;gap:2px;";
  fly.appendChild(list);

  function render(filter) {
    list.innerHTML = "";
    const f = (filter || "").toLowerCase();
    const shown = keys.filter(k => k.includes(f));
    if (!shown.length) {
      const empty = document.createElement("div");
      empty.textContent = keys.length ? "No matches" : "No wildcards found";
      empty.style.cssText = "color:#777;font-size:12px;padding:6px;font-style:italic;";
      list.appendChild(empty);
      return;
    }
    shown.forEach(k => {
      const row = document.createElement("div");
      row.textContent = `__${k}__`;
      row.style.cssText =
        "color:#e9d7f5;font-size:12px;padding:5px 8px;border-radius:5px;cursor:pointer;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      row.addEventListener("mouseenter", () => row.style.background = "#2a1d38");
      row.addEventListener("mouseleave", () => row.style.background = "transparent");
      row.addEventListener("click", () => { onPick(`__${k}__`); close(); });
      list.appendChild(row);
    });
  }

  const r = anchorEl.getBoundingClientRect();
  fly.style.left = `${Math.min(r.left, window.innerWidth - 252)}px`;
  fly.style.top  = `${Math.min(r.bottom + 4, window.innerHeight - 332)}px`;

  function close() { fly.remove(); document.removeEventListener("mousedown", onDoc, true); }
  function onDoc(e) { if (!fly.contains(e.target) && e.target !== anchorEl) close(); }

  search.addEventListener("input", () => render(search.value));
  document.body.appendChild(fly);
  document.addEventListener("mousedown", onDoc, true);
  render("");
  setTimeout(() => search.focus(), 10);
}

app.registerExtension({
  name: "DirtyBirds.Prompt",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsPrompt") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color   = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = Math.max(node.size[0] || 0, 340);

      const posWidget = node.widgets?.find(w => w.name === "positive");
      const negWidget = node.widgets?.find(w => w.name === "negative");

      // ── Section label above the prompt boxes ─────────────────────────────
      const scriptLabel = makeSectionLabel("The Script");
      scriptLabel.style.cssText += "box-sizing:border-box;overflow:hidden;padding:0;margin:0;";
      node.addDOMWidget("db_scriptlabel", "customhtml", scriptLabel, {
        serialize: false, height: 20, getMinHeight: () => 20,
      });
      // Move the label to sit above the positive widget.
      {
        const li = node.widgets.findIndex(w => w.name === "db_scriptlabel");
        const pi = node.widgets.findIndex(w => w.name === "positive");
        if (li > -1 && pi > -1 && li !== pi - 1) {
          const [lbl] = node.widgets.splice(li, 1);
          node.widgets.splice(node.widgets.findIndex(w => w.name === "positive"), 0, lbl);
        }
      }

      // Track which prompt box was last focused so inserts land in the right one.
      node._dbLastPromptWidget = posWidget;
      [posWidget, negWidget].forEach(w => {
        const ta = getTextarea(w);
        if (ta) ta.addEventListener("focus", () => { node._dbLastPromptWidget = w; });
      });

      // ── "Load Wildcards" button (DOM widget) ─────────────────────────────
      const btn = document.createElement("button");
      btn.className = "db-lib-btn db-lora-add-open-btn";
      btn.textContent = "🎲  Load Wildcards";
      btn.style.cssText += "box-sizing:border-box;overflow:hidden;width:100%;";
      btn.addEventListener("click", async () => {
        const data = await fetchJSON("/dirtybirds/wildcards");
        const keys = data?.keys || [];
        showWildcardFlyout(btn, keys, (token) => {
          const target = node._dbLastPromptWidget || posWidget;
          insertAtCursor(getTextarea(target), target, token);
        });
      });
      node.addDOMWidget("db_wildcard_btn", "customhtml", btn, {
        serialize: false, height: 34, getMinHeight: () => 34,
      });

      // ── Width sync ───────────────────────────────────────────────────────
      const domEls = [scriptLabel, btn];
      function applyWidths() {
        const w = nodeInnerW(node);
        domEls.forEach(el => { el.style.width = w + "px"; });
        node.widgets.forEach(ww => {
          if (ww.element?.classList?.contains("db-section-label")) ww.element.style.width = w + "px";
        });
      }
      requestAnimationFrame(() => requestAnimationFrame(applyWidths));
      const origResize = node.onResize;
      node.onResize = function (size) { origResize?.call(this, size); applyWidths(); };
    };
  },
});
