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
}

// ── Safely resize a DOM widget ────────────────────────────────────────────────
export function setWidgetHeight(widget, height) {
  if (!widget) return;
  widget.computedHeight = Math.max(0, height || 0);
}
