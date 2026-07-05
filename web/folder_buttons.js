/**
 * DirtyBirds Playhouse — "Open Folder" toolbar button.
 *
 * Docks a native button into ComfyUI's top action bar (via the official
 * `actionBarButtons` extension API, supported by comfyui-frontend >= 1.33.9).
 * Clicking it drops a themed menu with quick links that open Models /
 * custom_nodes / DirtyBirds Playhouse in the OS file manager, via the
 * /dirtybirds/open-folder backend route. Also registered as a command so it
 * appears in the command palette / can be pinned anywhere.
 *
 * The folder opens on the machine running the ComfyUI *server* — for the usual
 * local install that's your own desktop, which is what you want.
 *
 * Menu styling lives in web/css/style.css (.db-folder-menu) to match the node
 * theme; the button itself inherits ComfyUI's toolbar styling.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { ensureStylesheet } from "./db_shared.js";

// Visible at import time so you can confirm in DevTools whether this file loaded.
const FOLDERS = [
  { key: "models",       label: "Models",               icon: "🗂" },
  { key: "custom_nodes", label: "Custom Nodes",         icon: "🧩" },
  { key: "dirtybirds",   label: "DirtyBirds Playhouse", icon: "🍑" },
];

async function openFolder(key) {
  try {
    const resp = await api.fetchApi("/dirtybirds/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      console.error("[DirtyBirds] open-folder failed:", e);
      alert(`DirtyBirds: could not open folder — ${e.error || resp.statusText}`);
    }
  } catch (err) {
    console.error("[DirtyBirds] open-folder error:", err);
    alert(`DirtyBirds: could not reach server — ${err}`);
  }
}

function closeMenu() {
  document.getElementById("db-folder-menu")?.remove();
  document.removeEventListener("click", onOutside, true);
}
function onOutside() { closeMenu(); }

/** Toggle a themed dropdown anchored under the clicked toolbar button. */
function toggleFolderMenu(evt) {
  if (document.getElementById("db-folder-menu")) { closeMenu(); return; }
  ensureStylesheet();

  const menu = document.createElement("div");
  menu.id = "db-folder-menu";
  menu.className = "db-folder-menu";

  FOLDERS.forEach((f) => {
    const item = document.createElement("button");
    item.className = "db-folder-item";
    item.innerHTML =
      `<span class="db-folder-ico">${f.icon}</span><span>${f.label}</span>`;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      openFolder(f.key);
    });
    menu.appendChild(item);
  });

  // Off-screen first so we can measure, then position under the button.
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);

  const btn = evt?.currentTarget || evt?.target;
  const r = btn?.getBoundingClientRect?.();
  const mw = menu.offsetWidth;
  let top, left;
  if (r) {
    top = r.bottom + 6;
    left = r.right - mw;               // right-align the menu to the button
  } else {
    top = 48;                          // command-palette fallback (no anchor)
    left = window.innerWidth - mw - 12;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.visibility = "visible";

  // Close on any outside click (capture so it fires before canvas handlers).
  setTimeout(() => document.addEventListener("click", onOutside, true), 0);
}

app.registerExtension({
  name: "DirtyBirds.FolderLauncher",

  // Native toolbar button in the top action bar.
  actionBarButtons: [
    {
      icon: "pi pi-folder-open",
      tooltip: "DirtyBirds: open Models / custom_nodes / node folder",
      onClick: (e) => toggleFolderMenu(e),
    },
  ],

  // Also expose via the command palette (and pinnable anywhere).
  commands: [
    {
      id: "DirtyBirds.OpenFolder",
      label: "DirtyBirds: Open Folder…",
      icon: "pi pi-folder-open",
      function: () => toggleFolderMenu(null),
    },
  ],

  async setup() {
    ensureStylesheet(); // ensure web/css/style.css (menu theme) is loaded
  },
});
