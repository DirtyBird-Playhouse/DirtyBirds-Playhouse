/**
 * DirtyBirds Playhouse — Load Image node UI.
 *
 * Image ingest, segmentation, and image-derived prompt helpers live here.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  fetchJSON,
  makeSectionLabel,
  nodeInnerW,
} from "./db_shared.js";

ensureStylesheet();

function setWidgetText(targetNode, name, value) {
  const widget = targetNode.widgets?.find((w) => w.name === name);
  if (widget) widget.value = value || "";
  const ta = name === "positive" ? targetNode._dbPositiveTextarea : targetNode._dbNegativeTextarea;
  if (ta) {
    ta.value = value || "";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function findDirtyTalkNode() {
  const nodes = app.graph?._nodes || [];
  return nodes.find((n) => n.comfyClass === "DirtyBirdsPrompt" || n.type === "DirtyBirdsPrompt");
}

function hideBackingWidget(node, name) {
  const w = node.widgets?.find((widget) => widget.name === name);
  if (!w) return undefined;
  w.serializeValue = () => w.value;
  return w;
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

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = Math.max(node.size[0] || 0, 430);

      const staleWidgets = new Set(["db_image_tools_panel"]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      const imageUrlWidget = hideBackingWidget(node, "image_url");
      hideBackingWidget(node, "segment");
      hideBackingWidget(node, "segment_prompt");
      hideBackingWidget(node, "confidence");
      clearDefaultImageWidget(node);

      const panel = document.createElement("div");
      panel.className = "db-image-panel";

      const sourceLabel = makeSectionLabel("The Tags");
      const split = document.createElement("div");
      split.className = "db-image-split";
      const leftCol = document.createElement("div");
      leftCol.className = "db-image-col";
      const rightCol = document.createElement("div");
      rightCol.className = "db-image-col";
      const divider = document.createElement("div");
      divider.className = "db-prompt-toybox-divider";

      const sourceRow = document.createElement("div");
      sourceRow.className = "db-image-actions db-image-actions-three";
      const uploadCaptionBtn = document.createElement("button");
      uploadCaptionBtn.className = "db-lib-btn db-lora-add-open-btn";
      uploadCaptionBtn.textContent = "Load Image";
      const booruBtn = document.createElement("button");
      booruBtn.className = "db-lib-btn db-lora-add-open-btn";
      booruBtn.textContent = "Booru";
      const captionBtn = document.createElement("button");
      captionBtn.className = "db-lib-btn db-lora-add-open-btn";
      captionBtn.textContent = "Caption";
      sourceRow.append(uploadCaptionBtn, booruBtn, captionBtn);

      const captionFileInput = document.createElement("input");
      captionFileInput.type = "file";
      captionFileInput.accept = "image/*";
      captionFileInput.style.display = "none";
      let uploadedImageData = "";

      const lmStatus = document.createElement("div");
      lmStatus.className = "db-lm-status";
      lmStatus.textContent = "LM Studio: checking";
      const promptActions = document.createElement("div");
      promptActions.className = "db-image-actions";
      const sendBtn = document.createElement("button");
      sendBtn.className = "db-lib-btn db-lora-add-open-btn";
      sendBtn.textContent = "Send";
      const clearBtn = document.createElement("button");
      clearBtn.className = "db-lib-btn db-lora-add-open-btn";
      clearBtn.textContent = "Clear";
      promptActions.append(sendBtn, clearBtn);

      const promptBox = document.createElement("textarea");
      promptBox.className = "db-script-textarea db-image-prompt-box";
      promptBox.placeholder = "Booru tags or image caption";
      promptBox.spellcheck = false;

      const status = document.createElement("div");
      status.className = "db-url-tools-status";
      let latestPrompt = "";

      function setStatus(text, tone = "") {
        status.textContent = text || "";
        status.dataset.tone = tone;
        syncPanelH();
      }

      function setPrompt(text, tone = "ok") {
        latestPrompt = (text || "").trim();
        promptBox.value = latestPrompt;
        setStatus(latestPrompt ? "Prompt text ready." : "", tone);
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

      async function doBooru() {
        const q = String(imageUrlWidget?.value || "").trim();
        if (!q) return setStatus("Paste an AIBooru post URL.", "err");
        setStatus("Fetching AIBooru tags...");
        const data = await fetchJSON(`/dirtybirds/aibooru-post-tags?url=${encodeURIComponent(q)}`);
        const tags = data?.tags || [];
        if (data?.image_url) {
          if (imageUrlWidget) imageUrlWidget.value = data.image_url;
        }
        if (!tags.length) return setStatus(data?.error || "No tags found.", "err");
        setPrompt(tags.join(", "));
      }

      async function doCaption() {
        const q = String(imageUrlWidget?.value || "").trim();
        if (!q && !uploadedImageData) return setStatus("Paste an image URL or load an image.", "err");
        setStatus("Captioning image...");
        let data;
        if (uploadedImageData) {
          data = await fetchJSON("/dirtybirds/image-caption", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image: uploadedImageData,
              endpoint: "http://localhost:1234/v1",
              instruction: "Describe this image as comma-separated image-generation tags. Output only the tags.",
            }),
          });
        } else {
          const params = new URLSearchParams({
            url: q,
            endpoint: "http://localhost:1234/v1",
            instruction: "Describe this image as comma-separated image-generation tags. Output only the tags.",
          });
          data = await fetchJSON(`/dirtybirds/url-caption?${params.toString()}`);
          if (data?.image_url) {
            if (imageUrlWidget) imageUrlWidget.value = data.image_url;
          }
        }
        const caption = (data?.caption || "").trim();
        if (!caption) return setStatus(data?.error || "Caption returned empty.", "err");
        setPrompt(caption);
        refreshLmStatus();
      }

      function sendToDirtyTalk() {
        const target = findDirtyTalkNode();
        if (!target) return setStatus("No Dirty Talk node found.", "err");
        setWidgetText(target, "positive", latestPrompt || promptBox.value || "");
        target.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
        setStatus("Sent to Dirty Talk.", "ok");
      }

      clearBtn.addEventListener("click", () => {
        uploadedImageData = "";
        setPrompt("");
        setStatus("");
      });
      uploadCaptionBtn.addEventListener("click", () => captionFileInput.click());
      captionFileInput.addEventListener("change", () => {
        const file = captionFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          uploadedImageData = String(reader.result || "");
          if (imageUrlWidget) imageUrlWidget.value = "";
          setStatus(file.name, "ok");
        };
        reader.onerror = () => setStatus("Could not load image.", "err");
        reader.readAsDataURL(file);
      });
      booruBtn.addEventListener("click", doBooru);
      captionBtn.addEventListener("click", doCaption);
      sendBtn.addEventListener("click", sendToDirtyTalk);
      promptBox.addEventListener("input", () => {
        latestPrompt = promptBox.value;
        node.setDirtyCanvas(true, true);
      });

      leftCol.append(captionFileInput, lmStatus, sourceRow, promptActions, status);
      rightCol.append(promptBox);
      split.append(leftCol, divider, rightCol);
      panel.append(sourceLabel, split);

      node.addDOMWidget("db_image_tools_panel", "customhtml", panel, {
        serialize: false,
        height: 118,
        getMinHeight: () => 118,
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
        if (size[0] < 430) size[0] = 430;
        origResize?.call(this, size);
        syncPanelH();
      };

      refreshLmStatus();
      requestAnimationFrame(() => clearDefaultImageWidget(node));
      requestAnimationFrame(() => requestAnimationFrame(syncPanelH));
    };
  },
});
