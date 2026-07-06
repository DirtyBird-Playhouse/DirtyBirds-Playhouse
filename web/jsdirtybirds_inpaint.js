/** DirtyBirds image-only Inpainting node and Image Loader handoff. */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  hideWidget,
  makeSectionLabel,
  makeSlider,
  nodeInnerW,
} from "./db_shared.js";

ensureStylesheet();

function findSlot(slots, name) {
  return (slots || []).findIndex((slot) => String(slot?.name || "").toLowerCase() === name);
}

app.registerExtension({
  name: "DirtyBirds.Inpaint",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsInpaint") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      node.size[0] = Math.max(520, node.size[0] || 0);

      const widgets = Object.fromEntries(
        [
          "segment_prompt", "confidence", "seed", "steps", "cfg",
          "sampler_name", "scheduler", "denoise", "lanpaint_steps",
          "prompt_mode", "blend_feather", "grow_mask",
        ].map((name) => [name, hideWidget(node, name)])
      );

      const panel = document.createElement("div");
      panel.className = "db-inpaint-panel";

      const sourceButton = document.createElement("button");
      sourceButton.className = "db-lib-btn db-lora-add-open-btn";
      sourceButton.textContent = "Receive from Image Loader";
      const status = document.createElement("div");
      status.className = "db-url-tools-status db-inpaint-status";

      function setStatus(text, tone = "") {
        status.textContent = text;
        status.dataset.tone = tone;
        node.setDirtyCanvas?.(true, true);
      }

      function connectImageLoader() {
        const loaders = (app.graph?._nodes || []).filter(
          (candidate) => candidate !== node &&
            (candidate.comfyClass === "DirtyBirdsLoadImage" || candidate.type === "DirtyBirdsLoadImage")
        );
        if (!loaders.length) {
          setStatus("Add an Image Loader first.", "err");
          return false;
        }
        const source = loaders[loaders.length - 1];
        const imageOut = findSlot(source.outputs, "image");
        const imageIn = findSlot(node.inputs, "image");
        if ([imageOut, imageIn].some((index) => index < 0)) {
          setStatus("Image Loader socket contract is unavailable.", "err");
          return false;
        }
        if (node.inputs[imageIn].link == null) source.connect(imageOut, node, imageIn);
        setStatus("Image Loader connected.", "ok");
        return true;
      }

      sourceButton.addEventListener("click", connectImageLoader);

      function makeSelect(label, widget) {
        const wrap = document.createElement("label");
        wrap.className = "db-inpaint-field";
        const caption = document.createElement("span");
        caption.className = "db-inpaint-field-label";
        caption.textContent = label;
        const select = document.createElement("select");
        select.className = "db-text-input db-inpaint-select";
        for (const value of widget?.options?.values || []) {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = String(value);
          select.append(option);
        }
        select.value = String(widget?.value ?? "");
        select.addEventListener("change", () => {
          if (widget) widget.value = select.value;
          node.setDirtyCanvas?.(true, true);
        });
        wrap.append(caption, select);
        return wrap;
      }

      function slider(label, widget, min, max, step, format, integer = false) {
        return makeSlider(
          label, min, max, step,
          () => Number(widget?.value ?? min),
          (value) => { if (widget) widget.value = integer ? Math.round(value) : value; },
          format,
        ).row;
      }

      const prompt = document.createElement("textarea");
      prompt.className = "db-text-input db-inpaint-prompt";
      prompt.placeholder = "Describe the area to replace";
      prompt.value = String(widgets.segment_prompt?.value || "");
      prompt.addEventListener("input", () => {
        if (widgets.segment_prompt) widgets.segment_prompt.value = prompt.value;
      });

      const seed = document.createElement("label");
      seed.className = "db-inpaint-field";
      const seedLabel = document.createElement("span");
      seedLabel.className = "db-inpaint-field-label";
      seedLabel.textContent = "Seed";
      const seedInput = document.createElement("input");
      seedInput.className = "db-text-input db-inpaint-number";
      seedInput.type = "number";
      seedInput.min = "0";
      seedInput.value = String(widgets.seed?.value ?? 0);
      seedInput.addEventListener("change", () => {
        if (widgets.seed) widgets.seed.value = Math.max(0, Number(seedInput.value) || 0);
      });
      seed.append(seedLabel, seedInput);

      const left = document.createElement("div");
      left.className = "db-inpaint-column";
      left.append(
        makeSectionLabel("Segmentation"),
        prompt,
        slider("Confidence", widgets.confidence, 0.05, 0.95, 0.01, (v) => v.toFixed(2)),
        slider("Grow", widgets.grow_mask, 0, 64, 1, (v) => String(Math.round(v)), true),
        slider("Feather", widgets.blend_feather, 1, 51, 2, (v) => String(Math.round(v)), true),
      );
      const maskHint = document.createElement("div");
      maskHint.className = "db-inpaint-hint";
      maskHint.textContent = "External MASK input overrides SAM3";
      left.append(maskHint);

      const divider = document.createElement("div");
      divider.className = "db-inpaint-divider";

      const right = document.createElement("div");
      right.className = "db-inpaint-column";
      right.append(
        makeSectionLabel("Sampling"),
        makeSelect("Sampler", widgets.sampler_name),
        makeSelect("Scheduler", widgets.scheduler),
        makeSelect("Priority", widgets.prompt_mode),
        seed,
        slider("Steps", widgets.steps, 1, 100, 1, (v) => String(Math.round(v)), true),
        slider("CFG", widgets.cfg, 0, 20, 0.1, (v) => v.toFixed(1)),
        slider("Denoise", widgets.denoise, 0, 1, 0.01, (v) => v.toFixed(2)),
        slider("Thinking", widgets.lanpaint_steps, 0, 30, 1, (v) => String(Math.round(v)), true),
      );

      const grid = document.createElement("div");
      grid.className = "db-inpaint-grid";
      grid.append(left, divider, right);
      panel.append(sourceButton, status, grid);

      const onImageSourceChanged = () => connectImageLoader();
      window.addEventListener("dirtybirds:image-source-changed", onImageSourceChanged);
      const previousRemoved = node.onRemoved;
      node.onRemoved = function () {
        window.removeEventListener("dirtybirds:image-source-changed", onImageSourceChanged);
        return previousRemoved?.apply(this, arguments);
      };

      node.addDOMWidget("db_inpaint_panel", "customhtml", panel, {
        serialize: false,
        getMinHeight: () => 330,
      });

      function syncWidth() {
        panel.style.width = `${nodeInnerW(node)}px`;
      }
      const previousResize = node.onResize;
      node.onResize = function (size) {
        if (size[0] < 520) size[0] = 520;
        previousResize?.call(this, size);
        syncWidth();
      };
      syncWidth();
      requestAnimationFrame(() => requestAnimationFrame(connectImageLoader));
    };
  },
});
