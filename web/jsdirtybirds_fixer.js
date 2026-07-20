/** DirtyBirds Playhouse — Forbidden Vision Fixer themed controls. */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, addTitle, bindWidthSync,
  hideWidget, makeSlider, makeFlyoutBtn, addCollapsibleTitle, setDOMWidgetShown,
  makeTextarea, makeSegment, makeTwoColumn, openPickerModal,
} from "./db_shared.js";
import {
  handleAutocompleteInput, handleAutocompleteKeydown,
} from "./jsdirtybirds_prompt_helpers.js";

ensureStylesheet();

const RESTORE_METHOD_DEFAULT = "Diffusion (Inpaint)";
const ALL_COMPARE = "All (Compare)";
const RESTORE_METHODS = ["Diffusion (Inpaint)", "GFPGAN", "CodeFormer", ALL_COMPARE];
const CODEFORMER_FIDELITY_DEFAULT = 0.5;

// ── "All (Compare)" in-node picker ───────────────────────────────────────────
// The Python node runs all three restores and BLOCKS, pushing the batch here.
// The user picks which to keep in the shared modal; only those flow on to Save.
const PICK_EVENT = "dirtybirds-fixer-pick";
const PICK_ROUTE = "/dirtybirds/fixer-pick";

let _pick = null; // { token, node }

function viewURL(img) {
  const p = new URLSearchParams({
    filename: img.filename || "", subfolder: img.subfolder || "",
    type: img.type || "temp",
  });
  const path = "/view?" + p.toString();
  return api.apiURL ? api.apiURL(path) : path;
}

async function postPick(token, selection) {
  const res = await api.fetchApi(PICK_ROUTE, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, selection }),
  });
  if (!res?.ok) throw new Error(`Fixer pick reply failed (${res?.status ?? "no response"})`);
}

// The pick UI is the shared modal (openPickerModal): a node can't grow its
// inline widgets while it is executing, so the picker lives in a <body> overlay
// — same picker the Sampler uses. The Fixer just supplies its event/route,
// per-method labels (Diffusion / GFPGAN / CodeFormer), and the keep-all default.
let _fxModal = null; // shared picker-modal handle, when open

function closeFxModal() { _fxModal?.close(); _fxModal = null; }

function finishPick(selection) {
  if (!_pick) return;
  const { token } = _pick;
  postPick(token, selection).catch((err) =>
    console.error("[DirtyBirds] Fixer pick reply failed:", err));
  closeFxModal();
  _pick = null;
}

function startFixerPick(node, token, images, labels) {
  // Attach the method name to each preview so the shared modal badges it.
  const cards = (images || []).map((img, i) =>
    (labels && labels[i]) ? { ...img, label: labels[i] } : img);
  const sel = new Set(cards.map((_, i) => i)); // keep every method by default
  _pick = { token, node };
  _fxModal = openPickerModal({
    images: cards, selection: sel, title: "💄 Keep which restores?", viewURL,
    onSend: () => {
      const chosen = [...sel].sort((a, b) => a - b);
      if (!chosen.length) {
        _fxModal?.setStatus("Select at least one, or Cancel to keep all.");
        return;
      }
      finishPick(chosen);
    },
    onCancel: () => finishPick([]), // Python keeps all three on an empty selection
  });
}

