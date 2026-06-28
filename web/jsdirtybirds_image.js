/**
 * DirtyBirds Playhouse — Peep Show (Load Image) node UI.
 *
 * Image loader with upload/URL input, native preview, optional SAM3
 * segmentation toggle + confidence slider. Pixel dimensions drawn under
 * the preview.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  makeSectionLabel,
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

    const origDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      origDrawForeground?.apply(this, arguments);
      if (this.flags?.collapsed) return;
      const img = this.imgs?.[0];
      if (!img || !img.naturalWidth) return;
      const txt = `${img.naturalWidth} × ${img.naturalHeight}`;
      ctx.save();
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "#9fb3c0";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(txt, this.size[0] / 2, this.size[1] - 5);
      ctx.restore();
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
      const segmentWidget = hideNative(node, "segment");
      const segPromptWidget = hideNative(node, "segment_prompt");
      const confidenceWidget = hideNative(node, "confidence");

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
      urlInput.addEventListener("input", () => {
        if (imageUrlWidget) imageUrlWidget.value = urlInput.value;
      });

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/png,image/jpeg,image/jpg,image/webp,image/gif";
      fileInput.style.display = "none";

      function selectImage(path) {
        if (!imageWidget) return;
        const opts = imageWidget.options || (imageWidget.options = {});
        opts.values = opts.values || [];
        if (path && !opts.values.includes(path)) opts.values.push(path);
        imageWidget.value = path;
        imageWidget.callback?.(path);
        node.setDirtyCanvas(true, true);
      }

      const status = document.createElement("div");
      status.className = "db-url-tools-status";

      function setStatus(text, tone = "") {
        status.textContent = text || "";
        status.dataset.tone = tone;
        syncPanelH();
      }

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

      // ── Segment toggle + prompt ───────────────────────────────────────────
      const segLabel = makeSectionLabel("Segmentation");
      const segmentRow = document.createElement("div");
      segmentRow.className = "db-image-segment-row";
      const segToggle = document.createElement("button");
      segToggle.className = "db-lib-btn db-lora-add-open-btn db-image-segment-toggle";
      const segPrompt = document.createElement("input");
      segPrompt.type = "text";
      segPrompt.className = "db-text-input";
      segPrompt.placeholder = "what to segment (SAM3)";
      segPrompt.value = String(segPromptWidget?.value || "");
      segmentRow.append(segToggle, segPrompt);

      function paintSegment() {
        const on = !!segmentWidget?.value;
        segToggle.textContent = on ? "Segment: on" : "Segment: off";
        segToggle.dataset.tone = on ? "random" : "fixed";
        segPrompt.style.opacity = on ? "1" : "0.5";
        segPrompt.disabled = !on;
      }
      segToggle.addEventListener("click", () => {
        if (segmentWidget) segmentWidget.value = !segmentWidget.value;
        paintSegment();
        node.setDirtyCanvas(true, true);
      });
      segPrompt.addEventListener("input", () => {
        if (segPromptWidget) segPromptWidget.value = segPrompt.value;
      });

      // ── Confidence slider ─────────────────────────────────────────────────
      const { row: confidenceRow, paint: paintConfidence } = makeSlider(
        "Conf", 0.05, 0.95, 0.01,
        () => Number(confidenceWidget?.value ?? 0.5),
        (v) => { if (confidenceWidget) confidenceWidget.value = v; },
        (v) => v.toFixed(2),
      );
      confidenceRow.classList.add("db-image-confidence-row");

      // ── Assemble panel ────────────────────────────────────────────────────
      panel.append(fileInput, sourceRow, urlInput, status, segLabel, segmentRow, confidenceRow);

      node.addDOMWidget("db_image_tools_panel", "customhtml", panel, {
        serialize: false,
        height: 160,
        getMinHeight: () => 160,
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

      paintSegment();
      paintConfidence();
      requestAnimationFrame(() => { hideStockWidgets(); clearDefaultImageWidget(node); });
      requestAnimationFrame(() => requestAnimationFrame(() => { hideStockWidgets(); syncPanelH(); }));
      setTimeout(() => { hideStockWidgets(); node.setDirtyCanvas(true, true); }, 100);
    };
  },
});
