/**
 * DirtyBirds Playhouse - Save: The Archive node UI.
 *
 * Displays the final prompt as markdown, saves the generated image through the
 * backend node execution, and saves prompt text only when the user clicks Save
 * Prompt.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW, makeSectionLabel, hideWidget, makeCollapsibleSectionLabel } from "./db_shared.js";

ensureStylesheet();

function splitPromptPath(path) {
  const value = (path || "").trim();
  const idx = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  if (idx < 0) return { folder: "", filename: value };
  return { folder: value.slice(0, idx), filename: value.slice(idx + 1) };
}

function joinPromptPath(folder, filename) {
  const dir = (folder || "").trim().replace(/[\\\/]+$/, "");
  const name = (filename || "").trim();
  if (!dir) return name;
  if (!name) return dir;
  return dir + "\\" + name;
}

function markdownPrompt(positive, negative) {
  const pos = (positive || "").trim();
  const neg = (negative || "").trim();
  return [
    "## Positive",
    pos || "_empty_",
    "",
    "## Negative",
    neg || "_empty_",
  ].join("\n");
}

function showPromptBrowser(startPath, onPickFolder, onPickFile) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "db-flyout-overlay";
  const panel = document.createElement("div");
  panel.className = "db-flyout";
  panel.style.width = "min(520px, 92vw)";
  panel.style.left = Math.max(20, (window.innerWidth - 520) / 2) + "px";
  panel.style.top = Math.max(40, window.innerHeight / 2 - 260) + "px";

  const header = document.createElement("div");
  header.className = "db-flyout-header";
  const title = document.createElement("span");
  title.className = "db-flyout-title";
  title.textContent = "Prompt Folder";
  const closeBtn = document.createElement("button");
  closeBtn.className = "db-flyout-close";
  closeBtn.textContent = "x";
  header.append(title, closeBtn);

  const pathEl = document.createElement("div");
  pathEl.className = "db-url-tools-status";
  pathEl.style.cssText = "padding:6px 10px;word-break:break-all;white-space:normal;";

  const actions = document.createElement("div");
  actions.className = "db-url-tools-row";
  actions.style.cssText = "padding:0 10px 8px;";
  const useFolderBtn = document.createElement("button");
  useFolderBtn.className = "db-lib-btn db-lora-add-open-btn";
  useFolderBtn.textContent = "Use Folder";
  actions.append(useFolderBtn);

  const list = document.createElement("div");
  list.className = "db-flyout-list";
  list.style.cssText = "max-height:58vh;overflow:auto;";
  panel.append(header, pathEl, actions, list);

  let currentPath = startPath || "";
  function close() { overlay.remove(); panel.remove(); }
  function addRow(label, titleText, onClick) {
    const row = document.createElement("div");
    row.className = "db-res-opt";
    const text = document.createElement("span");
    text.className = "db-res-opt-label";
    text.textContent = label;
    text.title = titleText || label;
    row.append(text);
    row.addEventListener("click", onClick);
    list.append(row);
  }
  async function load(path) {
    list.textContent = "";
    pathEl.textContent = "Loading...";
    const data = await fetchJSON(`/dirtybirds/saveprompt-browse?path=${encodeURIComponent(path || "")}`);
    if (!data || data.error) {
      pathEl.textContent = data?.error || "Could not load folder.";
      return;
    }
    currentPath = data.path || "";
    pathEl.textContent = currentPath;
    if (data.parent) addRow("..", data.parent, () => load(data.parent));
    (data.dirs || []).forEach((name) => {
      const child = joinPromptPath(currentPath, name);
      addRow("[Folder] " + name, child, () => load(child));
    });
    (data.files || []).forEach((name) => {
      addRow(name, joinPromptPath(currentPath, name), () => {
        onPickFile?.(currentPath, name);
        close();
      });
    });
  }
  useFolderBtn.addEventListener("click", () => { onPickFolder?.(currentPath); close(); });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
  load(currentPath);
}

app.registerExtension({
  name: "DirtyBirds.Archive",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsSavePrompt") return;

    // The saved image renders in this node's own "Saved Image" panel. As an
    // OUTPUT_NODE the frontend also attaches its native "$$canvas-image-preview"
    // widget, which draws the images at the node's foot (outside our panel).
    // Suppress that native preview entirely so the image only shows under the
    // heading. (onDrawBackground is where core re-adds the widget.)
    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
      const ws = this.widgets;
      if (Array.isArray(ws)) {
        const i = ws.findIndex(w => w?.name === "$$canvas-image-preview");
        if (i > -1) { ws[i].onRemove?.(); ws.splice(i, 1); }
      }
      this.imgs = null;
      this.preview = null;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const prompts = message?.db_prompts_md;
      if (Array.isArray(prompts)) {
        this._dbArchivePositive = prompts[0] || "";
        this._dbArchiveNegative = prompts[1] || "";
        this._dbArchivePaint?.();
      }
      const imgs = message?.images;
      if (Array.isArray(imgs)) this._dbArchivePaintImages?.(imgs);
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = Math.max(node.size[0] || 0, 420);

      const staleWidgets = new Set(["db_script_panel", "db_save_title", "db_save_prefix", "db_save_file"]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      const posWidget = hideWidget(node, "positive");
      const negWidget = hideWidget(node, "negative");
      const prefixWidget = hideWidget(node, "filename_prefix");
      const fileWidget = hideWidget(node, "prompts_file");

      const panel = document.createElement("div");
      panel.className = "db-archive-panel";

      const promptBox = document.createElement("textarea");
      promptBox.className = "db-script-textarea db-archive-markdown";
      promptBox.readOnly = true;
      promptBox.spellcheck = false;

      const imageLabel = makeSectionLabel("Saved Image");
      const imagePanel = document.createElement("div");
      imagePanel.className = "db-url-preview db-archive-image";
      imagePanel.style.display = "none";
      const previewContent = document.createElement("div");
      previewContent.className = "db-collapsible-content";
      previewContent.style.display = "none";
      previewContent.append(promptBox, imageLabel, imagePanel);
      const previewSection = makeCollapsibleSectionLabel("Saved Output", {
        expanded: false,
        onChange: (expanded) => {
          previewContent.style.display = expanded ? "flex" : "none";
          requestAnimationFrame(() => {
            node.setSize(node.computeSize());
            node.setDirtyCanvas(true, true);
          });
        },
      });

      const archiveLabel = makeSectionLabel("The Archive");
      const archiveRow = document.createElement("div");
      archiveRow.className = "db-archive-settings";

      function makeTextRow(labelText, widget, placeholder) {
        const row = document.createElement("div");
        row.className = "db-slider-row";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = labelText;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "db-text-input";
        input.placeholder = placeholder || "";
        input.value = widget?.value ?? "";
        input.addEventListener("input", () => {
          if (widget) widget.value = input.value;
          input.title = input.value;
          node.setDirtyCanvas(true, true);
        });
        row.append(lbl, input);
        return { row, input, sync: () => { input.value = widget?.value ?? ""; input.title = input.value; } };
      }

      const prefixRow = makeTextRow("Filename", prefixWidget, "DirtyBirds");
      const initialPromptPath = splitPromptPath(fileWidget?.value || "");
      const folderRow = document.createElement("div");
      folderRow.className = "db-slider-row";
      folderRow.style.justifyContent = "space-between";
      folderRow.style.gap = "8px";
      const folderLabel = document.createElement("span");
      folderLabel.className = "db-slider-label";
      folderLabel.textContent = "Folder";
      const folderInput = document.createElement("input");
      folderInput.type = "text";
      folderInput.className = "db-text-input";
      folderInput.value = initialPromptPath.folder;
      const browseBtn = document.createElement("button");
      browseBtn.className = "db-lib-btn db-lora-add-open-btn";
      browseBtn.textContent = "Browse";
      browseBtn.style.flex = "0 0 72px";
      folderRow.append(folderLabel, folderInput, browseBtn);

      const fileRow = document.createElement("div");
      fileRow.className = "db-slider-row";
      fileRow.style.justifyContent = "space-between";
      fileRow.style.gap = "8px";
      const fileLabel = document.createElement("span");
      fileLabel.className = "db-slider-label";
      fileLabel.textContent = "Prompt file";
      const fileInput = document.createElement("input");
      fileInput.type = "text";
      fileInput.className = "db-text-input";
      fileInput.placeholder = "my_prompts.txt";
      fileInput.value = initialPromptPath.filename;
      fileRow.append(fileLabel, fileInput);

      const savePromptBtn = document.createElement("button");
      savePromptBtn.className = "db-lib-btn db-lora-add-open-btn db-archive-save-btn";
      savePromptBtn.textContent = "Save Prompt";
      const status = document.createElement("div");
      status.className = "db-url-tools-status";

      function fullPromptPath() {
        return joinPromptPath(folderInput.value, fileInput.value);
      }
      function syncPromptFile() {
        if (fileWidget) fileWidget.value = fullPromptPath();
        status.title = fileWidget?.value || "";
        node.setDirtyCanvas(true, true);
      }
      folderInput.addEventListener("input", syncPromptFile);
      fileInput.addEventListener("input", syncPromptFile);
      browseBtn.addEventListener("click", () => {
        showPromptBrowser(folderInput.value, (folder) => {
          folderInput.value = folder;
          syncPromptFile();
          syncPanelH();
        }, (folder, filename) => {
          folderInput.value = folder;
          fileInput.value = filename;
          syncPromptFile();
          syncPanelH();
        });
      });

      savePromptBtn.addEventListener("click", async () => {
        // Pull prompt from Dirty Talk node if Archive's own inputs are empty.
        let positive = (posWidget?.value || node._dbArchivePositive || "").trim();
        if (!positive) {
          const dt = (app.graph?._nodes || []).find(
            (n) => n.comfyClass === "DirtyBirdsPrompt" || n.type === "DirtyBirdsPrompt"
          );
          if (dt) {
            positive = (dt._dbResolvedPositive || dt._dbPositiveTextarea?.value || dt.widgets?.find(w => w.name === "positive")?.value || "").trim();
          }
        }
        if (!positive) {
          status.textContent = "Positive prompt is empty.";
          status.dataset.tone = "err";
          syncPanelH();
          return;
        }
        status.textContent = "Saving...";
        status.dataset.tone = "";
        const data = await fetchJSON("/dirtybirds/archive-save-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positive, negative: negWidget?.value || node._dbArchiveNegative || "", prompts_file: fullPromptPath() }),
        });
        if (data?.ok) {
          status.textContent = "Saved to " + (data.path || "prompt file");
          status.dataset.tone = "ok";
        } else {
          status.textContent = data?.error || "Save failed.";
          status.dataset.tone = "err";
        }
        syncPanelH();
      });

      archiveRow.append(prefixRow.row, folderRow, fileRow, savePromptBtn, status);
      panel.append(archiveLabel, archiveRow, previewSection.label, previewContent);
      syncPromptFile();

      const panelWidget = node.addDOMWidget("db_archive_panel", "customhtml", panel, {
        serialize: false,
        height: 320,
        getMinHeight: () => previewSection.isExpanded() ? 420 : 210,
      });

      node._dbArchivePaint = () => {
        let positive = posWidget?.value || node._dbArchivePositive || "";
        let negative = negWidget?.value || node._dbArchiveNegative || "";
        if (!positive.trim()) {
          const dt = (app.graph?._nodes || []).find(
            (n) => n.comfyClass === "DirtyBirdsPrompt" || n.type === "DirtyBirdsPrompt"
          );
          if (dt) {
            positive = dt._dbResolvedPositive || dt._dbPositiveTextarea?.value || dt.widgets?.find(w => w.name === "positive")?.value || "";
            negative = negative || dt._dbResolvedNegative || dt._dbNegativeTextarea?.value || dt.widgets?.find(w => w.name === "negative")?.value || "";
          }
        }
        promptBox.value = markdownPrompt(positive, negative);
        syncPanelH();
      };

      node._dbArchivePaintImages = (imgs) => {
        imagePanel.innerHTML = "";
        if (!imgs || !imgs.length) {
          imagePanel.style.display = "none";
          syncPanelH();
          return;
        }
        const img = document.createElement("img");
        const info = imgs[imgs.length - 1];
        const q = `filename=${encodeURIComponent(info.filename)}&subfolder=${encodeURIComponent(info.subfolder || "")}&type=${encodeURIComponent(info.type || "output")}&rand=${Date.now()}`;
        img.src = `/view?${q}`;
        img.onload = syncPanelH;
        imagePanel.append(img);
        imagePanel.style.display = "flex";
        syncPanelH();
      };

      function applyWidths() {
        panel.style.width = nodeInnerW(node) + "px";
      }
      function syncPanelH() {
        if (node._dbArchiveSizing) return;
        applyWidths();
        requestAnimationFrame(() => {
          node._dbArchiveSizing = true;
          const h = Math.max(260, panel.scrollHeight || 260);
          try { panelWidget.height = h; } catch (_) {}
          panelWidget.computedHeight = h;
          const nodeH = Math.max(330, h + 58);
          if (Math.abs((node.size?.[1] || 0) - nodeH) > 2) {
            if (typeof node.setSize === "function") node.setSize([node.size[0], nodeH]);
            else node.size[1] = nodeH;
          }
          node.setDirtyCanvas(true, true);
          node._dbArchiveSizing = false;
        });
      }

      const origResize = node.onResize;
      node.onResize = function (size) {
        if (size[0] < 420) size[0] = 420;
        origResize?.call(this, size);
        syncPanelH();
      };

      const onConfigure = node.onConfigure;
      node.onConfigure = function () {
        onConfigure?.apply(this, arguments);
        requestAnimationFrame(() => {
          prefixRow.sync();
          const parts = splitPromptPath(fileWidget?.value || "");
          folderInput.value = parts.folder;
          fileInput.value = parts.filename;
          node._dbArchivePaint();
          syncPromptFile();
        });
      };

      requestAnimationFrame(() => requestAnimationFrame(() => {
        node._dbArchivePaint();
        syncPanelH();
      }));
    };
  },
});
