/**
 * DirtyBirds Playhouse – shared frontend helpers
 *
 * Imported by jsdirtybirds.js (loader) and jsdirtybirds_prompt.js (prompt).
 * Keeps theme constants, the stylesheet injector, and small DOM helpers in one
 * place so the two node UIs stay consistent and don't drift.
 */

// ── Node theme ────────────────────────────────────────────────────────────────
// Title-bar color for every DirtyBirds node (node.color). Deep blue to match
// the in-node accent (#5aadff) used by section headers and active controls.
export const DB_COLOR   = "#15324a";
export const DB_BGCOLOR = "#131313";
export const DIRTYBIRDS_NODE_WIDTH = 360;

// ── Stylesheet (idempotent) ───────────────────────────────────────────────────
export function ensureStylesheet() {
  const HREF = "/extensions/DirtyBirds-Playhouse/css/style.css";
  if (!document.querySelector(`link[href="${HREF}"]`)) {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = HREF;
    document.head.appendChild(link);
  }
  if (!document.documentElement.dataset.dbSliderEdit) {
    document.documentElement.dataset.dbSliderEdit = "1";
    document.addEventListener("dblclick", (event) => {
      const readout = event.target.closest?.(".db-sel-val");
      if (!readout || readout.dataset.dbEditing === "1") return;
      const row = readout.parentElement;
      const slider = row?.querySelector?.('input[type="range"]');
      if (!slider) return;
      event.stopPropagation();
      readout.dataset.dbEditing = "1";
      const input = document.createElement("input");
      input.type = "number";
      input.min = slider.min; input.max = slider.max; input.step = slider.step || "any";
      input.value = slider.value;
      input.style.cssText = "width:58px;background:#111;color:#ddd;border:1px solid #5aadff;border-radius:3px;font-size:10px;text-align:right;";
      readout.replaceWith(input); input.focus(); input.select();
      let cancelled = false;
      const finish = () => {
        if (!cancelled) {
          const parsed = Number(input.value);
          if (Number.isFinite(parsed)) {
            slider.value = String(Math.max(Number(slider.min), Math.min(Number(slider.max), parsed)));
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        input.replaceWith(readout); delete readout.dataset.dbEditing;
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") { cancelled = true; input.blur(); }
      });
      input.addEventListener("blur", finish, { once: true });
    });
  }
}

// ── Fetch JSON with logging ────────────────────────────────────────────────────
export async function fetchJSON(url, options) {
  try {
    const r = await fetch(url, options);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error("[DirtyBirds]", e);
    return null;
  }
}

// ── Inner content width for a node (minus padding) ─────────────────────────────
export function nodeInnerW(node) {
  return Math.max(100, (node.size?.[0] || 380) - 32);
}

// ── Section label  ─────────── TITLE ─────────────────────────────────────────
export function makeSectionLabel(text) {
  const el = document.createElement("div");
  el.className = "db-section-label";
  const l = document.createElement("span"); l.className = "db-sep-line";
  const t = document.createElement("span"); t.className = "db-sep-text"; t.textContent = text;
  const r = document.createElement("span"); r.className = "db-sep-line";
  el.append(l, t, r);
  return el;
}

// ── Collapsible section label ───── TITLE ▸ expand ─────────────────────────
// Keeps TITLE geometrically centered; the action hint is absolutely positioned
// so it never shifts the section heading. Values inside `content` are untouched.
export function makeCollapsibleSectionLabel(text, { expanded = false, onChange } = {}) {
  const label = makeSectionLabel(text);
  label.classList.add("db-collapsible-label");
  label.style.cursor = "pointer";
  const labelText = label.querySelector(".db-sep-text");
  const title = document.createElement("span");
  title.textContent = text;
  const caret = document.createElement("span");
  caret.className = "db-collapsible-caret";
  const helper = document.createElement("span");
  helper.className = "db-collapsible-helper";
  const action = document.createElement("span");
  action.className = "db-collapsible-action";
  action.append(caret, helper);
  labelText?.replaceChildren(title, action);

  let isExpanded = !!expanded;
  function paint(notify = false) {
    caret.textContent = isExpanded ? "▾" : "▸";
    helper.textContent = isExpanded ? "collapse" : "expand";
    label.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    if (notify) onChange?.(isExpanded);
  }
  label.addEventListener("click", () => {
    isExpanded = !isExpanded;
    paint(true);
  });
  paint(false);
  return {
    label,
    isExpanded: () => isExpanded,
    setTitle(value) { title.textContent = String(value || text); },
    setExpanded(value, notify = true) { isExpanded = !!value; paint(notify); },
  };
}

// Register a collapsible section heading as a DOM widget.
export function addCollapsibleTitle(node, name, text, options = {}, h = 30) {
  const section = makeCollapsibleSectionLabel(text, options);
  h = Math.max(h || 0, 30);
  section.label.style.cssText += "box-sizing:border-box;overflow:visible;padding:0;margin:0;";
  section.widget = node.addDOMWidget(name, "customhtml", section.label, {
    serialize: false, height: h, getMinHeight: () => h,
  });
  return section;
}

// Collapse a DOM widget without touching its value or serialization state.
export function setDOMWidgetShown(node, widget, shown) {
  if (!widget) return;
  if (!widget._dbOpenComputeSize) widget._dbOpenComputeSize = widget.computeSize;
  if (!widget._dbOpenMinHeight) widget._dbOpenMinHeight = widget.getMinHeight;
  widget.element?.style && (widget.element.style.display = shown ? "" : "none");
  widget.computedHeight = shown ? undefined : 0;
  widget.computeSize = shown ? widget._dbOpenComputeSize : (() => [0, -4]);
  widget.getMinHeight = shown ? widget._dbOpenMinHeight : (() => -4);
  node.setDirtyCanvas?.(true, true);
}

// ── Hide a native widget (keeps its value serialized) ─────────────────────────
// Mirrors the local helper in jsdirtybirds.js, but takes the node explicitly so
// it can be shared. Returns the widget (or undefined if not found).
export function hideWidget(node, name) {
  const w = node.widgets?.find((w) => w.name === name);
  if (!w) return undefined;
  w.computeSize    = () => [0, -4];
  w.getMinHeight   = () => -4;
  w.computedHeight = 0;
  // Numeric widgets must never serialize an empty string: a blank value (e.g.
  // from an older saved workflow, or a widget that never received its default)
  // makes ComfyUI's INT/FLOAT coercion fail with "invalid literal for int()"
  // before the node runs. Emit a valid number, falling back to a numeric default.
  // The default is taken from the widget config if present, else from the widget's
  // current value at hide time (which is normally the freshly-created default), so
  // this works regardless of how the frontend exposes the config default.
  const numericDefault =
    typeof w.options?.default === "number" ? w.options.default
    : typeof w.value === "number" && Number.isFinite(w.value) ? w.value
    : (Number.isFinite(parseFloat(w.value)) ? parseFloat(w.value) : null);
  if (numericDefault !== null) {
    // Repair a currently-blank value now, and guarantee serialization is numeric.
    if (!Number.isFinite(parseFloat(w.value))) w.value = numericDefault;
    w.serializeValue = () => {
      const n = parseFloat(w.value);
      return Number.isFinite(n) ? n : numericDefault;
    };
  } else {
    w.serializeValue = () => w.value;
  }
  w.options = { ...(w.options || {}), hidden: true };
  if (w.element?.style) w.element.style.display = "none";
  if (w.inputEl?.style) w.inputEl.style.display = "none";
  if (typeof w.setHidden === "function") w.setHidden(true);
  else if ("hidden" in w) w.hidden = true;
  return w;
}

// ── Section-title DOM widget (centered separator label) ───────────────────────
// `text` is a plain string; builds the label and registers it as a DOM widget.
export function addTitle(node, name, text, h) {
  const el = makeSectionLabel(text);
  h = Math.max(h || 0, 30); // room so centered section text isn't clipped
  el.style.cssText += "box-sizing:border-box;overflow:visible;padding:0;margin:0;";
  node.addDOMWidget(name, "customhtml", el, { serialize: false, height: h, getMinHeight: () => h });
  return el;
}

// ── Labeled range slider. Returns { row, paint }. ─────────────────────────────
// getVal()/setVal(v) read/write the backing value; fmt(v) renders the readout.
export function makeSlider(label, min, max, step, getVal, setVal, fmt) {
  const row = document.createElement("div");
  row.className = "db-slider-row";
  row.style.justifyContent = "space-between";
  const lbl = document.createElement("span"); lbl.className = "db-slider-label"; lbl.textContent = label;
  const slider = document.createElement("input");
  slider.type = "range"; slider.className = "db-sel-slider";
  slider.min = String(min); slider.max = String(max); slider.step = String(step);
  slider.style.flex = "1"; slider.style.minWidth = "0";
  const valEl = document.createElement("span"); valEl.className = "db-sel-val";
  const fmtFn = fmt || ((v) => String(v));
  function paint() {
    const v = Number(getVal());
    slider.value = String(v);
    valEl.textContent = fmtFn(v);
  }
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    setVal(v);
    valEl.textContent = fmtFn(v);
  });
  row.append(lbl, slider, valEl);
  paint();
  return { row, paint };
}

