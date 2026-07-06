/**
 * DirtyBirds Playhouse — Image Loader node UI.
 *
 * Image loader with upload/URL input, native preview, and optional resize.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  makeSectionLabel,
  makeCollapsibleSectionLabel,
  makeSlider,
  hideWidget,
  nodeInnerW,
} from "./db_shared.js";

ensureStylesheet();

function hideNative(node, name) {
  const w = node.widgets?.find((widget) => widget.name === name);
  if (!w) return undefined;
  hideWidget(node, name);
  return w;
}

function removeWidget(node, w) {
  const i = node.widgets?.indexOf(w);
  if (i >= 0) {
    w.element?.remove?.();
    node.widgets.splice(i, 1);
  }
}

function clearDefaultImageWidget(node) {
  const imageWidget = node.widgets?.find((widget) => widget.name === "image");
  if (!imageWidget) return;
  const value = String(imageWidget.value || "");
  const values = imageWidget.options?.values || imageWidget.options?.items || [];
  const firstRealValue = Array.isArray(values) ? values.find((item) => String(item || "").trim()) : "";
  const looksAutoSelected = value && value === firstRealValue;
  if (!looksAutoSelected && value.toLowerCase() !== "example.png") return;

  imageWidget.value = "";
  if (imageWidget.inputEl) imageWidget.inputEl.value = "";
  if (imageWidget.element?.value !== undefined) imageWidget.element.value = "";
  node.imgs = [];
  node.imageIndex = null;
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "DirtyBirds.LoadImage",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsLoadImage") return;

    // The stock Load Image renderer paints node.imgs into unused canvas space.
    // This node owns its preview inside the DOM panel, so suppress that second,
    // blurry canvas copy while retaining node.imgs for other DirtyBirds tools.
    const origDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
      if (!this._dbOwnsImagePreview) return origDrawBackground?.apply(this, arguments);
      const imgs = this.imgs;
      this.imgs = undefined;
      try {
        return origDrawBackground?.apply(this, arguments);
      } finally {
        this.imgs = imgs;
      }
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = Math.max(node.size[0] || 0, 300);

      const staleWidgets = new Set(["db_image_tools_panel"]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      const imageWidget = node.widgets?.find((w) => w.name === "image");
      const imageUrlWidget = hideNative(node, "image_url");
      const resizeWidget = hideNative(node, "resize");
      const resizeModeWidget = hideNative(node, "resize_mode");
      const resizeMaxWidget = hideNative(node, "resize_max");
      const resizeWidthWidget = hideNative(node, "resize_width");
      const resizeHeightWidget = hideNative(node, "resize_height");
      hideNative(node, "allow_upscale"); // legacy serialized workflows
      const sharpenWidget = hideNative(node, "sharpen");
      // Numeric widgets (resize_max/width/height, sharpen strength, …) are
      // guarded against serializing "" centrally in db_shared's hideWidget.

      function hideStockWidgets() {
        hideNative(node, "image");
        for (const w of [...(node.widgets || [])]) {
          if (w === imageWidget) continue;
          const nm = String(w.name || "");
          if (/upload|choose file/i.test(nm) || (w.type === "button" && !w.element)) {
            removeWidget(node, w);
          }
        }
      }
      hideStockWidgets();
      clearDefaultImageWidget(node);

      const panel = document.createElement("div");
      panel.className = "db-image-panel";
      node._dbOwnsImagePreview = true;

      const previewWrap = document.createElement("div");
      previewWrap.className = "db-image-preview-wrap";
      previewWrap.style.cssText =
        "display:none;width:100%;min-height:100px;height:240px;overflow:hidden;" +
        "align-items:center;justify-content:center;box-sizing:border-box;";
      const previewImage = document.createElement("img");
      previewImage.className = "db-image-preview";
      previewImage.style.cssText =
        "display:block;width:100%;height:100%;object-fit:contain;image-rendering:auto;";
      previewWrap.append(previewImage);

      function showPreview(img) {
        if (!img?.src) {
          previewImage.removeAttribute("src");
          previewWrap.style.display = "none";
          return;
        }
        previewImage.src = img.src;
        previewWrap.style.display = "flex";
      }

      const sourceLabel = makeSectionLabel("Source");

      // ── Load Image button ─────────────────────────────────────────────────
      const sourceRow = document.createElement("div");
      sourceRow.className = "db-image-actions";
      sourceRow.style.gridTemplateColumns = "minmax(0, 1fr)";
      const uploadBtn = document.createElement("button");
      uploadBtn.className = "db-lib-btn db-lora-add-open-btn";
      uploadBtn.textContent = "Load Image";
      sourceRow.append(uploadBtn);

      // ── URL input ─────────────────────────────────────────────────────────
      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.className = "db-text-input";
      urlInput.placeholder = "image URL or local path";
      urlInput.style.cssText += "flex:0 0 auto;height:24px;width:100%;box-sizing:border-box;";
      urlInput.value = String(imageUrlWidget?.value || "");

      const sourceSummary = document.createElement("div");
      sourceSummary.className = "db-image-source-summary";
      function shortSource(value) {
        const source = String(value || "").trim();
        if (!source) return "";
        try {
          if (/^https?:\/\//i.test(source)) return new URL(source).hostname;
        } catch (_) { /* retain the original source */ }
        return source.split(/[\\/]/).filter(Boolean).pop() || source;
      }
      function paintSourceSummary() {
        const url = urlInput.value.trim();
        const file = String(imageWidget?.value || "").trim();
        const source = url || file;
        sourceSummary.dataset.empty = source ? "false" : "true";
        sourceSummary.textContent = source
          ? `${url ? "URL" : "FILE"} · ${shortSource(source)}`
          : "Choose a file or enter a URL/path";
        sourceSummary.title = source;
      }

      // Auto-preview: load whatever the URL/path field points at into node.imgs
      // so the image shows in the node immediately (also gives Booru/Caption a
      // live image to work from). Debounced so typing doesn't fire per keystroke.
      let _urlPreviewTimer = null;
      function previewFromUrl(raw) {
        const src = String(raw || "").trim();
        if (!src) { restoreSelectedFilePreview(); return; }
        const url = /^https?:\/\//i.test(src)
          ? src
          : `/view?filename=${encodeURIComponent(src)}&type=input`;
        setStatus("Loading preview...");
        const img = new Image();
        img.onload = () => {
          node.imgs = [img];
          node.imageIndex = 0;
          showPreview(img);
          setStatus(`${img.naturalWidth} × ${img.naturalHeight}`, "ok");
          node.setDirtyCanvas(true, true);
        };
        img.onerror = () => setStatus("Could not load preview from that URL/path.", "err");
        img.src = url;
      }
      function scheduleUrlPreview() {
        clearTimeout(_urlPreviewTimer);
        _urlPreviewTimer = setTimeout(() => previewFromUrl(urlInput.value), 450);
      }
      urlInput.addEventListener("input", () => {
        if (imageUrlWidget) imageUrlWidget.value = urlInput.value;
        paintSourceSummary();
        scheduleUrlPreview();
        window.dispatchEvent(new CustomEvent("dirtybirds:image-source-changed"));
      });
      // Paste lands the value before 'input' settles — preview a touch sooner.
      urlInput.addEventListener("paste", () => setTimeout(scheduleUrlPreview, 0));
      // Small clear (✕) button overlaid on the right of the URL field.
      const urlWrap = document.createElement("div");
      urlWrap.style.cssText = "position:relative;width:100%;box-sizing:border-box;";
      urlInput.style.paddingRight = "22px";
      const urlClear = document.createElement("button");
      urlClear.type = "button";
      urlClear.textContent = "✕";
      urlClear.title = "Clear";
      urlClear.style.cssText =
        "position:absolute;right:4px;top:50%;transform:translateY(-50%);" +
        "width:16px;height:16px;border:none;background:none;color:#888;" +
        "font-size:11px;line-height:1;cursor:pointer;padding:0;display:none;";
      urlClear.addEventListener("mouseenter", () => { urlClear.style.color = "#5aadff"; });
      urlClear.addEventListener("mouseleave", () => { urlClear.style.color = "#888"; });
      function syncUrlClear() { urlClear.style.display = urlInput.value.trim() ? "block" : "none"; }
      urlClear.addEventListener("click", () => {
        urlInput.value = "";
        if (imageUrlWidget) imageUrlWidget.value = "";
        clearTimeout(_urlPreviewTimer);
        previewFromUrl("");
        setStatus("");
        syncUrlClear();
        window.dispatchEvent(new CustomEvent("dirtybirds:image-source-changed"));
        urlInput.focus();
      });
      urlInput.addEventListener("input", syncUrlClear);
      urlWrap.append(urlInput, urlClear);
      syncUrlClear();

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/png,image/jpeg,image/jpg,image/webp,image/gif";
      fileInput.style.display = "none";

      function selectImage(path) {
        if (!imageWidget) return;
        // The backend intentionally gives URL/path precedence. Selecting a new
        // upload therefore clears the old URL so the visible choice is truthful.
        urlInput.value = "";
        if (imageUrlWidget) imageUrlWidget.value = "";
        syncUrlClear();
        const opts = imageWidget.options || (imageWidget.options = {});
        opts.values = opts.values || [];
        if (path && !opts.values.includes(path)) opts.values.push(path);
        imageWidget.value = path;
        imageWidget.callback?.(path);
        paintSourceSummary();
        restoreSelectedFilePreview();
        window.dispatchEvent(new CustomEvent("dirtybirds:image-source-changed"));
        node.setDirtyCanvas(true, true);
      }

      const status = document.createElement("div");
      status.className = "db-url-tools-status";

      function setStatus(text, tone = "") {
        status.textContent = text || "";
        status.dataset.tone = tone;
        status.hidden = !text;
        syncPanelH();
      }

      function restoreSelectedFilePreview() {
        const selected = String(imageWidget?.value || "").trim();
        if (!selected) {
          node.imgs = [];
          node.imageIndex = null;
          showPreview(null);
          paintSourceSummary();
          node.setDirtyCanvas(true, true);
          return;
        }
        const img = new Image();
        img.onload = () => {
          node.imgs = [img];
          node.imageIndex = 0;
          showPreview(img);
          node.setDirtyCanvas(true, true);
        };
        img.src = `/view?filename=${encodeURIComponent(selected)}&type=input`;
        paintSourceSummary();
      }
      status.hidden = true;
      paintSourceSummary();
      // Restore URL previews only after status and source state are initialized.
      if (urlInput.value.trim()) previewFromUrl(urlInput.value);
      else restoreSelectedFilePreview();

      async function uploadFile(file) {
        try {
          setStatus(`Uploading ${file.name}...`);
          const body = new FormData();
          body.append("image", file);
          body.append("overwrite", "true");
          const resp = await fetch("/upload/image", { method: "POST", body });
          if (resp.status !== 200) return setStatus(`Upload failed (${resp.status}).`, "err");
          const data = await resp.json();
          let path = data.name;
          if (data.subfolder) path = `${data.subfolder}/${path}`;
          selectImage(path);
          setStatus(file.name, "ok");
        } catch (e) {
          setStatus("Upload error.", "err");
        }
      }
      fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (f) uploadFile(f);
        fileInput.value = "";
      });
      uploadBtn.addEventListener("click", () => fileInput.click());

      // ── Resize toggle + max-size slider ───────────────────────────────────
      const resizeLabel = makeSectionLabel("Resize");
      const resizeToggle = document.createElement("button");
      resizeToggle.className = "db-lib-btn db-lora-add-open-btn db-image-segment-toggle";
      resizeToggle.style.cssText += "height:26px;min-height:26px;padding:0 8px;width:100%;";
      const { row: resizeMaxRow, paint: paintResizeMax } = makeSlider(
        "Longest Side", 256, 2048, 64,
        () => Number(resizeMaxWidget?.value ?? 1024),
        (v) => { if (resizeMaxWidget) resizeMaxWidget.value = Math.round(v); },
        (v) => String(Math.round(v)),
      );
      const { row: resizeWidthRow, paint: paintResizeWidth } = makeSlider(
        "Width", 256, 2048, 64,
        () => Number(resizeWidthWidget?.value ?? 1024),
        (v) => { if (resizeWidthWidget) resizeWidthWidget.value = Math.round(v); },
        (v) => String(Math.round(v)),
      );
      const { row: resizeHeightRow, paint: paintResizeHeight } = makeSlider(
        "Height", 256, 2048, 64,
        () => Number(resizeHeightWidget?.value ?? 1024),
        (v) => { if (resizeHeightWidget) resizeHeightWidget.value = Math.round(v); },
        (v) => String(Math.round(v)),
      );

      const resizeMode = document.createElement("div");
      resizeMode.className = "db-seg db-image-resize-mode";
      const modeOptions = [
        ["long_side", "Long Side"],
        ["custom", "Custom"],
      ].map(([value, label]) => {
        const option = document.createElement("div");
        option.className = "db-seg-opt";
        option.dataset.mode = value;
        option.textContent = label;
        option.addEventListener("click", () => {
          if (resizeModeWidget) resizeModeWidget.value = value;
          paintResize();
        });
        resizeMode.append(option);
        return option;
      });

      const sizeControls = document.createElement("div");
      sizeControls.className = "db-image-size-controls";
      sizeControls.append(resizeMode, resizeMaxRow, resizeWidthRow, resizeHeightRow);

      function paintResize() {
        const on = !!resizeWidget?.value;
        resizeToggle.textContent = on ? "Resize: on" : "Resize: off";
        resizeToggle.dataset.tone = on ? "random" : "fixed";
        sizeControls.style.opacity = on ? "1" : "0.35";
        sizeControls.style.pointerEvents = on ? "auto" : "none";
        const mode = String(resizeModeWidget?.value || "long_side");
        modeOptions.forEach((option) => option.classList.toggle(
          "db-seg-active", option.dataset.mode === mode
        ));
        resizeMaxRow.style.display = mode === "long_side" ? "flex" : "none";
        resizeWidthRow.style.display = mode === "custom" ? "flex" : "none";
        resizeHeightRow.style.display = mode === "custom" ? "flex" : "none";
        paintToolsSummary();
      }
      resizeToggle.addEventListener("click", () => {
        if (resizeWidget) resizeWidget.value = !resizeWidget.value;
        paintResize();
        node.setDirtyCanvas(true, true);
      });

      // ── Sharpen | Resize controls ─────────────────────────────────────────
      const toolsSplit = document.createElement("div");
      toolsSplit.className = "db-image-tools-grid";
      const sharpenCol = document.createElement("div");
      sharpenCol.className = "db-image-tools-col";
      const sharpenLabel = makeSectionLabel("Sharpen");
      const sharpenButton = document.createElement("button");
      sharpenButton.className = "db-lib-btn db-lora-add-open-btn db-image-sharpen-toggle";
      const sharpenModes = ["off", "auto", "low", "medium", "high"];
      function paintSharpen() {
        const mode = String(sharpenWidget?.value || "auto").toLowerCase();
        sharpenButton.textContent = `Sharpen: ${mode}`;
        sharpenButton.dataset.tone = mode === "off" ? "fixed" : "random";
        paintToolsSummary();
      }
      sharpenButton.addEventListener("click", () => {
        const current = String(sharpenWidget?.value || "auto").toLowerCase();
        const next = sharpenModes[(sharpenModes.indexOf(current) + 1) % sharpenModes.length];
        if (sharpenWidget) sharpenWidget.value = next;
        paintSharpen();
        node.setDirtyCanvas(true, true);
      });
      const sharpenHint = document.createElement("div");
      sharpenHint.className = "db-image-tool-hint";
      sharpenHint.textContent = "Auto restores detail after downscaling";
      sharpenCol.append(sharpenLabel, sharpenButton, sharpenHint);
      const toolsDivider = document.createElement("div");
      toolsDivider.className = "db-image-tools-divider";
      const resizeCol = document.createElement("div");
      resizeCol.className = "db-image-tools-col";
      const resizeHint = document.createElement("div");
      resizeHint.className = "db-image-tool-hint";
      resizeHint.textContent = "Long Side preserves aspect; Custom sets exact dimensions";
      resizeCol.append(resizeLabel, resizeToggle, sizeControls, resizeHint);
      toolsSplit.append(sharpenCol, toolsDivider, resizeCol);

      // ── Optional controls ─────────────────────────────────────────────────
      const optionalContent = document.createElement("div");
      optionalContent.className = "db-collapsible-content db-image-optional-content";
      optionalContent.style.display = "none";
      optionalContent.append(toolsSplit);
      const optionalSection = makeCollapsibleSectionLabel("Image Tools", {
        expanded: false,
        onChange: (expanded) => {
          optionalContent.style.display = expanded ? "flex" : "none";
          requestAnimationFrame(() => {
            node.setSize(node.computeSize());
            node.setDirtyCanvas(true, true);
          });
        },
      });
      function paintToolsSummary() {
        if (!optionalSection) return;
        optionalSection.setTitle("Image Tools");
      }

      // ── Assemble panel ────────────────────────────────────────────────────
      panel.append(fileInput, sourceLabel, sourceRow, urlWrap, sourceSummary, status, previewWrap,
        optionalSection.label, optionalContent);

      node.addDOMWidget("db_image_tools_panel", "customhtml", panel, {
        serialize: false,
        getMinHeight: () => {
          const controls = optionalSection.isExpanded() ? 330 : 132;
          const preview = previewWrap.style.display === "none"
            ? 0
            : Math.max(100, Number.parseFloat(previewWrap.style.height) || 240) + 8;
          return controls + preview;
        },
      });

      function applyWidths() {
        panel.style.width = nodeInnerW(node) + "px";
      }

      function syncPanelH() {
        applyWidths();
        node.setDirtyCanvas(true, true);
      }

      const origResize = node.onResize;
      node.onResize = function (size) {
        if (size[0] < 300) size[0] = 300;
        origResize?.call(this, size);
        syncPanelH();
      };

      paintResize();
      paintResizeMax();
      paintResizeWidth();
      paintResizeHeight();
      paintSharpen();
      paintToolsSummary();
      requestAnimationFrame(() => { hideStockWidgets(); clearDefaultImageWidget(node); });
      requestAnimationFrame(() => requestAnimationFrame(() => { hideStockWidgets(); syncPanelH(); }));
      setTimeout(() => { hideStockWidgets(); node.setDirtyCanvas(true, true); }, 100);
    };
  },
});
