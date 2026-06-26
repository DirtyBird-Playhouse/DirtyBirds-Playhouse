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

// ── Autocomplete dropdown for LoRA/embedding insertion ──────────────────────
let autocompleteState = {
  dropdown: null,
  timeout: null,
  currentNode: null,
};

function createAutocompleteDropdown() {
  const dropdown = document.createElement("div");
  dropdown.className = "db-autocomplete-dropdown";
  dropdown.style.cssText = `
    position: fixed;
    display: none;
    background: #252527;
    border: 1px solid #34343a;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 2000;
    min-width: 200px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    font-family: monospace;
  `;
  return dropdown;
}

function createAutocompleteItem(text, callback) {
  const item = document.createElement("div");
  item.className = "db-autocomplete-item";
  item.style.cssText = `
    padding: 6px 8px;
    cursor: pointer;
    font-size: 12px;
    color: #bbb;
    transition: background-color 0.1s;
  `;
  item.textContent = text;
  item.addEventListener("mouseenter", () => {
    item.style.backgroundColor = "#4a4a52";
  });
  item.addEventListener("mouseleave", () => {
    item.style.backgroundColor = "transparent";
  });
  item.addEventListener("click", callback);
  return item;
}

function hideAutocomplete() {
  if (autocompleteState.dropdown) {
    autocompleteState.dropdown.style.display = "none";
    autocompleteState.dropdown.innerHTML = "";
  }
}

function showAutocompleteDropdown(textarea, matches, prefix, partial) {
  if (!matches.length) {
    hideAutocomplete();
    return;
  }

  if (!autocompleteState.dropdown) {
    autocompleteState.dropdown = createAutocompleteDropdown();
    document.body.appendChild(autocompleteState.dropdown);
  }

  autocompleteState.dropdown.innerHTML = "";

  matches.slice(0, 10).forEach(name => {
    const item = createAutocompleteItem(name, () => {
      insertAutocompleteSelection(textarea, prefix, name);
      hideAutocomplete();
    });
    autocompleteState.dropdown.appendChild(item);
  });

  // Position dropdown near cursor
  const rect = textarea.getBoundingClientRect();
  const lines = textarea.value.slice(0, textarea.selectionStart).split("\n");
  const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 18;

  autocompleteState.dropdown.style.left = (rect.left + 10) + "px";
  autocompleteState.dropdown.style.top = (rect.top + lines.length * lineHeight) + "px";
  autocompleteState.dropdown.style.display = "block";
}

