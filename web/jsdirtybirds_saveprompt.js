/**
 * DirtyBirds Playhouse – Save (Image + Prompt) Node UI
 *
 * Exact clone of Dirty Talk (jsdirtybirds_prompt.js) with the same script
 * panel, toybox, and booru tools. Additionally hides the filename_prefix and
 * prompts_file widgets behind styled rows in a new "The Archive" section.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel, hideWidget } from "./db_shared.js";

ensureStylesheet();

const REFRESH = "🔄  Refresh list";

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

  const cleanedBefore = beforeCursor.replace(/<lora:[^:>]*$|(\[emb:|<embed:)[^:>]*$/, "");

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
  name: "DirtyBirds.SavePrompt",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsSavePrompt") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color   = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = 420;

      // Drop stale DOM widgets from older layouts.
      const staleWidgets = new Set([
        "db_scriptlabel", "db_toolslabel", "db_seed_row", "db_wildcard_btn",
        "db_loadprompt_btn", "db_toybox_cols", "db_booru_btn", "db_url_tools",
        "db_script_panel", "db_save_title", "db_save_prefix", "db_save_file",
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

      node._dbLastPromptWidget = posWidget;
      node._dbLastPromptTextarea = null;
      node._dbLoraList = [];
      node._dbEmbeddingList = [];

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

      // ── Seed (Fixed / Random) ───
      const seedWidget   = hideWidget(node, "seed");
      const rerollWidget = hideWidget(node, "reroll_each_run");
      hideWidget(node, "control_after_generate");
      const prefixWidget = hideWidget(node, "filename_prefix");
      const fileWidget   = hideWidget(node, "prompts_file");

      function setSeedMode(mode) {
        if (rerollWidget) rerollWidget.value = mode;
        if (!mode && seedWidget && !(parseInt(seedWidget.value, 10) > 0)) {
          seedWidget.value = Math.floor(Math.random() * 9007199254740991);
        }
        node.setDirtyCanvas(true);
      }

      // ── Wildcards menu ──
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
        const seedIsRandom = !!rerollWidget?.value;
        const items = [
          { content: REFRESH, callback: () => loadWildcards() },
          null,
          { content: `${seedIsRandom ? "" : "✓ "}📌 Seed: Fixed`,  callback: () => setSeedMode(false) },
          { content: `${seedIsRandom ? "✓ " : ""}🎲 Seed: Random`, callback: () => setSeedMode(true) },
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

      // ── Load Prompt menu ──
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
          const pickRandom = () => prompts[Math.floor(Math.random() * prompts.length)];
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

      // ── Booru / Image URL Tools ──
      const booruWrap = document.createElement("div");
      booruWrap.className = "db-prompt-booru-wrap";

      const booruBtn = document.createElement("button");
      booruBtn.className = "db-lib-btn db-lora-add-open-btn";
      booruBtn.textContent = "🔗  Image URL Tools";
      booruBtn.style.cssText = "width:100%;box-sizing:border-box;";

      const booruPanel = document.createElement("div");
      booruPanel.className = "db-url-tools-panel";
      booruPanel.style.display = "none";

      const booruInput = document.createElement("input");
      booruInput.type = "text";
      booruInput.placeholder = "AIBooru post URL or direct image URL…";
      booruInput.className = "db-text-input";

      const actionRow = document.createElement("div");
      actionRow.className = "db-url-tools-row db-url-tools-actions";
      const lmStatus = document.createElement("div");
      lmStatus.className = "db-lm-status";
      lmStatus.textContent = "LM Studio: checking";
      const booruSearchBtn = document.createElement("button");
      booruSearchBtn.textContent = "Booru";
      booruSearchBtn.className = "db-lib-btn db-lora-add-open-btn";
      const captionBtn = document.createElement("button");
      captionBtn.textContent = "Caption";
      captionBtn.className = "db-lib-btn db-lora-add-open-btn";
      const previewWrap = document.createElement("div");
      previewWrap.className = "db-url-preview";
      previewWrap.style.display = "none";
      const previewImg = document.createElement("img");
      previewImg.alt = "image preview";
      previewWrap.appendChild(previewImg);
      const urlStatus = document.createElement("div");
      urlStatus.className = "db-url-tools-status";
      actionRow.append(lmStatus, booruSearchBtn, captionBtn);
      booruPanel.append(booruInput, previewWrap, actionRow, urlStatus);
      booruWrap.append(booruBtn, booruPanel);

      let _booruOpen = false;
      let scriptPanelWidget = null;

      function setBooruOpen(open) {
        _booruOpen = open;
        booruPanel.style.display = open ? "flex" : "none";
        booruBtn.textContent = open ? "✕  Close" : "🔗  Image URL Tools";
        syncPanelH();
        if (open) refreshLmStatus();
        if (open) requestAnimationFrame(() => booruInput.focus());
      }

      booruBtn.addEventListener("click", () => setBooruOpen(!_booruOpen));

      function setUrlStatus(text, tone = "") {
        urlStatus.textContent = text || "";
        urlStatus.dataset.tone = tone;
        syncPanelH();
      }

      async function refreshLmStatus() {
        lmStatus.textContent = "LM Studio: checking";
        lmStatus.dataset.tone = "";
        const data = await fetchJSON("/dirtybirds/lm-models?endpoint=http%3A%2F%2Flocalhost%3A1234%2Fv1");
        const models = data?.models || [];
        if (models.length) {
          lmStatus.textContent = "LM Studio: ready";
          lmStatus.title = models[0];
          lmStatus.dataset.tone = "ok";
        } else {
          lmStatus.textContent = "LM Studio: offline";
          lmStatus.title = data?.error || "No model served at localhost:1234";
          lmStatus.dataset.tone = "err";
        }
        syncPanelH();
      }

      function setPreview(src) {
        const url = (src || "").trim();
        if (!url) {
          previewImg.removeAttribute("src");
          previewWrap.style.display = "none";
          syncPanelH();
          return;
        }
        previewImg.src = url;
        previewImg.title = url;
        previewWrap.style.display = "flex";
        syncPanelH();
      }

      function previewDirectUrl() {
        const q = booruInput.value.trim();
        if (/^https?:\/\//i.test(q) && !/aibooru\.online/i.test(q)) setPreview(q);
        else setPreview("");
      }

      previewImg.addEventListener("load", () => syncPanelH());
      previewImg.addEventListener("error", () => {
        previewWrap.style.display = "none";
        setUrlStatus("Preview could not load.", "err");
      });

      async function doSearch() {
        const q = booruInput.value.trim();
        if (!q) return setUrlStatus("Paste an AIBooru post URL.", "err");
        setUrlStatus("Fetching AIBooru tags…");
        const data = await fetchJSON(`/dirtybirds/aibooru-post-tags?url=${encodeURIComponent(q)}`);
        const tags = data?.tags || [];
        if (data?.image_url) setPreview(data.image_url);
        if (!tags.length) return setUrlStatus(data?.error || "No tags found.", "err");
        insertText(tags.join(", "));
        setUrlStatus(`Inserted ${tags.length} tags.`, "ok");
      }

      async function doCaption() {
        const q = booruInput.value.trim();
        if (!q) return setUrlStatus("Paste an image URL or AIBooru post URL.", "err");
        setUrlStatus("Captioning URL image…");
        const params = new URLSearchParams({
          url: q,
          endpoint: "http://localhost:1234/v1",
          instruction: "Describe this image as comma-separated image-generation tags. Output only the tags.",
        });
        const data = await fetchJSON(`/dirtybirds/url-caption?${params.toString()}`);
        if (data?.image_url) setPreview(data.image_url);
        const caption = (data?.caption || "").trim();
        if (!caption) return setUrlStatus(data?.error || "Caption returned empty.", "err");
        insertText(caption);
        setUrlStatus("Caption inserted.", "ok");
        refreshLmStatus();
      }

      refreshLmStatus();
      booruSearchBtn.addEventListener("click", doSearch);
      captionBtn.addEventListener("click", doCaption);
      booruInput.addEventListener("input", previewDirectUrl);
      booruInput.addEventListener("blur", previewDirectUrl);
      booruInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { doSearch(); e.preventDefault(); }
        if (e.key === "Escape") { setBooruOpen(false); }
      });

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
      const toyboxCols = document.createElement("div");
      toyboxCols.className = "db-prompt-toybox-columns";
      const toyboxDivider = document.createElement("div");
      toyboxDivider.className = "db-prompt-toybox-divider";
      toyboxCols.append(loadBtn, toyboxDivider, btn);

      // ── The Archive (save-specific settings) ──
      const archiveLabel = makeSectionLabel("The Archive");
      const archiveRow = document.createElement("div");
      archiveRow.className = "db-url-tools-row";
      archiveRow.style.cssText = "display:flex;flex-direction:column;gap:4px;";

      function makeTextRow(labelText, w, placeholder) {
        const row = document.createElement("div");
        row.className = "db-slider-row";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = labelText;
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "db-text-input";
        inp.placeholder = placeholder || "";
        inp.value = w?.value ?? "";
        inp.title = inp.value;
        inp.addEventListener("input", () => { if (w) { w.value = inp.value; inp.title = inp.value; } });
        row.append(lbl, inp);
        return { row, sync: () => { inp.value = w?.value ?? ""; inp.title = inp.value; } };
      }

      const prefixRow = makeTextRow("Filename", prefixWidget, "DirtyBirds");
      const fileRow = makeTextRow("Prompts file", fileWidget, "path to .txt");
      archiveRow.append(prefixRow.row, fileRow.row);

      panel.append(scriptLabel, posTA, negTA, toolsLabel, toyboxCols, booruWrap, archiveLabel, archiveRow);

      scriptPanelWidget = node.addDOMWidget("db_script_panel", "customhtml", panel, {
        serialize: false,
        height: 240,
        getMinHeight: () => Math.max(220, panel.scrollHeight || 220),
      });

      // ── Width sync ───────────────────────────────────────────────────────
      function applyWidths() {
        const w = nodeInnerW(node);
        panel.style.width = w + "px";
      }
      function syncPanelH() {
        applyWidths();
        requestAnimationFrame(() => {
          const h = Math.max(220, panel.scrollHeight || 220);
          if (scriptPanelWidget) {
            try { scriptPanelWidget.height = h; } catch (_) {}
            scriptPanelWidget.computedHeight = h;
          }
          node.size[1] = Math.max(300, h + 78);
          node.setDirtyCanvas(true, true);
        });
      }
      function applyLayout() {
        syncPanelH();
        node.setDirtyCanvas(true, true);
      }
      requestAnimationFrame(() => requestAnimationFrame(applyLayout));
      const origResize = node.onResize;
      node.onResize = function (size) { origResize?.call(this, size); applyLayout(); };

      // Re-sync styled inputs after a saved workflow restores widget values.
      const onConfigure = node.onConfigure;
      node.onConfigure = function () {
        onConfigure?.apply(this, arguments);
        requestAnimationFrame(() => {
          if (posWidget) posTA.value = posWidget.value || "";
          if (negWidget) negTA.value = negWidget.value || "";
          prefixRow.sync();
          fileRow.sync();
        });
      };
    };
  },
});

console.log("[DirtyBirds] Save — Image + Prompt UI module loaded");
