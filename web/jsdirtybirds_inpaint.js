/** DirtyBirds image-only Inpainting node and Image Loader handoff. */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  addTitle,
  ensureStylesheet,
  hideWidget,
  openImageLightbox,
  reserveHeight,
  setDOMWidgetShown,
  viewURL,
  makeSectionLabel,
  makeSlider,
  nodeInnerW,
  makeButton,
  makeTextarea,
  makeInput,
  makeSelect,
} from "./db_shared.js";

ensureStylesheet();

// Mirrors nodes/inpaint/__init__.py — change one and change the other.
const MASK_EVENT = "dirtybirds-inpaint-mask";
const IMAGES_KEY = "db_inpaint_images";
const CAPTION_KEY = "db_inpaint_caption";

const PREVIEW_HEADER_H = 30;
const PREVIEW_IMG_H = 190;
const PREVIEW_WIDGET_H = 198;
// Content height of the settings panel, reserved through reserveHeight().
// 333, not 330: the two settings columns measure 273px and the panel's own
// chrome 60, so 330 cut 3px off the bottom row of the grid (which is
// overflow:hidden, so it vanished rather than spilling).
const INPAINT_PANEL_H = 333;

// A single preview image plus caption. Not the shared compare view: this node
// paints the mask overlay mid-run and the finished image at the end, and those
// are two moments in one run rather than two halves of a flip.
function installMaskPreview(node) {
  const header = addTitle(
    node,
    "db_inpaint_preview_h",
    "Preview",
    PREVIEW_HEADER_H,
  );

  const box = document.createElement("div");
  box.className = "db-compare";
  box.style.height = `${PREVIEW_IMG_H}px`;
  const img = document.createElement("img");
  img.className = "db-compare-img";
  const caption = document.createElement("div");
  caption.className = "db-compare-caption";
  const state = document.createElement("div");
  state.className = "db-compare-state";
  box.append(img, caption, state);
  box.addEventListener("click", () => {
    if (img.src) openImageLightbox(img.src);
  });

  node.addDOMWidget("db_inpaint_preview", "customhtml", box, {
    serialize: false,
    height: reserveHeight(PREVIEW_WIDGET_H),
    getMinHeight: () => reserveHeight(PREVIEW_WIDGET_H),
  });

  const named = (name) => node.widgets?.find((widget) => widget.name === name);
  const show = (visible) => {
    setDOMWidgetShown(node, named("db_inpaint_preview_h"), visible);
    setDOMWidgetShown(node, named("db_inpaint_preview"), visible);
    node.setDirtyCanvas?.(true, true);
  };

  node._dbSetPreview = (images, captionText, label) => {
    const list = images || [];
    if (!list.length) {
      show(false);
      return;
    }
    img.src = viewURL(list[0]);
    caption.textContent = captionText || "";
    state.textContent = label || "";
    show(true);
  };

  show(false);
  return [header, box];
}

// One listener for every Inpainting node on the graph; the payload names which.
api.addEventListener(MASK_EVENT, ({ detail }) => {
  const node = app.graph?.getNodeById?.(Number(detail?.node_id));
  node?._dbSetPreview?.(
    detail?.[IMAGES_KEY],
    detail?.[CAPTION_KEY]?.[0],
    "Mask",
  );
});

function findSlot(slots, name) {
  return (slots || []).findIndex(
    (slot) => String(slot?.name || "").toLowerCase() === name,
  );
}