// ── Scrollable name-list flyout (no previews) ─────────────────────────────────
export function showListFlyout(title, names, current, displayFn, onPick) {
  document.querySelector(".db-flyout-overlay")?.remove();
  document.querySelector(".db-flyout")?.remove();

  const overlay = document.createElement("div"); overlay.className = "db-flyout-overlay";
  const panel   = document.createElement("div"); panel.className   = "db-flyout";
  panel.style.width = "min(320px, 90vw)";
  panel.style.left  = Math.max(20, (window.innerWidth - 320) / 2) + "px";
  panel.style.top   = Math.max(40, window.innerHeight / 2 - 220) + "px";

  const header   = document.createElement("div"); header.className = "db-flyout-header";
  const titleEl  = document.createElement("span"); titleEl.className = "db-flyout-title"; titleEl.textContent = title;
  const closeBtn = document.createElement("button"); closeBtn.className = "db-flyout-close"; closeBtn.textContent = "✕";
  header.append(titleEl, closeBtn); panel.appendChild(header);

  const list = document.createElement("div"); list.className = "db-flyout-list";
  list.style.cssText = "max-height:60vh;overflow:auto;";
  panel.appendChild(list);

  if (!names.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:14px;color:#888;font-size:12px;";
    empty.textContent = "Nothing found";
    list.appendChild(empty);
  }
  names.forEach((name) => {
    const row = document.createElement("div");
    row.className = "db-res-opt" + (name === current ? " db-selected" : "");
    const label = document.createElement("span");
    label.className = "db-res-opt-label";
    label.textContent = displayFn ? displayFn(name) : name;
    label.title = name;
    row.appendChild(label);
    row.addEventListener("click", () => { close(); onPick(name); });
    list.appendChild(row);
  });

  function close() { overlay.remove(); panel.remove(); }
  closeBtn.addEventListener("click", close); overlay.addEventListener("click", close);
  document.body.append(overlay, panel);
}

