/**
 * DirtyBirds Playhouse — Prompt Enhance node UI.
 *
 * Text-only LM Studio prompt writer. Model and endpoint are owned by LM Studio;
 * this node shows status and lets the user pick a system prompt file from
 * user-files/LM Studio.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, makeSectionLabel, fetchJSON, nodeInnerW,
  hideWidget as hideWidgetShared, makeCollapsibleSectionLabel,
  makeButton, makeTextarea,
  makeInput,
} from "./db_shared.js";

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
    empty.textContent = title === "Prompt Source"
      ? "No Prompt Builder nodes found"
      : "No prompt files found in user-files/LM Studio";
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
      if (Array.isArray(data)) {
        this._dbMusePositive = (data[0] || "").trim();
        this._dbMuseNegative = (data[1] || "").trim();
      }
      const status = message?.db_muse_status;
      if (Array.isArray(status) && status[0]) this._dbMuseRunStatus = status[0];
      this._dbMusePaintResponse?.();
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = onConfigure?.apply(this, arguments);
      requestAnimationFrame(() => this._dbMuseRestorePreferences?.());
      return result;
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

      const hideWidget = (name) => hideWidgetShared(node, name);

      const enabledWidget = hideWidget("enabled");
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

      const titleEl = makeSectionLabel("Prompt Enhance");
      const titleRow = document.createElement("div");
      titleRow.className = "db-muse-title-row";
      const power = makeButton();
      power.type = "button";
      power.className = "db-muse-power";
      const powerKnob = document.createElement("span");
      powerKnob.className = "db-muse-power-knob";
      const powerText = document.createElement("span");
      powerText.className = "db-muse-power-text";
      power.append(powerKnob, powerText);
      titleRow.append(titleEl, power);
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

      const requestLabel = makeSectionLabel("Enhancement Instructions");
      const sourceStatus = document.createElement("div");
      sourceStatus.className = "db-muse-source-status";
      sourceStatus.style.cursor = "pointer";
      const sourcePreview = document.createElement("div");
      sourcePreview.className = "db-muse-source-preview";
      const instructionArea = makeTextarea();
      instructionArea.className = "db-script-textarea db-muse-textarea";
      instructionArea.placeholder = "prompt writing request";
      instructionArea.value = instructionWidget?.value || "";
      instructionArea.spellcheck = false;
      instructionArea.addEventListener("input", () => {
        if (instructionWidget) instructionWidget.value = instructionArea.value;
        node.setDirtyCanvas(true, true);
      });

      const responseBox = makeTextarea();
      responseBox.className = "db-script-textarea db-muse-response";
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

      const sendBtn = makeButton();
      sendBtn.className = "db-lib-btn db-lora-add-open-btn db-muse-send-btn";
      sendBtn.textContent = "Apply to Prompt Builder";
      const generateBtn = makeButton();
      generateBtn.className = "db-lib-btn db-lora-add-open-btn db-muse-send-btn";
      generateBtn.textContent = "Enhance Prompt";

      node.properties = node.properties || {};
      if (!node.properties.db_muse_apply_mode) node.properties.db_muse_apply_mode = "preview";
      const modeRow = document.createElement("div");
      modeRow.className = "db-muse-mode-row";
      const modeButtons = [
        ["preview", "Preview Only"],
        ["replace", "Replace"],
        ["append", "Append"],
      ].map(([value, label]) => {
        const button = makeButton();
        button.type = "button";
        button.className = "db-lib-btn db-muse-mode-btn";
        button.textContent = label;
        button.addEventListener("click", () => {
          node.properties.db_muse_apply_mode = value;
          paintApplyMode();
          node.setDirtyCanvas(true, true);
        });
        modeRow.append(button);
        return [value, button];
      });

      const advancedContent = document.createElement("div");
      advancedContent.className = "db-muse-advanced";
      advancedContent.style.display = "none";
      advancedContent.textContent = "Legacy text_in wiring is enabled while this section is open.";
      const advancedSection = makeCollapsibleSectionLabel("Advanced Input", {
        expanded: false,
        onChange: (expanded) => {
          advancedContent.style.display = expanded ? "block" : "none";
          setLegacyInputVisible(expanded);
          requestAnimationFrame(() => {
            node.setSize(node.computeSize());
            node.setDirtyCanvas(true, true);
          });
        },
      });
      const actionRow = document.createElement("div");
      actionRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:7px;width:100%;";
      actionRow.append(generateBtn, sendBtn);

      function isEnabled() {
        return enabledWidget?.value !== false;
      }

      function paintPower() {
        const on = isEnabled();
        panel.classList.toggle("db-muse-off", !on);
        power.classList.toggle("is-on", on);
        power.setAttribute("aria-pressed", on ? "true" : "false");
        powerText.textContent = on ? "On" : "Off";
        lmStatus.textContent = on ? (node._dbMuseLmStatus || "LM Studio: checking") : "Prompt Enhance: off";
        lmStatus.dataset.tone = on ? (node._dbMuseLmTone || "") : "off";
        promptRow.classList.toggle("db-disabled", !on);
        tempRow.classList.toggle("db-disabled", !on);
        tokenRow.classList.toggle("db-disabled", !on);
        instructionArea.disabled = !on;
        generateBtn.disabled = !on || !!node._dbMuseGenerating;
        sendBtn.disabled = !on || node.properties.db_muse_apply_mode === "preview" ||
          !(node._dbMusePositive || node._dbMuseNegative);
        syncPanelH();
      }

      function paintApplyMode() {
        const mode = node.properties.db_muse_apply_mode || "preview";
        for (const [value, button] of modeButtons) {
          button.classList.toggle("db-active", value === mode);
          button.setAttribute("aria-pressed", value === mode ? "true" : "false");
        }
        sendBtn.textContent = mode === "append"
          ? "Append to Prompt Builder"
          : "Apply to Prompt Builder";
        paintPower();
      }

      function setLegacyInputVisible(visible) {
        const input = node.inputs?.find((slot) => slot.name === "text_in");
        if (!input) return;
        // ComfyUI versions that honor hidden suppress the slot; the blank label
        // keeps older versions unobtrusive without removing workflow data.
        input.hidden = !visible && input.link == null;
        input.label = visible || input.link != null ? "text_in (legacy)" : "";
        node.setDirtyCanvas(true, true);
      }

      power.addEventListener("click", () => {
        if (enabledWidget) enabledWidget.value = !isEnabled();
        node._dbMuseRunStatus = isEnabled() ? "" : "Prompt Enhance: off";
        paintPower();
        node.setDirtyCanvas(true, true);
      });

      function setWidgetText(targetNode, name, value) {
        const widget = targetNode.widgets?.find((w) => w.name === name);
        if (widget) widget.value = value || "";
        const ta = name === "positive" ? targetNode._dbPositiveTextarea : targetNode._dbNegativeTextarea;
        if (ta) {
          ta.value = value || "";
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }

      function promptBuildersByDistance() {
        const nodes = app.graph?._nodes || [];
        return nodes
          .filter((n) => n.comfyClass === "DirtyBirdsPrompt" || n.type === "DirtyBirdsPrompt")
          .sort((a, b) => {
            const distance = (candidate) => {
              const dx = Number(candidate.pos?.[0] || 0) - Number(node.pos?.[0] || 0);
              const dy = Number(candidate.pos?.[1] || 0) - Number(node.pos?.[1] || 0);
              return (dx * dx) + (dy * dy);
            };
            return distance(a) - distance(b);
          });
      }

      function findDirtyTalkNode() {
        const builders = promptBuildersByDistance();
        const selectedId = Number(node.properties.db_muse_source_node_id);
        return builders.find((builder) => Number(builder.id) === selectedId) || builders[0];
      }

      function promptBuilderText(target = findDirtyTalkNode()) {
        const widget = target?.widgets?.find((w) => w.name === "positive");
        return String(target?._dbPositiveTextarea?.value ?? widget?.value ?? "").trim();
      }

      function paintPromptSource() {
        const builders = promptBuildersByDistance();
        const target = findDirtyTalkNode();
        if (!target) {
          sourceStatus.textContent = "Source · No Prompt Builder found";
          sourceStatus.dataset.tone = "err";
          sourceStatus.title = "Add a Prompt Builder node to enable automatic prompt input.";
          sourcePreview.textContent = "Add a Prompt Builder to supply the source prompt.";
          sourcePreview.dataset.empty = "true";
          return;
        }
        node.properties.db_muse_source_node_id = target.id;
        const text = promptBuilderText(target);
        const hasText = !!text;
        const name = target.title || `Prompt Builder #${target.id}`;
        sourceStatus.textContent = `Source · ${name}${hasText ? "" : " (empty)"}`;
        sourceStatus.dataset.tone = hasText ? "ok" : "";
        sourceStatus.title = builders.length > 1
          ? "Click to choose a different Prompt Builder."
          : "Positive prompt is read automatically when Generate Prompt is clicked.";
        sourcePreview.textContent = text || "This Prompt Builder has no positive prompt yet.";
        sourcePreview.dataset.empty = hasText ? "false" : "true";
      }

      sourceStatus.addEventListener("click", () => {
        const builders = promptBuildersByDistance();
        if (builders.length < 2) return;
        showPromptFlyout(
          "Prompt Source",
          builders.map((builder) => ({
            name: builder.title || `Prompt Builder #${builder.id}`,
            file: String(builder.id),
          })),
          String(node.properties.db_muse_source_node_id || ""),
          (choice) => {
            node.properties.db_muse_source_node_id = Number(choice.file);
            paintPromptSource();
            node.setDirtyCanvas(true, true);
          },
        );
      });
      window.addEventListener("dirtybirds:prompt-source-changed", (event) => {
        if (Number(event.detail?.nodeId) === Number(findDirtyTalkNode()?.id)) {
          paintPromptSource();
        }
      });

      function appendPrompt(current, addition) {
        const left = String(current || "").trim().replace(/,\s*$/, "");
        const right = String(addition || "").trim().replace(/^\s*,/, "");
        return left && right ? `${left}, ${right}` : left || right;
      }

      function sendToDirtyTalk() {
        const target = findDirtyTalkNode();
        if (!target) {
          responseBox.value = "No Prompt Builder node found.";
          syncPanelH();
          return;
        }
        const mode = node.properties.db_muse_apply_mode || "preview";
        if (mode === "preview") return;
        const currentPositive = promptBuilderText(target);
        const currentNegative = String(
          target?._dbNegativeTextarea?.value ??
          target.widgets?.find((widget) => widget.name === "negative")?.value ?? ""
        ).trim();
        const positive = mode === "append"
          ? appendPrompt(currentPositive, node._dbMusePositive)
          : node._dbMusePositive;
        const negative = mode === "append"
          ? appendPrompt(currentNegative, node._dbMuseNegative)
          : (node._dbMuseNegative || currentNegative);
        setWidgetText(target, "positive", positive || "");
        setWidgetText(target, "negative", negative || "");
        paintPromptSource();
        target.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
      }

      sendBtn.addEventListener("click", sendToDirtyTalk);

      generateBtn.addEventListener("click", async () => {
        if (!isEnabled() || node._dbMuseGenerating) return;
        node._dbMuseGenerating = true;
          node._dbMuseRunStatus = "Prompt Enhance: generating";
        responseBox.value = "Generating prompt…";
        paintPower();
        try {
          const sourceText = promptBuilderText();
          paintPromptSource();
          const response = await fetch("/dirtybirds/muse-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: true,
              instruction: instructionWidget?.value || instructionArea.value || "",
              temperature: Number(temperatureWidget?.value ?? 0.7),
              max_tokens: Number(maxTokensWidget?.value ?? 1024),
              prompt_file: promptFileWidget?.value || "",
              text_in: sourceText,
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
          node._dbMusePositive = data?.positive || "";
          node._dbMuseNegative = data?.negative || "";
          node._dbMuseRunStatus = data?.status || "Prompt Enhance: on";
        } catch (error) {
          node._dbMusePositive = "";
          node._dbMuseNegative = "";
          node._dbMuseRunStatus = `Prompt Enhance error: ${error?.message || error}`;
        } finally {
          node._dbMuseGenerating = false;
          node._dbMusePaintResponse();
          node.setDirtyCanvas(true, true);
        }
      });

      node._dbMusePositive = node._dbMusePositive || "";
      node._dbMuseNegative = node._dbMuseNegative || "";
      responseBox.addEventListener("input", () => {
        const text = responseBox.value || "";
        const positiveMatch = text.match(/(?:^|\n)POSITIVE:\s*([\s\S]*?)(?=\n\s*NEGATIVE:|$)/i);
        const negativeMatch = text.match(/(?:^|\n)NEGATIVE:\s*([\s\S]*)$/i);
        node._dbMusePositive = (positiveMatch ? positiveMatch[1] : text).trim();
        node._dbMuseNegative = (negativeMatch?.[1] || "").trim();
        paintPower();
      });
      node._dbMusePaintResponse = function () {
        const pos = node._dbMusePositive || "";
        const neg = node._dbMuseNegative || "";
        responseBox.value = neg ? `POSITIVE:\n${pos}\n\nNEGATIVE:\n${neg}` : pos;
        if (node._dbMuseRunStatus && !pos && !neg) responseBox.value = node._dbMuseRunStatus;
        paintPower();
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
        if (!isEnabled()) {
          paintPower();
          return;
        }
        lmStatus.textContent = "LM Studio: checking";
        lmStatus.dataset.tone = "";
        const data = await fetchJSON("/dirtybirds/lm-models?endpoint=http%3A%2F%2Flocalhost%3A1234%2Fv1");
        const models = data?.models || [];
        if (models.length) {
          node._dbMuseLmStatus = "LM Studio: ready";
          lmStatus.title = models[0];
          node._dbMuseLmTone = "ok";
        } else {
          node._dbMuseLmStatus = "LM Studio: offline";
          lmStatus.title = data?.error || "No model served at localhost:1234";
          node._dbMuseLmTone = "err";
        }
        paintPower();
      }

      promptRow.addEventListener("click", async () => {
        if (!isEnabled()) return;
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
      panel.append(titleRow, split, sourceStatus, sourcePreview, requestLabel,
        instructionArea, modeRow, responseSection.label, responseBox, actionRow,
        advancedSection.label, advancedContent);

      const panelWidget = node.addDOMWidget("db_muse_panel", "customhtml", panel, {
        serialize: false,
        getMinHeight: () => {
          const responseH = responseSection.isExpanded() ? 90 : 0;
          const advancedH = advancedSection.isExpanded() ? 28 : 0;
          return 292 + responseH + advancedH;
        },
      });

      function makeSliderRow(label, widget, min, max, step, fmt) {
        const row = document.createElement("div");
        row.className = "db-slider-row db-muse-control-row";
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
        row.className = "db-slider-row db-muse-control-row";
        const lbl = document.createElement("span");
        lbl.className = "db-slider-label";
        lbl.textContent = label;
        const input = makeInput();
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
        node.setDirtyCanvas(true, true);
      }

      const origResize = node.onResize;
      node.onResize = function (size) {
        origResize?.call(this, size);
        syncPanelH();
      };
      node.resizable = true;
      node.min_height = 340;
      node._dbMuseRestorePreferences = () => {
        if (!node.properties.db_muse_apply_mode) node.properties.db_muse_apply_mode = "preview";
        paintPromptSource();
        paintApplyMode();
        setLegacyInputVisible(false);
      };

      loadPromptOptions();
      refreshLmStatus();
      paintPromptSource();
      setLegacyInputVisible(false);
      paintApplyMode();
      paintPower();
      node._dbMusePaintResponse();
      requestAnimationFrame(syncPanelH);
    };
  },
});
