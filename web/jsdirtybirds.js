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
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, fetchJSON, nodeInnerW,
  hideWidget as hideWidgetShared, makeSectionLabel, makeCollapsibleSectionLabel,
} from "./db_shared.js";

ensureStylesheet();

function makeAspectSVG(width, height) {
  const box = 18;
  const rw = width >= height ? box : Math.max(2, Math.round((width / height) * box));
  const rh = width >= height ? Math.max(2, Math.round((height / width) * box)) : box;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", box); svg.setAttribute("height", box); svg.setAttribute("viewBox", `0 0 ${box} ${box}`);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", Math.floor((box - rw) / 2)); rect.setAttribute("y", Math.floor((box - rh) / 2));
  rect.setAttribute("width", rw); rect.setAttribute("height", rh); rect.setAttribute("rx", "1"); rect.setAttribute("fill", "currentColor");
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
  image.onload = () => { mount.replaceChildren(image); onLoaded?.(); };
  image.onerror = () => {
    const video = document.createElement("video");
    video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
    video.onloadeddata = () => { mount.replaceChildren(video); video.play?.().catch(() => {}); onLoaded?.(); };
    video.onerror = () => { onMissing?.(); };
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
    return { name, normalized, folder: slash >= 0 ? normalized.slice(0, slash) : "(root)" };
  });
  const folders = [...new Set(normalizedNames.map((item) => item.folder))].sort((a, b) => a.localeCompare(b));
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
    observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          entry.target._dbLoadPreview?.();
        }
      }, { root: grid, rootMargin: "180px" })
      : null;
    const query = search.value.trim().toLowerCase();
    const selectedFolder = folder.value;
    const filtered = normalizedNames.filter((item) =>
      (!query || item.normalized.toLowerCase().includes(query)) &&
      (selectedFolder === "All folders" || item.folder === selectedFolder));
    count.textContent = `${filtered.length} / ${normalizedNames.length}`;
    grid.replaceChildren();
    if (!filtered.length) grid.append(el("div", "db-generation-picker-empty", "Nothing found"));
    for (const item of filtered) {
      const card = el("button", `db-generation-picker-card${item.name === current ? " is-selected" : ""}`);
      card.type = "button";
      const media = el("div", "db-generation-picker-media", "Preview");
      media._dbLoadPreview = () => {
        if (media.dataset.loaded) return;
        media.dataset.loaded = "true";
        loadMedia(media, previewURL(item.name), () => { media.textContent = "No preview"; });
      };
      if (observer) observer.observe(media); else media._dbLoadPreview();
      const label = el("span", "db-generation-picker-label", item.normalized.split("/").pop().replace(/\.[^.]+$/, ""));
      card.title = item.normalized;
      card.append(media, label);
      card.addEventListener("click", () => { closeFlyouts(); onPick(item.name); });
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
    const label = el("input", "db-generation-edit-input"); label.value = record.label || ""; label.placeholder = "Label";
    const width = el("input", "db-generation-edit-input"); width.type = "number"; width.value = record.width; width.min = 64; width.max = 8192; width.step = 8;
    const height = el("input", "db-generation-edit-input"); height.type = "number"; height.value = record.height; height.min = 64; height.max = 8192; height.step = 8;
    const snap = (input) => {
      const value = clamp(input.value || 1024, 64, 8192);
      input.value = String(Math.round(value / 8) * 8);
    };
    width.addEventListener("change", () => snap(width));
    height.addEventListener("change", () => snap(height));
    const remove = button("×", () => row.remove(), "db-generation-remove");
    row.append(label, width, height, remove); list.append(row);
    records.push({ row, label, width, height });
  };
  rows.forEach(addRow);
  const actions = el("div", "db-generation-editor-actions");
  actions.append(button("+ Add", () => addRow()), button("Save", async () => {
    const values = records.filter((item) => item.row.isConnected).map((item) => ({
      label: item.label.value.trim(),
      width: Math.round(clamp(item.width.value, 64, 8192) / 8) * 8,
      height: Math.round(clamp(item.height.value, 64, 8192) / 8) * 8,
    })).filter((item) => item.label && item.width >= 64 && item.height >= 64);
    await onSave(values); closeFlyouts();
  }, "is-active"));
  panel.append(list, actions);
}

