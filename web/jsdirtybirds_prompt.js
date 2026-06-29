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
import { api } from "../../../scripts/api.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel } from "./db_shared.js";

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
  return `### ${label}\n${text || "_empty_"}`;
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
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      const DB_MIN_W = 420;
      node.size[0] = Math.max(node.size[0] || 0, DB_MIN_W);
      const DB_MIN_H = 392;
      const DB_PANEL_MIN_H = 334;
      node.min_height = Math.max(node.min_height || 0, DB_MIN_H);
      node.min_width = Math.max(node.min_width || 0, DB_MIN_W);

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
      function hideWidget(name) {
        const w = node.widgets?.find(w => w.name === name);
        if (!w) return undefined;
        w.computeSize = () => [0, 0];
        w.serializeValue = () => w.value;
        if (typeof w.setHidden === "function") w.setHidden(true);
        else if ("hidden" in w) w.hidden = true;
        return w;
      }

      const seedWidget = hideWidget("seed");
      const rerollWidget = hideWidget("reroll_each_run");
      hideWidget("control_after_generate");
      let paintSeedMode = () => { };

      function randomSeedValue() {
        return Math.floor(Math.random() * 9007199254740991);
      }

      function setSeedMode(mode) {
        const isRandom = !!mode;
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
      const promptEditors = [posTA, negTA];
      node._dbPositiveTextarea = posTA;
      node._dbNegativeTextarea = negTA;
      node._dbLastPromptTextarea = posTA;

      const toolsLabel = makeSectionLabel("The Toybox");
      if (seedWidget && !(parseInt(seedWidget.value, 10) > 0)) {
        seedWidget.value = randomSeedValue();
      }

      const origExecuted = node.onExecuted;
      node.onExecuted = function (message) {
        origExecuted?.call(this, message);
        if (rerollWidget?.value && seedWidget) {
          seedWidget.value = randomSeedValue();
          node.setDirtyCanvas(true, true);
        }
      };

      const toyboxGrid = document.createElement("div");
      toyboxGrid.className = "db-prompt-tool-grid";
      toyboxGrid.style.gridTemplateColumns = "1fr 1fr 1fr 1fr";
      // ── Booru / Caption tools ───────────────────────────────────────────
      function currentImageUrl() {
        const peepShow = (app.graph?._nodes || []).find(
          (n) => n.comfyClass === "DirtyBirdsLoadImage" || n.type === "DirtyBirdsLoadImage"
        );
        if (!peepShow) return "";
        const urlW = peepShow.widgets?.find((w) => w.name === "image_url");
        const u = String(urlW?.value || "").trim();
        if (u) return u;
        return String(peepShow.imgs?.[0]?.src || "").trim();
      }

      const booruBtn = document.createElement("button");
      booruBtn.className = "db-lib-btn db-lora-add-open-btn";
      booruBtn.textContent = "Booru";
      booruBtn.addEventListener("click", async () => {
        const url = currentImageUrl();
        if (!url) return showOptionsFlyout("Booru", [{ value: "", label: "No image URL -- load one in Peep Show", glyph: "⚠" }], "", () => {});
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
        if (!url) { flyout.setStatus("No image -- load one in Peep Show first.", "err"); return; }
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

      toyboxGrid.append(loadBtn, btn, booruBtn, captionBtn);

      const previewLabel = makeSectionLabel("The Prompt");
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
        const posMd = promptToMarkdown(draft ? "Positive Draft" : "Positive", positive);
        const negMd = promptToMarkdown(draft ? "Negative Draft" : "Negative", negative);
        previewPos.innerHTML = renderMarkdownText(posMd);
        previewNeg.innerHTML = renderMarkdownText(negMd);
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
      const seedFixed = document.createElement("div");
      seedFixed.className = "db-seg-opt"; seedFixed.textContent = "📌 Fixed";
      seedFixed.style.cssText = "padding:0 8px;font-size:9px;";
      const seedRandom = document.createElement("div");
      seedRandom.className = "db-seg-opt"; seedRandom.textContent = "🎲 Random";
      seedRandom.style.cssText = "padding:0 8px;font-size:9px;";
      seedSeg.append(seedFixed, seedRandom);
      const seedVal = document.createElement("span");
      seedVal.className = "db-sel-val";
      seedVal.style.cssText = "flex:1;text-align:right;width:auto;color:#555;font-size:9px;";
      seedRow.append(seedLbl, seedSeg, seedVal);
      seedFixed.addEventListener("click", () => setSeedMode(false));
      seedRandom.addEventListener("click", () => setSeedMode(true));
      paintSeedMode = () => {
        const isRandom = !!rerollWidget?.value;
        seedRandom.classList.toggle("db-seg-active", isRandom);
        seedFixed.classList.toggle("db-seg-active", !isRandom);
        seedVal.textContent = isRandom ? "re-rolls each run" : String(seedWidget?.value ?? "");
      };

      panel.append(scriptLabel, posTA, negTA, toolsLabel, toyboxGrid, previewLabel, previewSplit, seedRow);
      node._dbRenderPromptMarkdown(posWidget?.value || "", negWidget?.value || "", true);
      paintSeedMode();
      scriptPanelWidget = node.addDOMWidget("db_script_panel", "customhtml", panel, {
        serialize: false,
        height: DB_PANEL_MIN_H,
        getMinHeight: () => Math.max(DB_PANEL_MIN_H, panel.scrollHeight || DB_PANEL_MIN_H),
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
        if (node._dbPromptSizing) return;
        applyWidths();
        requestAnimationFrame(() => {
          node._dbPromptSizing = true;
          applyEditorHeight(node.size?.[1] || DB_MIN_H);
          const h = Math.max(DB_PANEL_MIN_H, panel.scrollHeight || DB_PANEL_MIN_H);
          if (scriptPanelWidget) {
            try { scriptPanelWidget.height = h; } catch (_) { }
            scriptPanelWidget.computedHeight = h;
          }
          const nodeH = Math.max(DB_MIN_H, h + 58);
          if (Math.abs((node.size?.[1] || 0) - nodeH) > 2) {
            if (typeof node.setSize === "function") node.setSize([node.size[0], nodeH]);
            else node.size[1] = nodeH;
          }
          node.min_height = DB_MIN_H;
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
      node.onResize = function (size) {
        size[0] = Math.max(DB_MIN_W, size[0] || DB_MIN_W);
        const h = Math.max(DB_MIN_H, size[1] || DB_MIN_H);
        origResize?.call(this, [size[0], h]);
        this.size[0] = Math.max(DB_MIN_W, this.size?.[0] || DB_MIN_W);
        this.size[1] = h;
        applyEditorHeight(h);
        applyLayout();
      };
      const origDrawForeground = node.onDrawForeground;
      node.onDrawForeground = function (ctx) {
        if (!this.flags?.collapsed) {
          if (this.size?.[0] < DB_MIN_W) {
            if (typeof this.setSize === "function") this.setSize([DB_MIN_W, this.size[1]]);
            else this.size[0] = DB_MIN_W;
          }
          if (this.size?.[1] < DB_MIN_H) {
            if (typeof this.setSize === "function") this.setSize([this.size[0], DB_MIN_H]);
            else this.size[1] = DB_MIN_H;
          }
        }
        origDrawForeground?.call(this, ctx);
      };
    };
  },
});
