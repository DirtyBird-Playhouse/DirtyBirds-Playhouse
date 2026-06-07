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
}

// ── Fetch JSON with logging ────────────────────────────────────────────────────
export async function fetchJSON(url) {
  try {
    const r = await fetch(url);
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