// ── Flyout-backed combo button (TAG + value + caret). Returns { row, refresh }.
// opts: { getLabel, getValues, getCurrent, onPick, displayFn }.
export function makeFlyoutBtn(node, tag, opts) {
  const row = document.createElement("div");
  row.className = "db-sel-row"; row.style.cursor = "pointer";
  const tagEl  = document.createElement("span"); tagEl.className  = "db-model-tag";   tagEl.textContent = tag;
  const nameEl = document.createElement("span"); nameEl.className = "db-sel-name";    nameEl.style.flex = "1";
  const caret  = document.createElement("span"); caret.className  = "db-model-caret"; caret.textContent = "▾";
  row.append(tagEl, nameEl, caret);
  function refresh() {
    const label = opts.getLabel ? opts.getLabel() : (opts.getCurrent?.() ?? "");
    nameEl.textContent = label || "(none)";
    row.title = (opts.getCurrent?.() ?? "") + "";
  }
  row.addEventListener("click", () => {
    showListFlyout(
      tag,
      opts.getValues ? opts.getValues() : [],
      opts.getCurrent?.(),
      opts.displayFn,
      (v) => { opts.onPick?.(v); refresh(); node.setDirtyCanvas?.(true); },
    );
  });
  refresh();
  return { row, refresh };
}

// ── Keep DOM-widget elements synced to the node's inner width ──────────────────
export function bindWidthSync(node, els, minW) {
  if (minW) node.size[0] = Math.max(node.size[0] || 0, minW);
  function applyWidths() {
    const w = nodeInnerW(node);
    (els || []).forEach((el) => { if (el?.style) el.style.width = w + "px"; });
    node.widgets?.forEach((ww) => {
      if (ww.element?.classList?.contains("db-section-label")) ww.element.style.width = w + "px";
    });
  }
  requestAnimationFrame(() => requestAnimationFrame(applyWidths));
  const origResize = node.onResize;
  node.onResize = function (size) { origResize?.call(this, size); applyWidths(); };
  installContentSizeGuard(node, { minWidth: minW });
}

