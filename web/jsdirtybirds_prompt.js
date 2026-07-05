/**
 * DirtyBirds Playhouse – Prompt Builder Node UI
 *
 * Native positive / negative multiline widgets + a "Load Wildcards" button.
 * Clicking it opens a native LiteGraph context menu listing wildcard keys from
 * the node's wildcards/*.yaml folder; picking one inserts a __key__ token at
 * the cursor of the last focused prompt box. The menu is drawn by ComfyUI
 * itself (not a custom DOM flyout), so it stays legible and zoom-aware.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel,
  hideWidget as hideWidgetShared, makeCollapsibleSectionLabel,
} from "./db_shared.js";

ensureStylesheet();

const REFRESH = "🔄  Refresh list";

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function promptToMarkdown(label, value) {
  const text = String(value || "").trim();
  return `### ${label}${text ? `\n${text}` : ""}`;
}

function renderMarkdownText(value) {
  return escapeHTML(value)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\n/g, "<br>");
}

function showOptionsFlyout(title, options, current, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel = document.createElement("div"); panel.className = "db-flyout";
  panel.style.left = Math.min(window.innerWidth / 2, window.innerWidth - 300) + "px";
  panel.style.top = Math.max(40, window.innerHeight / 2 - 120) + "px";

  const header = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const list = document.createElement("div"); list.className = "db-flyout-list"; panel.appendChild(list);
  options.forEach(opt => {
    const row = document.createElement("div");
    row.className = "db-res-opt" + (opt.value === current ? " db-selected" : "");
    row.innerHTML = `<span class="db-res-opt-glyph">${opt.glyph || ""}</span><span class="db-res-opt-label">${escapeHTML(opt.label)}</span>`;
    row.addEventListener("click", () => { close(); onPick(opt.value); });
    list.appendChild(row);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

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
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
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
  requestId: 0,
  selectedIndex: -1,
  selectItem: null,
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
  autocompleteState.selectedIndex = -1;
  autocompleteState.selectItem = null;
}

function positionAutocomplete(textarea) {
  const rect = textarea.getBoundingClientRect();
  const lines = textarea.value.slice(0, textarea.selectionStart).split("\n");
  const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 18;
  autocompleteState.dropdown.style.left = (rect.left + 10) + "px";
  autocompleteState.dropdown.style.top = Math.min(window.innerHeight - 220, rect.top + lines.length * lineHeight) + "px";
  autocompleteState.dropdown.style.display = "block";
}

function showTagAutocomplete(textarea, matches, start) {
  if (!matches.length) return hideAutocomplete();
  if (!autocompleteState.dropdown) {
    autocompleteState.dropdown = createAutocompleteDropdown();
    document.body.appendChild(autocompleteState.dropdown);
  }
  autocompleteState.dropdown.innerHTML = "";
  autocompleteState.selectedIndex = -1;
  const select = (name) => {
    const cursor = textarea.selectionStart;
    const insertion = `${name}, `;
    textarea.value = textarea.value.slice(0, start) + insertion + textarea.value.slice(cursor);
    textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    hideAutocomplete();
  };
  autocompleteState.selectItem = (index) => select(matches[index].tag_name);
  matches.slice(0, 20).forEach(match => {
    const item = createAutocompleteItem(match.tag_name, () => select(match.tag_name));
    const categoryColors = { 0: "#009be6", 1: "#ff8a8b", 3: "#c797ff", 4: "#35c64a", 5: "#ead084", 7: "#009be6", 8: "#ff8a8b", 10: "#c797ff", 11: "#35c64a", 12: "#8bd5ca", 14: "#ead084" };
    item.style.color = categoryColors[match.category] || "#bbb";
    const count = Number(match.post_count || 0).toLocaleString();
    item.innerHTML = `<span>${match.tag_name}</span><span style="float:right;opacity:.55;margin-left:18px">${count}</span>`;
    autocompleteState.dropdown.appendChild(item);
  });
  positionAutocomplete(textarea);
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
  const requestId = ++autocompleteState.requestId;

  const text = textarea.value;
  const cursorPos = textarea.selectionStart;
  const beforeCursor = text.slice(0, cursorPos);

  const loraMatch = beforeCursor.match(/<lora:([^:>]*)$/);
  const embedMatch = beforeCursor.match(/(\[emb:|<embed:)([^:>]*)$/);

  if (!loraMatch && !embedMatch) {
    const fragmentMatch = beforeCursor.match(/(?:^|[,\n])\s*([^,<>{}\[\]]+)$/);
    const partial = fragmentMatch?.[1]?.trim() || "";
    if (partial.length < 2) return hideAutocomplete();
    const start = cursorPos - partial.length;
    autocompleteState.timeout = setTimeout(async () => {
      const data = await fetchJSON(
        `/dirtybirds/tag-autocomplete?query=${encodeURIComponent(partial)}&limit=40`
      );
      if (requestId !== autocompleteState.requestId || textarea.selectionStart !== cursorPos) return;
      showTagAutocomplete(textarea, data?.tags || [], start);
    }, 60);
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

  const items = [...autocompleteState.dropdown.children];
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    autocompleteState.selectedIndex = (autocompleteState.selectedIndex + delta + items.length) % items.length;
    items.forEach((item, index) => {
      item.style.backgroundColor = index === autocompleteState.selectedIndex ? "#4a4a52" : "transparent";
    });
    items[autocompleteState.selectedIndex].scrollIntoView({ block: "nearest" });
    return;
  }

  if ((event.key === "Enter" || event.key === "Tab") && autocompleteState.selectedIndex >= 0 && autocompleteState.selectItem) {
    event.preventDefault();
    autocompleteState.selectItem(autocompleteState.selectedIndex);
    return;
  }

  if (event.key === "Escape") {
    hideAutocomplete();
    event.preventDefault();
  }
}

app.registerExtension({
  name: "DirtyBirds.Prompt",

  setup() {
    api.addEventListener("dirtybirds_set_prompt", (event) => {
      const positive = String(event?.detail?.positive || "");
      if (!positive) return;
      const nodes = app.graph?._nodes || [];
      for (const node of nodes) {
        if (node?.comfyClass !== "DirtyBirdsPrompt") continue;
        const widget = node.widgets?.find(w => w.name === "positive");
        const textarea = node._dbPositiveTextarea;
        if (textarea) {
          textarea.value = positive;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (widget) {
          widget.value = positive;
          node.setDirtyCanvas?.(true, true);
        }
      }
    });
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsPrompt") return;

    function removeLegacyCyclerOutput(node) {
      for (let i = (node.outputs?.length || 0) - 1; i >= 0; i--) {
        if (node.outputs[i]?.name === "cycler_text") node.removeOutput?.(i);
      }
    }

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      removeLegacyCyclerOutput(this);
      requestAnimationFrame(() => {
        this._dbRestoreToyboxState?.();
        this._dbMigratePromptLayout?.();
      });
      return result;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const prompts = message?.db_prompts_md;
      if (Array.isArray(prompts)) {
        this._dbResolvedPositive = prompts[0] || "";
        this._dbResolvedNegative = prompts[1] || "";
        this._dbRenderPromptMarkdown?.(prompts[0] || "", prompts[1] || "");
      }
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      // Migrate saved nodes from the former public cycler output. The active
      // line now travels privately with the positive STRING into db_pipe.
      removeLegacyCyclerOutput(node);
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      const DB_MIN_W = 420;
      node.size[0] = Math.max(node.size[0] || 0, DB_MIN_W);
      // Keep the body large enough for its controls. ComfyUI owns DOM-widget
      // height allocation; the panel does not run its own resize loop.
      const DB_PANEL_MIN_H = 342;
      const DB_TOYBOX_EXPANDED_H = 34;
      const DB_CHROME_H = 80;
      const DB_MIN_H = DB_PANEL_MIN_H + DB_CHROME_H;
      // Old workflows may serialize a stale minimum from a previous DOM
      // layout. Preserving it would permanently clamp the rebuilt node tall.
      node.min_height = DB_MIN_H;
      node.min_width = Math.max(node.min_width || 0, DB_MIN_W);
      node.size[1] = Math.max(node.size[1] || 0, DB_MIN_H);
      node.resizable = true;

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
      const cyclerTextWidget = node.widgets?.find(w => w.name === "cycler_text");

      function hideBackingWidget(widget) {
        if (!widget) return;
        widget.computeSize = () => [0, -4];
        widget.getMinHeight = () => -4;
        widget.computedHeight = 0;
        widget.serializeValue = () => widget.value;
        // Keep the real STRING widget serializable. ComfyUI's setHidden(true)
        // can mark converted widgets as non-serializing, which made custom
        // textarea edits disappear after a browser refresh.
        widget.serialize = true;
        if (widget.element?.style) widget.element.style.display = "none";
        if ("hidden" in widget) widget.hidden = false;
      }

      hideBackingWidget(posWidget);
      hideBackingWidget(negWidget);
      hideBackingWidget(cyclerTextWidget);

      // Display-only slot labels for the optional concat inputs; the underlying
      // input names (concat_positive/negative) stay intact so links don't break.
      // Set both `label` and `localized_name` (newer ComfyUI reads the latter),
      // and re-apply on the next frame since optional slots may populate late.
      function applyInputLabels() {
        const map = { concat_positive: "add +", concat_negative: "add -" };
        (node.inputs || []).forEach((slot) => {
          if (map[slot.name]) { slot.label = map[slot.name]; slot.localized_name = map[slot.name]; }
        });
        node.setDirtyCanvas(true, true);
      }
      applyInputLabels();
      requestAnimationFrame(applyInputLabels);

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
      const hideWidget = (name) => hideWidgetShared(node, name);

      const seedWidget = hideWidget("seed");
      const rerollWidget = hideWidget("reroll_each_run");
      hideWidget("control_after_generate");
      let paintSeedMode = () => { };

      function randomSeedValue() {
        return Math.floor(Math.random() * 9007199254740991);
      }

      function setSeedMode(mode) {
        const isRandom = mode === "random";
        if (rerollWidget) rerollWidget.value = isRandom;
        if (seedWidget) {
          if (isRandom) {
            seedWidget.value = randomSeedValue();
          } else if (!(parseInt(seedWidget.value, 10) > 0)) {
            seedWidget.value = randomSeedValue();
          }
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

      function replaceText(text) {
        const textarea = node._dbPositiveTextarea;
        if (textarea) textarea.value = text;
        if (posWidget) posWidget.value = text;
        node._dbRenderPromptMarkdown?.(text, negWidget?.value || "", true);
        node.setDirtyCanvas(true, true);
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

      function toItems(treeNode, path = "") {
        return Object.keys(treeNode.children).sort().map(name => {
          const child = treeNode.children[name];
          const hasChildren = Object.keys(child.children).length > 0;
          const childPath = path ? `${path}/${name}` : name;
          if (hasChildren) {
            const options = toItems(child, childPath);
            options.unshift({
              content: "↳ use all in folder",
              callback: () => insertText(`__${childPath}*__`),
            });
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
      function itemLabel(item) {
        const text = String(item?.text || "");
        const short = text.length > 54 ? text.slice(0, 54) + "…" : text;
        const file = item?.file ? `${item.file}:` : "";
        return `<span style="color:#69b7ff;font-weight:700;">${escapeHTML(file)}#${item?.line ?? "?"}</span> <span style="color:#d8e1e8;">${escapeHTML(short)}</span>`;
      }

      function normalizePromptItems(data) {
        if (Array.isArray(data?.items)) return data.items;
        return (data?.prompts || []).map((text, i) => ({ file: "", line: i + 1, text }));
      }

      let loadBtn = null;

      function setLoadPromptSource(item) {
        if (!loadBtn) return;
        const file = item?.file ? `${item.file}:` : "";
        const line = item?.line ?? "?";
        loadBtn.innerHTML = `<span>📥</span><span class="db-load-prompt-source">${escapeHTML(file)}#${line}</span>`;
        loadBtn.title = `${item?.file || "prompt file"}:${line}`;
      }

      function closePromptFlyout() {
        document.querySelector(".db-flyout-overlay")?.remove();
        document.querySelector(".db-flyout.db-prompt-file-flyout")?.remove();
      }

      function openPromptFlyout(title, event) {
        closePromptFlyout();
        const overlay = document.createElement("div");
        overlay.className = "db-flyout-overlay";
        const panel = document.createElement("div");
        panel.className = "db-flyout db-prompt-file-flyout";
        panel.style.width = "min(520px, 92vw)";
        panel.style.left = Math.max(20, Math.min(event?.clientX || 260, window.innerWidth - 540)) + "px";
        panel.style.top = Math.max(40, Math.min(event?.clientY || 160, window.innerHeight - 520)) + "px";

        const header = document.createElement("div");
        header.className = "db-flyout-header";
        const titleEl = document.createElement("span");
        titleEl.className = "db-flyout-title";
        titleEl.textContent = title;
        const closeBtn = document.createElement("button");
        closeBtn.className = "db-flyout-close";
        closeBtn.textContent = "✕";
        header.append(titleEl, closeBtn);

        const list = document.createElement("div");
        list.className = "db-flyout-list";
        list.style.maxHeight = "62vh";
        panel.append(header, list);

        function close() { overlay.remove(); panel.remove(); }
        closeBtn.addEventListener("click", close);
        overlay.addEventListener("click", close);
        document.body.append(overlay, panel);
        return { panel, list, close };
      }

      function appendPromptRow(list, item, onInsert, onDelete) {
        const row = document.createElement("div");
        row.className = "db-res-opt db-prompt-file-row";
        const label = document.createElement("div");
        label.className = "db-prompt-file-label";
        const prefix = document.createElement("span");
        prefix.className = "db-prompt-file-line";
        prefix.textContent = `${item.file ? item.file + ":" : ""}#${item.line ?? "?"}`;
        const text = document.createElement("span");
        text.className = "db-prompt-file-text";
        text.textContent = String(item.text || "");
        label.append(prefix, text);
        row.appendChild(label);
        row.title = `${item.file || "prompt file"}:${item.line}\n${item.text}`;

        if (onDelete) {
          const actions = document.createElement("div");
          actions.className = "db-prompt-file-actions";
          const insertBtn = document.createElement("button");
          insertBtn.className = "db-prompt-file-action";
          insertBtn.textContent = "Insert";
          insertBtn.addEventListener("click", (e) => { e.stopPropagation(); onInsert(item); });
          const deleteBtn = document.createElement("button");
          deleteBtn.className = "db-prompt-file-action db-prompt-file-delete";
          deleteBtn.textContent = "Delete";
          deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (deleteBtn.dataset.confirm !== "1") {
              deleteBtn.dataset.confirm = "1";
              deleteBtn.textContent = "Delete?";
              return;
            }
            await onDelete(item);
          });
          actions.append(insertBtn, deleteBtn);
          row.appendChild(actions);
        } else {
          row.addEventListener("click", () => onInsert(item));
        }
        list.appendChild(row);
      }

      async function openManagePromptsMenu(event) {
        const data = await fetchJSON("/dirtybirds/saved-prompts");
        const items = normalizePromptItems(data);
        const flyout = openPromptFlyout(`Manage Prompts (${items.length})`, event);
        const refresh = document.createElement("div");
        refresh.className = "db-res-opt";
        refresh.textContent = REFRESH;
        refresh.addEventListener("click", () => openManagePromptsMenu(event));
        flyout.list.appendChild(refresh);
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "db-res-opt";
          empty.textContent = "(no saved prompts)";
          flyout.list.appendChild(empty);
        } else {
          items.slice().reverse().forEach(item => {
            appendPromptRow(flyout.list, item, (picked) => {
              replaceText(picked.text);
              setLoadPromptSource(picked);
            }, async (picked) => {
              await fetchJSON("/dirtybirds/delete-saved-prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(picked),
              });
              openManagePromptsMenu(event);
            });
          });
        }
      }

      async function openSavedPromptMenu(event) {
        const data = await fetchJSON("/dirtybirds/saved-prompts");
        const promptItems = normalizePromptItems(data);
        const flyout = openPromptFlyout(`Saved Prompts (${promptItems.length})`, event);
        const refresh = document.createElement("div");
        refresh.className = "db-res-opt";
        refresh.textContent = REFRESH;
        refresh.addEventListener("click", () => openSavedPromptMenu(event));
        const manage = document.createElement("div");
        manage.className = "db-res-opt";
        manage.textContent = "🗂️  Manage Prompts";
        manage.addEventListener("click", () => openManagePromptsMenu(event));
        flyout.list.append(refresh, manage);
        if (!promptItems.length) {
          const empty = document.createElement("div");
          empty.className = "db-res-opt";
          empty.textContent = "(no saved prompts)";
          flyout.list.appendChild(empty);
        } else {
          const pickRandom = () => {
            if (rerollWidget?.value && seedWidget) {
              seedWidget.value = Math.floor(Math.random() * 9007199254740991);
              paintSeedMode();
            }
            return promptItems[Math.floor(Math.random() * promptItems.length)] || null;
          };
          const randomRow = document.createElement("div");
          randomRow.className = "db-res-opt";
          randomRow.textContent = "🎲  Randomize";
          randomRow.addEventListener("click", () => {
            const picked = pickRandom();
            if (picked) {
              replaceText(picked.text);
              setLoadPromptSource(picked);
            }
            flyout.close();
          });
          flyout.list.appendChild(randomRow);
          promptItems.slice().reverse().forEach(item => {
            appendPromptRow(flyout.list, item, (picked) => {
              replaceText(picked.text);
              setLoadPromptSource(picked);
              flyout.close();
            });
          });
        }
      }

      loadBtn = document.createElement("button");
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
          node._dbRenderPromptMarkdown?.(posWidget?.value || "", negWidget?.value || "", true);
          if (tone === "positive") {
            window.dispatchEvent(new CustomEvent("dirtybirds:prompt-source-changed", {
              detail: { nodeId: node.id },
            }));
          }
          node.setDirtyCanvas(true, true);
        });
        ta.addEventListener("keydown", (e) => handleAutocompleteKeydown(e, ta));
        return ta;
      }

      const panel = document.createElement("div");
      panel.className = "db-script-panel";

      const scriptLabel = makeSectionLabel("User Prompt");
      const posTA = makePromptTextarea(posWidget, "positive");
      const negTA = makePromptTextarea(negWidget, "negative");
      const promptEditors = [posTA, negTA];

      function cyclerLines(value) {
        if (!value) return [];
        let normalized = value.replace(/\r\n?/g, "\n");
        // Match Python splitlines(): the final newline terminates the current
        // line; it does not create an additional cycler item.
        if (normalized.endsWith("\n")) normalized = normalized.slice(0, -1);
        return normalized.split("\n");
      }
      function syncCyclerValue(value) {
        const lines = cyclerLines(value);
        let limited = value;
        if (lines.length > 50) {
          limited = lines.slice(0, 50).join("\n");
        }
        if (cyclerTextWidget) cyclerTextWidget.value = limited;
        return limited;
      }
      syncCyclerValue(cyclerTextWidget?.value || "");

      // onNodeCreated runs before ComfyUI restores saved widget values onto a
      // reloaded graph, so the textarea snapshot above can be empty/stale.
      // Re-sync once restore has happened.
      requestAnimationFrame(() => {
        if (posWidget && posTA.value !== posWidget.value) posTA.value = posWidget.value || "";
        if (negWidget && negTA.value !== negWidget.value) negTA.value = negWidget.value || "";
        syncCyclerValue(cyclerTextWidget?.value || "");
        node._dbRenderPromptMarkdown?.(posWidget?.value || "", negWidget?.value || "");
      });
      node._dbPositiveTextarea = posTA;
      node._dbNegativeTextarea = negTA;
      node._dbLastPromptTextarea = posTA;

      let toyboxExpanded = false;
      if (seedWidget && !(parseInt(seedWidget.value, 10) > 0)) {
        seedWidget.value = randomSeedValue();
      }

      const origExecuted = node.onExecuted;
      node.onExecuted = function (message) {
        origExecuted?.call(this, message);
        if (seedWidget && Number.isFinite(Number(seedWidget.value))) {
          node._dbLastQueuedSeed = Number(seedWidget.value);
        }
        if (rerollWidget?.value && seedWidget) {
          seedWidget.value = randomSeedValue();
        }
        paintSeedMode();
        node.setDirtyCanvas(true, true);
      };

      const toyboxGrid = document.createElement("div");
      toyboxGrid.className = "db-prompt-tool-grid";
      toyboxGrid.style.gridTemplateColumns = "1fr 1fr 1fr 1fr";
      toyboxGrid.style.display = "none";
      function applyToyboxState(expanded, resize = true) {
        toyboxExpanded = !!expanded;
        toyboxGrid.style.display = toyboxExpanded ? "grid" : "none";
        node.properties = node.properties || {};
        node.properties.db_toybox_expanded = toyboxExpanded;
        if (resize) {
          const currentH = node.size?.[1] || DB_MIN_H;
          node.setSize([
            node.size[0],
            toyboxExpanded
              ? currentH + DB_TOYBOX_EXPANDED_H
              : Math.max(DB_MIN_H, currentH - DB_TOYBOX_EXPANDED_H),
          ]);
        }
        node.setDirtyCanvas(true, true);
      }
      const toyboxSection = makeCollapsibleSectionLabel("Prompt Tools", {
        expanded: false,
        onChange: (expanded) => applyToyboxState(expanded, true),
      });
      node._dbRestoreToyboxState = () => {
        const expanded = !!node.properties?.db_toybox_expanded;
        toyboxSection.setExpanded(expanded, false);
        applyToyboxState(expanded, false);
      };
      node._dbMigratePromptLayout = () => {
        const layoutVersion = 3;
        node.properties = node.properties || {};
        if (Number(node.properties.db_prompt_layout_version || 0) >= layoutVersion) return;
        node.setSize([
          Math.max(DB_MIN_W, node.size?.[0] || DB_MIN_W),
          DB_MIN_H + (toyboxExpanded ? DB_TOYBOX_EXPANDED_H : 0),
        ]);
        node.properties.db_prompt_layout_version = layoutVersion;
        node.setDirtyCanvas(true, true);
      };
      // ── Booru / Caption tools ───────────────────────────────────────────
      function currentImageUrl() {
        const peepShow = (app.graph?._nodes || []).find(
          (n) => n.comfyClass === "DirtyBirdsLoadImage" || n.type === "DirtyBirdsLoadImage"
        );
        if (!peepShow) return "";
        const urlW = peepShow.widgets?.find((w) => w.name === "image_url");
        const u = String(urlW?.value || "").trim();
        if (u) return u;
        const imageW = peepShow.widgets?.find((w) => w.name === "image");
        const filename = String(imageW?.value || "").trim();
        if (filename) return `/view?filename=${encodeURIComponent(filename)}&type=input`;
        return String(peepShow.imgs?.[0]?.src || "").trim();
      }

      const booruBtn = document.createElement("button");
      booruBtn.className = "db-lib-btn db-lora-add-open-btn";
      booruBtn.textContent = "Booru";
      booruBtn.addEventListener("click", async () => {
        const url = currentImageUrl();
        if (!url) return showOptionsFlyout("Booru", [{ value: "", label: "No image URL -- load one in Image Loader", glyph: "⚠" }], "", () => {});
        const flyout = openCaptionFlyout("Booru Tags", booruBtn);
        flyout.setStatus("Fetching AIBooru tags...");
        const data = await fetchJSON(`/dirtybirds/aibooru-post-tags?url=${encodeURIComponent(url)}`);
        const tags = data?.tags || [];
        if (!tags.length) { flyout.setStatus(data?.error || "No tags found.", "err"); return; }
        replaceText(tags.join(", "));
        flyout.setStatus(`${tags.length} tags replaced.`, "ok");
        setTimeout(() => flyout.close(), 1200);
      });

      function openCaptionFlyout(title, anchor) {
        document.querySelector(".db-flyout-overlay")?.remove();
        document.querySelector(".db-flyout")?.remove();
        const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
        const panel = document.createElement("div"); panel.className = "db-flyout";
        panel.style.width = "min(360px, 80vw)";
        const rect = anchor.getBoundingClientRect();
        panel.style.left = Math.max(20, rect.left) + "px";
        panel.style.top = (rect.bottom + 6) + "px";
        const header = document.createElement("div"); header.className = "db-flyout-header";
        const titleEl = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
        const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
        header.append(titleEl, closeBtn);
        const statusEl = document.createElement("div");
        statusEl.className = "db-url-tools-status";
        statusEl.style.padding = "10px 12px";
        panel.append(header, statusEl);
        function close() { overlay.remove(); panel.remove(); }
        closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
        document.body.append(overlay, panel);
        return {
          close,
          setStatus(text, tone = "") { statusEl.textContent = text; statusEl.dataset.tone = tone; },
          el: statusEl,
        };
      }

      const captionBtn = document.createElement("button");
      captionBtn.className = "db-lib-btn db-lora-add-open-btn";
      captionBtn.textContent = "Caption";
      captionBtn.addEventListener("click", async () => {
        const flyout = openCaptionFlyout("Caption", captionBtn);
        flyout.setStatus("Checking LM Studio...");
        const lmData = await fetchJSON("/dirtybirds/lm-models?endpoint=http%3A%2F%2Flocalhost%3A1234%2Fv1");
        const models = lmData?.models || [];
        if (!models.length) { flyout.setStatus(lmData?.error || "LM Studio offline -- start it and load a vision model.", "err"); return; }
        flyout.setStatus(`LM Studio: ${models[0]}`);
        const url = currentImageUrl();
        if (!url) { flyout.setStatus("No image -- load one in Image Loader first.", "err"); return; }
        flyout.setStatus("Captioning image...");
        const params = new URLSearchParams({
          url,
          endpoint: "http://localhost:1234/v1",
          instruction: "Describe this image as comma-separated image-generation tags. Output only the tags.",
        });
        const data = await fetchJSON(`/dirtybirds/url-caption?${params.toString()}`);
        const caption = (data?.caption || "").trim();
        if (!caption) { flyout.setStatus(data?.error || "Caption returned empty.", "err"); return; }
        replaceText(caption);
        flyout.setStatus("Caption replaced.", "ok");
        setTimeout(() => flyout.close(), 1200);
      });
      function paintImageToolAvailability() {
        const available = !!currentImageUrl();
        for (const button of [booruBtn, captionBtn]) {
          button.disabled = !available;
          button.title = available ? "" : "Load an image in Image Loader first";
        }
      }
      window.addEventListener("dirtybirds:image-source-changed", paintImageToolAvailability);
      const previousOnRemoved = node.onRemoved;
      node.onRemoved = function () {
        window.removeEventListener("dirtybirds:image-source-changed", paintImageToolAvailability);
        return previousOnRemoved?.apply(this, arguments);
      };
      requestAnimationFrame(() => requestAnimationFrame(paintImageToolAvailability));

      const cyclerBtn = document.createElement("button");
      cyclerBtn.className = "db-lib-btn db-lora-add-open-btn";
      function paintCyclerButton() {
        const count = cyclerLines(cyclerTextWidget?.value || "").filter((line) => line.trim()).length;
        cyclerBtn.textContent = count ? `Cycler · ${count}` : "Cycler";
        cyclerBtn.title = count ? `${count} active cycler line${count === 1 ? "" : "s"}` : "Add prompt lines to cycle";
        toyboxSection.setTitle(count ? `Prompt Tools · Cycler: ${count}` : "Prompt Tools");
      }
      function openCyclerFlyout() {
        document.querySelector(".db-flyout-overlay")?.remove();
        document.querySelector(".db-flyout")?.remove();
        const overlay = document.createElement("div");
        overlay.className = "db-flyout-overlay";
        const flyout = document.createElement("div");
        flyout.className = "db-flyout db-cycler-flyout";
        flyout.style.cssText += "width:min(460px,90vw);left:50%;top:50%;transform:translate(-50%,-50%);";
        const header = document.createElement("div");
        header.className = "db-flyout-header";
        const title = document.createElement("span");
        title.className = "db-flyout-title";
        title.textContent = "The Cycler";
        const closeBtn = document.createElement("button");
        closeBtn.className = "db-flyout-close";
        closeBtn.textContent = "✕";
        header.append(title, closeBtn);
        const editor = document.createElement("textarea");
        editor.className = "db-script-textarea db-script-positive";
        editor.placeholder = "one prompt addition per line";
        editor.value = cyclerTextWidget?.value || "";
        editor.spellcheck = false;
        editor.style.cssText += "height:220px;min-height:140px;resize:vertical;margin:10px;width:calc(100% - 20px);";
        const footer = document.createElement("div");
        footer.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:0 10px 10px;color:#6f7b84;font-size:9px;";
        const count = document.createElement("span");
        const done = document.createElement("button");
        done.className = "db-lib-btn db-lora-add-open-btn";
        done.textContent = "Done";
        function sync() {
          const limited = syncCyclerValue(editor.value);
          if (limited !== editor.value) editor.value = limited;
          count.textContent = `${cyclerLines(limited).filter((line) => line.trim()).length} / 50 lines`;
          paintCyclerButton();
          node.setDirtyCanvas(true, true);
        }
        function close() { sync(); overlay.remove(); flyout.remove(); }
        editor.addEventListener("input", sync);
        closeBtn.addEventListener("click", close);
        done.addEventListener("click", close);
        overlay.addEventListener("click", close);
        footer.append(count, done);
        flyout.append(header, editor, footer);
        document.body.append(overlay, flyout);
        sync();
        editor.focus();
      }
      cyclerBtn.addEventListener("click", openCyclerFlyout);
      paintCyclerButton();

      toyboxGrid.append(loadBtn, booruBtn, captionBtn, cyclerBtn);

      const previewLabel = makeSectionLabel("Preview");
      const previewSplit = document.createElement("div");
      previewSplit.className = "db-prompt-md-split";
      const previewPos = document.createElement("div");
      previewPos.className = "db-prompt-md-box db-prompt-md-positive";
      const previewNeg = document.createElement("div");
      previewNeg.className = "db-prompt-md-box db-prompt-md-negative";
      const previewDivider = document.createElement("div");
      previewDivider.className = "db-prompt-toybox-divider";
      previewSplit.append(previewPos, previewDivider, previewNeg);

      node._dbRenderPromptMarkdown = (positive, negative, draft = false) => {
        const positiveEmpty = !String(positive || "").trim();
        const negativeEmpty = !String(negative || "").trim();
        const posMd = promptToMarkdown(draft ? "Positive Draft" : "Positive", positive);
        const negMd = promptToMarkdown(draft ? "Negative Draft" : "Negative", negative);
        previewPos.innerHTML = renderMarkdownText(posMd);
        previewNeg.innerHTML = renderMarkdownText(negMd);
        previewPos.classList.toggle("db-prompt-md-empty", positiveEmpty);
        previewNeg.classList.toggle("db-prompt-md-empty", negativeEmpty);
        previewSplit.classList.toggle("db-prompt-md-all-empty", positiveEmpty && negativeEmpty);
        syncPanelH();
      };

      // ── Seed mode (Fixed / Random) — visible toggle under The Prompt ──────
      // Reuses the global .db-seg control. Random = reroll_each_run on (fresh
      // roll every queue); Fixed = reproducible seed shown to the right.
      const seedRow = document.createElement("div");
      seedRow.className = "db-prompt-seed-row";
      seedRow.style.cssText += "display:flex;align-items:center;gap:8px;";
      const seedLbl = document.createElement("span");
      seedLbl.className = "db-slider-label";
      seedLbl.style.fontSize = "9px";
      seedLbl.textContent = "Seed";
      const seedSeg = document.createElement("div");
      seedSeg.className = "db-seg";
      seedSeg.style.cssText = "flex:0 0 auto;height:18px;";
      const seedRandom = document.createElement("div");
      seedRandom.className = "db-seg-opt"; seedRandom.textContent = "Each";
      seedRandom.title = "Use a different seed each run";
      seedRandom.style.cssText = "padding:0 2px;font-size:9px;min-width:0;";
      const seedNewFixed = document.createElement("div");
      seedNewFixed.className = "db-seg-opt"; seedNewFixed.textContent = "New";
      seedNewFixed.title = "Create a new fixed seed";
      seedNewFixed.style.cssText = "padding:0 2px;font-size:9px;min-width:0;";
      const seedLast = document.createElement("div");
      seedLast.className = "db-seg-opt"; seedLast.textContent = "Last";
      seedLast.style.cssText = "padding:0 2px;font-size:9px;min-width:0;";
      seedSeg.append(seedRandom, seedNewFixed, seedLast);
      const seedVal = document.createElement("span");
      seedVal.className = "db-sel-val";
      seedVal.style.display = "none";
      seedRow.append(seedLbl, seedSeg, seedVal);
      seedRandom.addEventListener("click", () => setSeedMode("random"));
      seedNewFixed.addEventListener("click", () => {
        if (seedWidget) seedWidget.value = randomSeedValue();
        setSeedMode("fixed");
      });
      seedLast.addEventListener("click", () => {
        if (!Number.isFinite(node._dbLastQueuedSeed)) return;
        if (seedWidget) seedWidget.value = node._dbLastQueuedSeed;
        setSeedMode("fixed");
      });
      paintSeedMode = () => {
        const isRandom = !!rerollWidget?.value;
        seedRandom.classList.toggle("db-seg-active", isRandom);
        const hasLast = Number.isFinite(node._dbLastQueuedSeed);
        seedLast.style.opacity = hasLast ? "1" : "0.35";
        seedLast.style.pointerEvents = hasLast ? "auto" : "none";
        seedLast.title = hasLast ? `Use last queued seed: ${node._dbLastQueuedSeed}` : "No queued seed is available yet";
        seedVal.textContent = isRandom ? "re-rolls each run" : String(seedWidget?.value ?? "");
        seedRow.title = isRandom ? "Seed: different each run" : `Fixed seed: ${seedWidget?.value ?? ""}`;
      };

      const primaryRow = document.createElement("div");
      primaryRow.className = "db-prompt-primary-row";
      const seedCol = document.createElement("div");
      seedCol.className = "db-prompt-primary-col";
      const seedHead = document.createElement("div");
      seedHead.className = "db-talent-col-header";
      seedHead.textContent = "Seed";
      seedLbl.style.display = "none";
      seedCol.append(seedHead, seedRow);
      const primaryDivider = document.createElement("div");
      primaryDivider.className = "db-prompt-primary-divider";
      const wildcardCol = document.createElement("div");
      wildcardCol.className = "db-prompt-primary-col";
      const wildcardHead = document.createElement("div");
      wildcardHead.className = "db-talent-col-header";
      wildcardHead.textContent = "Wildcard";
      wildcardCol.append(wildcardHead, btn);
      primaryRow.append(seedCol, primaryDivider, wildcardCol);

      panel.append(scriptLabel, posTA, negTA, primaryRow, toyboxSection.label, toyboxGrid, previewLabel, previewSplit);
      node._dbRenderPromptMarkdown(posWidget?.value || "", negWidget?.value || "", true);
      paintSeedMode();
      scriptPanelWidget = node.addDOMWidget("db_script_panel", "customhtml", panel, {
        serialize: false,
        getMinHeight: () => DB_PANEL_MIN_H + (toyboxExpanded ? DB_TOYBOX_EXPANDED_H : 0),
        afterResize: (resizedNode) => {
          applyWidths();
          applyEditorHeight(resizedNode.size?.[1] || DB_MIN_H);
        },
      });

      // ── Width sync ───────────────────────────────────────────────────────
      function applyWidths() {
        const w = nodeInnerW(node);
        panel.style.width = w + "px";
      }
      function applyEditorHeight(totalH) {
        const extra = Math.max(0, totalH - DB_MIN_H);
        const editorH = Math.min(180, 48 + Math.floor(extra / 2));
        promptEditors.forEach((ta) => {
          ta.style.height = editorH + "px";
          ta.style.minHeight = editorH + "px";
          ta.style.maxHeight = editorH + "px";
        });
      }
      function syncPanelH() {
        applyWidths();
        requestAnimationFrame(() => {
          applyEditorHeight(node.size?.[1] || DB_MIN_H);
          node.setDirtyCanvas(true, true);
        });
      }
      function applyLayout() {
        syncPanelH();
        node.setDirtyCanvas(true, true);
      }
      requestAnimationFrame(() => requestAnimationFrame(applyLayout));
    };
  },
});