api.addEventListener(PICK_EVENT, (e) => {
  const d = e.detail || {};
  if (Array.isArray(d.images)) {
    let node = d.node_id != null && d.node_id !== "None"
      ? (app.graph?.getNodeById?.(Number(d.node_id)) || app.graph?.getNodeById?.(d.node_id))
      : null;
    // Older saved workflows may queue without the newer hidden UNIQUE_ID.
    // When there is exactly one Face Restore node, it is unambiguous and safe
    // to route the picker there instead of silently accepting every result.
    if (!node) {
      const fixers = (app.graph?._nodes || []).filter((candidate) =>
        candidate?.comfyClass === "DirtyBirdsFixer" || candidate?.type === "DirtyBirdsFixer");
      if (fixers.length === 1) node = fixers[0];
    }
    if (!node) {
      // No node to drive the picker -> keep everything so the graph completes.
      postPick(d.token, Array.from({ length: d.count || d.images.length }, (_, i) => i))
        .catch((err) => console.error("[DirtyBirds] Fixer pick fallback failed:", err));
      return;
    }
    startFixerPick(node, d.token, d.images, d.labels || []);
    return;
  }
  if (!_pick || d.token !== _pick.token) return;
  if (d.timeout) { closeFxModal(); _pick = null; return; }
  if (typeof d.tick === "number") {
    const m = Math.floor(d.tick / 60), s = d.tick % 60;
    _fxModal?.setCountdown(`${m}:${String(s).padStart(2, "0")} left`);
  }
});

function normalizeNumberWidget(node, name, fallback) {
  const widget = node.widgets?.find((w) => w.name === name);
  if (!widget) return;
  const read = () => {
    const value = Number(widget.value);
    return Number.isFinite(value) ? value : fallback;
  };
  widget.value = read();
  widget.serializeValue = read;
}

function normalizeFixerWidgets(node) {
  const widget = node.widgets?.find((w) => w.name === "restore_method");
  if (widget) {
    const values = widget.options?.values || RESTORE_METHODS;
    const fallback = values.includes(RESTORE_METHOD_DEFAULT) ? RESTORE_METHOD_DEFAULT : values[0];
    if (!values.includes(widget.value)) widget.value = fallback;
    widget.serializeValue = () => values.includes(widget.value) ? widget.value : fallback;
  }
  normalizeNumberWidget(node, "codeformer_fidelity", CODEFORMER_FIDELITY_DEFAULT);
}

