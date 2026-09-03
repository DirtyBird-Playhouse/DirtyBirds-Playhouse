/**
 * DirtyBirds Playhouse — Prompt Enhance node UI.
 *
 * A plain text-in → text-out LLM prompt writer: it enhances whatever STRING is
 * wired into text_in and emits the result on the text output. LM Studio owns
 * the model; this node shows status and lets the user pick a system prompt
 * file from user-files/LM Studio.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  makeSectionLabel,
  fetchJSON,
  nodeInnerW,
  hideWidget as hideWidgetShared,
  makeCollapsibleSectionLabel,
  makeButton,
  makeTextarea,
  makeInput,
  reserveHeight,
} from "./db_shared.js";

ensureStylesheet();

// Hand-maintained content heights, the same convention the rest of the pack
// uses (see the note on applyControlSurface in db_shared.js — nothing here may
// measure the panel and resize the node back).
//
//   title row 24 + gap 6                               = 30
//   split: prompt row 24 + status 14 + gap             = 60
//   "Enhancement Instructions" label 16 + gap 6        = 22
//   instruction textarea                               = 86
//   "LM Response" collapsible label 16 + gap 6         = 22
//   Enhance Prompt button 26 + gap 6                   = 32
//   panel padding                                      = 12
// Re-measured live after the backend-selector row was removed (LM Studio is now
// the only backend). It was 210 before that, which is where the missing 66px at
// the foot of this node came from: the button and half the instruction box were
// drawn past the panel.
const ENHANCE_PANEL_H = 238;
const ENHANCE_RESPONSE_H = 90;

// LM Studio is the only backend. Mirrors DEFAULT_ENDPOINT / BACKEND_LABEL in
// nodes/prompt_enhance/__init__.py.
const LM_STUDIO = {
  label: "LM Studio",
  tag: "LM",
  endpoint: "http://localhost:1234/v1",
};

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
  const closeBtn = makeButton();
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
    row.className =
      "db-res-opt" + (prompt.file === current ? " db-selected" : "");
    const label = document.createElement("span");
    label.className = "db-res-opt-label";
    label.textContent = prompt.name || prompt.file;
    label.title = prompt.file;
    row.appendChild(label);
    row.addEventListener("click", () => {
      close();
      onPick(prompt);
    });
    list.appendChild(row);
  });

  function close() {
    overlay.remove();
    panel.remove();
  }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

app.registerExtension({
  name: "DirtyBirds.PromptEnhance",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsPromptEnhance") return;

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const data = message?.db_prompt_enhance_response;
      if (Array.isArray(data)) {
        this._dbEnhancePositive = (data[0] || "").trim();
        this._dbEnhanceNegative = (data[1] || "").trim();
      }
      const status = message?.db_prompt_enhance_status;
      if (Array.isArray(status) && status[0]) this._dbEnhanceRunStatus = status[0];
      this._dbEnhancePaintResponse?.();
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      requestAnimationFrame(() => this._dbEnhanceRestorePreferences?.());
      return result;
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      // Width is the shared control surface's job (DIRTYBIRDS_NODE_WIDTH in
      // db_shared.js, applied by jsdirtybirds_surface.js). This node used to pin
      // itself to 420px, which made it the one node in a DirtyBirds row that did
      // not line up with the others.

      if (Array.isArray(node.inputs)) {
        for (let i = node.inputs.length - 1; i >= 0; i--) {
          if (node.inputs[i]?.name === "image") node.removeInput?.(i);
        }
      }
      if (Array.isArray(node.outputs)) {
        for (let i = node.outputs.length - 1; i >= 0; i--) {
          if (["positive", "negative"].includes(node.outputs[i]?.name))
            node.removeOutput?.(i);
        }
      }

      const staleWidgets = new Set([
        "db_enhance_label",
        "db_enhance_model",
        "db_enhance_panel",
      ]);
      if (Array.isArray(node.widgets)) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
          if (staleWidgets.has(node.widgets[i]?.name)) {
            node.widgets[i]?.element?.remove?.();
            node.widgets.splice(i, 1);
          }
        }
      }

      const hideWidget = (name) => hideWidgetShared(node, name);

      const enabledWidget = hideWidget("enabled");
      const instructionWidget = hideWidget("instruction");
      const temperatureWidget = hideWidget("temperature");
      const maxTokensWidget = hideWidget("max_tokens");
      const promptFileWidget = hideWidget("prompt_file");

      let promptOptions = [];

      const panel = document.createElement("div");
      panel.className = "db-enhance-panel";

      const titleEl = makeSectionLabel("Prompt Enhance");
      const titleRow = document.createElement("div");
      titleRow.className = "db-enhance-title-row";
      const power = makeButton();
      power.type = "button";
      power.className = "db-enhance-power";
      const powerKnob = document.createElement("span");
      powerKnob.className = "db-enhance-power-knob";
      const powerText = document.createElement("span");
      powerText.className = "db-enhance-power-text";
      power.append(powerKnob, powerText);
      titleRow.append(titleEl, power);
      const split = document.createElement("div");
      split.className = "db-enhance-split";
      const leftCol = document.createElement("div");
      leftCol.className = "db-enhance-col";
      const rightCol = document.createElement("div");
      rightCol.className = "db-enhance-col";
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
      lmStatus.className = "db-lm-status db-enhance-status";
      lmStatus.textContent = "LM Studio: checking";

      node.properties = node.properties || {};

      promptTag.textContent = LM_STUDIO.tag;

      const tempRow = makeSliderRow(
        "TEMP",
        temperatureWidget,
        0,
        2,
        0.05,
        (v) => Number(v).toFixed(2),
      );
      const tokenRow = makeStepperRow("TOKENS", maxTokensWidget, 16, 8192, 16);

      const requestLabel = makeSectionLabel("Enhancement Instructions");
      const instructionArea = makeTextarea();
      instructionArea.className = "db-script-textarea db-enhance-textarea";
      instructionArea.placeholder = "prompt writing request";
      instructionArea.value = instructionWidget?.value || "";
      instructionArea.spellcheck = false;
      instructionArea.addEventListener("input", () => {
        if (instructionWidget) instructionWidget.value = instructionArea.value;
        node.setDirtyCanvas(true, true);
      });

      const responseBox = makeTextarea();
      responseBox.className = "db-script-textarea db-enhance-response";
      responseBox.placeholder = "run the node to see the LM response";
      responseBox.spellcheck = false;
      responseBox.style.display = "none";
      const responseSection = makeCollapsibleSectionLabel("LM Response", {
        expanded: false,
        onChange: (expanded) => {
          responseBox.style.display = expanded ? "block" : "none";
          requestAnimationFrame(() => {
            node.setSize(node.computeSize());
            node.setDirtyCanvas(true, true);
          });
        },
      });

      const generateBtn = makeButton();
      generateBtn.className =
        "db-lib-btn db-lora-add-open-btn db-enhance-send-btn";
      generateBtn.textContent = "Enhance Prompt";

      const actionRow = document.createElement("div");
      actionRow.style.cssText = "width:100%;";
      actionRow.append(generateBtn);

      function isEnabled() {
        return enabledWidget?.value !== false;
      }

      function paintPower() {
        const on = isEnabled();
        panel.classList.toggle("db-enhance-off", !on);
        power.classList.toggle("is-on", on);
        power.setAttribute("aria-pressed", on ? "true" : "false");
        powerText.textContent = on ? "On" : "Off";
        lmStatus.textContent = on
          ? node._dbEnhanceLmStatus || `${LM_STUDIO.label}: not checked`
          : "Prompt Enhance: off";
        lmStatus.dataset.tone = on ? node._dbEnhanceLmTone || "" : "off";
        promptRow.classList.toggle("db-disabled", !on);
        tempRow.classList.toggle("db-disabled", !on);
        tokenRow.classList.toggle("db-disabled", !on);
        instructionArea.disabled = !on;
        generateBtn.disabled = !on || !!node._dbEnhanceGenerating;
        syncPanelH();
      }

      power.addEventListener("click", () => {
        if (enabledWidget) enabledWidget.value = !isEnabled();
        node._dbEnhanceRunStatus = isEnabled() ? "" : "Prompt Enhance: off";
        paintPower();
        node.setDirtyCanvas(true, true);
      });

      // Read whatever STRING is wired into the text_in socket, so the manual
      // "Enhance Prompt" preview uses the same input the graph run would.
      function wiredTextIn() {
        const slot = node.inputs?.find((s) => s.name === "text_in");
        if (!slot || slot.link == null) return "";
        const link = app.graph?.links?.[slot.link];
        const src = link && app.graph?.getNodeById?.(link.origin_id);
        if (!src) return "";
        const out = src.outputs?.[link.origin_slot];
        // Prefer a DirtyBirds prompt textarea, else a widget matching the output.
        return String(
          src._dbPositiveTextarea?.value ??
            src.widgets?.find((w) => w.name === out?.name)?.value ??
            "",
        ).trim();
      }

      generateBtn.addEventListener("click", async () => {
        if (!isEnabled() || node._dbEnhanceGenerating) return;
        node._dbEnhanceGenerating = true;
        node._dbEnhanceRunStatus = "Prompt Enhance: generating";
        responseBox.value = "Generating prompt…";
        if (!responseSection.isExpanded()) responseSection.setExpanded(true);
        paintPower();
        try {
          const sourceText = wiredTextIn();
          const response = await fetch("/dirtybirds/prompt-enhance-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: true,
              instruction:
                instructionWidget?.value || instructionArea.value || "",
              temperature: Number(temperatureWidget?.value ?? 0.7),
              max_tokens: Number(maxTokensWidget?.value ?? 1024),
              prompt_file: promptFileWidget?.value || "",
              text_in: sourceText,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data?.error || `HTTP ${response.status}`);
          node._dbEnhancePositive = data?.positive || "";
          node._dbEnhanceNegative = data?.negative || "";
          node._dbEnhanceRunStatus = data?.status || "Prompt Enhance: on";
        } catch (error) {
          node._dbEnhancePositive = "";
          node._dbEnhanceNegative = "";
          node._dbEnhanceRunStatus = `Prompt Enhance error: ${error?.message || error}`;
        } finally {
          node._dbEnhanceGenerating = false;
          node._dbEnhancePaintResponse();
          node.setDirtyCanvas(true, true);
        }
      });

      node._dbEnhancePositive = node._dbEnhancePositive || "";
      node._dbEnhanceNegative = node._dbEnhanceNegative || "";
      responseBox.addEventListener("input", () => {
        const text = responseBox.value || "";
        const positiveMatch = text.match(
          /(?:^|\n)POSITIVE:\s*([\s\S]*?)(?=\n\s*NEGATIVE:|$)/i,
        );
        const negativeMatch = text.match(/(?:^|\n)NEGATIVE:\s*([\s\S]*)$/i);
        node._dbEnhancePositive = (positiveMatch ? positiveMatch[1] : text).trim();
        node._dbEnhanceNegative = (negativeMatch?.[1] || "").trim();
        paintPower();
      });
      node._dbEnhancePaintResponse = function () {
        const pos = node._dbEnhancePositive || "";
        const neg = node._dbEnhanceNegative || "";
        responseBox.value = neg
          ? `POSITIVE:\n${pos}\n\nNEGATIVE:\n${neg}`
          : pos;
        if (node._dbEnhanceRunStatus && !pos && !neg)
          responseBox.value = node._dbEnhanceRunStatus;
        // The response box lives in a section that starts collapsed. Auto-open
        // it whenever there's anything to show — an enhanced prompt or an error
        // status — so the result is visible without expanding "LM Response" by
        // hand.
        if (responseBox.value.trim() && !responseSection.isExpanded()) {
          responseSection.setExpanded(true);
        }
        paintPower();
        syncPanelH();
      };

      function promptLabel(file) {
        if (!file) return "Select prompt";
        const found = promptOptions.find((p) => p.file === file);
        return (
          found?.name ||
          file
            .split("/")
            .pop()
            ?.replace(/\.[^.]+$/, "") ||
          file
        );
      }

      function refreshPromptRow() {
        const file = promptFileWidget?.value || "";
        promptName.textContent = promptLabel(file);
        promptRow.title = file || "user-files/LM Studio";
      }

      async function loadPromptOptions() {
        const data = await fetchJSON("/dirtybirds/prompt-enhance-prompts");
        promptOptions = data?.prompts || [];
        if (!promptFileWidget?.value && promptOptions[0]) {
          promptFileWidget.value = promptOptions[0].file;
        }
        refreshPromptRow();
      }

      promptRow.addEventListener("click", async () => {
        if (!isEnabled()) return;
        if (!promptOptions.length) await loadPromptOptions();
        showPromptFlyout(
          "LM Studio Prompts",
          promptOptions,
          promptFileWidget?.value || "",
          (prompt) => {
            if (promptFileWidget) promptFileWidget.value = prompt.file;
            refreshPromptRow();
            node.setDirtyCanvas(true, true);
          },
        );
      });

      leftCol.append(promptRow, lmStatus);
      rightCol.append(tempRow, tokenRow);
      split.append(leftCol, divider, rightCol);
      panel.append(
        titleRow,
        split,
        requestLabel,
        instructionArea,
        responseSection.label,
        responseBox,
        actionRow,
      );

      const panelWidget = node.addDOMWidget(
        "db_enhance_panel",
        "customhtml",
        panel,
        {
          serialize: false,
          getMinHeight: () =>
            reserveHeight(
              ENHANCE_PANEL_H +
                (responseSection.isExpanded() ? ENHANCE_RESPONSE_H : 0),
            ),
        },
      );

      function makeSliderRow(label, widget, min, max, step, fmt) {
        const row = document.createElement("div");
        row.className = "db-slider-row db-enhance-control-row";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = label;
        const slider = makeInput();
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
        row.className = "db-slider-row db-enhance-control-row";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = label;
        const input = makeInput();
        input.type = "number";
        input.className = "db-text-input db-enhance-token-input";
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
        node.setDirtyCanvas(true, true);
      }

      const origResize = node.onResize;
      node.onResize = function (size) {
        origResize?.call(this, size);
        syncPanelH();
      };
      node.resizable = true;
      node.min_height = 280;
      node._dbEnhanceRestorePreferences = paintPower;

      loadPromptOptions();
      paintPower();
      node._dbEnhancePaintResponse();
      requestAnimationFrame(syncPanelH);
    };
  },
});
