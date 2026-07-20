/**
 * DirtyBirds Playhouse — Prompt Builder shared helpers.
 *
 * Module-scope helpers extracted from jsdirtybirds_prompt.js: markdown/HTML
 * escaping, the options flyout, textarea utilities, and the tag/LoRA/embedding
 * autocomplete cluster (with its own private state). Imported by the main
 * Prompt Builder extension so that file can focus on the node UI.
 */

import { fetchJSON, makeButton } from "./db_shared.js";

export const REFRESH = "🔄  Refresh list";

export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function promptToMarkdown(label, value) {
  const text = String(value || "").trim();
  return `### ${label}${text ? `\n${text}` : ""}`;
}

export function renderMarkdownText(value) {
  return escapeHTML(value)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\n/g, "<br>");
}

export function showOptionsFlyout(title, options, current, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel = document.createElement("div"); panel.className = "db-flyout";
  panel.style.left = Math.min(window.innerWidth / 2, window.innerWidth - 300) + "px";
  panel.style.top = Math.max(40, window.innerHeight / 2 - 120) + "px";

  const header = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = makeButton("✕", null, "db-flyout-close");
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

export function insertAtCursor(textarea, widget, token) {
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

export function syncTextareaToWidget(textarea, widget, node) {
  if (!textarea || !widget) return;
  widget.value = textarea.value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  node?.setDirtyCanvas?.(true, true);
}


export function handleAutocompleteInput(event, textarea, node) {
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

export function handleAutocompleteKeydown(event, textarea) {
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
