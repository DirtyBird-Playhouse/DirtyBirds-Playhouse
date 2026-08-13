/**
 * DirtyBirds Playhouse - 💾 Save Image & Prompt node UI.
 *
 * Displays the final prompt as markdown, saves the generated image through the
 * backend node execution, and saves prompt text only when the user clicks Save
 * Prompt.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  fetchJSON,
  nodeInnerW,
  makeSectionLabel,
  hideWidget,
  makeCollapsibleSectionLabel,
  makeButton,
  makeTextarea,
  makeInput,
  openImageViewer,
  reserveHeight,
  DOM_WIDGET_CHROME,
} from "./db_shared.js";

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

function markdownPrompt(positive, negative, settings) {
  const pos = (positive || "").trim();
  const neg = (negative || "").trim();
  const set = (settings || "").trim();
  const lines = [
    "## Positive",
    pos || "_empty_",
    "",
    "## Negative",
    neg || "_empty_",
  ];
  // Settings only appear once a run has reported them — 🎲 Random's rolled
  // resolution among them, which nothing else records.
  if (set) lines.push("", "## Settings", set);
  return lines.join("\n");
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
  const closeBtn = makeButton();
  closeBtn.className = "db-flyout-close";
  closeBtn.textContent = "x";
  header.append(title, closeBtn);

  const pathEl = document.createElement("div");
  pathEl.className = "db-url-tools-status";
  pathEl.style.cssText =
    "padding:6px 10px;word-break:break-all;white-space:normal;";

  const actions = document.createElement("div");
  actions.className = "db-url-tools-row";
  actions.style.cssText = "padding:0 10px 8px;";
  const useFolderBtn = makeButton();
  useFolderBtn.className = "db-lib-btn db-lora-add-open-btn";
  useFolderBtn.textContent = "Use Folder";
  actions.append(useFolderBtn);

  const list = document.createElement("div");
  list.className = "db-flyout-list";
  list.style.cssText = "max-height:58vh;overflow:auto;";
  panel.append(header, pathEl, actions, list);

  let currentPath = startPath || "";
  function close() {
    overlay.remove();
    panel.remove();
  }
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
    const data = await fetchJSON(
      `/dirtybirds/saveprompt-browse?path=${encodeURIComponent(path || "")}`,
    );
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
  useFolderBtn.addEventListener("click", () => {
    onPickFolder?.(currentPath);
    close();
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
  load(currentPath);
}

app.registerExtension({
  name: "DirtyBirds.SavePrompt",

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
        const i = ws.findIndex((w) => w?.name === "$$canvas-image-preview");
        if (i > -1) {
          ws[i].onRemove?.();
          ws.splice(i, 1);
        }
      }
      this.imgs = null;
      this.preview = null;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const prompts = message?.db_prompts_md;
      const settings = message?.db_settings_md;
      if (Array.isArray(settings)) this._dbSaveSettings = settings[0] || "";
      if (Array.isArray(prompts)) {
        this._dbSavePositive = prompts[0] || "";
        this._dbSaveNegative = prompts[1] || "";
        this._dbSavePaint?.();
      }
      const imgs = message?.images;
      if (Array.isArray(imgs)) this._dbSavePaintImages?.(imgs);
      // A run just delivered a result -> reveal it (the panel is collapsed by
      // default, which otherwise makes a successful save look like it did nothing).
      if (Array.isArray(prompts) || Array.isArray(imgs))
        this._dbSaveReveal?.();
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;

      const staleWidgets = new Set([
        "db_script_panel",
        "db_save_title",
        "db_save_prefix",
        "db_save_file",
      ]);
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
      panel.className = "db-saveprompt-panel";

      const promptBox = makeTextarea();
      promptBox.className = "db-script-textarea db-saveprompt-markdown";
      promptBox.readOnly = true;
      promptBox.spellcheck = false;

      const imageLabel = makeSectionLabel("Saved Image");
      const imagePanel = document.createElement("div");
      imagePanel.className = "db-url-preview db-saveprompt-image";
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

      const saveLabel = makeSectionLabel("Save Location");
      const saveRow = document.createElement("div");
      saveRow.className = "db-saveprompt-settings";

      function makeTextRow(labelText, widget, placeholder) {
        const row = document.createElement("div");
        row.className = "db-slider-row";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = labelText;
        const input = makeInput();
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
        return {
          row,
          input,
          sync: () => {
            input.value = widget?.value ?? "";
            input.title = input.value;
          },
        };
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
      const folderInput = makeInput();
      folderInput.type = "text";
      folderInput.className = "db-text-input";
      folderInput.value = initialPromptPath.folder;
      const browseBtn = makeButton();
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
      const fileInput = makeInput();
      fileInput.type = "text";
      fileInput.className = "db-text-input";
      fileInput.placeholder = "my_prompts.txt";
      fileInput.value = initialPromptPath.filename;
      fileRow.append(fileLabel, fileInput);

      const savePromptBtn = makeButton();
      savePromptBtn.className =
        "db-lib-btn db-lora-add-open-btn db-saveprompt-save-btn";
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
        showPromptBrowser(
          folderInput.value,
          (folder) => {
            folderInput.value = folder;
            syncPromptFile();
            syncPanelH();
          },
          (folder, filename) => {
            folderInput.value = folder;
            fileInput.value = filename;
            syncPromptFile();
            syncPanelH();
          },
        );
      });

      savePromptBtn.addEventListener("click", async () => {
        // Pull prompt from Prompt Builder if this node's own inputs are empty.
        let positive = (
          posWidget?.value ||
          node._dbSavePositive ||
          ""
        ).trim();
        if (!positive) {
          const dt = (app.graph?._nodes || []).find(
            (n) =>
              n.comfyClass === "DirtyBirdsPrompt" ||
              n.type === "DirtyBirdsPrompt",
          );
          if (dt) {
            positive = (
              dt._dbResolvedPositive ||
              dt._dbPositiveTextarea?.value ||
              dt.widgets?.find((w) => w.name === "positive")?.value ||
              ""
            ).trim();
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
        const data = await fetchJSON("/dirtybirds/saveprompt-write-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positive,
            negative: negWidget?.value || node._dbSaveNegative || "",
            prompts_file: fullPromptPath(),
          }),
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

      saveRow.append(
        prefixRow.row,
        folderRow,
        fileRow,
        savePromptBtn,
        status,
      );
      panel.append(
        saveLabel,
        saveRow,
        previewSection.label,
        previewContent,
      );
      syncPromptFile();

      // Hand-maintained CONTENT heights, because nothing measures the panel any
      // more. They are reserved through reserveHeight() below, so they stay
      // honest numbers about what the rows need.
      //   COLLAPSED  "Save Location" 16 + settings block 132 + "Saved Output" 16
      //              + two 6px gaps                                       = 176
      //   EXPANDED   + prompt textarea 110 + "Saved Image" 16 + gaps      = 314
      //   WITH_IMAGE + the saved image thumbnail 150 + gap                = 470
      // Adding a row to the panel means bumping these. They were re-measured by
      // hand in a live ComfyUI (the same way the constants in jsdirtybirds.js
      // were); the old 210/420/620 were guesses that left the Save Prompt button
      // and the status line drawn through the foot of the node.
      const PANEL_COLLAPSED = 176;
      const PANEL_EXPANDED = 314;
      const PANEL_WITH_IMAGE = 470;
      let hasImage = false;
      const panelMinHeight = () => {
        if (!previewSection.isExpanded()) return PANEL_COLLAPSED;
        return hasImage ? PANEL_WITH_IMAGE : PANEL_EXPANDED;
      };

      // Node height above and below the panel: the title bar, the node's own
      // padding, and ComfyUI's per-widget chrome. syncPanelH's floor uses the
      // same number, so "how tall must the node be" and "how tall may the panel
      // be" stay one fact rather than two that can drift.
      const PANEL_CHROME_H = 58 + DOM_WIDGET_CHROME;

      const panelWidget = node.addDOMWidget(
        "db_saveprompt_panel",
        "customhtml",
        panel,
        {
          serialize: false,
          height: reserveHeight(PANEL_EXPANDED),
          getMinHeight: () => reserveHeight(panelMinHeight()),
        },
      );

      node._dbSavePaint = () => {
        let positive = posWidget?.value || node._dbSavePositive || "";
        let negative = negWidget?.value || node._dbSaveNegative || "";
        if (!positive.trim()) {
          const dt = (app.graph?._nodes || []).find(
            (n) =>
              n.comfyClass === "DirtyBirdsPrompt" ||
              n.type === "DirtyBirdsPrompt",
          );
          if (dt) {
            positive =
              dt._dbResolvedPositive ||
              dt._dbPositiveTextarea?.value ||
              dt.widgets?.find((w) => w.name === "positive")?.value ||
              "";
            negative =
              negative ||
              dt._dbResolvedNegative ||
              dt._dbNegativeTextarea?.value ||
              dt.widgets?.find((w) => w.name === "negative")?.value ||
              "";
          }
        }
        promptBox.value = markdownPrompt(
          positive,
          negative,
          node._dbSaveSettings,
        );
        syncPanelH();
      };

      node._dbSaveReveal = () => {
        if (!previewSection.isExpanded()) previewSection.setExpanded(true);
      };

      node._dbSavePaintImages = (imgs) => {
        imagePanel.innerHTML = "";
        hasImage = Boolean(imgs && imgs.length);
        if (!hasImage) {
          imagePanel.style.display = "none";
          syncPanelH();
          return;
        }
        // Every image in the batch, not just the last one. A batch of two used
        // to render one and silently drop the other. More than one gets a
        // horizontal strip you can scroll; a single image fills the panel as
        // before.
        const rand = Date.now();
        const rendered = [];
        imgs.forEach((info, index) => {
          const img = document.createElement("img");
          const q = `filename=${encodeURIComponent(info.filename)}&subfolder=${encodeURIComponent(info.subfolder || "")}&type=${encodeURIComponent(info.type || "output")}&rand=${rand}`;
          img.src = `/view?${q}`;
          if (index === 0) img.onload = syncPanelH;
          // Same gesture as ComfyUI's Preview Image node. The whole batch is
          // handed over so the gallery can page through it from wherever you
          // opened it.
          img.style.cursor = "zoom-in";
          img.title =
            imgs.length > 1
              ? `Image ${index + 1} of ${imgs.length} — double-click to view full size`
              : "Double-click to view full size";
          img.addEventListener("dblclick", () =>
            openImageViewer(node, rendered, index),
          );
          rendered.push(img);
          imagePanel.append(img);
        });
        imagePanel.classList.toggle("db-saveprompt-image-strip", imgs.length > 1);
        imagePanel.style.display = "flex";
        syncPanelH();
      };

      // Width, and the height the panel is allowed to occupy. Dragging the node
      // taller used to change neither: the panel stayed at its getMinHeight and
      // the extra height became blank space under it, so the preview appeared to
      // ignore the resize handle entirely.
      //
      // This reads the node's size and writes the panel's — never the reverse —
      // so it cannot re-enter the way the old scrollHeight measurement did.
      function applyWidths() {
        panel.style.width = nodeInnerW(node) + "px";
        // Fill the slot ComfyUI actually gave this widget, which is its reserved
        // height less the frontend's per-widget chrome. Deriving the panel height
        // from the node's size instead — which is what this did — overshoots that
        // slot by exactly DOM_WIDGET_CHROME, and the overshoot is drawn through
        // the bottom of the node. `computedHeight` is a number ComfyUI computed,
        // not a DOM measurement, so reading it cannot start a resize loop.
        const slot = Math.max(
          panelMinHeight(),
          (Number(panelWidget?.computedHeight) || 0) - DOM_WIDGET_CHROME,
        );
        panel.style.height = slot + "px";
      }

      // Width only. This used to measure panel.scrollHeight and setSize the node
      // to match, from inside onResize — so every drag of the resize handle was
      // immediately overwritten by the measured height, which is what made the
      // node look like it refused to resize and snapped back.
      //
      // The height floor now comes from the getMinHeight constants above, the
      // same hand-maintained approach the rest of the pack uses. Drag it as tall
      // as you like; it will not fight back.
      function syncPanelH() {
        applyWidths();
        // One-shot floor so the node grows when the saved image first appears.
        // Only ever grows, and is never reached from onResize, so it cannot
        // fight the resize handle the way the old measurement did.
        const floor = panelMinHeight() + PANEL_CHROME_H;
        if ((node.size?.[1] || 0) < floor)
          node.setSize?.([node.size[0], floor]);
        node.setDirtyCanvas(true, true);
      }

      const origResize = node.onResize;
      node.onResize = function (size) {
        origResize?.call(this, size);
        applyWidths();
      };

      const onConfigure = node.onConfigure;
      node.onConfigure = function () {
        onConfigure?.apply(this, arguments);
        requestAnimationFrame(() => {
          prefixRow.sync();
          const parts = splitPromptPath(fileWidget?.value || "");
          folderInput.value = parts.folder;
          fileInput.value = parts.filename;
          node._dbSavePaint();
          syncPromptFile();
        });
      };

      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          node._dbSavePaint();
          syncPanelH();
        }),
      );
    };
  },
});
