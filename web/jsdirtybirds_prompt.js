/**
 * DirtyBirds Playhouse – Prompt (Dirty Talk) Node UI
 *
 * Native positive / negative multiline widgets + a "Load Wildcards" button.
 * Clicking it opens a native LiteGraph context menu listing wildcard keys from
 * the node's wildcards/*.yaml folder; picking one inserts a __key__ token at
 * the cursor of the last focused prompt box. The menu is drawn by ComfyUI
 * itself (not a custom DOM flyout), so it stays legible and zoom-aware.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel } from "./db_shared.js";

ensureStylesheet();

const REFRESH = "🔄  Refresh list";

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

      // ── "Load Wildcards" button → native LiteGraph context menu ──────────
      node._dbWildcardKeys = [];

      function insertKey(key) {
        const target = node._dbLastPromptWidget || posWidget;
        insertAtCursor(getTextarea(target), target, `__${key}__`);
      }

      // Build a nested tree from "parent/child/leaf" keys so the menu can show
      // them as cascading submenus instead of long flat tokens.
      function buildTree(keys) {
        const root = { children: {} };
        for (const key of keys) {
          let cur = root;
          const parts = key.split("/");
          parts.forEach((p, i) => {
            cur.children[p] = cur.children[p] || { children: {} };
            cur = cur.children[p];
            if (i === parts.length - 1) cur.key = key;  // leaf -> full token
          });
        }
        return root;
      }

      // Turn a tree node into LiteGraph context-menu options (recursive).
      function toItems(treeNode) {
        return Object.keys(treeNode.children).sort().map(name => {
          const child = treeNode.children[name];
          const hasChildren = Object.keys(child.children).length > 0;
          if (hasChildren) {
            const options = toItems(child);
            // A branch that is ALSO a wildcard itself gets a "(use this)" entry.
            if (child.key) {
              options.unshift({ content: "↳ use this", callback: () => insertKey(child.key) });
            }
            return { content: name, has_submenu: true, submenu: { options } };
          }
          return { content: name, callback: () => insertKey(child.key) };
        });
      }

      function openMenu(event) {
        const items = [
          { content: REFRESH, callback: () => loadWildcards() },
          null, // separator
          ...toItems(buildTree(node._dbWildcardKeys)),
        ];
        if (!node._dbWildcardKeys.length) {
          items.push({ content: "(no wildcards found)", disabled: true });
        }
        new LiteGraph.ContextMenu(items, {
          event,
          title: `🎲 Wildcards (${node._dbWildcardKeys.length})`,
          scale: Math.max(1, app.canvas?.ds?.scale || 1),
        });
      }

      const btn = document.createElement("button");
      btn.className = "db-lib-btn db-lora-add-open-btn";
      btn.textContent = "🎲  Load Wildcards";
      btn.style.cssText += "box-sizing:border-box;overflow:hidden;width:100%;";
      btn.addEventListener("click", (e) => openMenu(e));
      node.addDOMWidget("db_wildcard_btn", "customhtml", btn, {
        serialize: false, height: 34, getMinHeight: () => 34,
      });

      async function loadWildcards() {
        const data = await fetchJSON("/dirtybirds/wildcards");
        node._dbWildcardKeys = data?.keys || [];
      }
      loadWildcards();

      // ── Width sync ───────────────────────────────────────────────────────
      function applyWidths() {
        const w = nodeInnerW(node);
        scriptLabel.style.width = w + "px";
        btn.style.width = w + "px";
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