function showResolutionPicker(dimensions, current, onPick, onCustom, onEdit) {
  const panel = flyoutShell("Resolution");
  const list = el("div", "db-flyout-list");
  const addChoice = (glyph, label, value, selected = false) => {
    const row = el("button", `db-res-opt${selected ? " db-selected" : ""}`);
    row.type = "button";
    const icon = el("span", "db-res-opt-glyph");
    if (glyph instanceof Element) icon.append(glyph); else icon.textContent = glyph;
    row.append(icon, el("span", "db-res-opt-label", label));
    row.addEventListener("click", () => { closeFlyouts(); value === "custom" ? onCustom() : value === "edit" ? onEdit() : onPick(value); });
    list.append(row);
  };
  addChoice("🎲", "Random", "__random__", current === "__random__");
  addChoice("+", "Custom resolution", "custom");
  addChoice("✎", "Edit stored resolutions", "edit");
  for (const [label, [width, height]] of Object.entries(dimensions)) {
    const svg = makeAspectSVG(width, height);
    addChoice(svg, `${label}  ·  ${width}×${height}`, label, current === label || current === `${width}x${height}`);
  }
  panel.append(list);
}

const NODE_WIDTH = 500;
// Section heights are computed from known state (item counts, whether a
// preview is reserved) rather than measured DOM height, so layout can never
// feed its own height back into ComfyUI and grow on every draw. Lists beyond
// their row cap scroll internally (.db-generation-lora-list /
// .db-generation-trigger-list) instead of growing the section unbounded.
const PANEL_BASE_HEIGHT = 320; // Generation block + Embeddings/LoRAs collapsed headers
const EMBED_CARD_BASE_H = 92;   // enable + picker + weight field, no preview
const EMBED_PREVIEW_H = 90;     // added once if either slot reserves a preview
const LORA_SECTION_BASE_H = 75; // "Selected"/"Trigger Words" labels + add-row chrome
const LORA_ROW_H = 54;
const LORA_ROW_CAP = 4;         // beyond this the list scrolls instead of growing (4 * 54 = 216px, matches CSS max-height)
const TRIGGER_ROW_H = 26;
const TRIGGER_ROW_CAP = 6;      // 6 * 26 = 156px, matches CSS max-height
const UI_VERSION = 6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const findWidget = (node, name) => node.widgets?.find((widget) => widget.name === name);
const findInput = (node, name) => node.inputs?.find((input) => input.name === name);

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
  const control = el("button", `db-generation-button ${className}`.trim(), text);
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
// DirtyBirds node uses for its optional sections (Muse, Image Loader, Save
// Prompt). Only the label markup is reused here, not `addCollapsibleTitle`:
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

  const widgets = Object.fromEntries((node.widgets || []).map((widget) => [widget.name, widget]));
  const backingNames = [
    // positive/negative become forceInput sockets, but ComfyUI retains their
    // backing widgets. They must cancel their widget-row spacing too.
    "positive", "negative", "workflow", "ckpt_name", "dimension", "loras_data", "trigger_words_data",
    "batch_size", "seed", "denoise", "seed_mode", "pos_embedding", "neg_embedding",
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

  const panel = el("div", "db-generation-panel");
  panel.style.setProperty("--db-node-bg", DB_BGCOLOR);
  const panelWidget = node.addDOMWidget("db_generation_panel", "customhtml", panel, {
    serialize: false,
    getMinHeight: () => currentPanelHeight(),
    afterResize: (resizedNode) => syncPanelWidth(resizedNode),
  });

  // The DOM widget owns live width synchronization. ComfyUI calls afterResize
  // during an interactive drag, whereas replacing node.onResize is unreliable
  // and can conflict with LiteGraph or another extension's resize lifecycle.
  function syncPanelWidth(resizedNode = node) {
    panel.style.width = nodeInnerW(resizedNode || node) + "px";
  }
  requestAnimationFrame(() => requestAnimationFrame(() => syncPanelWidth(node)));

  function embeddingsHeight() {
    const hasPreview = Boolean(readEmbedding(widgets.pos_embedding?.value).name) ||
      Boolean(readEmbedding(widgets.neg_embedding?.value).name);
    return EMBED_CARD_BASE_H + (hasPreview ? EMBED_PREVIEW_H : 0);
  }

  function lorasHeight() {
    const loraRows = Math.min(Math.max(loras.length, 1), LORA_ROW_CAP);
    const triggerRows = Math.min(Math.max(triggerWords.length, 1), TRIGGER_ROW_CAP);
    return LORA_SECTION_BASE_H + Math.max(loraRows * LORA_ROW_H, triggerRows * TRIGGER_ROW_H);
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
    const computed = typeof node.computeSize === "function" ? node.computeSize() : null;
    node.min_height = previousMinimum;
    return Math.max(panelHeight + 96, Number(computed?.[1]) || 0);
  }

  function applyLayout(adjustForSectionToggle = false, normalizeSavedHeight = false) {
    node.properties ||= {};
    node.properties.db_generation_sections = { ...state };
    node.properties.db_generation_ui_version = UI_VERSION;
    const panelHeight = currentPanelHeight();
    const panelDelta = panelHeight - previousPanelHeight;
    const currentWidth = node.size?.[0] || NODE_WIDTH;
    const currentHeight = node.size?.[1] || 0;
    const targetWidth = Math.max(NODE_WIDTH, currentWidth);
    panelWidget.computedHeight = panelHeight;
    panel.style.height = `${panelHeight}px`;
    syncPanelWidth(node);
    const minimumHeight = naturalNodeHeight(panelHeight);
    node.min_width = NODE_WIDTH;
    node.min_height = minimumHeight;

    let targetHeight = normalizeSavedHeight ? minimumHeight : Math.max(minimumHeight, currentHeight);
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
  const generation = el("section", "db-generation-section is-open db-generation-main");
  generation.append(makeSectionLabel("Generation"));
  const generationBody = el("div", "db-generation-section-body");
  generation.append(generationBody);

  const workflow = el("div", "db-generation-segmented");
  const textToImage = button("Text → Image", () => setWorkflow("Text2Image"));
  const imageToImage = button("Image → Image", () => setWorkflow("Image2Image"));
  workflow.append(textToImage, imageToImage);

  let dimensions = { "1024x1024": [1024, 1024] };
  const checkpointValues = widgets.ckpt_name?.options?.values || [];
  const checkpoint = button("", () => {
    showCardPicker("Checkpoints", checkpointValues, widgets.ckpt_name?.value,
      (name) => `/dirtybirds/model-preview?type=checkpoints&name=${encodeURIComponent(name)}`,
      (name) => { setWidget(widgets.ckpt_name, name, node); updateCheckpointControl(); updateCheckpointPreview(); });
  }, "db-generation-model-button");
  const checkpointTag = el("span", "db-generation-control-tag", "CKPT");
  const checkpointName = el("span", "db-generation-control-name");
  checkpoint.append(checkpointTag, checkpointName, el("span", "db-generation-control-caret", "▾"));
  const preview = el("div", "db-generation-preview");
  const previewEmpty = el("span", "db-generation-preview-empty", "No checkpoint preview");
  preview.append(previewEmpty);

  const resolution = button("", () => {
    const current = widgets.dimension?.value || "__random__";
    showResolutionPicker(dimensions, current, (value) => {
      if (value === "__random__") setWidget(widgets.dimension, value, node);
      else {
        const [width, height] = dimensions[value] || [1024, 1024];
        setWidget(widgets.dimension, `${width}x${height}`, node);
      }
      updateResolutionControl();
    }, () => {
      const raw = widgets.dimension?.value || "1024x1024";
      const [width, height] = raw.split("x").map(Number);
      showResolutionEditor("Custom Resolution", [{ label: "Custom", width: width || 1024, height: height || 1024 }], (values) => {
        const value = values[0];
        if (value) { setWidget(widgets.dimension, `${value.width}x${value.height}`, node); updateResolutionControl(); }
      });
    }, () => {
      const rows = Object.entries(dimensions).map(([label, [width, height]]) => ({ label, width, height }));
      showResolutionEditor("Edit Resolutions", rows, async (values) => {
        const next = Object.fromEntries(values.map((value) => [value.label, [value.width, value.height]]));
        const saved = await fetchJSON("/dirtybirds/dimensions", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
        });
        if (saved) dimensions = saved;
        updateResolutionControl();
      });
    });
  }, "db-generation-model-button");
  resolution.append(el("span", "db-generation-control-tag", "RES"), el("span", "db-generation-control-name"), el("span", "db-generation-control-caret", "▾"));
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
  const i2iWarning = el("div", "db-generation-warning", "Connect an image to use Image → Image.");

  const seedRow = el("div", "db-generation-seed-row");
  seedRow.append(el("span", "db-generation-field-label", "Seed"));
  const fixedSeed = button("Fixed", () => setSeedMode("fixed"));
  const randomSeed = button("Random", () => setSeedMode("random"));
  const lastSeed = button("Last", () => {
    if (node._dbLastSeed != null) setWidget(widgets.seed, node._dbLastSeed, node);
    setSeedMode("fixed");
  });
  seedRow.append(fixedSeed, randomSeed, lastSeed);

  const generationColumns = el("div", "db-generation-workspace");
  const modelColumn = el("div", "db-generation-column db-generation-model-column");
  const settingsColumn = el("div", "db-generation-column db-generation-settings-column");
  modelColumn.append(checkpoint, preview);
  settingsColumn.append(
    resolution,
    field("Batch", batch, batchValue),
    field("Denoise", denoise, denoiseValue),
    seedRow,
  );
  generationColumns.append(modelColumn, settingsColumn);
  generationBody.append(workflow, generationColumns, i2iWarning);

  function refreshWorkflowState() {
    const value = widgets.workflow?.value || "Text2Image";
    const isI2I = value === "Image2Image";
    textToImage.classList.toggle("is-active", !isI2I);
    imageToImage.classList.toggle("is-active", isI2I);
    denoise.disabled = !isI2I;
    denoise.title = isI2I ? "" : "Denoise only applies in Image → Image mode";
    denoise.closest(".db-generation-field")?.classList.toggle("is-disabled", !isI2I);
    const input = findInput(node, "image");
    if (input) input.hidden = !isI2I;
    i2iWarning.hidden = !isI2I || input?.link != null;
    resolution.disabled = isI2I;
    resolution.title = isI2I ? "Resolution follows the connected image in Image → Image mode" : "";
    resolution.classList.toggle("is-disabled", isI2I);
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
  }

  function updateCheckpointPreview() {
    const name = widgets.ckpt_name?.value || "";
    preview.replaceChildren(previewEmpty);
    if (!name) return;
    const url = `/dirtybirds/model-preview?type=checkpoints&name=${encodeURIComponent(name)}&v=${Date.now()}`;
    loadMedia(preview, url, () => preview.replaceChildren(previewEmpty));
  }

  function updateCheckpointControl() {
    const value = widgets.ckpt_name?.value || checkpointValues[0] || "";
    checkpointName.textContent = value ? value.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "") : "Select checkpoint";
    checkpoint.title = value;
  }

  function updateResolutionControl() {
    const value = widgets.dimension?.value || "__random__";
    const label = resolution.querySelector(".db-generation-control-name");
    if (value === "__random__") label.textContent = "🎲 Random";
    else {
      const match = Object.entries(dimensions).find(([, [width, height]]) => `${width}x${height}` === value);
      label.textContent = match ? match[0] : value.replace("x", "×");
    }
  }

  // Embeddings -------------------------------------------------------------
  const embeddingsSection = section("Embeddings", "embeddings", state, applyLayout);
  const embeddingGrid = el("div", "db-generation-two-column");
  embeddingsSection.body.append(embeddingGrid);
  let embeddingNames = [];

  function makeEmbeddingSlot(label, widget) {
    const card = el("div", "db-generation-card");
    const controls = el("div", "db-generation-embedding-controls");
    const enabled = el("input"); enabled.type = "checkbox"; enabled.title = "Enable embedding";
    const picker = selectControl(["(none)", ...embeddingNames], (value) => {
      const parsed = readEmbedding(widget?.value);
      const name = value === "(none)" ? "" : value;
      setWidget(widget, writeEmbedding(name, parsed.strength, enabled.checked), node);
      refreshEmbeddingCount();
      updateEmbeddingPreview(card, name);
      applyLayout();
    });
    const strengthValue = el("output", "db-generation-value", "1.00");
    const strength = rangeControl(0, 2, 0.05, (value) => {
      strengthValue.textContent = value.toFixed(2);
      setWidget(widget, writeEmbedding(picker.value === "(none)" ? "" : picker.value, value, enabled.checked), node);
    });
    enabled.addEventListener("change", () => {
      setWidget(widget, writeEmbedding(picker.value === "(none)" ? "" : picker.value, Number(strength.value), enabled.checked), node);
      card.classList.toggle("is-disabled", !enabled.checked);
    });
    controls.append(enabled, picker);
    const preview = el("div", "db-generation-embed-preview");
    preview.hidden = true;
    card.append(el("span", "db-generation-card-label", label), controls, field("Weight", strength, strengthValue), preview);
    card._picker = picker;
    card._enabled = enabled;
    card._strength = strength;
    card._strengthValue = strengthValue;
    card._preview = preview;
    return card;
  }

  // Reserves preview space whenever a name is chosen (matches the checkpoint
  // preview's box-always-present convention) rather than after the image/video
  // actually resolves, so `currentPanelHeight()` stays a pure function of state.
  function updateEmbeddingPreview(card, name) {
    card._preview.hidden = !name;
    if (!name) { card._preview.replaceChildren(); return; }
    const empty = el("span", "db-generation-preview-empty", "No preview");
    card._preview.replaceChildren(empty);
    loadMedia(card._preview, `/dirtybirds/embedding-preview?name=${encodeURIComponent(name)}`,
      () => card._preview.replaceChildren(empty));
  }
  const posEmbedding = makeEmbeddingSlot("Positive", widgets.pos_embedding);
  const negEmbedding = makeEmbeddingSlot("Negative", widgets.neg_embedding);
  embeddingGrid.append(posEmbedding, negEmbedding);

  function readEmbedding(raw) {
    raw = String(raw || "");
    const active = !raw.startsWith("!");
    if (!active) raw = raw.slice(1);
    const match = raw.match(/^(.*):(-?\d+(?:\.\d+)?)$/);
    return { name: match ? match[1] : raw, strength: match ? Number(match[2]) : 1, active };
  }

  function writeEmbedding(name, strength = 1, active = true) {
    if (!name) return "";
    const weighted = Math.abs(strength - 1) < 0.001 ? name : `${name}:${Number(strength).toFixed(2)}`;
    return active ? weighted : `!${weighted}`;
  }

  function syncEmbeddingCard(card, widget) {
    const parsed = readEmbedding(widget?.value);
    if (parsed.name && !Array.from(card._picker.options).some((option) => option.value === parsed.name)) {
      const option = document.createElement("option"); option.value = parsed.name; option.textContent = parsed.name; card._picker.append(option);
    }
    card._picker.value = parsed.name || "(none)";
    card._enabled.checked = parsed.active;
    card._strength.value = String(parsed.strength);
    card._strengthValue.textContent = parsed.strength.toFixed(2);
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
  const loraAddBtn = button("", () => {
    showCardPicker("Add LoRA", availableLoraNames, null,
      (name) => `/dirtybirds/lora-preview?name=${encodeURIComponent(name)}`,
      (name) => addLora(name));
  }, "db-generation-model-button");
  loraAddBtn.append(
    el("span", "db-generation-control-tag", "LORA"),
    el("span", "db-generation-control-name", "+ Add"),
    el("span", "db-generation-control-caret", "▾"),
  );
  loraAddRow.append(loraAddBtn);
  const loraList = el("div", "db-generation-lora-list");
  const triggers = el("div", "db-generation-trigger-list");
  const loraColumns = el("div", "db-generation-lora-columns");
  const selectedColumn = el("div", "db-generation-lora-column");
  const triggerColumn = el("div", "db-generation-lora-column");
  selectedColumn.append(el("span", "db-generation-card-label", "Selected"), loraAddRow, loraList);
  triggerColumn.append(el("span", "db-generation-card-label", "Trigger Words"), triggers);
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
      const meta = await fetchJSON(`/dirtybirds/lora-meta?name=${encodeURIComponent(name)}`);
      for (const text of meta?.trigger_words || []) {
        if (!triggerWords.some((item) => item.lora === name && item.text === text)) {
          triggerWords.push({ lora: name, text, active: true });
        }
      }
    } catch (_) { /* metadata is optional */ }
    saveLoras();
  }

  function renderLoras() {
    loraList.replaceChildren();
    triggers.replaceChildren();
    for (const item of loras) {
      const row = el("div", "db-generation-lora-row");
      const top = el("div", "db-generation-lora-row-top");
      const weights = el("div", "db-generation-lora-weights");
      const thumb = el("div", "db-generation-lora-thumb");
      thumb.hidden = true;
      loadMedia(thumb, `/dirtybirds/lora-preview?name=${encodeURIComponent(item.name)}`, undefined, () => { thumb.hidden = false; });
      const active = el("input");
      active.type = "checkbox";
      active.checked = item.active !== false;
      active.addEventListener("change", () => { item.active = active.checked; saveLoras(); });
      const name = el("span", "db-generation-lora-name", item.name);
      const strength = el("input", "db-generation-number");
      strength.type = "number"; strength.min = "-2"; strength.max = "2"; strength.step = "0.05";
      strength.value = String(item.strength ?? 1);
      strength.title = "Model strength";
      strength.addEventListener("change", () => { item.strength = clamp(strength.value, -2, 2); saveLoras(); });
      const clip = strength.cloneNode();
      clip.value = String(item.clip_strength ?? item.strength ?? 1);
      clip.title = "CLIP strength";
      clip.addEventListener("change", () => { item.clip_strength = clamp(clip.value, -2, 2); saveLoras(); });
      const remove = button("×", () => {
        loras = loras.filter((candidate) => candidate !== item);
        triggerWords = triggerWords.filter((candidate) => candidate.lora !== item.name);
        saveLoras();
      }, "db-generation-remove");
      top.append(thumb, active, name, remove);
      weights.append(el("span", "db-generation-weight-label", "Model"), strength,
        el("span", "db-generation-weight-label", "CLIP"), clip);
      row.append(top, weights);
      loraList.append(row);
    }
    for (const item of triggerWords) {
      const chip = el("label", "db-generation-trigger");
      chip.title = "Double-click to rename";
      const active = el("input");
      active.type = "checkbox";
      active.checked = item.active !== false;
      active.addEventListener("change", () => { item.active = active.checked; saveLoras(); });
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
          if (keyEvent.key === "Escape") { input.value = item.text; input.blur(); }
        });
        input.addEventListener("blur", commit, { once: true });
      });
      triggers.append(chip);
    }
    if (!loras.length) loraList.append(el("div", "db-generation-empty", "No LoRAs selected"));
    if (!triggerWords.length) triggers.append(el("div", "db-generation-empty", "Trigger words appear here"));
    const activeCount = loras.filter((item) => item.active !== false).length;
    loraSection.setCount(activeCount);
  }

  node._dbApplyLoras = (incoming, mode = "append") => {
    const normalized = (incoming || []).filter((item) => item?.name).map((item) => ({
      name: item.name,
      strength: Number(item.strength ?? 1),
      clip_strength: Number(item.clip_strength ?? item.strength ?? 1),
      active: item.active !== false,
    }));
    if (mode === "replace") loras = normalized;
    else for (const item of normalized) {
      const index = loras.findIndex((candidate) => candidate.name === item.name);
      if (index >= 0) loras[index] = item; else loras.push(item);
    }
    saveLoras();
  };

  panel.append(generation, embeddingsSection.root, loraSection.root);

  async function loadLibraries() {
    const [loadedDimensions, embeddings, availableLoras] = await Promise.all([
      fetchJSON("/dirtybirds/dimensions").catch(() => ({ "1024x1024": [1024, 1024] })),
      fetchJSON("/dirtybirds/embeddings").catch(() => []),
      fetchJSON("/dirtybirds/loras").catch(() => []),
    ]);
    dimensions = loadedDimensions || dimensions;
    embeddingNames = embeddings || [];
    for (const card of [posEmbedding, negEmbedding]) {
      const current = card._picker.value;
      card._picker.replaceChildren();
      for (const value of ["(none)", ...embeddingNames]) {
        const option = document.createElement("option"); option.value = value; option.textContent = value;
        card._picker.append(option);
      }
      card._picker.value = current;
    }
    availableLoraNames = availableLoras || [];
    syncFromWidgets();
  }

  function syncFromWidgets() {
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
        const allNodes = app.graph?._nodes || Object.values(app.graph?._nodes_by_id || {});
        (Array.isArray(allNodes) ? allNodes : []).forEach(n => {
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
          clip_strength: (clipStrength != null && !isNaN(clipStrength)) ? clipStrength : null,
          active: true,
        });
      }

      if (!loras.length) return;

      targets.forEach(n => {
        if (typeof n._dbApplyLoras === "function") {
          n._dbApplyLoras(loras, mode);
        }
      });
    });

    // ── Advertise DirtyBirdsLoader as lora-capable to LoRA Manager ──────────────
    // LoRA Manager's "Send to node" only offers nodes whose registry entry has
    // capabilities.supports_lora === true, and it sets that flag only for its own
    // three hardcoded Lora node classes (see workflow_registry.js LORA_NODE_CLASSES).
    // DirtyBirdsLoader isn't one, so it's registered with supports_lora:false and
    // rejected with the "no supported nodes" toast.
    //
    // Rather than reimplement LM's registry builder (which drifts every time they
    // update the pack — it already broke once), we intercept the single
    // /api/lm/register-nodes POST it makes and flip our node's flag to true. Our
    // loader is already IN that POST because it has a "ckpt_name" widget (LM's own
    // hasTargetWidget filter includes it); we only change one boolean and leave
    // LM's exact node reference (node_id/graph_id) untouched, so this is immune to
    // however LM computes those internally.
    if (!window.__dbLMFetchPatched) {
      window.__dbLMFetchPatched = true;
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          const url = typeof input === "string" ? input : input?.url;
          const method = (init?.method || (typeof input === "object" ? input?.method : "") || "GET").toUpperCase();
          if (url && url.includes("/api/lm/register-nodes") && method === "POST"
              && init && typeof init.body === "string") {
            const data = JSON.parse(init.body);
            if (data && Array.isArray(data.nodes)) {
              let flipped = 0;
              for (const n of data.nodes) {
                if (n && n.comfy_class === "DirtyBirdsLoader") {
                  n.capabilities = (n.capabilities && typeof n.capabilities === "object") ? n.capabilities : {};
                  n.capabilities.supports_lora = true;
                  flipped++;
                }
              }
              if (flipped) init = { ...init, body: JSON.stringify(data) };
            }
          }
        } catch (e) {
          console.warn("[DirtyBirds] LM register-nodes intercept failed; passing request through:", e);
        }
        return origFetch.call(this, input, init);
      };
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
  const node = app.graph?._nodes?.find((candidate) => String(candidate.id) === String(detail?.node_id));
  node?._dbApplyLoras?.(detail?.loras, detail?.mode);
});

api.addEventListener("dirtybirds_set_embedding", ({ detail }) => {
  const node = app.graph?._nodes?.find((candidate) => String(candidate.id) === String(detail?.node_id));
  if (!node) return;
  const widget = findWidget(node, detail?.slot === "negative" ? "neg_embedding" : "pos_embedding");
  const strength = Number(detail?.strength ?? 1);
  const value = detail?.name
    ? (Math.abs(strength - 1) < 0.001 ? detail.name : `${detail.name}:${strength.toFixed(2)}`)
    : "";
  setWidget(widget, value, node);
  node._dbGenerationSync?.();
});
