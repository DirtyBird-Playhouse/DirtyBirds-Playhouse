/** DirtyBirds ✨ Finish — upscale, face restore and sharpen controls. */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  hideWidget,
  installCompareExecuted,
  installComparePreview,
  makeSectionLabel,
  makeSelect,
  makeSlider,
  nodeInnerW,
  reserveHeight,
} from "./db_shared.js";

ensureStylesheet();

// Hand-maintained panel height, deliberately not measured. Panel heights come
// from constants across this pack precisely to avoid a measure -> resize ->
// re-measure loop (resizing a node resizes its DOM widget, which re-triggers the
// measurement). Adding a row here means bumping this number.
//
//   section label 16 + gap 6                        = 22
//   Upscale select 24 + gap 6                       = 30
//   Size slider 24 + gap 6                          = 30
//   section label 16 + gap 6                        = 22
//   Face restore select 24 + gap 6                  = 30
//   Fidelity slider 24                              = 24
//   ---- tallest column (left) ------------------------ 158
//   panel padding/gaps                              = 12
const PANEL_H = 170;

// Sharpen is one slider, matching the Sharpen blueprint it is ported from.

const CODEFORMER = "CodeFormer";

app.registerExtension({
  name: "DirtyBirds.Finish",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsFinish") return;

    // The node returns db_compare_* instead of the usual `images`, so ComfyUI
    // draws no preview of its own and the compare view is the only one.
    installCompareExecuted(nodeType);

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;

      const widgets = Object.fromEntries(
        [
          "upscale_model",
          "upscale_scale",
          "face_restore",
          "codeformer_fidelity",
          "sharpen",
          "face_restore_strength",
        ].map(
          (name) => [name, hideWidget(node, name)],
        ),
      );

      const panel = document.createElement("div");
      panel.className = "db-finish-panel";

      // Named selectField, NOT makeSelect: a local declaration reusing an
      // imported name shadows the import, and the makeSelect() call below would
      // then recurse into this function — a stack overflow inside onNodeCreated
      // that stops the node being added to the graph at all.
      function selectField(label, widget, onChange) {
        const wrap = document.createElement("label");
        wrap.className = "db-finish-field";
        const caption = document.createElement("span");
        caption.className = "db-finish-field-label";
        caption.textContent = label;
        const select = makeSelect();
        select.className = "db-text-input db-finish-select";
        for (const value of widget?.options?.values || []) {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = String(value);
          select.append(option);
        }
        select.value = String(widget?.value ?? "");
        select.addEventListener("change", () => {
          if (widget) widget.value = select.value;
          onChange?.(select.value);
          node.setDirtyCanvas?.(true, true);
        });
        wrap.append(caption, select);
        return { row: wrap, select };
      }

      function slider(label, widget, min, max, step, format) {
        return makeSlider(
          label,
          min,
          max,
          step,
          () => Number(widget?.value ?? min),
          (value) => {
            if (widget) widget.value = value;
          },
          format,
        ).row;
      }

      const twoDp = (v) => Number(v).toFixed(2);

      // ── Left column: what to enlarge and whose faces to fix ────────────────
      const left = document.createElement("div");
      left.className = "db-finish-column";

      const upscale = selectField("Upscale", widgets.upscale_model, (v) =>
        paintScale(v),
      );

      // Final size relative to the input, independent of the model's own
      // factor. 0 keeps whatever the model does, so an existing workflow is
      // unchanged; the readout says "model" rather than "0.00" at that end.
      const scaleRow = slider(
        "Size",
        widgets.upscale_scale,
        0,
        8,
        0.25,
        (v) => (Number(v) > 0 ? `${Number(v).toFixed(2)}x` : "model"),
      );
      const scaleField = document.createElement("div");
      scaleField.className = "db-finish-field";
      scaleField.style.gridTemplateColumns = "minmax(0, 1fr)";
      scaleField.append(scaleRow);

      // Nothing to scale when no upscaler is chosen. Dim rather than hide, so
      // the control below it doesn't jump under the cursor.
      function paintScale(choice) {
        scaleField.classList.toggle(
          "db-finish-inert",
          String(choice ?? "") === "None",
        );
      }

      const fidelityRow = slider(
        "Fidelity",
        widgets.codeformer_fidelity,
        0,
        1,
        0.05,
        twoDp,
      );
      const fidelityField = document.createElement("div");
      fidelityField.className = "db-finish-field";
      fidelityField.style.gridTemplateColumns = "minmax(0, 1fr)";
      fidelityField.append(fidelityRow);

      const restoreStrengthRow = slider(
        "Restore",
        widgets.face_restore_strength,
        0,
        1,
        0.05,
        twoDp,
      );
      const restoreStrengthField = document.createElement("div");
      restoreStrengthField.className = "db-finish-field";
      restoreStrengthField.style.gridTemplateColumns = "minmax(0, 1fr)";
      restoreStrengthField.append(restoreStrengthRow);

      // Fidelity is a CodeFormer-only parameter; GFPGAN ignores it entirely.
      // Dim rather than hide, so the control doesn't move under the cursor.
      function paintFidelity(method) {
        fidelityField.classList.toggle(
          "db-finish-inert",
          String(method) !== CODEFORMER,
        );
        restoreStrengthField.classList.toggle(
          "db-finish-inert",
          String(method ?? "") === "Off",
        );
      }

      const restore = selectField("Faces", widgets.face_restore, paintFidelity);
      paintFidelity(widgets.face_restore?.value);
      paintScale(widgets.upscale_model?.value);

      left.append(
        makeSectionLabel("Upscale"),
        upscale.row,
        scaleField,
        makeSectionLabel("Face Restore"),
        restore.row,
        fidelityField,
      );

      const divider = document.createElement("div");
      divider.className = "db-finish-divider";

      // ── Right column: sharpen ─────────────────────────────────────────────
      const right = document.createElement("div");
      right.className = "db-finish-column";
      right.append(
        makeSectionLabel("Sharpen"),
        slider("Amount", widgets.sharpen, 0, 3, 0.05, twoDp),
      );

      const hint = document.createElement("div");
      hint.className = "db-finish-hint";
      // No invented "useful range" here. 0.15 is the Sharpen blueprint's own
      // default and 3 its own maximum; anything else would be my guess.
      hint.textContent = "0 = off · blueprint default 0.15";
      right.append(hint);
      right.append(
        makeSectionLabel("Face Detail"),
        restoreStrengthField,
      );

      const grid = document.createElement("div");
      grid.className = "db-finish-grid";
      grid.append(left, divider, right);
      panel.append(grid);

      node.addDOMWidget("db_finish_panel", "customhtml", panel, {
        serialize: false,
        height: reserveHeight(PANEL_H),
        getMinHeight: () => reserveHeight(PANEL_H),
      });

      // Click-to-flip Before/After, shared with 🖌️ Inpainting.
      const previewEls = installComparePreview(node, "db_finish");

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

      // onNodeCreated runs before ComfyUI restores a saved workflow's widget
      // values, so the selects above can be built from stale ones. Re-sync once.
      requestAnimationFrame(() => {
        if (widgets.upscale_model) {
          upscale.select.value = String(widgets.upscale_model.value ?? "");
          paintScale(widgets.upscale_model.value);
        }
        if (widgets.face_restore) {
          restore.select.value = String(widgets.face_restore.value ?? "");
          paintFidelity(widgets.face_restore.value);
        }
        syncWidth();
      });
    };
  },
});
