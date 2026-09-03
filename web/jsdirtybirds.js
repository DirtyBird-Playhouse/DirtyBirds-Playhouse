/**
 * DirtyBirds Playhouse — Generation Setup
 *
 * One ComfyUI DOM widget owns the entire interface.  All visible controls are
 * ordinary children of that widget, so there are no competing canvas layouts,
 * reparented widgets, scroll-height feedback loops, or incremental resize math.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  fetchJSON,
  nodeInnerW,
  hideWidget as hideWidgetShared,
  makeSectionLabel,
  makeCollapsibleSectionLabel,
  reserveHeight,
} from "./db_shared.js";

ensureStylesheet();

function makeAspectSVG(width, height) {
  const box = 18;
  const rw =
    width >= height ? box : Math.max(2, Math.round((width / height) * box));
  const rh =
    width >= height ? Math.max(2, Math.round((height / width) * box)) : box;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", box);
  svg.setAttribute("height", box);
  svg.setAttribute("viewBox", `0 0 ${box} ${box}`);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", Math.floor((box - rw) / 2));
  rect.setAttribute("y", Math.floor((box - rh) / 2));
  rect.setAttribute("width", rw);
  rect.setAttribute("height", rh);
  rect.setAttribute("rx", "1");
  rect.setAttribute("fill", "currentColor");
  svg.append(rect);
  return svg;
}

// Fills `mount` with an <img>; if the URL isn't a decodable image (e.g. the
// only preview asset is an mp4/webm), falls back to a muted looping <video>
// before giving up. Shared by every preview surface (checkpoint, LoRA,
// embedding) so none of them silently go blank for video-only previews.
function loadMedia(mount, url, onMissing, onLoaded) {
  const image = document.createElement("img");
  image.alt = "";
  image.onload = () => {
    mount.replaceChildren(image);
    onLoaded?.();
  };
  image.onerror = () => {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      mount.replaceChildren(video);
      video.play?.().catch(() => {});
      onLoaded?.();
    };
    video.onerror = () => {
      onMissing?.();
    };
    video.src = url;
  };
  image.src = url;
}

function closeFlyouts() {
  document.querySelectorAll(".db-flyout-overlay,.db-flyout").forEach((item) => {
    item._dbCleanup?.();
    item.remove();
  });
}

function flyoutShell(title) {
  closeFlyouts();
  const overlay = el("div", "db-flyout-overlay");
  const panel = el("div", "db-flyout db-generation-flyout");
  const header = el("div", "db-flyout-header");
  const close = button("✕", closeFlyouts, "db-flyout-close");
  header.append(el("span", "db-flyout-title", title), close);
  panel.append(header);
  overlay.addEventListener("click", closeFlyouts);
  document.body.append(overlay, panel);
  return panel;
}

function showCardPicker(title, names, current, previewURL, onPick) {
  const panel = flyoutShell(title);
  const toolbar = el("div", "db-generation-picker-toolbar");
  const search = el("input", "db-generation-picker-search");
  search.type = "search";
  search.placeholder = `Search ${title.toLowerCase()}`;
  search.setAttribute("aria-label", `Search ${title}`);
  const folder = el("select", "db-generation-picker-folder");
  folder.setAttribute("aria-label", `Filter ${title} by folder`);
  const normalizedNames = names.map((name) => {
    const normalized = String(name).replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    return {
      name,
      normalized,
      folder: slash >= 0 ? normalized.slice(0, slash) : "(root)",
    };
  });
  const folders = [...new Set(normalizedNames.map((item) => item.folder))].sort(
    (a, b) => a.localeCompare(b),
  );
  for (const value of ["All folders", ...folders]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    folder.append(option);
  }
  const count = el("span", "db-generation-picker-count");
  toolbar.append(search, folder, count);
  const grid = el("div", "db-generation-card-grid");
  let observer = null;

  function renderCards() {
    observer?.disconnect();
    observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer.unobserve(entry.target);
                entry.target._dbLoadPreview?.();
              }
            },
            { root: grid, rootMargin: "180px" },
          )
        : null;
    const query = search.value.trim().toLowerCase();
    const selectedFolder = folder.value;
    const filtered = normalizedNames.filter(
      (item) =>
        (!query || item.normalized.toLowerCase().includes(query)) &&
        (selectedFolder === "All folders" || item.folder === selectedFolder),
    );
    count.textContent = `${filtered.length} / ${normalizedNames.length}`;
    grid.replaceChildren();
    if (!filtered.length)
      grid.append(el("div", "db-generation-picker-empty", "Nothing found"));
    for (const item of filtered) {
      const card = el(
        "button",
        `db-generation-picker-card${item.name === current ? " is-selected" : ""}`,
      );
      card.type = "button";
      const media = el("div", "db-generation-picker-media", "Preview");
      media._dbLoadPreview = () => {
        if (media.dataset.loaded) return;
        media.dataset.loaded = "true";
        loadMedia(media, previewURL(item.name), () => {
          media.textContent = "No preview";
        });
      };
      if (observer) observer.observe(media);
      else media._dbLoadPreview();
      const label = el(
        "span",
        "db-generation-picker-label",
        item.normalized
          .split("/")
          .pop()
          .replace(/\.[^.]+$/, ""),
      );
      card.title = item.normalized;
      card.append(media, label);
      card.addEventListener("click", () => {
        closeFlyouts();
        onPick(item.name);
      });
      grid.append(card);
    }
  }
  search.addEventListener("input", renderCards);
  folder.addEventListener("change", renderCards);
  panel._dbCleanup = () => observer?.disconnect();
  panel.append(toolbar, grid);
  renderCards();
  requestAnimationFrame(() => search.focus());
}

function showResolutionEditor(title, rows, onSave) {
  const panel = flyoutShell(title);
  const list = el("div", "db-generation-resolution-editor");
  const records = [];
  const addRow = (record = { label: "Custom", width: 1024, height: 1024 }) => {
    const row = el("div", "db-generation-resolution-edit-row");
    const label = el("input", "db-generation-edit-input");
    label.value = record.label || "";
    label.placeholder = "Label";
    const width = el("input", "db-generation-edit-input");
    width.type = "number";
    width.value = record.width;
    width.min = 64;
    width.max = 8192;
    width.step = 8;
    const height = el("input", "db-generation-edit-input");
    height.type = "number";
    height.value = record.height;
    height.min = 64;
    height.max = 8192;
    height.step = 8;
    const snap = (input) => {
      const value = clamp(input.value || 1024, 64, 8192);
      input.value = String(Math.round(value / 8) * 8);
    };
    width.addEventListener("change", () => snap(width));
    height.addEventListener("change", () => snap(height));
    const remove = button("×", () => row.remove(), "db-generation-remove");
    row.append(label, width, height, remove);
    list.append(row);
    records.push({ row, label, width, height });
  };
  rows.forEach(addRow);
  const actions = el("div", "db-generation-editor-actions");
  actions.append(
    button("+ Add", () => addRow()),
    button(
      "Save",
      async () => {
        const values = records
          .filter((item) => item.row.isConnected)
          .map((item) => ({
            label: item.label.value.trim(),
            width: Math.round(clamp(item.width.value, 64, 8192) / 8) * 8,
            height: Math.round(clamp(item.height.value, 64, 8192) / 8) * 8,
          }))
          .filter(
            (item) => item.label && item.width >= 64 && item.height >= 64,
          );
        await onSave(values);
        closeFlyouts();
      },
      "is-active",
    ),
  );
  panel.append(list, actions);
}

// 🎲 Random sentinels stored in the `dimension` widget. The backend rolls the
// actual size per run (see dimension_store.pick_random_dimension), so these
// values must stay in step with its sentinels.
const RANDOM_DIMENSIONS = {
  __random__: "🎲 Random",
  __random_portrait__: "🎲 Random portrait",
  __random_landscape__: "🎲 Random landscape",
  __random_square__: "🎲 Random square",
};
const isRandomDimension = (value) =>
  Object.prototype.hasOwnProperty.call(RANDOM_DIMENSIONS, value);

function showResolutionPicker(dimensions, current, onPick, onCustom, onEdit) {
  const panel = flyoutShell("Resolution");
  const list = el("div", "db-flyout-list");
  const addChoice = (glyph, label, value, selected = false) => {
    const row = el("button", `db-res-opt${selected ? " db-selected" : ""}`);
    row.type = "button";
    const icon = el("span", "db-res-opt-glyph");
    if (glyph instanceof Element) icon.append(glyph);
    else icon.textContent = glyph;
    row.append(icon, el("span", "db-res-opt-label", label));
    row.addEventListener("click", () => {
      closeFlyouts();
      value === "custom"
        ? onCustom()
        : value === "edit"
          ? onEdit()
          : onPick(value);
    });
    list.append(row);
  };
  // Shape-filtered rolls: an unfiltered Random mixes portrait and landscape,
  // which rarely suits the subject. Only offer a shape that has presets.
  const shapes = Object.values(dimensions);
  const hasShape = (test) =>
    shapes.some(([width, height]) => test(width, height));
  const shapeAvailable = {
    __random__: () => true,
    __random_portrait__: () => hasShape((w, h) => h > w),
    __random_landscape__: () => hasShape((w, h) => w > h),
    __random_square__: () => hasShape((w, h) => w === h),
  };
  for (const [value, label] of Object.entries(RANDOM_DIMENSIONS)) {
    if (shapeAvailable[value]())
      addChoice("🎲", label.replace("🎲 ", ""), value, current === value);
  }
  addChoice("+", "Custom resolution", "custom");
  addChoice("✎", "Edit stored resolutions", "edit");
  for (const [label, [width, height]] of Object.entries(dimensions)) {
    const svg = makeAspectSVG(width, height);
    addChoice(
      svg,
      `${label}  ·  ${width}×${height}`,
      label,
      current === label || current === `${width}x${height}`,
    );
  }
  panel.append(list);
}

// Section heights are computed from known state (item counts, whether a
// preview is reserved) rather than measured DOM height, so layout can never
// feed its own height back into ComfyUI and grow on every draw. Lists beyond
// their row cap scroll internally (.db-generation-lora-list /
// .db-generation-trigger-list) instead of growing the section unbounded.
// Generation block (checkpoint + settings + full-width seed) + collapsed headers.
// 356 not 340: the resolution caption made the settings column (res + caption +
// batch + denoise = ~115px) taller than the model column (checkpoint + 64px
// preview = ~100px), so the settings column now sets the workspace height.
// Measured in a live ComfyUI against a real node, not estimated. This file must
// never measure at runtime — that is what caused the old resize feedback loop —
// so the measuring is done once, by hand, from the browser console, and the
// result is written here. Re-measure that way if a row's contents change.
// Left at its original value on purpose. Measured content is 302-329 depending
// on how wide the node is dragged, and trimming this to fit the wide case hid
// the LoRAs section entirely at the default width. The ~30px saved is not worth
// a section disappearing.
const PANEL_BASE_HEIGHT = 356;
// label 13 + controls 26 + weights 26 + three 5px gaps + 6px top accent = 98,
// re-measured in a live ComfyUI with the section expanded. Was 86, which clipped
// the bottom of the weight boxes once Embeddings was opened.
const EMBED_CARD_BASE_H = 98; // enable + picker + weight box, no preview (incl. top accent)
const EMBED_PREVIEW_H = 74; // added once if either slot reserves a 64px preview
const LORA_SECTION_BASE_H = 70; // "Selected"/"Trigger Words" labels + add-row chrome
const LORA_EMPTY_H = 33; // the "No LoRAs selected" placeholder, which is not a row
// Row PITCH, not row height: a row measures 124px and the list puts a 5px gap
// after it. Was 118, which under-reserved by 11px per row — one row hid inside
// the panel's slack, but three clipped 14px off the bottom of the LoRA list.
// Re-measured in a live ComfyUI with three LoRAs selected.
const LORA_ROW_H = 129; // thumb(64) + name line + weights row + padding + 5px gap
const LORA_ROW_CAP = 4; // beyond this the list scrolls instead of growing (4 * 129 = 516px, matches the CSS max-height)
// A trigger chip is a whole trigger set now, not one word, so the text wraps to
// two lines in this column — measured at 40px plus the 5px gap.
const TRIGGER_ROW_H = 48;
const TRIGGER_ROW_CAP = 4; // 4 * 48 = 192px, matches the CSS max-height
// 10: the resolution caption raised the panel's minimum height. Bumping this
// re-normalizes already-saved nodes once, which both clears the clipped section
// header and drops the dead space under it.
// 11: saved nodes were sitting taller than their content — empty space under
// the LoRA row. Same one-shot re-fit; manual resizing afterwards is preserved.
// 12: the height constants above were re-measured in a live ComfyUI; the panel
// reserved ~93px it never used, and ~104px more per collapsed LoRA list.
const UI_VERSION = 12;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
// Outer bound for LoRA model/CLIP strength and embedding weight. Well past any
// normal value; the old ±2 stop was cutting off legitimate over-driven weights.
const LORA_WEIGHT_LIMIT = 5;
const findWidget = (node, name) =>
  node.widgets?.find((widget) => widget.name === name);
const findInput = (node, name) =>
  node.inputs?.find((input) => input.name === name);

function parseJSON(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function setWidget(widget, value, node) {
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value, app.canvas, node, [0, 0], null);
  app.graph?.setDirtyCanvas(true, true);
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function button(text, onClick, className = "") {
  const control = el(
    "button",
    `db-generation-button ${className}`.trim(),
    text,
  );
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}

function selectControl(values, onChange) {
  const control = el("select", "db-generation-select");
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    control.append(option);
  }
  control.addEventListener("change", () => onChange(control.value));
  return control;
}

function rangeControl(min, max, step, onInput) {
  const control = el("input", "db-generation-range");
  control.type = "range";
  control.min = min;
  control.max = max;
  control.step = step;
  control.addEventListener("input", () => onInput(Number(control.value)));
  return control;
}

function field(label, control, valueElement = null) {
  const row = el("div", "db-generation-field");
  row.append(el("span", "db-generation-field-label", label), control);
  if (valueElement) row.append(valueElement);
  return row;
}

// Centered "═ TITLE ▸ expand ═" heading — the same convention every other
// DirtyBirds node uses for its optional sections (Prompt Enhance, Image Loader, Save
// Prompt). Only the label markup is reused here; the Loader keeps one DOM owner:
// this node's sections stay plain children of the single owning panel widget,
// with height driven by `state`/`applyLayout`, not a widget of their own.
function section(title, key, state, applyLayout) {
  const root = el("section", `db-generation-section db-generation-${key}`);
  const body = el("div", "db-generation-section-body");
  const heading = makeCollapsibleSectionLabel(title, {
    expanded: state[key],
    onChange: (isOpen) => {
      state[key] = isOpen;
      root.classList.toggle("is-open", isOpen);
      body.hidden = !isOpen;
      applyLayout(true);
    },
  });
  root.classList.toggle("is-open", state[key]);
  body.hidden = !state[key];
  root.append(heading.label, body);
  return {
    root,
    body,
    setCount(count) {
      heading.setTitle(count ? `${title} · ${count}` : title);
    },
  };
}

function setupGenerationNode(node) {
  if (node._dbGenerationBuilt) return;
  node._dbGenerationBuilt = true;
  node.color = DB_COLOR;
  node.bgcolor = DB_BGCOLOR;
  node.resizable = true;

  const widgets = Object.fromEntries(
    (node.widgets || []).map((widget) => [widget.name, widget]),
  );
  const backingNames = [
    // positive/negative become forceInput sockets, but ComfyUI retains their
    // backing widgets. They must cancel their widget-row spacing too.
    "positive",
    "negative",
    "workflow",
    "ckpt_name",
    "dimension",
    "loras_data",
    "trigger_words_data",
    "batch_size",
    "seed",
    "denoise",
    "seed_mode",
    "clip_skip",
    "vae_name",
    "pos_embedding",
    "neg_embedding",
  ];
  for (const name of backingNames) {
    if (widgets[name]) hideWidgetShared(node, name);
  }

  const savedUiVersion = Number(node.properties?.db_generation_ui_version || 0);
  const saved = node.properties?.db_generation_sections || {};
  const state = {
    embeddings: Boolean(saved.embeddings),
    loras: Boolean(saved.loras),
  };
  let loras = parseJSON(widgets.loras_data?.value);
  let triggerWords = parseJSON(widgets.trigger_words_data?.value);
  function syncLoraStateFromWidgets() {
    // onNodeCreated sees defaults; onConfigure runs after saved widget values
    // are restored. Re-read both backing fields so the visible panel always
    // represents the data that ComfyUI will queue.
    loras = parseJSON(widgets.loras_data?.value);
    triggerWords = parseJSON(widgets.trigger_words_data?.value);
    // A trigger word is owned by a selected LoRA and must not survive without
    // that parent.
    const selectedLoraNames = new Set(
      loras.map((item) => item?.name).filter(Boolean),
    );
    const currentTriggerWords = triggerWords.filter((item) =>
      selectedLoraNames.has(item?.lora),
    );
    if (currentTriggerWords.length !== triggerWords.length) {
      triggerWords = currentTriggerWords;
      if (widgets.trigger_words_data)
        widgets.trigger_words_data.value = JSON.stringify(triggerWords);
    }
  }
  syncLoraStateFromWidgets();

  const panel = el("div", "db-generation-panel");
  panel.style.setProperty("--db-node-bg", DB_BGCOLOR);
  const panelWidget = node.addDOMWidget(
    "db_generation_panel",
    "customhtml",
    panel,
    {
      serialize: false,
      getMinHeight: () => reserveHeight(currentPanelHeight()),
      afterResize: (resizedNode) => syncPanelWidth(resizedNode),
    },
  );

  // The DOM widget owns live width synchronization. ComfyUI calls afterResize
  // during an interactive drag, whereas replacing node.onResize is unreliable
  // and can conflict with LiteGraph or another extension's resize lifecycle.
  function syncPanelWidth(resizedNode = node) {
    panel.style.width = nodeInnerW(resizedNode || node) + "px";
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => syncPanelWidth(node)),
  );

  function embeddingsHeight() {
    const hasPreview =
      Boolean(readEmbedding(widgets.pos_embedding?.value).name) ||
      Boolean(readEmbedding(widgets.neg_embedding?.value).name);
    return EMBED_CARD_BASE_H + (hasPreview ? EMBED_PREVIEW_H : 0);
  }

  function lorasHeight() {
    // An empty list shows a one-line placeholder, not a row. Reserving a full
    // row for it left ~100px of blank space under the section.
    const loraH = loras.length
      ? Math.min(loras.length, LORA_ROW_CAP) * LORA_ROW_H
      : LORA_EMPTY_H;
    const triggerH = triggerWords.length
      ? Math.min(triggerWords.length, TRIGGER_ROW_CAP) * TRIGGER_ROW_H
      : LORA_EMPTY_H;
    return LORA_SECTION_BASE_H + Math.max(loraH, triggerH);
  }

  function currentPanelHeight() {
    let height = PANEL_BASE_HEIGHT;
    if (state.embeddings) height += embeddingsHeight();
    if (state.loras) height += lorasHeight();
    return height;
  }

  // Remember the content height independently from node.size. Section toggles
  // apply exactly one height delta; routine syncs only enforce the current
  // minimum and therefore preserve any extra height chosen by the user.
  let previousPanelHeight = currentPanelHeight();

  function naturalNodeHeight(panelHeight) {
    // computeSize is safe here because the panel height is a fixed formula—no
    // live DOM measurement feeds back into it. Temporarily clear an old
    // serialized minimum so it cannot keep a rebuilt node artificially tall.
    const previousMinimum = node.min_height;
    node.min_height = 0;
    const computed =
      typeof node.computeSize === "function" ? node.computeSize() : null;
    node.min_height = previousMinimum;
    return Math.max(panelHeight + 96, Number(computed?.[1]) || 0);
  }

  function applyLayout(
    adjustForSectionToggle = false,
    normalizeSavedHeight = false,
  ) {
    node.properties ||= {};
    node.properties.db_generation_sections = { ...state };
    node.properties.db_generation_ui_version = UI_VERSION;
    const panelHeight = currentPanelHeight();
    const panelDelta = panelHeight - previousPanelHeight;
    const currentWidth = node.size?.[0] || 0;
    const currentHeight = node.size?.[1] || 0;
    const targetWidth = currentWidth;
    panelWidget.computedHeight = reserveHeight(panelHeight);
    panel.style.height = `${panelHeight}px`;
    syncPanelWidth(node);
    const minimumHeight = naturalNodeHeight(panelHeight);
    node.min_height = minimumHeight;

    let targetHeight = normalizeSavedHeight
      ? minimumHeight
      : Math.max(minimumHeight, currentHeight);
    if (adjustForSectionToggle && !normalizeSavedHeight) {
      targetHeight = Math.max(minimumHeight, currentHeight + panelDelta);
    }
    previousPanelHeight = panelHeight;

    if (targetWidth !== currentWidth || targetHeight !== currentHeight) {
      node.setSize([targetWidth, targetHeight]);
    }
    app.graph?.setDirtyCanvas(true, true);
  }

  node._dbApplyGenerationLayout = applyLayout;

  // Generation -------------------------------------------------------------
  const generation = el(
    "section",
    "db-generation-section is-open db-generation-main",
  );
  generation.append(makeSectionLabel("Generation"));
  const generationBody = el("div", "db-generation-section-body");
  generation.append(generationBody);

  const workflow = el("div", "db-generation-segmented");
  const textToImage = button("Text → Image", () => setWorkflow("Text2Image"));
  const imageToImage = button("Image → Image", () =>
    setWorkflow("Image2Image"),
  );
  workflow.append(textToImage, imageToImage);

  let dimensions = { "1024x1024": [1024, 1024] };
  const checkpointValues = widgets.ckpt_name?.options?.values || [];
  const checkpoint = button(
    "",
    () => {
      showCardPicker(
        "Checkpoints",
        checkpointValues,
        widgets.ckpt_name?.value,
        (name) =>
          `/dirtybirds/model-preview?type=checkpoints&name=${encodeURIComponent(name)}`,
        (name) => {
          setWidget(widgets.ckpt_name, name, node);
          updateCheckpointControl();
          updateCheckpointPreview();
        },
      );
    },
    "db-generation-model-button",
  );
  const checkpointTag = el("span", "db-generation-control-tag", "CKPT");
  const checkpointName = el("span", "db-generation-control-name");
  checkpoint.append(
    checkpointTag,
    checkpointName,
    el("span", "db-generation-control-caret", "▾"),
  );
  const preview = el("div", "db-generation-preview");
  const previewEmpty = el(
    "span",
    "db-generation-preview-empty",
    "No checkpoint preview",
  );
  preview.append(previewEmpty);

  // CLIP skip and VAE override are intentionally not surfaced in the UI — the
  // backing widgets stay hidden at their defaults (clip_skip=1, Baked VAE), so
  // the model column is just the checkpoint selector + its preview.

  const resolution = button(
    "",
    () => {
      const current = widgets.dimension?.value || "__random__";
      showResolutionPicker(
        dimensions,
        current,
        (value) => {
          if (isRandomDimension(value))
            setWidget(widgets.dimension, value, node);
          else {
            const [width, height] = dimensions[value] || [1024, 1024];
            setWidget(widgets.dimension, `${width}x${height}`, node);
          }
          updateResolutionControl();
        },
        () => {
          const raw = widgets.dimension?.value || "1024x1024";
          const [width, height] = raw.split("x").map(Number);
          showResolutionEditor(
            "Custom Resolution",
            [{ label: "Custom", width: width || 1024, height: height || 1024 }],
            (values) => {
              const value = values[0];
              if (value) {
                setWidget(
                  widgets.dimension,
                  `${value.width}x${value.height}`,
                  node,
                );
                updateResolutionControl();
              }
            },
          );
        },
        () => {
          const rows = Object.entries(dimensions).map(
            ([label, [width, height]]) => ({ label, width, height }),
          );
          showResolutionEditor("Edit Resolutions", rows, async (values) => {
            const next = Object.fromEntries(
              values.map((value) => [value.label, [value.width, value.height]]),
            );
            const saved = await fetchJSON("/dirtybirds/dimensions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            if (saved) dimensions = saved;
            updateResolutionControl();
          });
        },
      );
    },
    "db-generation-model-button",
  );
  resolution.append(
    el("span", "db-generation-control-tag", "RES"),
    el("span", "db-generation-control-name"),
    el("span", "db-generation-control-caret", "▾"),
  );
  // Caption under the RES button. The button can only say "🎲 Random"; this
  // line reports the pixel size that will actually be used — and after a run,
  // the size Random rolled (or the size the connected image forced in I2I).
  const resolutionValue = el("div", "db-generation-res-value");
  const batchValue = el("output", "db-generation-value");
  const batch = rangeControl(1, 5, 1, (value) => {
    batchValue.textContent = String(value);
    setWidget(widgets.batch_size, value, node);
  });
  const denoiseValue = el("output", "db-generation-value");
  const denoise = rangeControl(0, 1, 0.01, (value) => {
    denoiseValue.textContent = value.toFixed(2);
    setWidget(widgets.denoise, value, node);
  });
  const i2iWarning = el(
    "div",
    "db-generation-warning",
    "Connect an image to use Image → Image.",
  );

  // Seed mode reads as one segmented control (Fixed / Random / Last). It spans
  // the full panel width below both columns so the three labels have room to
  // breathe instead of being crushed into the narrow settings column.
  const seedRow = el("div", "db-generation-seed-row");
  seedRow.append(el("span", "db-generation-field-label", "Seed"));
  const seedSegment = el("div", "db-generation-segment");
  // JS-safe random seed (<= 2**53-1) so it round-trips exactly, matching the
  // backend cap and the Prompt Builder's roll.
  const newRandomSeed = () => Math.floor(Math.random() * 0x1fffffffffffff);
  const fixedSeed = button(
    "Fixed",
    () => {
      // "New Fixed Random": roll a fresh seed on click, then hold it for reruns.
      setWidget(widgets.seed, newRandomSeed(), node);
      setSeedMode("fixed");
    },
    "db-generation-segment-btn",
  );
  const randomSeed = button(
    "Random",
    () => setSeedMode("random"),
    "db-generation-segment-btn",
  );
  const lastSeed = button(
    "Last",
    () => {
      if (node._dbLastSeed != null)
        setWidget(widgets.seed, node._dbLastSeed, node);
      setSeedMode("fixed");
    },
    "db-generation-segment-btn",
  );
  seedSegment.append(fixedSeed, randomSeed, lastSeed);
  const seedValue = el("span", "db-sel-val db-generation-seed-value");
  seedRow.append(seedSegment, seedValue);

  function paintSeedValue() {
    const mode = widgets.seed_mode?.value || "fixed";
    seedValue.textContent =
      mode === "random"
        ? node._dbLastSeed != null
          ? `last: ${node._dbLastSeed}`
          : "re-rolls each run"
        : String(widgets.seed?.value ?? "");
  }

  const generationColumns = el("div", "db-generation-workspace");
  const modelColumn = el(
    "div",
    "db-generation-column db-generation-model-column",
  );
  const settingsColumn = el(
    "div",
    "db-generation-column db-generation-settings-column",
  );
  modelColumn.append(checkpoint, preview);
  settingsColumn.append(
    resolution,
    resolutionValue,
    field("Batch", batch, batchValue),
    field("Denoise", denoise, denoiseValue),
  );
  generationColumns.append(modelColumn, settingsColumn);
  generationBody.append(workflow, generationColumns, seedRow, i2iWarning);

  function refreshWorkflowState() {
    const value = widgets.workflow?.value || "Text2Image";
    const isI2I = value === "Image2Image";
    textToImage.classList.toggle("is-active", !isI2I);
    imageToImage.classList.toggle("is-active", isI2I);
    denoise.disabled = !isI2I;
    denoise.title = isI2I ? "" : "Denoise only applies in Image → Image mode";
    denoise
      .closest(".db-generation-field")
      ?.classList.toggle("is-disabled", !isI2I);
    const input = findInput(node, "image");
    if (input) input.hidden = !isI2I;
    i2iWarning.hidden = !isI2I || input?.link != null;
    resolution.disabled = isI2I;
    resolution.title = isI2I
      ? "Resolution follows the connected image in Image → Image mode"
      : "";
    resolution.classList.toggle("is-disabled", isI2I);
    paintResolutionValue();
  }

  function setWorkflow(value) {
    setWidget(widgets.workflow, value, node);
    refreshWorkflowState();
  }

  node._dbRefreshGenerationConnections = refreshWorkflowState;

  function setSeedMode(value) {
    setWidget(widgets.seed_mode, value, node);
    fixedSeed.classList.toggle("is-active", value !== "random");
    randomSeed.classList.toggle("is-active", value === "random");
    lastSeed.disabled = node._dbLastSeed == null;
    paintSeedValue();
  }

  function updateCheckpointPreview() {
    const name = widgets.ckpt_name?.value || "";
    preview.replaceChildren(previewEmpty);
    if (!name) return;
    const url = `/dirtybirds/model-preview?type=checkpoints&name=${encodeURIComponent(name)}`;
    loadMedia(preview, url, () => preview.replaceChildren(previewEmpty));
  }

  function updateCheckpointControl() {
    const value = widgets.ckpt_name?.value || checkpointValues[0] || "";
    checkpointName.textContent = value
      ? value
          .replace(/\\/g, "/")
          .split("/")
          .pop()
          .replace(/\.[^.]+$/, "")
      : "Select checkpoint";
    checkpoint.title = value;
  }

  function updateResolutionControl() {
    const value = widgets.dimension?.value || "__random__";
    const label = resolution.querySelector(".db-generation-control-name");
    if (isRandomDimension(value)) label.textContent = RANDOM_DIMENSIONS[value];
    else {
      const match = Object.entries(dimensions).find(
        ([, [width, height]]) => `${width}x${height}` === value,
      );
      label.textContent = match ? match[0] : value.replace("x", "×");
    }
    paintResolutionValue();
  }

  // "832x1216" -> "832 × 1216", plus the preset's name when one matches and
  // that name says something the numbers don't (presets are often named "WxH").
  function describeDimension(value, withName) {
    const [width, height] = String(value).toLowerCase().split("x").map(Number);
    if (!width || !height) return String(value);
    const pretty = `${width} × ${height}`;
    if (!withName) return pretty;
    const match = Object.entries(dimensions).find(
      ([, [presetWidth, presetHeight]]) =>
        presetWidth === width && presetHeight === height,
    );
    const name = match?.[0] || "";
    return name && name.toLowerCase() !== `${width}x${height}`
      ? `${pretty} · ${name}`
      : pretty;
  }

  function paintResolutionValue() {
    const isI2I = (widgets.workflow?.value || "Text2Image") === "Image2Image";
    const last = node._dbLastDimension;
    if (isI2I) {
      resolutionValue.textContent = last
        ? `from image: ${describeDimension(last, true)}`
        : "follows the connected image";
      return;
    }
    const value = widgets.dimension?.value || "__random__";
    if (!isRandomDimension(value)) {
      resolutionValue.textContent = describeDimension(value, false);
      return;
    }
    resolutionValue.textContent = last
      ? `last run: ${describeDimension(last, true)}`
      : "re-rolls each run";
  }

  // Embeddings -------------------------------------------------------------
  const embeddingsSection = section(
    "Embeddings",
    "embeddings",
    state,
    applyLayout,
  );
  const embeddingGrid = el("div", "db-generation-two-column");
  embeddingsSection.body.append(embeddingGrid);
  let embeddingNames = [];

  function makeEmbeddingSlot(label, widget) {
    const card = el("div", "db-generation-card");
    const controls = el("div", "db-generation-embedding-controls");
    const enabled = el("input");
    enabled.type = "checkbox";
    enabled.title = "Enable embedding";
    const picker = selectControl(["(none)", ...embeddingNames], (value) => {
      const parsed = readEmbedding(widget?.value);
      const name = value === "(none)" ? "" : value;
      setWidget(
        widget,
        writeEmbedding(name, parsed.strength, enabled.checked),
        node,
      );
      refreshEmbeddingCount();
      updateEmbeddingPreview(card, name);
      applyLayout();
    });
    // Numeric weight box (mirrors the LoRA rows' Model/CLIP inputs) instead of a
    // slider. Embeddings carry a single scalar strength, so there's one box.
    const strength = el("input", "db-generation-number");
    strength.type = "number";
    strength.min = "0";
    strength.max = String(LORA_WEIGHT_LIMIT);
    strength.step = "0.05";
    strength.title = "Embedding weight";
    strength.addEventListener("change", () => {
      const value = clamp(strength.value, 0, LORA_WEIGHT_LIMIT);
      strength.value = String(value);
      setWidget(
        widget,
        writeEmbedding(
          picker.value === "(none)" ? "" : picker.value,
          value,
          enabled.checked,
        ),
        node,
      );
    });
    enabled.addEventListener("change", () => {
      setWidget(
        widget,
        writeEmbedding(
          picker.value === "(none)" ? "" : picker.value,
          Number(strength.value),
          enabled.checked,
        ),
        node,
      );
      card.classList.toggle("is-disabled", !enabled.checked);
    });
    controls.append(enabled, picker);
    const weights = el("div", "db-generation-embed-weights");
    weights.append(
      el("span", "db-generation-weight-label", "Weight"),
      strength,
    );
    const preview = el("div", "db-generation-embed-preview");
    preview.hidden = true;
    card.append(
      el("span", "db-generation-card-label", label),
      controls,
      weights,
      preview,
    );
    card._picker = picker;
    card._enabled = enabled;
    card._strength = strength;
    card._preview = preview;
    return card;
  }

  // Reserves preview space whenever a name is chosen (matches the checkpoint
  // preview's box-always-present convention) rather than after the image/video
  // actually resolves, so `currentPanelHeight()` stays a pure function of state.
  function updateEmbeddingPreview(card, name) {
    card._preview.hidden = !name;
    if (!name) {
      card._preview.replaceChildren();
      return;
    }
    const empty = el("span", "db-generation-preview-empty", "No preview");
    card._preview.replaceChildren(empty);
    loadMedia(
      card._preview,
      `/dirtybirds/embedding-preview?name=${encodeURIComponent(name)}`,
      () => card._preview.replaceChildren(empty),
    );
  }
  const posEmbedding = makeEmbeddingSlot("Positive", widgets.pos_embedding);
  const negEmbedding = makeEmbeddingSlot("Negative", widgets.neg_embedding);
  posEmbedding.classList.add("db-emb-pos");
  negEmbedding.classList.add("db-emb-neg");
  embeddingGrid.append(posEmbedding, negEmbedding);

  function readEmbedding(raw) {
    raw = String(raw || "");
    const active = !raw.startsWith("!");
    if (!active) raw = raw.slice(1);
    const match = raw.match(/^(.*):(-?\d+(?:\.\d+)?)$/);
    return {
      name: match ? match[1] : raw,
      strength: match ? Number(match[2]) : 1,
      active,
    };
  }

  function writeEmbedding(name, strength = 1, active = true) {
    if (!name) return "";
    const weighted =
      Math.abs(strength - 1) < 0.001
        ? name
        : `${name}:${Number(strength).toFixed(2)}`;
    return active ? weighted : `!${weighted}`;
  }

  function syncEmbeddingCard(card, widget) {
    const parsed = readEmbedding(widget?.value);
    if (
      parsed.name &&
      !Array.from(card._picker.options).some(
        (option) => option.value === parsed.name,
      )
    ) {
      const option = document.createElement("option");
      option.value = parsed.name;
      option.textContent = parsed.name;
      card._picker.append(option);
    }
    card._picker.value = parsed.name || "(none)";
    card._enabled.checked = parsed.active;
    card._strength.value = String(parsed.strength);
    card.classList.toggle("is-disabled", !parsed.active);
    updateEmbeddingPreview(card, parsed.name);
  }

  function refreshEmbeddingCount() {
    const count = [widgets.pos_embedding?.value, widgets.neg_embedding?.value]
      .map(readEmbedding)
      .filter((item) => item.name && item.active).length;
    embeddingsSection.setCount(count);
  }

  // LoRAs ------------------------------------------------------------------
  const loraSection = section("LoRAs", "loras", state, applyLayout);
  let availableLoraNames = [];
  const loraAddRow = el("div", "db-generation-add-row");
  const loraAddBtn = button(
    "",
    () => {
      showCardPicker(
        "Add LoRA",
        availableLoraNames,
        null,
        (name) => `/dirtybirds/lora-preview?name=${encodeURIComponent(name)}`,
        (name) => addLora(name),
      );
    },
    "db-generation-model-button",
  );
  loraAddBtn.append(
    el("span", "db-generation-control-tag", "LORA"),
    el("span", "db-generation-control-name", "+ Add"),
    el("span", "db-generation-control-caret", "▾"),
  );
  loraAddRow.append(loraAddBtn);
  const loraList = el("div", "db-generation-lora-list");
  // Lazy-loads each LoRA thumb on scroll and pauses off-screen video previews,
  // so a long stack of animated (.mp4) previews doesn't decode+loop all at once.
  let loraThumbObserver = null;
  const triggers = el("div", "db-generation-trigger-list");
  const loraColumns = el("div", "db-generation-lora-columns");
  const selectedColumn = el("div", "db-generation-lora-column");
  const triggerColumn = el("div", "db-generation-lora-column");
  selectedColumn.append(
    el("span", "db-generation-card-label", "Selected"),
    loraAddRow,
    loraList,
  );
  triggerColumn.append(
    el("span", "db-generation-card-label", "Trigger Words"),
    triggers,
  );
  loraColumns.append(selectedColumn, triggerColumn);
  loraSection.body.append(loraColumns);

  function saveLoras() {
    setWidget(widgets.loras_data, JSON.stringify(loras), node);
    setWidget(widgets.trigger_words_data, JSON.stringify(triggerWords), node);
    renderLoras();
    applyLayout();
  }

  async function addLora(name) {
    if (!name || loras.some((item) => item.name === name)) return;
    loras.push({ name, strength: 1, clip_strength: 1, active: true });
    try {
      const meta = await fetchJSON(
        `/dirtybirds/lora-meta?name=${encodeURIComponent(name)}`,
      );
      // The model's own name ("Futanari / Penis anatomy"), which reads far
      // better in the list than the filename ("Fta_SDXL_epoch_10"). The
      // filename stays the identity — this is display only.
      const title = (meta?.model_name || "").trim();
      if (title) {
        const entry = loras.find((candidate) => candidate.name === name);
        if (entry) entry.title = title;
      }
      for (const text of meta?.trigger_words || []) {
        if (
          !triggerWords.some((item) => item.lora === name && item.text === text)
        ) {
          triggerWords.push({ lora: name, text, active: true });
        }
      }
    } catch (_) {
      /* metadata is optional */
    }
    saveLoras();
  }

  function renderLoras() {
    loraThumbObserver?.disconnect();
    loraThumbObserver =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  entry.target._dbLoadPreview?.(); // load once, on demand
                  entry.target
                    .querySelector("video")
                    ?.play?.()
                    .catch(() => {});
                } else {
                  entry.target.querySelector("video")?.pause?.(); // stop decoding off-screen
                }
              }
            },
            { root: loraList, rootMargin: "120px" },
          )
        : null;
    loraList.replaceChildren();
    triggers.replaceChildren();
    for (const item of loras) {
      const row = el("div", "db-generation-lora-row");
      const top = el("div", "db-generation-lora-row-top");
      const weights = el("div", "db-generation-lora-weights");
      const thumb = el("div", "db-generation-lora-thumb");
      // Keep the thumb box present (not hidden). A display:none element has no
      // layout box, so an IntersectionObserver never reports it as intersecting —
      // which would leave the preview gated on a callback that can never fire.
      thumb._dbLoadPreview = () => {
        if (thumb.dataset.loaded) return;
        thumb.dataset.loaded = "true";
        loadMedia(
          thumb,
          `/dirtybirds/lora-preview?name=${encodeURIComponent(item.name)}`,
          // No local preview for this LoRA — show a placeholder instead of an
          // empty gap in the reserved thumb column.
          () => {
            thumb.classList.add("db-generation-lora-thumb-empty");
          },
        );
      };
      // Observe for video play/pause of off-screen previews, but load eagerly:
      // canvas-transformed DOM widgets don't yield reliable intersection
      // callbacks, and the visible list is capped at a few rows.
      if (loraThumbObserver) loraThumbObserver.observe(thumb);
      thumb._dbLoadPreview();
      const active = el("input");
      active.type = "checkbox";
      active.checked = item.active !== false;
      active.addEventListener("change", () => {
        item.active = active.checked;
        saveLoras();
      });
      const name = el("span", "db-generation-lora-name", item.name);
      const strength = el("input", "db-generation-number");
      strength.type = "number";
      strength.min = String(-LORA_WEIGHT_LIMIT);
      strength.max = String(LORA_WEIGHT_LIMIT);
      strength.step = "0.05";
      strength.value = String(item.strength ?? 1);
      strength.title = "Model strength";
      strength.addEventListener("change", () => {
        item.strength = clamp(
          strength.value,
          -LORA_WEIGHT_LIMIT,
          LORA_WEIGHT_LIMIT,
        );
        saveLoras();
      });
      const clip = strength.cloneNode();
      clip.value = String(item.clip_strength ?? item.strength ?? 1);
      clip.title = "CLIP strength";
      clip.addEventListener("change", () => {
        item.clip_strength = clamp(
          clip.value,
          -LORA_WEIGHT_LIMIT,
          LORA_WEIGHT_LIMIT,
        );
        saveLoras();
      });
      const remove = button(
        "×",
        () => {
          loras = loras.filter((candidate) => candidate !== item);
          triggerWords = triggerWords.filter(
            (candidate) => candidate.lora !== item.name,
          );
          saveLoras();
        },
        "db-generation-remove",
      );
      // The Selected column is ~130px wide and the thumbnail takes 58 of it, so
      // after the checkbox and the remove button nothing is left beside it —
      // the name used to render as a single truncated letter there. It gets its
      // own full-width line instead, with the weights on the line below.
      // Re-read this LoRA's metadata from disk, past both caches. Trigger words
      // edited in LoRA Manager are otherwise invisible here: the backend caches
      // them per file and the node stores them in the workflow, so neither side
      // ever asks again.
      const refresh = button(
        "⟳",
        async () => {
          refresh.disabled = true;
          refresh.textContent = "…";
          try {
            const meta = await fetchJSON(
              `/dirtybirds/lora-meta?name=${encodeURIComponent(item.name)}&refresh=1`,
            );
            const title = (meta?.model_name || "").trim();
            if (title) item.title = title;
            const incoming = meta?.trigger_words || [];
            if (incoming.length) {
              // Keep the ticked/unticked state of any set that survived the
              // edit; anything new arrives ticked, anything gone disappears.
              const previous = new Map(
                triggerWords
                  .filter((entry) => entry.lora === item.name)
                  .map((entry) => [entry.text, entry.active !== false]),
              );
              triggerWords = triggerWords.filter(
                (entry) => entry.lora !== item.name,
              );
              for (const text of incoming) {
                triggerWords.push({
                  lora: item.name,
                  text,
                  active: previous.has(text) ? previous.get(text) : true,
                });
              }
            }
            saveLoras();
          } catch (_) {
            refresh.textContent = "⟳";
            refresh.disabled = false;
          }
        },
        "db-generation-refresh",
      );
      refresh.title = "Re-read trigger words and name for this LoRA";
      top.append(thumb, active, refresh, remove);
      const nameRow = el("div", "db-generation-lora-name-row");
      nameRow.append(name);
      // Show the model's name; keep the filename on hover, since that is what
      // actually identifies the file on disk.
      name.textContent = item.title || item.name;
      name.title = item.name;
      // A LoRA added before titles were stored has none. Fetch it once, in the
      // background, and fill it in — failure just leaves the filename showing.
      if (!item.title) {
        fetchJSON(`/dirtybirds/lora-meta?name=${encodeURIComponent(item.name)}`)
          .then((meta) => {
            const fetched = (meta?.model_name || "").trim();
            if (!fetched || fetched === item.title) return;
            item.title = fetched;
            name.textContent = fetched;
            setWidget(widgets.loras_data, JSON.stringify(loras), node);
          })
          .catch(() => {});
      }
      weights.append(
        el("span", "db-generation-weight-label", "Model"),
        strength,
        el("span", "db-generation-weight-label", "CLIP"),
        clip,
      );
      row.append(top, nameRow, weights);
      loraList.append(row);
    }
    for (const item of triggerWords) {
      const chip = el("label", "db-generation-trigger");
      chip.title = "Double-click to rename";
      const active = el("input");
      active.type = "checkbox";
      active.checked = item.active !== false;
      active.addEventListener("change", () => {
        item.active = active.checked;
        saveLoras();
      });
      const text = el("span", "db-generation-trigger-text", item.text);
      chip.append(active, text);
      chip.addEventListener("dblclick", (event) => {
        event.preventDefault();
        const input = el("input", "db-generation-trigger-input");
        input.value = item.text;
        chip.replaceChild(input, text);
        input.focus();
        input.select();
        const commit = () => {
          const value = input.value.trim();
          if (value) item.text = value;
          saveLoras();
        };
        input.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key === "Enter") input.blur();
          if (keyEvent.key === "Escape") {
            input.value = item.text;
            input.blur();
          }
        });
        input.addEventListener("blur", commit, { once: true });
      });
      triggers.append(chip);
    }
    if (!loras.length)
      loraList.append(el("div", "db-generation-empty", "No LoRAs selected"));
    if (!triggerWords.length)
      triggers.append(
        el("div", "db-generation-empty", "Trigger words appear here"),
      );
    const activeCount = loras.filter((item) => item.active !== false).length;
    loraSection.setCount(activeCount);
  }

  node._dbApplyLoras = async (incoming, mode = "append") => {
    const normalized = (incoming || [])
      .filter((item) => item?.name)
      .map((item) => ({
        name: item.name,
        strength: Number(item.strength ?? 1),
        clip_strength: Number(item.clip_strength ?? item.strength ?? 1),
        active: item.active !== false,
      }));
    if (mode === "replace") {
      loras = normalized;
      // Drop trigger words whose LoRA is no longer selected.
      const names = new Set(normalized.map((item) => item.name));
      triggerWords = triggerWords.filter((candidate) =>
        names.has(candidate.lora),
      );
    } else {
      for (const item of normalized) {
        const index = loras.findIndex(
          (candidate) => candidate.name === item.name,
        );
        if (index >= 0) loras[index] = item;
        else loras.push(item);
      }
    }
    // Extract trigger words for each incoming LoRA, same as the picker's addLora.
    // LoRAs sent from LoRA Manager come through here, so without this their
    // trigger words never get pulled from the LoRA's metadata/sidecar.
    await Promise.all(
      normalized.map(async (item) => {
        try {
          const meta = await fetchJSON(
            `/dirtybirds/lora-meta?name=${encodeURIComponent(item.name)}`,
          );
          const title = (meta?.model_name || "").trim();
          if (title) item.title = title;
          for (const text of meta?.trigger_words || []) {
            if (
              !triggerWords.some(
                (candidate) =>
                  candidate.lora === item.name && candidate.text === text,
              )
            ) {
              triggerWords.push({ lora: item.name, text, active: true });
            }
          }
        } catch (_) {
          /* metadata is optional */
        }
      }),
    );
    saveLoras();
  };

  panel.append(generation, embeddingsSection.root, loraSection.root);

  async function loadLibraries() {
    const [loadedDimensions, embeddings, availableLoras] = await Promise.all([
      fetchJSON("/dirtybirds/dimensions").catch(() => ({
        "1024x1024": [1024, 1024],
      })),
      fetchJSON("/dirtybirds/embeddings").catch(() => []),
      fetchJSON("/dirtybirds/loras").catch(() => []),
    ]);
    dimensions = loadedDimensions || dimensions;
    embeddingNames = embeddings || [];
    for (const card of [posEmbedding, negEmbedding]) {
      const current = card._picker.value;
      card._picker.replaceChildren();
      for (const value of ["(none)", ...embeddingNames]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        card._picker.append(option);
      }
      card._picker.value = current;
    }
    availableLoraNames = availableLoras || [];
    syncFromWidgets();
  }

  function syncFromWidgets() {
    syncLoraStateFromWidgets();
    batch.value = String(widgets.batch_size?.value ?? 1);
    batchValue.textContent = batch.value;
    denoise.value = String(widgets.denoise?.value ?? 1);
    denoiseValue.textContent = Number(denoise.value).toFixed(2);
    syncEmbeddingCard(posEmbedding, widgets.pos_embedding);
    syncEmbeddingCard(negEmbedding, widgets.neg_embedding);
    setWorkflow(widgets.workflow?.value || "Text2Image");
    setSeedMode(widgets.seed_mode?.value || "fixed");
    refreshEmbeddingCount();
    renderLoras();
    updateCheckpointControl();
    updateResolutionControl();
    updateCheckpointPreview();
  }

  node._dbGenerationSync = syncFromWidgets;
  node._dbGenerationExecuted = (message) => {
    node._dbLastSeed = message?.db_seed_used?.[0];
    lastSeed.disabled = node._dbLastSeed == null;
    paintSeedValue();
    const usedDimension = message?.db_dimension_used?.[0];
    if (usedDimension) {
      node._dbLastDimension = usedDimension;
      paintResolutionValue();
    }
    renderLoras();
  };

  loadLibraries();
  requestAnimationFrame(() => {
    syncFromWidgets();
    // Version 6 removes leaked forceInput widget rows and the obsolete base
    // reserve. Normalize once; later routine syncs preserve manual resizing.
    applyLayout(false, savedUiVersion < UI_VERSION);
  });
}