app.registerExtension({
  name: "DirtyBirds.Inpaint",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsInpaint") return;

    // The finished image replaces the mask overlay the run already showed.
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      this._dbSetPreview?.(
        message?.[IMAGES_KEY],
        message?.[CAPTION_KEY]?.[0],
        "Result",
      );
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;

      const widgets = Object.fromEntries(
        [
          "segment_prompt",
          "confidence",
          "seed",
          "steps",
          "cfg",
          "sampler_name",
          "scheduler",
          "denoise",
          "lanpaint_steps",
          "prompt_mode",
          "blend_feather",
          "grow_mask",
        ].map((name) => [name, hideWidget(node, name)]),
      );

      const panel = document.createElement("div");
      panel.className = "db-inpaint-panel";

      const sourceButton = makeButton();
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
          (candidate) =>
            candidate !== node &&
            (candidate.comfyClass === "DirtyBirdsLoadImage" ||
              candidate.type === "DirtyBirdsLoadImage"),
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
        if (node.inputs[imageIn].link == null)
          source.connect(imageOut, node, imageIn);
        setStatus("Image Loader connected.", "ok");
        return true;
      }

      sourceButton.addEventListener("click", connectImageLoader);

      // NOT named makeSelect: that would shadow the shared factory imported at
      // the top of this file, and the call below would recurse into this
      // function instead — a stack overflow inside onNodeCreated, which stops
      // the node being instantiated at all (it lists in the menu but cannot be
      // added to the graph).
      function makeSelectField(label, widget) {
        const wrap = document.createElement("label");
        wrap.className = "db-inpaint-field";
        const caption = document.createElement("span");
        caption.className = "db-inpaint-field-label";
        caption.textContent = label;
        const select = makeSelect();
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
          label,
          min,
          max,
          step,
          () => Number(widget?.value ?? min),
          (value) => {
            if (widget) widget.value = integer ? Math.round(value) : value;
          },
          format,
        ).row;
      }

      const prompt = makeTextarea();
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
      const seedInput = makeInput();
      seedInput.className = "db-text-input db-inpaint-number";
      seedInput.type = "number";
      seedInput.min = "0";
      seedInput.value = String(widgets.seed?.value ?? 0);
      seedInput.addEventListener("change", () => {
        if (widgets.seed)
          widgets.seed.value = Math.max(0, Number(seedInput.value) || 0);
      });
      seed.append(seedLabel, seedInput);

      const left = document.createElement("div");
      left.className = "db-inpaint-column";
      left.append(
        makeSectionLabel("Segmentation"),
        prompt,
        slider("Confidence", widgets.confidence, 0.05, 0.95, 0.01, (v) =>
          v.toFixed(2),
        ),
        slider(
          "Grow",
          widgets.grow_mask,
          0,
          64,
          1,
          (v) => String(Math.round(v)),
          true,
        ),
        slider(
          "Feather",
          widgets.blend_feather,
          1,
          51,
          2,
          (v) => String(Math.round(v)),
          true,
        ),
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
        makeSelectField("Sampler", widgets.sampler_name),
        makeSelectField("Scheduler", widgets.scheduler),
        makeSelectField("Priority", widgets.prompt_mode),
        seed,
        slider(
          "Steps",
          widgets.steps,
          1,
          100,
          1,
          (v) => String(Math.round(v)),
          true,
        ),
        slider("CFG", widgets.cfg, 0, 20, 0.1, (v) => v.toFixed(1)),
        slider("Denoise", widgets.denoise, 0, 1, 0.01, (v) => v.toFixed(2)),
        slider(
          "Thinking",
          widgets.lanpaint_steps,
          0,
          30,
          1,
          (v) => String(Math.round(v)),
          true,
        ),
      );

      const grid = document.createElement("div");
      grid.className = "db-inpaint-grid";
      grid.append(left, divider, right);
      panel.append(sourceButton, status, grid);

      const onImageSourceChanged = () => connectImageLoader();
      window.addEventListener(
        "dirtybirds:image-source-changed",
        onImageSourceChanged,
      );
      const previousRemoved = node.onRemoved;
      node.onRemoved = function () {
        window.removeEventListener(
          "dirtybirds:image-source-changed",
          onImageSourceChanged,
        );
        return previousRemoved?.apply(this, arguments);
      };

      node.addDOMWidget("db_inpaint_panel", "customhtml", panel, {
        serialize: false,
        getMinHeight: () => reserveHeight(INPAINT_PANEL_H),
      });

      const previewEls = installMaskPreview(node);

      // Width is read FROM the node; nothing here measures content and resizes
      // the node back, which is what makes this safe to call on every resize.
      const sized = [panel, ...previewEls];
      function syncWidth() {
        const width = `${nodeInnerW(node)}px`;
        sized.forEach((element) => {
          element.style.width = width;
        });
      }
      const previousResize = node.onResize;
      node.onResize = function (size) {
        previousResize?.call(this, size);
        syncWidth();
      };
      syncWidth();
      requestAnimationFrame(() => requestAnimationFrame(connectImageLoader));
    };
  },
});
