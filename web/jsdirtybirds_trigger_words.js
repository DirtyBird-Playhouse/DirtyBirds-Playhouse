/**
 * DirtyBirds Playhouse — Trigger Words node UI (formerly "Trigger Words").
 *
 * Themed to match the suite. Add LoRAs via a flyout (from /dirtybirds/loras);
 * each LoRA's trigger words (from /dirtybirds/lora-meta) become toggleable,
 * editable chips. Active chip text is serialized into the hidden
 * `trigger_words_data` widget and pushed into the Prompt Builder positive prompt
 * via the "Send to Prompt Builder" button.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  fetchJSON,
  hideWidget,
  showListFlyout,
  bindWidthSync,
  setWidgetHeight,
  makeButton,
  makeInput,
  reserveHeight,
} from "./db_shared.js";

// Content heights. Reserved through reserveHeight() so ComfyUI's per-widget
// chrome does not eat the bottom of the two buttons and the status line.
const ADD_ROW_H = 34;
const CHIPS_MIN_H = 44;
const CHIPS_MAX_H = 180;
const STATUS_H = 14;
const SEND_ROW_H = 34;

const chipsContentHeight = (panel) =>
  Math.min(CHIPS_MAX_H, Math.max(CHIPS_MIN_H, panel.scrollHeight || CHIPS_MIN_H));

ensureStylesheet();

const loraDisplay = (f) =>
  (f || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "");

app.registerExtension({
  name: "DirtyBirds.TriggerWords",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsTriggerWords") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;

      const dataW = hideWidget(node, "trigger_words_data");
      let chips = [];
      try {
        const p = JSON.parse(dataW?.value || "[]");
        if (Array.isArray(p)) chips = p;
      } catch (e) {}

      const widthEls = [];

      // Header already reads "Trigger Words" — no redundant in-node title.

      // ── Add-LoRA button ──────────────────────────────────────────────────────
      const addBtn = makeButton();
      addBtn.className = "db-lib-btn db-lora-add-open-btn";
      addBtn.textContent = "👗  Add LoRA";
      addBtn.style.cssText +=
        "box-sizing:border-box;overflow:hidden;width:100%;";
      const addWrap = document.createElement("div");
      addWrap.style.cssText =
        "box-sizing:border-box;overflow:hidden;width:100%;";
      addWrap.appendChild(addBtn);
      node.addDOMWidget("db_wd_add", "customhtml", addWrap, {
        serialize: false,
        height: reserveHeight(ADD_ROW_H),
        getMinHeight: () => reserveHeight(ADD_ROW_H),
      });
      widthEls.push(addWrap);

      // ── Trigger-word chip panel ──────────────────────────────────────────────
      const panel = document.createElement("div");
      panel.className = "db-tw-panel";
      panel.style.cssText +=
        `box-sizing:border-box;overflow:auto;width:100%;max-height:${CHIPS_MAX_H}px;`;
      const panelWidget = node.addDOMWidget(
        "db_wd_chips",
        "customhtml",
        panel,
        {
          serialize: false,
          height: reserveHeight(CHIPS_MIN_H),
          getMinHeight: () => reserveHeight(chipsContentHeight(panel)),
        },
      );
      widthEls.push(panel);

      // ── Status line ──────────────────────────────────────────────────────────
      const status = document.createElement("div");
      status.style.cssText =
        "font-size:10px;color:#888;padding:0 2px;width:100%;box-sizing:border-box;";
      node.addDOMWidget("db_wd_status", "customhtml", status, {
        serialize: false,
        height: reserveHeight(STATUS_H),
        getMinHeight: () => reserveHeight(STATUS_H),
      });
      widthEls.push(status);

      function serialize() {
        if (dataW) dataW.value = JSON.stringify(chips);
      }
      // Rebinds `chips` to freshly parsed objects, so every chip's click,
      // dblclick and contextmenu handler — which closed over the PREVIOUS
      // objects — is now editing entries this array no longer contains.
      // ONLY call this immediately before renderChips(), which rebuilds those
      // handlers against the new objects. renderChips() does exactly that.
      function restoreChips() {
        try {
          const parsed = JSON.parse(dataW?.value || "[]");
          if (Array.isArray(parsed)) chips = parsed;
        } catch (_) {}
      }
      function activeCount() {
        return chips.filter((c) => c.active).length;
      }
      function activeText() {
        // Deliberately does NOT restore. `chips` is already authoritative —
        // every mutation calls serialize() — and re-parsing here swapped the
        // array out from under the live chip handlers, so after one press of
        // "Send to Prompt Builder" every chip silently stopped toggling for the
        // rest of the session.
        return chips
          .filter((c) => c.active && String(c.text || "").trim())
          .map((c) => String(c.text).trim())
          .join(", ");
      }
      function refreshStatus() {
        status.textContent = chips.length
          ? `${activeCount()}/${chips.length} trigger words active`
          : "No trigger words yet — add a LoRA.";
      }
      function fitNode() {
        // Grow the node so the last widget (Send button) is never clipped.
        const need = node.computeSize();
        if ((node.size?.[1] || 0) < need[1])
          node.setSize([node.size[0], need[1]]);
      }
      function syncH() {
        requestAnimationFrame(() => {
          setWidgetHeight(panelWidget, reserveHeight(chipsContentHeight(panel)));
          fitNode();
          node.setDirtyCanvas(true, true);
        });
      }

      function renderChips() {
        restoreChips();
        panel.innerHTML = "";
        if (!chips.length) {
          const hint = document.createElement("div");
          hint.className = "db-tw-empty";
          hint.textContent = "No trigger words";
          panel.appendChild(hint);
          refreshStatus();
          syncH();
          return;
        }
        chips.forEach((entry, idx) => {
          const chip = document.createElement("span");
          chip.className =
            "db-tw-chip" + (entry.active ? " db-tw-active" : " db-tw-inactive");
          chip.title = `LoRA: ${loraDisplay(entry.lora)}\nClick: toggle • Double-click: edit • Right-click: remove`;
          const textEl = document.createElement("span");
          textEl.className = "db-tw-text";
          textEl.textContent = entry.text;
          chip.appendChild(textEl);

          chip.addEventListener("click", () => {
            if (chip.classList.contains("db-tw-editing")) return;
            entry.active = !entry.active;
            chip.classList.toggle("db-tw-active", entry.active);
            chip.classList.toggle("db-tw-inactive", !entry.active);
            serialize();
            refreshStatus();
          });

          chip.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (chip.classList.contains("db-tw-editing")) return;
            chip.classList.add("db-tw-editing");
            const input = makeInput();
            input.className = "db-tw-input";
            input.value = entry.text;
            input.style.width = Math.max(40, entry.text.length * 7) + "px";
            chip.innerHTML = "";
            chip.appendChild(input);
            function commit() {
              const v = input.value.trim();
              if (v) entry.text = v;
              else chips.splice(idx, 1);
              chip.classList.remove("db-tw-editing");
              serialize();
              renderChips();
            }
            input.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                input.blur();
              }
              if (ev.key === "Escape") {
                input.value = entry.text;
                input.blur();
              }
            });
            input.addEventListener("blur", commit);
            setTimeout(() => {
              input.focus();
              input.select();
            }, 10);
          });

          chip.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            chips.splice(idx, 1);
            serialize();
            renderChips();
          });

          panel.appendChild(chip);
        });
        refreshStatus();
        syncH();
      }

      async function addLora(name) {
        status.textContent = `Loading ${loraDisplay(name)}…`;
        const meta = await fetchJSON(
          `/dirtybirds/lora-meta?name=${encodeURIComponent(name)}`,
        );
        const words = (meta?.trigger_words || [])
          .map((w) => String(w).trim())
          .filter(Boolean);
        if (!words.length) {
          status.textContent = `${loraDisplay(name)}: no trigger words found.`;
          return;
        }
        let added = 0;
        words.forEach((t) => {
          if (
            !chips.find(
              (c) =>
                c.lora === name && c.text.toLowerCase() === t.toLowerCase(),
            )
          ) {
            chips.push({ lora: name, text: t, active: true });
            added++;
          }
        });
        if (added) {
          serialize();
          renderChips();
          node.setDirtyCanvas(true);
        } else status.textContent = `${loraDisplay(name)}: already added.`;
      }

      addBtn.addEventListener("click", async () => {
        const list = await fetchJSON("/dirtybirds/loras");
        const names = Array.isArray(list) ? list : [];
        showListFlyout("Add LoRA", names, null, loraDisplay, addLora);
      });

      // ── Send active trigger words to Prompt Builder positive prompt ────────────
      const sendBtn = makeButton();
      sendBtn.className = "db-lib-btn db-lora-add-open-btn";
      sendBtn.textContent = "Send to Prompt Builder";
      sendBtn.style.cssText +=
        "box-sizing:border-box;overflow:hidden;width:100%;";
      const sendWrap = document.createElement("div");
      sendWrap.style.cssText =
        "box-sizing:border-box;overflow:hidden;width:100%;";
      sendWrap.appendChild(sendBtn);
      node.addDOMWidget("db_wd_send", "customhtml", sendWrap, {
        serialize: false,
        height: reserveHeight(SEND_ROW_H),
        getMinHeight: () => reserveHeight(SEND_ROW_H),
      });
      widthEls.push(sendWrap);

      function findDirtyTalkNode() {
        return app.graph?._nodes?.find(
          (n) =>
            n.type === "DirtyBirdsPrompt" ||
            n.comfyClass === "DirtyBirdsPrompt",
        );
      }

      function appendToDirtyTalk(text) {
        const target = findDirtyTalkNode();
        if (!target) {
          status.textContent = "Add a Prompt Builder node first.";
          return;
        }
        const posWidget = target.widgets?.find((w) => w.name === "positive");
        const posTA = target._dbPositiveTextarea;
        const current = String(posWidget?.value ?? posTA?.value ?? "").trim();
        const sep =
          current && !/[\s,]$/.test(current) ? ", " : current ? " " : "";
        const next = current + sep + text;
        if (posWidget) posWidget.value = next;
        if (posTA) {
          posTA.value = next;
          posTA.dispatchEvent(new Event("input", { bubbles: true }));
          posTA.focus();
        }
        target.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
        status.textContent = "Sent active trigger words to Prompt Builder.";
      }

      sendBtn.addEventListener("click", () => {
        const text = activeText();
        if (!text) {
          status.textContent = "No active trigger words to send.";
          return;
        }
        appendToDirtyTalk(text);
      });

      // ── Width sync + restore ────────────────────────────────────────────────
      bindWidthSync(node, widthEls);
      requestAnimationFrame(() => requestAnimationFrame(renderChips));
    };
  },
});