app.registerExtension({
  name: "DirtyBirds.GenerationSetup",
  setup() {
    // ── LoRA Manager integration ─────────────────────────────────────────
    // Receives <lora:name:strength> or <lora:name:strength:clip_strength>
    // syntax from the comfyui-lora-manager "Send to node" action.
    // (The dirtybirds_set_loras / _set_embedding listeners live at module scope.)
    api.addEventListener("lora_code_update", (event) => {
      const d = event?.detail || {};
      const nodeId = d.node_id ?? d.id;
      const loraCode = d.lora_code ?? "";
      const mode = d.mode ?? "append";

      const numericId = typeof nodeId === "string" ? Number(nodeId) : nodeId;

      // Collect target DB loader nodes
      const targets = [];
      if (numericId === -1) {
        // Broadcast — find all DirtyBirdsLoader nodes
        const allNodes =
          app.graph?._nodes || Object.values(app.graph?._nodes_by_id || {});
        (Array.isArray(allNodes) ? allNodes : []).forEach((n) => {
          if (n?.comfyClass === "DirtyBirdsLoader") targets.push(n);
        });
      } else {
        const n = app.graph?.getNodeById?.(numericId);
        if (n?.comfyClass === "DirtyBirdsLoader") targets.push(n);
      }

      if (!targets.length) return;

      // Parse <lora:name:model_strength> or <lora:name:model_strength:clip_strength>
      const loraPattern = /<lora:([^:>]+):([-\d.]+)(?::([-\d.]+))?>/g;
      const loras = [];
      let match;
      while ((match = loraPattern.exec(loraCode)) !== null) {
        const strength = parseFloat(match[2]);
        const clipStrength = match[3] != null ? parseFloat(match[3]) : null;
        loras.push({
          name: match[1],
          strength: isNaN(strength) ? 1.0 : strength,
          clip_strength:
            clipStrength != null && !isNaN(clipStrength) ? clipStrength : null,
          active: true,
        });
      }

      if (!loras.length) return;

      targets.forEach((n) => {
        if (typeof n._dbApplyLoras === "function") {
          n._dbApplyLoras(loras, mode);
        }
      });
    });

    // ── Register DirtyBirdsLoader as lora-capable in LoRA Manager's registry ─────
    // Replaces LM's refreshRegistry so DirtyBirdsLoader appears in "Send to node".
    // We must include DirtyBirds in the SAME register-nodes POST that LM makes,
    // because the server waits for exactly one POST and returns immediately after.
    //
    // The install is load-order safe: if LM's extension hasn't registered yet
    // when this setup() runs, we retry briefly until it appears. refreshRegistry
    // is only invoked on a user "Send to node" action, so installing within a
    // couple seconds of load is always in time.
    function installLMRegistryOverride() {
      const lmExt = app.extensions?.find(
        (e) => e.name === "LoraManager.WorkflowRegistry",
      );
      if (!lmExt || typeof lmExt.refreshRegistry !== "function") return false;
      if (lmExt._dbOverrideInstalled) return true; // idempotent
      lmExt._dbOverrideInstalled = true;

      const LM_LORA_CLASSES = new Set([
        "Lora Loader (LoraManager)",
        "Lora Stacker (LoraManager)",
        "WanVideo Lora Select (LoraManager)",
      ]);
      const LM_TARGET_WIDGETS = new Set(["ckpt_name", "unet_name"]);

      lmExt.refreshRegistry = async function () {
        try {
          const workflowNodes = [];

          function collectNodes(g, visited = new Set()) {
            const gid = String(g?.id ?? "root");
            if (!g || visited.has(gid)) return;
            visited.add(gid);

            if (Array.isArray(g._nodes)) {
              const graphName =
                typeof g.name === "string" && g.name.trim() ? g.name : null;
              for (const node of g._nodes) {
                if (!node) continue;
                const widgetNames = Array.isArray(node.widgets)
                  ? node.widgets
                      .map((w) => w?.name)
                      .filter((n) => typeof n === "string" && n)
                  : [];
                const isLMNode = LM_LORA_CLASSES.has(node.comfyClass);
                const isDBNode = node.comfyClass === "DirtyBirdsLoader";
                const hasTargetWidget = widgetNames.some((n) =>
                  LM_TARGET_WIDGETS.has(n),
                );
                if (!isLMNode && !isDBNode && !hasTargetWidget) continue;

                workflowNodes.push({
                  node_id: node.id,
                  graph_id: gid,
                  graph_name: graphName,
                  bgcolor: node.bgcolor ?? node.color ?? null,
                  title: node.title || node.comfyClass,
                  type: node.comfyClass,
                  comfy_class: node.comfyClass,
                  mode: node.mode,
                  capabilities: {
                    supports_lora: isLMNode || isDBNode,
                    widget_names: widgetNames,
                  },
                });
              }
            }

            // Walk subgraphs (mirrors LM's traverseGraphs logic)
            const subs = g._subgraphs;
            if (subs) {
              const subArr =
                typeof subs.values === "function"
                  ? [...subs.values()]
                  : Object.values(subs);
              for (const sg of subArr) {
                const sub = sg?.graph || sg?._graph || sg;
                if (sub && sub !== g) collectNodes(sub, visited);
              }
            }
          }

          collectNodes(app.graph);

          const dbCount = workflowNodes.filter(
            (n) => n.comfy_class === "DirtyBirdsLoader",
          ).length;
          console.debug(
            `[DirtyBirds] LM refreshRegistry (override): posting ${workflowNodes.length} node(s), ${dbCount} DirtyBirdsLoader`,
          );

          const resp = await fetch("/api/lm/register-nodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // LoRA Manager keys each workflow registry by the active ComfyUI
            // websocket client. Current releases reject registrations without
            // this value, which made "Send to node" silently lose DirtyBirds.
            body: JSON.stringify({
              nodes: workflowNodes,
              client_id: api.clientId ?? api.initialClientId ?? "",
            }),
          });
          if (!resp.ok)
            console.warn(
              "[DirtyBirds] LM register-nodes failed:",
              resp.statusText,
            );
        } catch (e) {
          console.warn("[DirtyBirds] Error in LM registry refresh:", e);
        }
      };
      console.debug("[DirtyBirds] LM registry override installed");
      return true;
    }

    // Try now; if LoRA Manager's extension hasn't registered yet, keep retrying.
    // "Send to node" happens well after load, but LM can register slowly on cold
    // starts, so we poll generously (~30s) rather than giving up after a beat —
    // if the override isn't installed when the user sends, LM's own (empty on
    // this setup) refreshRegistry runs and the send fails with "no supported
    // nodes". Once installed it's idempotent and we stop.
    if (!installLMRegistryOverride()) {
      let tries = 0;
      const lmTimer = setInterval(() => {
        if (installLMRegistryOverride() || ++tries > 300)
          clearInterval(lmTimer);
      }, 100);
    }
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsLoader") return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalConfigure = nodeType.prototype.onConfigure;
    const originalExecuted = nodeType.prototype.onExecuted;
    const originalConnectionsChange = nodeType.prototype.onConnectionsChange;

    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      setupGenerationNode(this);
      return result;
    };
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      requestAnimationFrame(() => {
        this._dbGenerationSync?.();
        this._dbApplyGenerationLayout?.(false);
      });
      return result;
    };
    nodeType.prototype.onExecuted = function (message) {
      const result = originalExecuted?.apply(this, arguments);
      this._dbGenerationExecuted?.(message);
      return result;
    };
    nodeType.prototype.onConnectionsChange = function () {
      const result = originalConnectionsChange?.apply(this, arguments);
      requestAnimationFrame(() => this._dbRefreshGenerationConnections?.());
      return result;
    };
  },
});

api.addEventListener("dirtybirds_set_loras", ({ detail }) => {
  const node = app.graph?._nodes?.find(
    (candidate) => String(candidate.id) === String(detail?.node_id),
  );
  node?._dbApplyLoras?.(detail?.loras, detail?.mode);
});

api.addEventListener("dirtybirds_set_embedding", ({ detail }) => {
  const node = app.graph?._nodes?.find(
    (candidate) => String(candidate.id) === String(detail?.node_id),
  );
  if (!node) return;
  const widget = findWidget(
    node,
    detail?.slot === "negative" ? "neg_embedding" : "pos_embedding",
  );
  const strength = Number(detail?.strength ?? 1);
  const value = detail?.name
    ? Math.abs(strength - 1) < 0.001
      ? detail.name
      : `${detail.name}:${strength.toFixed(2)}`
    : "";
  setWidget(widget, value, node);
  node._dbGenerationSync?.();
});
