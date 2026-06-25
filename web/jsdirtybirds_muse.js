/**
 * DirtyBirds Playhouse — Prompt Muse node UI.
 *
 * Text-only LM Studio prompt writer. Model and endpoint are owned by LM Studio;
 * this node shows status and lets the user pick a system prompt file from
 * user-files/LM Studio.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet, makeSectionLabel, fetchJSON, nodeInnerW } from "./db_shared.js";

ensureStylesheet();

function showPromptFlyout(title, prompts, current, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "db-flyout-overlay";
  const panel = document.createElement("div");
  panel.className = "db-flyout";
  panel.style.width = "min(420px, 90vw)";
  panel.style.left = Math.max(20, (window.innerWidth - 420) / 2) + "px";
  panel.style.top = Math.max(40, window.innerHeight / 2 - 220) + "px";

  const header = document.createElement("div");
  header.className = "db-flyout-header";
  const titleEl = document.createElement("span");
  titleEl.className = "db-flyout-title";
  titleEl.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.className = "db-flyout-close";
  closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn);
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "db-flyout-list";
  list.style.cssText = "max-height:60vh;overflow:auto;";
  panel.appendChild(list);

  if (!prompts || !prompts.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:14px;color:#888;font-size:12px;";
    empty.textContent = "No prompt files found in user-files/LM Studio";
    list.appendChild(empty);
  }

  (prompts || []).forEach((prompt) => {
    const row = document.createElement("div");
    row.className = "db-res-opt" + (prompt.file === current ? " db-selected" : "");
    const label = document.createElement("span");
    label.className = "db-res-opt-label";
    label.textContent = prompt.name || prompt.file;
    label.title = prompt.file;
    row.appendChild(label);
    row.addEventListener("click", () => { close(); onPick(prompt); });
    list.appendChild(row);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

app.registerExtension({
  name: "DirtyBirds.Muse",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsMuse") return;

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const data = message?.db_muse_response;
      if (!Array.isArray(data)) return;
      this._dbMusePositive = (data[0] || "").trim();
      this._dbMuseNegative = (data[1] || "").trim();
      this._dbMusePaintResponse?.();
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = 420;

      if (Array.isArray(node.inputs)) {
        for (let i = node.inputs.length - 1; i >= 0; i--) {
          if (node.inputs[i]?.name === "image") node.removeInput?.(i);
        }
      }
      if (Array.isArray(node.outputs)) {
        for (let i = node.outputs.length - 1; i >= 0; i--) {
          if (["positive", "negative"].includes(node.outputs[i]?.name)) node.removeOutput?.(i);
        }
      }

      const staleWidgets = new Set(["db_muselabel", "db_muse_model", "db_muse_panel"]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      function hideWidget(name) {
        const w = node.widgets?.find((widget) => widget.name === name);
        if (!w) return undefined;
        w.computeSize = () => [0, 0];
        w.serializeValue = () => w.value;
        if (w.element?.style) w.element.style.display = "none";
        if (typeof w.setHidden === "function") w.setHidden(true);
        else if ("hidden" in w) w.hidden = true;
        return w;
      }

      const instructionWidget = hideWidget("instruction");
      const temperatureWidget = hideWidget("temperature");
      const maxTokensWidget = hideWidget("max_tokens");
      const promptFileWidget = hideWidget("prompt_file");
      hideWidget("model");
      hideWidget("endpoint");
      hideWidget("system");
      hideWidget("style");

      let promptOptions = [];

      const panel = document.createElement("div");
      panel.className = "db-muse-panel";

      const titleEl = makeSectionLabel("The Writer");
      const split = document.createElement("div");
      split.className = "db-muse-split";
      const leftCol = document.createElement("div");
      leftCol.className = "db-muse-col";
      const rightCol = document.createElement("div");
      rightCol.className = "db-muse-col";
      const divider = document.createElement("div");
      divider.className = "db-prompt-toybox-divider";

      const promptRow = document.createElement("div");
      promptRow.className = "db-sel-row";
      promptRow.style.cursor = "pointer";
      const promptTag = document.createElement("span");
      promptTag.className = "db-model-tag";
      promptTag.textContent = "LM";
      const promptName = document.createElement("span");
      promptName.className = "db-sel-name";
      promptName.style.flex = "1";
      const promptCaret = document.createElement("span");
      promptCaret.className = "db-model-caret";
      promptCaret.textContent = "▾";
      promptRow.append(promptTag, promptName, promptCaret);

      const lmStatus = document.createElement("div");
      lmStatus.className = "db-lm-status db-muse-status";
      lmStatus.textContent = "LM Studio: checking";

      const tempRow = makeSliderRow("TEMP", temperatureWidget, 0, 2, 0.05, (v) => Number(v).toFixed(2));
      const tokenRow = makeStepperRow("TOKENS", maxTokensWidget, 16, 8192, 16);

      const requestLabel = makeSectionLabel("The Request");
      const instructionArea = document.createElement("textarea");
      instructionArea.className = "db-script-textarea db-muse-textarea";
      instructionArea.placeholder = "prompt writing request";
      instructionArea.value = instructionWidget?.value || "";
      instructionArea.spellcheck = false;
      instructionArea.addEventListener("input", () => {
        if (instructionWidget) instructionWidget.value = instructionArea.value;
        node.setDirtyCanvas(true, true);
      });

      const responseLabel = makeSectionLabel("LM Response");
      const responseBox = document.createElement("textarea");
      responseBox.className = "db-script-textarea db-muse-response";
      responseBox.placeholder = "run the node to see the LM response";
      responseBox.readOnly = true;
      responseBox.spellcheck = false;

      const sendBtn = document.createElement("button");
      sendBtn.className = "db-lib-btn db-lora-add-open-btn db-muse-send-btn";
      sendBtn.textContent = "Send to Dirty Talk";

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

      function sendToDirtyTalk() {
        const target = findDirtyTalkNode();
        if (!target) {
          responseBox.value = "No Dirty Talk node found.";
          syncPanelH();
          return;
        }
        setWidgetText(target, "positive", node._dbMusePositive || "");
        setWidgetText(target, "negative", node._dbMuseNegative || "");
        target.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
      }

      sendBtn.addEventListener("click", sendToDirtyTalk);

      node._dbMusePositive = node._dbMusePositive || "";
      node._dbMuseNegative = node._dbMuseNegative || "";
      node._dbMusePaintResponse = function () {
        const pos = node._dbMusePositive || "";
        const neg = node._dbMuseNegative || "";
        responseBox.value = neg ? `POSITIVE:\n${pos}\n\nNEGATIVE:\n${neg}` : pos;
        syncPanelH();
      };

      function promptLabel(file) {
        if (!file) return "Select prompt";
        const found = promptOptions.find((p) => p.file === file);
        return found?.name || file.split("/").pop()?.replace(/\.[^.]+$/, "") || file;
      }

      function refreshPromptRow() {
        const file = promptFileWidget?.value || "";
        promptName.textContent = promptLabel(file);
        promptRow.title = file || "user-files/LM Studio";
      }

      async function loadPromptOptions() {
        const data = await fetchJSON("/dirtybirds/muse-prompts");
        promptOptions = data?.prompts || [];
        if (!promptFileWidget?.value && promptOptions[0]) {
          promptFileWidget.value = promptOptions[0].file;
        }
        refreshPromptRow();
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

      promptRow.addEventListener("click", async () => {
        if (!promptOptions.length) await loadPromptOptions();
        showPromptFlyout("LM Studio Prompts", promptOptions, promptFileWidget?.value || "", (prompt) => {
          if (promptFileWidget) promptFileWidget.value = prompt.file;
          refreshPromptRow();
          node.setDirtyCanvas(true, true);
        });
      });

      leftCol.append(promptRow, lmStatus);
      rightCol.append(tempRow, tokenRow);
      split.append(leftCol, divider, rightCol);
      panel.append(titleEl, split, requestLabel, instructionArea, responseLabel, responseBox, sendBtn);

      const panelWidget = node.addDOMWidget("db_muse_panel", "customhtml", panel, {
        serialize: false,
        height: 260,
        getMinHeight: () => Math.max(240, panel.scrollHeight || 240),
      });

      function makeSliderRow(label, widget, min, max, step, fmt) {
        const row = document.createElement("div");
        row.className = "db-slider-row db-muse-control-row";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = label;
        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "db-sel-slider";
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        const value = document.createElement("span");
        value.className = "db-sel-val";
        function paint() {
          const v = Number(widget?.value ?? min);
          slider.value = String(v);
          value.textContent = fmt ? fmt(v) : String(v);
        }
        slider.addEventListener("input", () => {
          if (widget) widget.value = Number(slider.value);
          value.textContent = fmt ? fmt(Number(slider.value)) : slider.value;
          node.setDirtyCanvas(true, true);
        });
        row.append(lbl, slider, value);
        paint();
        return row;
      }

      function makeStepperRow(label, widget, min, max, step) {
        const row = document.createElement("div");
        row.className = "db-slider-row db-muse-control-row";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = label;
        const input = document.createElement("input");
        input.type = "number";
        input.className = "db-text-input db-muse-token-input";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(widget?.value ?? 1024);
        input.addEventListener("input", () => {
          let v = Number(input.value || min);
          v = Math.max(min, Math.min(max, Math.round(v / step) * step));
          if (widget) widget.value = v;
          node.setDirtyCanvas(true, true);
        });
        row.append(lbl, input);
        return row;
      }

      function applyWidths() {
        panel.style.width = nodeInnerW(node) + "px";
      }

      function syncPanelH() {
        applyWidths();
        requestAnimationFrame(() => {
          const h = Math.max(240, panel.scrollHeight || 240);
          try { panelWidget.height = h; } catch (_) {}
          panelWidget.computedHeight = h;
          node.size[1] = Math.max(310, h + 78);
          node.setDirtyCanvas(true, true);
        });
      }

      const origResize = node.onResize;
      node.onResize = function (size) {
        if (size[0] < 420) size[0] = 420;
        origResize?.call(this, size);
        syncPanelH();
      };

      loadPromptOptions();
      refreshLmStatus();
      node._dbMusePaintResponse();
      requestAnimationFrame(() => requestAnimationFrame(syncPanelH));
    };
  },
});