// ── Shared control constructors ──────────────────────────────────────────────
// Node modules own behavior and content; these factories own element type,
// common class names and event wiring so controls cannot visually drift.
export function makeButton(text = "", onClick = null, className = "db-lib-btn") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

export function makeTextarea(value = "", placeholder = "", className = "comfy-multiline-input") {
  const textarea = document.createElement("textarea");
  textarea.className = className;
  textarea.value = value;
  textarea.placeholder = placeholder;
  textarea.spellcheck = false;
  return textarea;
}

export function makeInput(type = "text", value = "", className = "db-text-input") {
  const input = document.createElement("input");
  input.type = type;
  input.className = className;
  if (value !== undefined && value !== null) input.value = value;
  return input;
}

export function makeSelect(className = "db-select") {
  const select = document.createElement("select");
  select.className = className;
  return select;
}

export function makeSegment() {
  const segment = document.createElement("div");
  segment.className = "db-seg";
  return segment;
}

export function makeTwoColumn(className = "db-two-column") {
  const columns = document.createElement("div");
  columns.className = className;
  return columns;
}

// Keep every custom-DOM node at least as tall as its visible widgets while
// preserving any extra height chosen by the user. Safe to call more than once.
export function installContentSizeGuard(node, { minWidth = 0 } = {}) {
  if (!node) return;
  if (node._dbContentSizeGuard) {
    node._dbContentSizeGuard.minWidth = Math.max(
      node._dbContentSizeGuard.minWidth || 0, minWidth || 0);
    node._dbFitContent?.();
    return;
  }
  const guard = node._dbContentSizeGuard = { minWidth: Math.max(0, minWidth || 0) };
  let scheduled = false;
  const fit = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scheduled = false;
      const oldMin = Number(node.min_height) || 0;
      node.min_height = 0;
      const measured = node.computeSize?.() || node.size || [guard.minWidth, oldMin];
      const required = Math.max(1, Number(measured[1]) || 0);
      node.min_height = required;
      const width = Math.max(guard.minWidth, Number(node.size?.[0]) || guard.minWidth);
      const height = Math.max(required, Number(node.size?.[1]) || required);
      if (width !== node.size?.[0] || height !== node.size?.[1]) node.setSize?.([width, height]);
      node.setDirtyCanvas?.(true, true);
    }));
  };
  node._dbFitContent = fit;
  const originalResize = node.onResize;
  node.onResize = function (size) {
    size[0] = Math.max(guard.minWidth, size[0]);
    size[1] = Math.max(Number(node.min_height) || 0, size[1]);
    originalResize?.call(this, size);
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  (node.widgets || []).forEach((widget) => {
    if (!widget.element) return;
    widget.element.classList?.add("db-control-surface");
    observer?.observe(widget.element);
  });
  node._dbContentSizeObserver = observer;
  fit();
}

// ── Safely resize a DOM widget ────────────────────────────────────────────────
export function setWidgetHeight(widget, height) {
  if (!widget) return;
  widget.computedHeight = Math.max(0, height || 0);
}

