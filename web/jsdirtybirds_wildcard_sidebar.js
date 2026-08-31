/**
 * DirtyBirds Playhouse – Wildcards sidebar
 *
 * A native ComfyUI sidebar tab that browses every wildcard key under
 * user_files/wildcards/*.{txt,yaml,yml}: search, sort, a collapsible folder
 * tree, an inline entry preview, and click-to-copy tokens/entries. Polls
 * /dirtybirds/wildcard-helper/catalog every few seconds and only re-renders
 * when the file-fingerprint actually changes, so edits to a wildcard file
 * show up here without reopening ComfyUI.
 *
 * Behavior and structure are ported from PBandDev/comfyui-wildcard-helper
 * (AGPL-3.0-only, https://github.com/PBandDev/comfyui-wildcard-helper),
 * rewritten in plain JS against this project's own backend — there is no
 * Impact Pack "on-demand vs full cache" concept here, so that whole layer of
 * the original is gone; load_wildcard_dict() always has everything.
 */

import { app } from "../../../scripts/app.js";
import { ensureStylesheet, fetchJSON, makeTextarea } from "./db_shared.js";

ensureStylesheet();

const SIDEBAR_TAB_ID = "dirtybirds-wildcards";
const POLL_INTERVAL_MS = 5000;

// Folder-token convention already used by the "Load Wildcards" dropdown in
// jsdirtybirds_prompt.js: a bare trailing "*" (no "/"), which the engine's
// prefix-match special case expands to every key starting with that text.
function folderToken(path) {
  return `__${path}*__`;
}

function el(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase().replace(/\\/g, "/");
}