function insertAutocompleteSelection(textarea, prefix, name) {
  const text = textarea.value;
  const cursorPos = textarea.selectionStart;
  const beforeCursor = text.slice(0, cursorPos);

  // Remove the partial match
  const cleanedBefore = beforeCursor.replace(/<lora:[^:>]*$|(\[emb:|<embed:)[^:>]*$/, "");

  // Insert full syntax
  const syntax = `${prefix}${name}:1.0>`;
  const afterCursor = text.slice(cursorPos);

  textarea.value = cleanedBefore + syntax + afterCursor;
  textarea.selectionStart = textarea.selectionEnd = cleanedBefore.length + syntax.length;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncTextareaToWidget(textarea, widget, node) {
  if (!textarea || !widget) return;
  widget.value = textarea.value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  node?.setDirtyCanvas?.(true, true);
}

function seededIndex(seed, length) {
  if (!length) return 0;
  let x = Number(seed);
  if (!Number.isFinite(x) || x <= 0) x = Date.now();
  x = (Math.imul((x >>> 0) ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0;
  return x % length;
}

function handleAutocompleteInput(event, textarea, node) {
  clearTimeout(autocompleteState.timeout);

  const text = textarea.value;
  const cursorPos = textarea.selectionStart;
  const beforeCursor = text.slice(0, cursorPos);

  const loraMatch = beforeCursor.match(/<lora:([^:>]*)$/);
  const embedMatch = beforeCursor.match(/(\[emb:|<embed:)([^:>]*)$/);

  if (!loraMatch && !embedMatch) {
    hideAutocomplete();
    return;
  }

  const partial = loraMatch ? loraMatch[1] : embedMatch ? embedMatch[2] : "";
  const prefix = loraMatch ? "<lora:" : "<embed:";
  const list = loraMatch ? (node._dbLoraList || []) : (node._dbEmbeddingList || []);

  autocompleteState.timeout = setTimeout(() => {
    showAutocompleteDropdown(
      textarea,
      list.filter(item => item.toLowerCase().includes(partial.toLowerCase())),
      prefix,
      partial
    );
  }, 150);
}

function handleAutocompleteKeydown(event, textarea) {
  if (!autocompleteState.dropdown || autocompleteState.dropdown.style.display === "none") return;

  if (event.key === "Escape") {
    hideAutocomplete();
    event.preventDefault();
  }
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
      node.size[0] = 420;

      // Saved workflows can carry obsolete DOM widgets from older Script UI
      // layouts. Drop them before adding the compact panel, otherwise invisible
      // stale rows keep reserving vertical space.
      const staleWidgets = new Set([
        "db_scriptlabel", "db_toolslabel", "db_seed_row", "db_wildcard_btn",
        "db_loadprompt_btn", "db_toybox_cols", "db_booru_btn", "db_url_tools", "db_script_panel",
      ]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      const posWidget = node.widgets?.find(w => w.name === "positive");
      const negWidget = node.widgets?.find(w => w.name === "negative");

      function hideBackingWidget(widget) {
        if (!widget) return;
        widget.computeSize = () => [0, 0];
        widget.serializeValue = () => widget.value;
        if (widget.element?.style) widget.element.style.display = "none";
        if (typeof widget.setHidden === "function") widget.setHidden(true);
        else if ("hidden" in widget) widget.hidden = true;
      }

      hideBackingWidget(posWidget);
      hideBackingWidget(negWidget);

      // Track which prompt box was last focused so inserts land in the right one.
      node._dbLastPromptWidget = posWidget;
      node._dbLastPromptTextarea = null;
      node._dbLoraList = [];
      node._dbEmbeddingList = [];

      // Fetch LoRA/embedding lists for autocomplete
      async function loadAutocompleteData() {
        try {
          const loras = await fetchJSON("/dirtybirds/loras");
          node._dbLoraList = Array.isArray(loras) ? loras : [];
          const embeds = await fetchJSON("/dirtybirds/embeddings");
          node._dbEmbeddingList = Array.isArray(embeds) ? embeds : [];
        } catch (e) {
          console.warn("[DirtyBirds] Could not load LoRA/embedding lists for autocomplete:", e);
        }
      }
      loadAutocompleteData();

      // ── Seed (Fixed / Random) ───────────────────────────────────────────
      function hideWidget(name) {
        const w = node.widgets?.find(w => w.name === name);
        if (!w) return undefined;
        w.computeSize    = () => [0, 0];
        w.serializeValue = () => w.value;
        if (typeof w.setHidden === "function") w.setHidden(true);
        else if ("hidden" in w) w.hidden = true;
        return w;
      }

      const seedWidget   = hideWidget("seed");
      const rerollWidget = hideWidget("reroll_each_run");
      hideWidget("control_after_generate");
      let paintSeedMode = () => {};

      function setSeedMode(mode) {
        if (rerollWidget) rerollWidget.value = mode;
        if (!mode && seedWidget && !(parseInt(seedWidget.value, 10) > 0)) {
          seedWidget.value = Math.floor(Math.random() * 9007199254740991);
        }
        node.setDirtyCanvas(true);
        paintSeedMode();
      }

      // ── "Load Wildcards" button → native LiteGraph context menu ──────────
      node._dbWildcardKeys = [];

      function insertText(text) {
        const target = node._dbLastPromptWidget || posWidget;
        const textarea = node._dbLastPromptTextarea || node._dbPositiveTextarea;
        insertAtCursor(textarea, target, text);
        syncTextareaToWidget(textarea, target, node);
      }

      function buildTree(keys) {
        const root = { children: {} };
        for (const key of keys) {
          let cur = root;
          const parts = key.split("/");
          parts.forEach((p, i) => {
            cur.children[p] = cur.children[p] || { children: {} };
            cur = cur.children[p];
            if (i === parts.length - 1) cur.key = key;
          });
        }
        return root;
      }

      function toItems(treeNode) {
        return Object.keys(treeNode.children).sort().map(name => {
          const child = treeNode.children[name];
          const hasChildren = Object.keys(child.children).length > 0;
          if (hasChildren) {
            const options = toItems(child);
            if (child.key) {
              options.unshift({ content: "↳ use this", callback: () => insertText(`__${child.key}__`) });
            }
            return { content: name, has_submenu: true, submenu: { options } };
          }
          return { content: name, callback: () => insertText(`__${child.key}__`) };
        });
      }

      function openWildcardMenu(event) {
        const items = [
          { content: REFRESH, callback: () => loadWildcards() },
          null,
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
      btn.textContent = "🎲  Wildcards";
      btn.style.cssText += "box-sizing:border-box;overflow:hidden;width:100%;";
      btn.addEventListener("click", (e) => openWildcardMenu(e));

      // ── "Load Prompt" button → menu of saved positive prompts ────────────
      async function openSavedPromptMenu(event) {
        const data = await fetchJSON("/dirtybirds/saved-prompts");
        const prompts = data?.prompts || [];
        const items = [
          { content: REFRESH, callback: () => openSavedPromptMenu(event) },
          null,
        ];
        if (!prompts.length) {
          items.push({ content: "(no saved prompts)", disabled: true });
        } else {
          const pickRandom = () => {
            if (rerollWidget?.value && seedWidget) {
              seedWidget.value = Math.floor(Math.random() * 9007199254740991);
              paintSeedMode();
            }
            return prompts[seededIndex(seedWidget?.value, prompts.length)];
          };
          items.push({
            content: "🎲  Randomize",
            callback: () => insertText(pickRandom()),
          });
          items.push(null);
          prompts.slice().reverse().forEach(text => {
            const short = text.length > 60 ? text.slice(0, 60) + "…" : text;
            items.push({
              content: short, title: text,
              callback: () => insertText(text),
            });
          });
        }
        new LiteGraph.ContextMenu(items, {
          event,
          title: `📥 Saved Prompts (${prompts.length})`,
          scale: Math.max(1, app.canvas?.ds?.scale || 1),
        });
      }

      const loadBtn = document.createElement("button");
      loadBtn.className = "db-lib-btn db-lora-add-open-btn";
      loadBtn.textContent = "📥  Load Prompt";
      loadBtn.style.cssText += "box-sizing:border-box;overflow:hidden;width:100%;";
      loadBtn.addEventListener("click", (e) => openSavedPromptMenu(e));

      let scriptPanelWidget = null;

      async function loadWildcards() {
        const data = await fetchJSON("/dirtybirds/wildcards");
        node._dbWildcardKeys = data?.keys || [];
      }
      loadWildcards();

      // ── Compact single-panel UI ─────────────────────────────────────────
      function makePromptTextarea(widget, tone) {
        const ta = document.createElement("textarea");
        ta.className = `db-script-textarea ${tone === "negative" ? "db-script-negative" : "db-script-positive"}`;
        ta.placeholder = tone === "negative" ? "negative" : "positive";
        ta.value = widget?.value || "";
        ta.spellcheck = false;
        ta.addEventListener("focus", () => {
          node._dbLastPromptWidget = widget;
          node._dbLastPromptTextarea = ta;
        });
        ta.addEventListener("input", (e) => {
          if (widget) widget.value = ta.value;
          handleAutocompleteInput(e, ta, node);
          node.setDirtyCanvas(true, true);
        });
        ta.addEventListener("keydown", (e) => handleAutocompleteKeydown(e, ta));
        return ta;
      }

      const panel = document.createElement("div");
      panel.className = "db-script-panel";

      const scriptLabel = makeSectionLabel("The Script");
      const posTA = makePromptTextarea(posWidget, "positive");
      const negTA = makePromptTextarea(negWidget, "negative");
      node._dbPositiveTextarea = posTA;
      node._dbNegativeTextarea = negTA;
      node._dbLastPromptTextarea = posTA;

      const toolsLabel = makeSectionLabel("The Toybox");
      const seedRow = document.createElement("div");
      seedRow.className = "db-prompt-seed-row";
      const seedModeBtn = document.createElement("button");
      seedModeBtn.className = "db-lib-btn db-lora-add-open-btn db-prompt-seed-mode";
      const seedLabel = document.createElement("span");
      seedLabel.className = "db-slider-label";
      seedLabel.textContent = "Seed";
      const seedInput = document.createElement("input");
      seedInput.type = "text";
      seedInput.inputMode = "numeric";
      seedInput.className = "db-text-input db-prompt-seed-input";
      seedInput.min = "0";
      seedInput.max = "18446744073709551615";
      seedInput.value = String(seedWidget?.value ?? 0);
      paintSeedMode = () => {
        const random = !!rerollWidget?.value;
        seedModeBtn.textContent = random ? "Random" : "Fixed";
        seedModeBtn.dataset.tone = random ? "random" : "fixed";
        seedInput.disabled = random;
        seedInput.value = String(seedWidget?.value ?? 0);
      };
      seedModeBtn.addEventListener("click", () => setSeedMode(!rerollWidget?.value));
      seedInput.addEventListener("input", () => {
        if (seedWidget) seedWidget.value = Number(seedInput.value.replace(/[^\d]/g, "") || 0);
        node.setDirtyCanvas(true, true);
      });
      seedRow.append(seedModeBtn, seedLabel, seedInput);
      paintSeedMode();

      const toyboxSplit = document.createElement("div");
      toyboxSplit.className = "db-prompt-toybox-split db-script-tool-split";
      const toyboxLeft = document.createElement("div");
      toyboxLeft.className = "db-prompt-toybox-col";
      const toyboxRight = document.createElement("div");
      toyboxRight.className = "db-prompt-toybox-col";
      const toyboxDivider = document.createElement("div");
      toyboxDivider.className = "db-prompt-toybox-divider";
      const promptToolGrid = document.createElement("div");
      promptToolGrid.className = "db-prompt-tool-grid db-prompt-tool-grid-two";
      promptToolGrid.append(loadBtn, btn);
      toyboxLeft.append(seedRow);
      toyboxRight.append(promptToolGrid);
      toyboxSplit.append(toyboxLeft, toyboxDivider, toyboxRight);

      panel.append(scriptLabel, posTA, negTA, toolsLabel, toyboxSplit);

      scriptPanelWidget = node.addDOMWidget("db_script_panel", "customhtml", panel, {
        serialize: false,
        height: 190,
        getMinHeight: () => Math.max(172, panel.scrollHeight || 172),
      });

      // ── Width sync ───────────────────────────────────────────────────────
      function applyWidths() {
        const w = nodeInnerW(node);
        panel.style.width = w + "px";
      }
      function syncPanelH() {
        if (node._dbPromptSizing) return;
        applyWidths();
        requestAnimationFrame(() => {
          node._dbPromptSizing = true;
          const h = Math.max(172, panel.scrollHeight || 172);
          if (scriptPanelWidget) {
            try { scriptPanelWidget.height = h; } catch (_) {}
            scriptPanelWidget.computedHeight = h;
          }
          const nodeH = Math.max(250, h + 58);
          if (Math.abs((node.size?.[1] || 0) - nodeH) > 2) {
            if (typeof node.setSize === "function") node.setSize([node.size[0], nodeH]);
            else node.size[1] = nodeH;
          }
          node.setDirtyCanvas(true, true);
          node._dbPromptSizing = false;
        });
      }
      function applyLayout() {
        syncPanelH();
        node.setDirtyCanvas(true, true);
      }
      requestAnimationFrame(() => requestAnimationFrame(applyLayout));
      const origResize = node.onResize;
      node.onResize = function (size) { origResize?.call(this, size); applyLayout(); };
    };
  },
});
