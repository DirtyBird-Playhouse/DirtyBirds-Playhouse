/**
 * DirtyBirds Playhouse — Prompt Studio page logic.
 *
 * Drives the standalone Studio page (web/wildcard_editor.html, served at
 * /dirtybirds/wildcard-editor): wildcard YAML editing, LM Studio extraction,
 * image captioning, and prompt enhancement. Talks to the backend routes in
 * dirtybirds_studio.py and injects results back to the Prompt node via a
 * same-origin BroadcastChannel.
 *
 * NOTE: ComfyUI auto-loads every .js in the web/ folder onto the MAIN graph
 * page as an extension. This file is only meaningful on the Studio page, so it
 * guards on a Studio-only element and bails everywhere else (the early return
 * lives inside the IIFE so it's valid whether loaded as a classic script or an
 * ES module).
 */

(function () {
  // Not the Prompt Studio page → do nothing (e.g. main ComfyUI graph).
  if (!document.getElementById("pane-enhance")) return;

  const $ = (id) => document.getElementById(id);
  let extracted = [];   // [{text, category}]
  let knownCats = [];   // categories list (from file/keys)

  function flash(msg, ok = true) {
    const el = $("status");
    el.textContent = msg;
    el.className = "status " + (ok ? "ok" : "err");
    if (ok) setTimeout(() => { el.className = "status"; }, 4000);
  }

  async function api(url, opts) {
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  async function loadFileList(selectName) {
    const { files } = await api("/dirtybirds/wildcard-files");
    const sel = $("fileSel");
    sel.innerHTML = "";
    files.forEach(f => {
      const o = document.createElement("option");
      o.value = o.textContent = f;
      sel.appendChild(o);
    });
    if (selectName && files.includes(selectName)) sel.value = selectName;
    if (sel.value) await loadFile(sel.value);
  }

  async function loadFile(name) {
    if (!name) { $("yamlEditor").value = ""; $("fileLabel").textContent = "—"; return; }
    const { content } = await api("/dirtybirds/wildcard-file?name=" + encodeURIComponent(name));
    $("yamlEditor").value = content;
    $("fileLabel").textContent = name;
  }

  async function loadCategories() {
    try {
      const { keys } = await api("/dirtybirds/wildcards");
      knownCats = keys || [];
      $("categories").value = knownCats.join("\n");
    } catch { /* non-fatal */ }
  }

  function currentCategories() {
    return $("categories").value.split("\n").map(s => s.trim()).filter(Boolean);
  }

  // Phrases already present in the loaded YAML file, so extracted dupes can be
  // hidden. Handles block lists (`- foo`), scalars (`key: foo`), flow lists
  // (`key: ["a", "b"]`) and dynamic groups (`{a|b}`, `{1-2$$, $$a|b}`, `{7::a|3::b}`)
  // by splitting each into its individual phrase values.
  function existingPhrases() {
    const set = new Set();
    const norm = (s) => s.trim().replace(/^['"]|['"]$/g, "").trim().toLowerCase();
    // Add a raw value, splitting {a|b} option groups into their separate phrases.
    const add = (val) => {
      let v = norm(val);
      if (!v) return;
      if (v.includes("|")) {
        let body = v.replace(/[{}]/g, "");
        const parts = body.split("$$");          // strip "N$$" / "$$sep$$" quantifier
        if (parts.length >= 2 && /^\s*\d+(-\d+)?\s*$/.test(parts[0])) {
          body = parts.slice(parts.length >= 3 ? 2 : 1).join("$$");
        }
        body.split("|").forEach((opt) => {
          const o = norm(opt.replace(/^\s*\d+(\.\d+)?\s*::/, "")); // strip weight prefix
          if (o) set.add(o);
        });
      }
      set.add(v);
    };
    const text = $("yamlEditor").value;
    // 1. Every quoted string anywhere — covers flow-list items: key: ["a", "b"].
    const qre = /"([^"]*)"|'([^']*)'/g;
    let m;
    while ((m = qre.exec(text)) !== null) add(m[1] !== undefined ? m[1] : m[2]);
    // 2. Block-style items and unquoted scalars (lines without quotes).
    text.split("\n").forEach((line) => {
      const s = line.trim();
      if (!s || s.startsWith("#") || s.includes('"') || s.includes("'")) return;
      let v = null;
      if (s.startsWith("- ")) v = s.slice(2);
      else {
        const mm = s.match(/^[^:]+:\s*(.+)$/);
        if (mm) v = mm[1];
      }
      if (v) add(v);
    });
    return set;
  }

  function renderReview() {
    const list = $("reviewList");
    list.innerHTML = "";
    const cats = currentCategories();
    const have = existingPhrases();
    const hideDupes = $("hideDupes") && $("hideDupes").checked;
    let dupes = 0, hidden = 0;
    extracted.forEach((it, i) => {
      const isDupe = have.has(String(it.text).trim().toLowerCase());
      if (isDupe) { dupes++; if (hideDupes) { hidden++; return; } }
      const isNew = !cats.includes(it.category);
      const row = document.createElement("div");
      const applyCls = () => {
        row.className = "item"
          + (!currentCategories().includes(extracted[i].category) ? " new" : "")
          + (isDupe ? " dupe" : "")
          + (extracted[i].selected ? " selected" : "");
      };
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "sel";
      chk.checked = !!it.selected;
      chk.title = "Tick to include this phrase when committing";
      chk.onchange = () => { extracted[i].selected = chk.checked; applyCls(); };
      const txt = document.createElement("input");
      txt.className = "txt"; txt.value = it.text;
      txt.oninput = () => { extracted[i].text = txt.value; };
      const cat = document.createElement("input");
      cat.className = "txt cat"; cat.value = it.category;
      cat.title = "category path (parent/child/leaf)";
      cat.oninput = () => { extracted[i].category = cat.value; applyCls(); };
      const rm = document.createElement("button");
      rm.className = "rm"; rm.textContent = "✕";
      rm.onclick = () => { extracted.splice(i, 1); renderReview(); };
      applyCls();
      row.append(chk, txt, cat, rm);
      if (isNew) { const b = document.createElement("span"); b.className = "badge-new"; b.textContent = "✨"; row.appendChild(b); }
      if (isDupe) { const b = document.createElement("span"); b.className = "badge-dupe"; b.title = "Already in the file"; b.textContent = "↺"; row.appendChild(b); }
      list.appendChild(row);
    });
    if (dupes) {
      const note = document.createElement("div");
      note.className = "hint";
      note.style.marginTop = "6px";
      note.textContent = hideDupes
        ? `${hidden} duplicate(s) already in the file were hidden.`
        : `${dupes} phrase(s) (↺) already exist in the file — left unticked so you won't duplicate them.`;
      list.appendChild(note);
    }
    $("reviewPanel").style.display = extracted.length ? "block" : "none";
  }

  // ── Events ────────────────────────────────────────────────────────────────
  $("fileSel").onchange = (e) => loadFile(e.target.value).catch(err => flash(err.message, false));
  $("reloadBtn").onclick = () => loadFile($("fileSel").value).then(() => flash("Reloaded.")).catch(err => flash(err.message, false));

  $("newBtn").onclick = async () => {
    const name = prompt("New wildcard file name (e.g. extras.yaml):", "");
    if (!name) return;
    const fixed = /\.(ya?ml)$/i.test(name) ? name : name + ".yaml";
    try {
      await api("/dirtybirds/wildcard-file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fixed, content: "# " + fixed + "\n" }),
      });
      await loadFileList(fixed);
      flash("Created " + fixed);
    } catch (err) { flash(err.message, false); }
  };

  $("saveBtn").onclick = async () => {
    const name = $("fileSel").value;
    if (!name) return flash("No file selected.", false);
    const btn = $("saveBtn"); btn.classList.add("busy");
    try {
      await api("/dirtybirds/wildcard-file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: $("yamlEditor").value }),
      });
      flash("Saved " + name);
      loadCategories();
    } catch (err) { flash(err.message, false); }
    finally { btn.classList.remove("busy"); }
  };

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll(".tabpane").forEach((p) =>
      p.classList.toggle("active", p.id === "pane-" + name));
    document.querySelectorAll("nav.tabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.pane === name));
  }
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.onclick = () => switchTab(b.dataset.pane);
  });

  // ── Prompt enhance ────────────────────────────────────────────────────────
  const injectChannel = (typeof BroadcastChannel !== "undefined")
    ? new BroadcastChannel("dirtybirds-prompt") : null;

  $("enhanceBtn").onclick = async () => {
    const text = $("enhanceIn").value.trim();
    if (!text) return flash("Type a prompt to enhance first.", false);
    const btn = $("enhanceBtn"); btn.classList.add("busy"); btn.textContent = "⏳ Enhancing…";
    try {
      const { enhanced } = await api("/dirtybirds/wildcard-enhance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_url: $("serverUrl").value.trim(),
          model: $("modelName").value.trim(),
          text,
          prompt: $("enhancePrompt").value.trim(),
          temperature: parseFloat($("temp").value),
          max_tokens: parseInt($("maxTokens").value, 10),
        }),
      });
      $("enhanceOut").value = enhanced;
      flash("Prompt enhanced — review, then Inject or Copy.");
    } catch (err) { flash(err.message, false); }
    finally { btn.classList.remove("busy"); btn.textContent = "🚀 Enhance prompt"; }
  };

  function injectPrompt(text, mode, target) {
    if (!text) return flash("Nothing to inject.", false);
    if (!injectChannel) return flash("This browser can't reach the Prompt node (no BroadcastChannel).", false);
    injectChannel.postMessage({ type: "inject-prompt", text, mode, target });
    flash(`Injected into the ${target} box. Switch back to ComfyUI to see it.`);
  }

  $("injectBtn").onclick = () =>
    injectPrompt($("enhanceOut").value.trim(), "replace", $("enhanceTarget").value);
  $("captionInject").onclick = () =>
    injectPrompt($("captionOut").value.trim(), "append", $("captionTarget").value);

  $("copyEnhance").onclick = async () => {
    const out = $("enhanceOut").value.trim();
    if (!out) return flash("Nothing to copy.", false);
    try { await navigator.clipboard.writeText(out); flash("Copied to clipboard."); }
    catch { flash("Copy failed — select and copy manually.", false); }
  };

  // ── LM Studio model list ──────────────────────────────────────────────────
  // Preferred selections (restored from settings before models are pulled).
  let preferredModel = "";
  let preferredVision = "";

  function esc(s) { return String(s).replace(/"/g, "&quot;"); }

  // Fill a <select> from [{id, loaded}] models. Selection priority:
  //   1. the user's saved preference (`prefer`), if still present
  //   2. a currently-LOADED model (avoids requesting a cold/heavy model)
  //   3. the first model
  // Loaded models are marked with ● so it's obvious which are ready to use.
  function fillSelect(sel, models, prefer) {
    const ids = models.map((m) => m.id);
    let opts = models.slice();
    if (prefer && !ids.includes(prefer)) opts = [{ id: prefer, loaded: false }, ...opts];
    sel.innerHTML = opts.map((m) =>
      `<option value="${esc(m.id)}">${m.loaded ? "● " : ""}${esc(m.id)}</option>`).join("");
    const loaded = opts.find((m) => m.loaded);
    const want = (prefer && ids.includes(prefer)) ? prefer
               : (loaded ? loaded.id : (opts[0] && opts[0].id));
    if (want) sel.value = want;
  }

  async function pullModels(quiet) {
    const btn = $("pullModels"); btn.classList.add("busy");
    try {
      const { models } = await api("/dirtybirds/wildcard-models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server_url: $("serverUrl").value.trim() }),
      });
      const list = models || [];
      const haveTypes = list.some((m) => m.type);
      const conv = (m) => ({ id: m.id, loaded: m.state === "loaded" });
      // Model field: anything chat-capable (exclude embeddings). Vision field:
      // vision models only. Without type info (e.g. /v1/models), show all.
      const textModels = list
        .filter((m) => !haveTypes || m.type !== "embeddings").map(conv);
      const visionModels = list
        .filter((m) => !haveTypes || m.type === "vlm").map(conv);
      fillSelect($("modelName"), textModels, preferredModel);
      fillSelect($("visionModel"), visionModels, preferredVision);
      if (!quiet) {
        const nLoaded = list.filter((m) => m.state === "loaded").length;
        flash(`Loaded ${list.length} model(s) from LM Studio (${nLoaded} in memory).`);
      }
    } catch (err) {
      // Keep any preferred values usable even when LM Studio is unreachable.
      fillSelect($("modelName"), [], preferredModel);
      fillSelect($("visionModel"), [], preferredVision);
      if (!quiet) flash(err.message, false);
    }
    finally { btn.classList.remove("busy"); }
  }
  $("pullModels").onclick = () => pullModels(false);

  // ── Image captioning ──────────────────────────────────────────────────────
  let imageDataUrl = null;

  function setImage(dataUrl) {
    imageDataUrl = dataUrl;
    $("imgPreview").src = dataUrl;
    $("imgPreviewWrap").style.display = "";
  }
  function clearImage() {
    imageDataUrl = null;
    $("imgPreview").removeAttribute("src");
    $("imgPreviewWrap").style.display = "none";
    $("imageInput").value = "";
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    setImage(await fileToDataUrl(file));
  }

  $("dropZone").onclick = (e) => { if (e.target.tagName !== "BUTTON") $("imageInput").click(); };
  $("imageInput").onchange = (e) => handleFile(e.target.files[0]);
  $("clearImgBtn").onclick = clearImage;
  $("dropZone").addEventListener("dragover", (e) => { e.preventDefault(); $("dropZone").style.borderColor = "#9b6dff"; });
  $("dropZone").addEventListener("dragleave", () => { $("dropZone").style.borderColor = "#555"; });
  $("dropZone").addEventListener("drop", (e) => {
    e.preventDefault(); $("dropZone").style.borderColor = "#555";
    handleFile(e.dataTransfer.files[0]);
  });
  window.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) handleFile(item.getAsFile());
  });

  // Pull the image currently selected on a DirtyBirds Load Image node. Asks the
  // node (on the main ComfyUI tab) for its image/url over BroadcastChannel, then
  // resolves the pixels server-side via /dirtybirds/fetch-image.
  $("pullLoadImage").onclick = () => {
    if (!injectChannel) return flash("This browser can't reach the graph (no BroadcastChannel).", false);
    const btn = $("pullLoadImage"); btn.classList.add("busy"); btn.textContent = "⏳ Fetching…";
    let done = false;
    const finish = (fn) => { if (done) return; done = true; injectChannel.removeEventListener("message", onInfo); clearTimeout(timer); btn.classList.remove("busy"); btn.textContent = "📥 From Load Image node"; fn(); };
    const onInfo = async (ev) => {
      const m = ev.data || {};
      if (m.type !== "load-image-info") return;
      if (m.error) return finish(() => flash(m.error, false));
      try {
        const data = await api("/dirtybirds/fetch-image", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: m.image || "", image_url: m.image_url || "" }),
        });
        finish(() => { setImage(data.image); switchTab("caption"); flash("Pulled image from Load Image node."); });
      } catch (err) { finish(() => flash(err.message, false)); }
    };
    const timer = setTimeout(() => finish(() =>
      flash("No response — is a DirtyBirds Load Image node open in ComfyUI?", false)), 2500);
    injectChannel.addEventListener("message", onInfo);
    injectChannel.postMessage({ type: "request-load-image" });
  };

  $("captionBtn").onclick = async () => {
    if (!imageDataUrl) return flash("Drop or select an image first.", false);
    const btn = $("captionBtn"); btn.classList.add("busy"); btn.textContent = "⏳ Captioning…";
    try {
      const { caption } = await api("/dirtybirds/wildcard-caption", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_url: $("serverUrl").value.trim(),
          model: $("visionModel").value.trim(),
          image: imageDataUrl,
          prompt: $("captionPrompt").value.trim(),
          temperature: parseFloat($("temp").value),
          max_tokens: parseInt($("maxTokens").value, 10),
        }),
      });
      $("captionOut").value = caption;
      flash("Caption ready — edit it, then ‘Send to Extract’.");
    } catch (err) { flash(err.message, false); }
    finally { btn.classList.remove("busy"); btn.textContent = "✨ Caption image"; }
  };

  $("captionToExtract").onclick = () => {
    const cap = $("captionOut").value.trim();
    if (!cap) return flash("Nothing to send — caption an image first.", false);
    const existing = $("rawText").value.trim();
    $("rawText").value = existing ? existing + "\n" + cap : cap;
    switchTab("wild");
    flash("Caption sent to Extract box.");
  };

  if ($("hideDupes")) $("hideDupes").onchange = renderReview;

  $("analyzeBtn").onclick = async () => {
    const text = $("rawText").value.trim();
    if (!text) return flash("Paste some text to extract first.", false);
    const body = {
      server_url: $("serverUrl").value.trim(),
      model: $("modelName").value.trim(),
      text, categories: currentCategories(),
      temperature: parseFloat($("temp").value),
      max_tokens: parseInt($("maxTokens").value, 10),
      system_prompt: $("sysPrompt").value.trim(),
    };
    const btn = $("analyzeBtn"); btn.classList.add("busy"); btn.textContent = "⏳ Analyzing…";
    try {
      const { items } = await api("/dirtybirds/wildcard-extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Default every phrase to NOT selected — the user opts in per item.
      extracted = (items || []).map((it) => ({ ...it, selected: false }));
      renderReview();
      flash(`Extracted ${extracted.length} phrase(s). Review below.`);
    } catch (err) { flash(err.message, false); }
    finally { btn.classList.remove("busy"); btn.textContent = "🚀 Analyze & Extract"; }
  };

  $("commitBtn").onclick = async () => {
    const name = $("fileSel").value;
    if (!name) return flash("Select a file to commit into first.", false);
    const chosen = extracted.filter((it) => it.selected);
    if (!chosen.length) return flash("Tick the phrases you want to keep first.", false);
    const btn = $("commitBtn"); btn.classList.add("busy");
    try {
      const { content } = await api("/dirtybirds/wildcard-merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, items: chosen }),
      });
      $("yamlEditor").value = content;
      extracted = []; renderReview();
      await loadCategories();
      // Add any newly-used category paths to the target schema list (after the
      // file refresh, so manual additions aren't clobbered by loadCategories).
      const cats = currentCategories();
      let added = 0;
      chosen.forEach((it) => {
        const c = String(it.category || "").trim();
        if (c && !cats.includes(c)) { cats.push(c); added++; }
      });
      if (added) $("categories").value = cats.join("\n");
      flash("Committed to " + name + (added ? ` (+${added} categor${added === 1 ? "y" : "ies"})` : ""));
    } catch (err) { flash(err.message, false); }
    finally { btn.classList.remove("busy"); }
  };

  let defaultPrompt = "";
  let defaultCaptionPrompt = "";
  let defaultEnhancePrompt = "";
  const LS_KEY = "dirtybirds.wildcard.modelSettings";

  function saveSettings() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        temperature: $("temp").value,
        max_tokens: $("maxTokens").value,
        system_prompt: $("sysPrompt").value,
        caption_prompt: $("captionPrompt").value,
        enhance_prompt: $("enhancePrompt").value,
        model: $("modelName").value,
        vision_model: $("visionModel").value,
      }));
    } catch { /* storage unavailable / full — ignore */ }
  }

  async function loadExtractDefaults() {
    // Server defaults first, then overlay any user-saved overrides.
    try {
      const d = await api("/dirtybirds/wildcard-extract-defaults");
      defaultPrompt = d.system_prompt || "";
      defaultCaptionPrompt = d.caption_prompt || "";
      defaultEnhancePrompt = d.enhance_prompt || "";
      $("sysPrompt").value = defaultPrompt;
      $("captionPrompt").value = defaultCaptionPrompt;
      $("enhancePrompt").value = defaultEnhancePrompt;
      if (d.temperature != null) $("temp").value = d.temperature;
      if (d.max_tokens != null) $("maxTokens").value = d.max_tokens;
    } catch { /* non-fatal: fields keep their HTML defaults */ }

    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (saved) {
        if (saved.temperature != null && saved.temperature !== "") $("temp").value = saved.temperature;
        if (saved.max_tokens != null && saved.max_tokens !== "") $("maxTokens").value = saved.max_tokens;
        if (saved.system_prompt != null && saved.system_prompt !== "") $("sysPrompt").value = saved.system_prompt;
        if (saved.caption_prompt != null && saved.caption_prompt !== "") $("captionPrompt").value = saved.caption_prompt;
        if (saved.enhance_prompt != null && saved.enhance_prompt !== "") $("enhancePrompt").value = saved.enhance_prompt;
        // Model selects are populated later by pullModels(); remember the
        // desired ids so that pass can re-select them.
        if (saved.model) preferredModel = saved.model;
        if (saved.vision_model) preferredVision = saved.vision_model;
      }
    } catch { /* corrupt entry — ignore */ }

    // Persist on edit.
    ["temp", "maxTokens", "sysPrompt", "captionPrompt", "enhancePrompt", "modelName", "visionModel"].forEach((id) => {
      $(id).addEventListener("input", saveSettings);
    });
  }
  $("resetPrompt").onclick = () => { $("sysPrompt").value = defaultPrompt; saveSettings(); };
  $("resetCaption").onclick = () => { $("captionPrompt").value = defaultCaptionPrompt; saveSettings(); };
  $("resetEnhance").onclick = () => { $("enhancePrompt").value = defaultEnhancePrompt; saveSettings(); };

  // ── Init ────────────────────────────────────────────────────────────────
  (async () => {
    try { await loadExtractDefaults(); await loadFileList(); await loadCategories(); pullModels(true); }
    catch (err) { flash(err.message, false); }
  })();
})();