function filterItems(items, query) {
  const q = normalizeSearch(query);
  if (!q) return [...items].sort((a, b) => a.key.localeCompare(b.key));
  const tokens = q.split(/[\s/]+/).filter(Boolean);
  return items
    .filter((item) => {
      const haystack = normalizeSearch(
        [item.key, item.token, item.sourcePath, item.sourceType, item.segments.join("/")].join(" "),
      );
      return tokens.every((t) => haystack.includes(t));
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function getComparator(mode) {
  if (mode === "za") return (a, b) => b.key.localeCompare(a.key);
  if (mode === "type")
    return (a, b) => {
      const c = a.sourceType.localeCompare(b.sourceType);
      return c !== 0 ? c : a.key.localeCompare(b.key);
    };
  return (a, b) => a.key.localeCompare(b.key);
}

function buildCatalogTree(items, comparator) {
  const cmp = comparator || getComparator("az");
  const root = { name: "", path: "", folders: new Map(), items: [] };
  for (const item of [...items].sort(cmp)) {
    let cur = root;
    let path = "";
    const folderSegments = item.segments.slice(0, -1);
    for (const seg of folderSegments) {
      path = path ? `${path}/${seg}` : seg;
      let child = cur.folders.get(path);
      if (!child) {
        child = { name: seg, path, folders: new Map(), items: [] };
        cur.folders.set(path, child);
      }
      cur = child;
    }
    cur.items.push(item);
  }
  promoteMatchingItems(root);
  return freezeFolder(root, cmp);
}

// Move an item whose key equals a child folder's path into that folder
// (first slot) — e.g. an item literally keyed "clothing/casual" sits inside
// the "casual" folder instead of floating beside it.
function promoteMatchingItems(node) {
  for (const child of node.folders.values()) promoteMatchingItems(child);
  const remaining = [];
  for (const item of node.items) {
    const folder = node.folders.get(item.key);
    if (folder) folder.items.unshift(item);
    else remaining.push(item);
  }
  node.items = remaining;
}

function freezeFolder(node, cmp) {
  const folders = [...node.folders.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((c) => freezeFolder(c, cmp));
  const items = [...node.items].sort(cmp);
  const ownEntryCount = items.reduce((n, i) => n + (i.entryCount || 0), 0);
  return {
    name: node.name,
    path: node.path,
    folders,
    items,
    totalEntryCount: ownEntryCount + folders.reduce((n, f) => n + f.totalEntryCount, 0),
  };
}

function fallbackCopy(text) {
  const textarea = makeTextarea(text);
  textarea.setAttribute("readonly", "true");
  textarea.style.cssText = "position:fixed;opacity:0;";
  document.body.append(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {
    // best-effort only
  }
  textarea.remove();
}

async function copyText(text, toastLabel) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else fallbackCopy(text);
  } catch {
    fallbackCopy(text);
  }
  app.extensionManager?.toast?.add?.({
    severity: "success",
    summary: toastLabel || "Copied",
    detail: text.length > 60 ? text.slice(0, 57) + "..." : text,
    life: 2000,
  });
}

function mountWildcardSidebar(container) {
  const root = el("div", "db-wc");

  // ── Header ──────────────────────────────────────────────────────────
  const header = el("div", "db-wc-header");
  const title = el("h3", "db-wc-title");
  title.textContent = "Wildcards";
  const countBadge = el("span", "db-wc-badge");
  const sortBtn = el("button", "db-wc-btn", { type: "button", title: "Sort" });
  const foldersBtn = el("button", "db-wc-btn", { type: "button", title: "Folders first" });
  const refreshBtn = el("button", "db-wc-btn", { type: "button", title: "Refresh" });
  refreshBtn.textContent = "⟳";
  header.append(title, countBadge, sortBtn, foldersBtn, refreshBtn);

  // ── Search ──────────────────────────────────────────────────────────
  const searchWrap = el("div", "db-wc-search-wrap");
  const searchInput = el("input", "db-wc-search", {
    type: "search",
    placeholder: "Search wildcards...",
  });
  const searchCount = el("span", "db-wc-search-count");
  searchWrap.append(searchInput, searchCount);

  const message = el("div", "db-wc-message");
  message.hidden = true;

  const listPane = el("div", "db-wc-list");

  root.append(header, searchWrap, message, listPane);
  container.replaceChildren(root);

  // ── State ───────────────────────────────────────────────────────────
  let catalog = null; // {fingerprint, items}
  let sortMode = localStorage.getItem("db.wc.sortMode") || "az";
  let foldersFirst = localStorage.getItem("db.wc.foldersFirst") !== "false";
  const expandedFolders = new Set();
  let searchQuery = "";
  let selectedKey = null;
  let preview = null;
  let previewError = null;
  let previewRequestToken = 0;
  let disposed = false;
  let pollTimer = null;

  const SORT_LABELS = { az: "A–Z", za: "Z–A", type: "Type" };
  const SORT_CYCLE = ["az", "za", "type"];

  function paintToggles() {
    sortBtn.textContent = SORT_LABELS[sortMode];
    foldersBtn.textContent = foldersFirst ? "📁 first" : "📄 first";
    foldersBtn.title = foldersFirst ? "Folders first (click for files first)" : "Files first (click for folders first)";
  }
  paintToggles();

  sortBtn.addEventListener("click", () => {
    sortMode = SORT_CYCLE[(SORT_CYCLE.indexOf(sortMode) + 1) % SORT_CYCLE.length];
    localStorage.setItem("db.wc.sortMode", sortMode);
    paintToggles();
    render();
  });
  foldersBtn.addEventListener("click", () => {
    foldersFirst = !foldersFirst;
    localStorage.setItem("db.wc.foldersFirst", String(foldersFirst));
    paintToggles();
    render();
  });
  refreshBtn.addEventListener("click", () => void loadCatalog(true));
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    render();
  });

  async function loadCatalog(forceSpin) {
    if (forceSpin) refreshBtn.classList.add("db-wc-spin");
    try {
      const data = await fetchJSON("/dirtybirds/wildcard-helper/catalog");
      if (disposed) return;
      if (!data) {
        message.hidden = false;
        message.textContent = "Could not load the wildcard catalog.";
        return;
      }
      message.hidden = true;
      catalog = data;
      countBadge.textContent = `${data.items.length} keys`;
      render();
      if (selectedKey) await loadPreview(selectedKey, true);
    } finally {
      refreshBtn.classList.remove("db-wc-spin");
    }
  }

  async function loadPreview(key, force) {
    if (!force && selectedKey === key && preview?.key === key) return;
    const myToken = ++previewRequestToken;
    previewError = null;
    const data = await fetchJSON(`/dirtybirds/wildcard-helper/preview?key=${encodeURIComponent(key)}`);
    if (disposed || myToken !== previewRequestToken) return;
    if (!data || data.error) {
      previewError = data?.error || "Preview failed.";
      preview = null;
    } else {
      preview = data;
    }
    render();
  }

  function selectKey(key) {
    if (selectedKey === key) {
      selectedKey = null;
      preview = null;
      previewError = null;
      render();
      return;
    }
    selectedKey = key;
    preview = null;
    previewError = null;
    render();
    void loadPreview(key);
  }

  function render() {
    if (!catalog) {
      listPane.replaceChildren(emptyState("Loading wildcards..."));
      searchCount.textContent = "";
      return;
    }

    const filtered = filterItems(catalog.items, searchQuery);
    searchCount.textContent = searchQuery ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}` : "";

    if (filtered.length === 0) {
      listPane.replaceChildren(emptyState(catalog.items.length === 0 ? "No wildcard files found." : "No wildcards match your search."));
      return;
    }

    const tree = buildCatalogTree(filtered, getComparator(sortMode));
    const fragment = document.createDocumentFragment();

    const renderFiles = () => tree.items.forEach((item) => fragment.append(renderItem(item)));
    const renderFolders = () => tree.folders.forEach((folder) => fragment.append(renderFolder(folder, 0)));

    if (foldersFirst) {
      renderFolders();
      renderFiles();
    } else {
      renderFiles();
      renderFolders();
    }

    listPane.replaceChildren(fragment);
  }

  function emptyState(text) {
    const e = el("div", "db-wc-empty");
    e.textContent = text;
    return e;
  }

  function renderFolder(folder, depth) {
    const section = el("div", "db-wc-folder");
    const expanded = expandedFolders.has(folder.path);

    const row = el("div", "db-wc-folder-row");
    row.style.paddingLeft = `${depth * 12 + 4}px`;

    const toggle = el("button", "db-wc-folder-toggle", { type: "button" });
    toggle.textContent = (expanded ? "▾ " : "▸ ") + folder.name;
    toggle.title = folder.path;
    toggle.addEventListener("click", () => {
      if (expandedFolders.has(folder.path)) expandedFolders.delete(folder.path);
      else expandedFolders.add(folder.path);
      render();
    });

    const count = el("span", "db-wc-folder-count");
    count.textContent = `${folder.totalEntryCount} entries`;

    const copyBtn = el("button", "db-wc-btn db-wc-copy", { type: "button", title: folderToken(folder.path) });
    copyBtn.textContent = "📋";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void copyText(folderToken(folder.path), "Copied folder token");
    });

    row.append(toggle, count, copyBtn);
    section.append(row);

    if (expanded) {
      const inner = el("div", "db-wc-folder-content");
      folder.items.forEach((item) => inner.append(renderItem(item, depth + 1)));
      folder.folders.forEach((child) => inner.append(renderFolder(child, depth + 1)));
      section.append(inner);
    }

    return section;
  }

  function renderItem(item, depth) {
    const fragment = document.createDocumentFragment();
    const row = el("button", "db-wc-item", { type: "button" });
    if (depth) row.style.paddingLeft = `${depth * 12 + 4}px`;
    if (selectedKey === item.key) row.classList.add("db-wc-item-selected");
    row.addEventListener("click", () => selectKey(item.key));

    const text = el("div", "db-wc-item-text");
    const token = el("div", "db-wc-item-token");
    token.textContent = item.token;
    const meta = el("div", "db-wc-item-meta");
    meta.textContent = `${item.sourceType.toUpperCase()} · ${item.entryCount} entr${item.entryCount === 1 ? "y" : "ies"}`;
    text.append(token, meta);

    const copyBtn = el("button", "db-wc-btn db-wc-copy", { type: "button", title: `Copy ${item.token}` });
    copyBtn.textContent = "📋";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void copyText(item.token, "Copied token");
    });

    row.append(text, copyBtn);
    fragment.append(row);

    if (selectedKey === item.key) fragment.append(renderDetail());
    return fragment;
  }

  function renderDetail() {
    const wrap = el("div", "db-wc-detail");
    if (previewError) {
      const err = el("div", "db-wc-detail-error");
      err.textContent = previewError;
      wrap.append(err);
      return wrap;
    }
    if (!preview) {
      const loading = el("div", "db-wc-detail-loading");
      loading.textContent = "Loading preview...";
      wrap.append(loading);
      return wrap;
    }
    const summary = el("div", "db-wc-detail-summary");
    summary.textContent = `${preview.totalEntries} entr${preview.totalEntries === 1 ? "y" : "ies"}${preview.truncated ? ` (showing ${preview.previewEntries.length})` : ""}`;
    wrap.append(summary);

    const list = el("div", "db-wc-detail-list");
    preview.previewEntries.forEach((entryText) => {
      const entryEl = el("div", "db-wc-detail-entry");
      entryEl.textContent = entryText;
      entryEl.title = "Click to copy";
      entryEl.addEventListener("click", () => void copyText(entryText, "Copied entry"));
      list.append(entryEl);
    });
    wrap.append(list);
    return wrap;
  }

  void loadCatalog(false);
  pollTimer = setInterval(async () => {
    if (disposed || !root.isConnected) return;
    const status = await fetchJSON("/dirtybirds/wildcard-helper/catalog");
    if (disposed || !status) return;
    if (!catalog || status.fingerprint !== catalog.fingerprint) {
      catalog = status;
      countBadge.textContent = `${status.items.length} keys`;
      render();
      if (selectedKey) await loadPreview(selectedKey, true);
    }
  }, POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
    container.replaceChildren();
  };
}

app.registerExtension({
  name: "DirtyBirds.WildcardSidebar",
  setup() {
    let cleanup;
    app.extensionManager?.registerSidebarTab?.({
      id: SIDEBAR_TAB_ID,
      title: "Wildcards",
      tooltip: "Browse and copy DirtyBirds wildcard tokens",
      icon: "pi pi-book",
      type: "custom",
      render: (container) => {
        cleanup?.();
        cleanup = mountWildcardSidebar(container);
      },
      destroy: () => {
        cleanup?.();
        cleanup = undefined;
      },
    });
  },
});