app.registerExtension({
  name: "DirtyBirds.Fixer",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsFixer") return;
    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      requestAnimationFrame(() => {
        normalizeFixerWidgets(this);
        this._dbSyncPromptTextareas?.();  // restore face-prompt text from the saved widget
      });
      return result;
    };
    // The Fixer owns its preview UI. Prevent ComfyUI's native image canvas from
    // drawing the full output underneath/alongside the face comparison widget.
    const drawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
      const nativeImages = this.imgs;
      this.imgs = null;
      try {
        return drawBackground?.apply(this, arguments);
      } finally {
        this.imgs = nativeImages;
      }
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      executed?.apply(this, arguments);
      if (Array.isArray(message?.db_fixer_batch)) {
        // "All (Compare)" picked results -> show them all in the batched grid.
        this._dbFixerBatch?.(message.db_fixer_batch,
          message.db_fixer_batch.map((x) => x?.label || ""));
      } else {
        this._dbFixerPreview?.(message?.db_fixer_before, message?.db_fixer_after, message?.db_fixer_resolution?.[0]);
      }
    };
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      original?.apply(this, arguments);
      const node = this;
      normalizeFixerWidgets(node);
      node.color = DB_COLOR; node.bgcolor = DB_BGCOLOR;
      const els = [], controls = {};
      const names = ["steps", "cfg_scale", "sampler", "scheduler", "denoise_strength",
        "pick_timeout",
        "face_positive_prompt",
        "replace_positive_prompt", "face_negative_prompt", "replace_negative_prompt", "exclusions"];
      names.forEach((n) => { controls[n] = hideWidget(node, n); });

      const add = (name, el, h = 34) => {
        el.style.cssText += "box-sizing:border-box;overflow:hidden;";
        node.addDOMWidget(name, "customhtml", el, { serialize:false, height:h, getMinHeight:()=>h });
        els.push(el); return el;
      };
      const title = (name, text) => els.push(addTitle(node, name, text, 30));
      const slider = (name, label, min, max, step, digits = 0, addNow = true) => {
        const w = controls[name];
        const s = makeSlider(label, min, max, step, () => Number(w?.value ?? min),
          (v) => { if (w) w.value = v; node.setDirtyCanvas(true); }, (v) => Number(v).toFixed(digits));
        if (addNow) add(`db_fx_${name}`, s.row); return s;
      };
      const toggle = (name, label, addNow = true) => {
        const w = controls[name], row = document.createElement("div"); row.className = "db-slider-row";
        const txt = document.createElement("span"); txt.className = "db-slider-label"; txt.textContent = label;
        const seg = makeSegment(); seg.style.flex = "1";
        const opts = [[false,"Off"],[true,"On"]].map(([v,l]) => { const e=document.createElement("div"); e.className="db-seg-opt"; e.textContent=l;
          e.onclick=()=>{ if(w) w.value=v; paint(); node.setDirtyCanvas(true); }; seg.appendChild(e); return [v,e]; });
        const paint=()=>opts.forEach(([v,e])=>e.classList.toggle("db-seg-active",Boolean(w?.value)===v)); paint();
        row.append(txt,seg); if (addNow) add(`db_fx_${name}`,row); return { row, paint };
      };
      const combo = (name, tag, addNow = true) => { const w=controls[name]; const p=makeFlyoutBtn(node,tag,{getLabel:()=>w?.value,
        getValues:()=>w?.options?.values||[],getCurrent:()=>w?.value,onPick:(v)=>{if(w)w.value=v;}}); if (addNow) add(`db_fx_${name}`,p.row); return p; };
      // Face-prompt textareas: keep the hidden widget in sync (so the text is
      // serialized and survives refresh/restart), offer the same tag
      // autocomplete as the Prompt Builder, and register for repopulation on
      // workflow load (onConfigure restores widget values after this runs).
      const faceTextareas = (node._dbFaceTextareas = {});
      const text = (name, placeholder, addNow = true) => { const w=controls[name], box=makeTextarea(w?.value||"", placeholder);
        box.style.cssText="width:100%;height:72px;resize:none;background:#191919;color:#ddd;border:1px solid #343434;border-radius:6px;padding:8px;";
        box.addEventListener("input",(e)=>{ if(w)w.value=box.value; handleAutocompleteInput(e, box, node); });
        box.addEventListener("keydown",(e)=>handleAutocompleteKeydown(e, box));
        if (w) faceTextareas[name]=box;
        if (addNow) add(`db_fx_${name}`,box,82); return box; };
      // Called from onConfigure: push restored widget values back into the boxes.
      node._dbSyncPromptTextareas = () => {
        Object.entries(faceTextareas).forEach(([n, box]) => {
          const w = controls[n];
          if (w && box.value !== (w.value || "")) box.value = w.value || "";
        });
      };
      // Pick Timeout — sits at the top of the node (under the native dropdowns).
      // How long the "All (Compare)" picker blocks before keeping every result.
      add("db_fx_pick_timeout", slider("pick_timeout", "Pick Timeout (s)", 5, 600, 5, 0, false).row);

      title("db_fx_sampling_h", "The Face Pass");
      const samplerCtl = combo("sampler","SAMPLER",false);
      const schedulerCtl = combo("scheduler","SCHEDULER",false);
      const stepsCtl = slider("steps","Steps",1,100,1,0,false);
      const cfgCtl = slider("cfg_scale","CFG",0,30,.5,1,false);
      const denoiseCtl = slider("denoise_strength","Denoise",0,1,.01,2,false);
      denoiseCtl.row.style.cssText += "border-left:2px solid #5aadff;padding-left:5px;";
      const passCols = makeTwoColumn("db-talent-columns");
      passCols.style.cssText = "box-sizing:border-box;overflow:hidden;align-items:flex-start;";
      const methodCol = document.createElement("div"); methodCol.className = "db-talent-loras";
      methodCol.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";
      const methodHead = document.createElement("div"); methodHead.className = "db-talent-col-header"; methodHead.textContent = "Method";
      methodCol.append(methodHead, samplerCtl.row, schedulerCtl.row);
      const passDivider = document.createElement("div"); passDivider.className = "db-talent-divider";
      const tuningCol = document.createElement("div"); tuningCol.className = "db-talent-triggerwords";
      tuningCol.style.cssText = "display:flex;flex-direction:column;min-width:0;";
      const tuningHead = document.createElement("div"); tuningHead.className = "db-talent-col-header"; tuningHead.textContent = "Tuning";
      tuningCol.append(tuningHead, stepsCtl.row, cfgCtl.row, denoiseCtl.row);
      passCols.append(methodCol, passDivider, tuningCol);
      add("db_fx_face_pass_cols", passCols, 108);

      // Face Prompt — collapsible section (starts expanded).
      let promptWidget = null;
      const promptSection = addCollapsibleTitle(node, "db_fx_prompt_h", "Face Prompt", {
        expanded: true,
        onChange: (open) => { setDOMWidgetShown(node, promptWidget, open); node._dbFitContent?.(); },
      });
      els.push(promptSection.label);
      const promptPanel=document.createElement("div");
      promptPanel.style.cssText="display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;overflow:hidden;";
      const promptTabs=makeSegment(); promptTabs.style.height="22px";
      const promptViews={
        positive:{label:"Positive",editor:text("face_positive_prompt","Additional positive face prompt",false),extra:toggle("replace_positive_prompt","Replace",false).row},
        negative:{label:"Negative",editor:text("face_negative_prompt","Additional negative face prompt",false),extra:toggle("replace_negative_prompt","Replace",false).row},
        exclusions:{label:"Exclusions",editor:text("exclusions","Tags to remove from the face prompt",false),extra:null},
      };
      const promptBody=document.createElement("div"); promptBody.style.cssText="min-height:112px;overflow:hidden;";
      let activePrompt="positive";
      const showPrompt=(name)=>{
        activePrompt=name; promptBody.replaceChildren(promptViews[name].editor);
        if(promptViews[name].extra)promptBody.append(promptViews[name].extra);
        Object.entries(promptViews).forEach(([key,item])=>item.button.classList.toggle("db-seg-active",key===name));
      };
      const paintPromptTabs=()=>Object.values(promptViews).forEach(item=>item.button.textContent=`${item.label}${item.editor.value.trim()?" •":""}`);
      Object.entries(promptViews).forEach(([name,item])=>{const button=document.createElement("div");button.className="db-seg-opt";button.style.fontSize="9px";button.onclick=()=>showPrompt(name);item.button=button;item.editor.addEventListener("input",paintPromptTabs);promptTabs.append(button);});
      paintPromptTabs();
      promptPanel.append(promptTabs,promptBody); showPrompt(activePrompt);
      add("db_fx_prompt_tabs",promptPanel,146);
      promptWidget = node.widgets?.find((w)=>w.name==="db_fx_prompt_tabs");

      // ── Preview: Before/After compare (single result) + batched grid ─────────
      // The grid shows every image received and doubles as the "All (Compare)"
      // picker. Everything stays fully collapsed until there's real output, so
      // the node shows no empty preview box by default.
      title("db_fx_preview_h", "Preview");
      // Batch count badge — how many images were passed in / are being shown.
      const countRow=document.createElement("div");
      countRow.style.cssText="text-align:center;font-size:10px;font-weight:600;color:#8fb6c9;letter-spacing:.06em;";
      add("db_fx_count", countRow, 16);
      const compare=document.createElement("div"); compare.title="Click to compare"; compare.style.cssText="position:relative;height:190px;background:#0b0b0b;border:1px solid #303030;border-radius:6px;overflow:hidden;cursor:pointer;user-select:none;";
      const resolution=document.createElement("div"); resolution.style.cssText="position:absolute;top:6px;right:8px;z-index:4;color:#aaa;font-size:9px;text-shadow:0 1px 2px #000;";
      const compareState=document.createElement("div"); compareState.style.cssText="position:absolute;left:8px;bottom:7px;z-index:4;padding:3px 7px;border:1px solid #5aadff;border-radius:10px;background:#10283bcc;color:#bfe4ff;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-shadow:0 1px 2px #000;pointer-events:none;";
      const beforeImg=document.createElement("img"), afterImg=document.createElement("img");
      [beforeImg,afterImg].forEach(img=>img.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;");
      let showAfter=true;
      const paintComparison=()=>{afterImg.style.display=showAfter?"block":"none";compareState.textContent=showAfter?"After":"Before";};
      compare.addEventListener("click",()=>{showAfter=!showAfter;paintComparison();});
      compare.append(beforeImg,afterImg,resolution,compareState); paintComparison(); add("db_fx_compare",compare,198);

      // Batched grid (also the All-Compare picker).
      const grid=document.createElement("div");
      grid.style.cssText="display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;";
      const gridThumbs=document.createElement("div");
      gridThumbs.style.cssText="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:150px;overflow-y:auto;";
      grid.append(gridThumbs);
      add("db_fx_grid",grid,196);

      const W=(n)=>node.widgets?.find((w)=>w.name===n);
      // Batch count badge: "N image(s)". Hidden when there's nothing to show.
      const setCount=(n)=>{
        countRow.textContent = n>0 ? `${n} image${n===1?"":"s"}` : "";
        setDOMWidgetShown(node, W("db_fx_count"), n>0);
      };
      const showSection=(which)=>{ // "none" | "compare" | "grid"
        setDOMWidgetShown(node, W("db_fx_preview_h"), which!=="none");
        setDOMWidgetShown(node, W("db_fx_compare"), which==="compare");
        setDOMWidgetShown(node, W("db_fx_grid"), which==="grid");
        if (which==="none") setCount(0);
        node._dbFitContent?.();
      };
      // Static grid of the final kept result(s), drawn after the run completes
      // (onExecuted). Picking happens in the shared modal, not inline here.
      const renderGrid=(images,labels)=>{
        gridThumbs.replaceChildren();
        (images||[]).forEach((img,i)=>{
          const card=document.createElement("div");
          card.style.cssText="position:relative;height:96px;border-radius:6px;overflow:hidden;border:2px solid #303030;background:#0b0b0b;";
          const im=document.createElement("img"); im.src=viewURL(img); im.style.cssText="width:100%;height:100%;object-fit:contain;";
          im.addEventListener("load",()=>node._dbFitContent?.(),{once:true});
          card.append(im);
          const text=(labels&&labels[i])||img.label||"";
          if(text){const lbl=document.createElement("div"); lbl.textContent=text; lbl.style.cssText="position:absolute;left:4px;bottom:4px;font-size:8px;padding:1px 5px;border-radius:8px;background:#000a;color:#bfe4ff;"; card.append(lbl);}
          gridThumbs.append(card);
        });
      };

      // `befores`/`afters` are the full input batch (one entry per image passed
      // in). One image → before/after compare; multiple → show them all in the
      // grid. The count badge always reflects how many images were processed.
      node._dbFixerPreview=(befores,afters,res)=>{
        const after=afters||[], before=befores||[];
        const n=after.length;
        setCount(n);
        if(n>1){
          renderGrid(after, after.map((img)=>img?.label||""));
          showSection("grid");
        }else if(n===1){
          beforeImg.src=viewURL(before[0]); afterImg.src=viewURL(after[0]);
          resolution.textContent=res?`Auto · ${res}px`:"";
          showSection("compare");
        }else{
          showSection("none");
        }
      };
      node._dbFixerBatch=(images,labels)=>{
        setCount((images&&images.length)||0);
        renderGrid(images,labels);
        showSection((images&&images.length)?"grid":"none");
      };

      showSection("none");
      bindWidthSync(node, els);
      node._dbFitContent?.();
    };
  },
});