// ── Shared image-picker modal ────────────────────────────────────────────────
// The one full-screen picker used by every DirtyBirds in-node pick handshake
// (Sampler, Fixer "All (Compare)", …). A node that is executing can't grow its
// inline DOM widgets, so the pick UI must live in an overlay on <body> — an
// inline grid gets clipped mid-run. This is a pure view: the caller owns the
// selection Set and the websocket reply; this builds/repaints the modal and
// reports clicks. Each card's badge is `img.label` when present (e.g. the
// Fixer's method name) else `#index`.
//
// Returns { overlay, cards, close, setStatus, setCountdown, repaint }.
export function openPickerModal({
  images = [], selection, title = "Pick images", viewURL,
  sendLabel = "Keep selected", cancelLabel = "Cancel",
  onToggle, onSend, onCancel,
}) {
  const sel = selection || new Set();
  const url = viewURL || ((img) => `/view?filename=${encodeURIComponent(img.filename || "")}` +
    `&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "temp")}`);
  let relayout = () => {};

  const overlay = document.createElement("div");
  overlay.className = "db-flyout-overlay db-sampler-picker-overlay";
  const panel = document.createElement("div");
  panel.className = "db-lora-flyout db-sampler-picker-panel";

  const header = document.createElement("div");
  header.className = "db-flyout-header";
  const titleEl = document.createElement("span");
  titleEl.className = "db-flyout-title";
  titleEl.textContent = title;
  const countdown = document.createElement("span");
  countdown.className = "db-flyout-title";
  countdown.style.opacity = "0.6";
  header.append(titleEl, countdown);
  panel.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "db-lp-grid";
  const cards = [];
  const imageEls = [];
  images.forEach((img, i) => {
    const card = document.createElement("div");
    card.className = "db-lp-card";
    card.style.cursor = "pointer";
    if (sel.has(i)) card.classList.add("db-lp-selected");
    const wrap = document.createElement("div");
    wrap.className = "db-lp-img-wrap";
    const thumb = document.createElement("img");
    thumb.className = "db-lp-thumb";
    const reveal = () => { thumb.classList.add("db-lp-thumb-loaded"); relayout(); };
    thumb.addEventListener("load", reveal);
    thumb.addEventListener("error", () => { reveal(); thumb.style.opacity = "1"; });
    thumb.src = url(img);
    if (thumb.complete && thumb.naturalWidth > 0) reveal();
    const badge = document.createElement("div");
    badge.className = "db-lp-cat-badge";
    badge.textContent = img.label || ("#" + i);
    wrap.append(thumb, badge);
    card.appendChild(wrap);
    card.addEventListener("click", () => {
      if (sel.has(i)) { sel.delete(i); card.classList.remove("db-lp-selected"); }
      else { sel.add(i); card.classList.add("db-lp-selected"); }
      onToggle?.(i);
      updateStatus();
    });
    grid.appendChild(card);
    cards.push(card);
    imageEls.push(thumb);
  });
  panel.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "db-lp-pills";
  footer.style.cssText += "justify-content:space-between;align-items:center;";
  const statusEl = document.createElement("span");
  statusEl.style.cssText = "font-size:11px;color:#888;";
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:8px;";
  const cancelBtn = makeButton(cancelLabel, () => onCancel?.(), "db-lora-add-open-btn");
  cancelBtn.style.cssText = "width:auto;padding:6px 14px;";
  const sendBtn = makeButton(sendLabel, () => onSend?.(), "db-lora-add-open-btn");
  sendBtn.style.cssText = "width:auto;padding:6px 16px;";
  btns.append(cancelBtn, sendBtn);
  footer.append(statusEl, btns);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const imageSize = () => {
    const first = images[0] || {};
    const natural = imageEls.find((img) => img.naturalWidth > 0);
    return {
      width: Number(first.width || natural?.naturalWidth || 1),
      height: Number(first.height || natural?.naturalHeight || 1),
    };
  };
  relayout = () => {
    const box = grid.getBoundingClientRect();
    if (!box.width || !box.height || !images.length) return;
    const { width: imgW, height: imgH } = imageSize();
    let bestPerRow = 1, bestScale = 0;
    for (let perRow = 1; perRow <= images.length; perRow++) {
      const rows = Math.ceil(images.length / perRow);
      const scale = Math.min(box.width / (imgW * perRow), box.height / (imgH * rows));
      if (scale > bestScale) { bestScale = scale; bestPerRow = perRow; }
    }
    const rows = Math.ceil(images.length / bestPerRow);
    grid.style.gridTemplateColumns = `repeat(${bestPerRow}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  };

  const updateStatus = () => {
    statusEl.textContent = sel.size
      ? `${sel.size} selected · Enter to keep`
      : "Click images to keep · Esc cancels · Ctrl+A all";
  };
  const repaint = () => cards.forEach((c, i) => c.classList.toggle("db-lp-selected", sel.has(i)));

  const keydown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
    else if (e.key === "Enter") { e.preventDefault(); onSend?.(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const selectAll = sel.size < cards.length;
      cards.forEach((_, i) => { if (selectAll) sel.add(i); else sel.delete(i); });
      cards.forEach((_, i) => onToggle?.(i));
      repaint();
      updateStatus();
    }
  };

  const close = () => {
    overlay.remove();
    window.removeEventListener("resize", relayout);
    document.removeEventListener("keydown", keydown);
  };

  updateStatus();
  requestAnimationFrame(relayout);
  window.addEventListener("resize", relayout);
  document.addEventListener("keydown", keydown);

  return {
    overlay, cards, close, repaint, relayout,
    setStatus: (t) => { statusEl.textContent = t; },
    setCountdown: (t) => { countdown.textContent = t; },
  };
}
