/** DirtyBirds Playhouse — Forbidden Vision Fixer themed controls. */
import { app } from "../../../scripts/app.js";
import {
  DB_COLOR, DB_BGCOLOR, ensureStylesheet, addTitle, bindWidthSync,
  hideWidget, makeSlider, makeFlyoutBtn,
} from "./db_shared.js";

ensureStylesheet();

const RESTORE_METHOD_DEFAULT = "Diffusion (Inpaint)";
const RESTORE_METHODS = ["Diffusion (Inpaint)", "GFPGAN", "CodeFormer"];
const CODEFORMER_FIDELITY_DEFAULT = 0.5;

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
      requestAnimationFrame(() => normalizeFixerWidgets(this));
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
      this._dbFixerPreview?.(message?.db_fixer_before?.[0], message?.db_fixer_after?.[0], message?.db_fixer_resolution?.[0]);
    };
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      original?.apply(this, arguments);
      const node = this;
      normalizeFixerWidgets(node);
      node.color = DB_COLOR; node.bgcolor = DB_BGCOLOR;
      const MIN_W = 390; node.size[0] = Math.max(node.size[0] || 0, MIN_W);
      const els = [], controls = {};
      const names = ["steps", "cfg_scale", "sampler", "scheduler", "denoise_strength",
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
        const seg = document.createElement("div"); seg.className = "db-seg"; seg.style.flex = "1";
        const opts = [[false,"Off"],[true,"On"]].map(([v,l]) => { const e=document.createElement("div"); e.className="db-seg-opt"; e.textContent=l;
          e.onclick=()=>{ if(w) w.value=v; paint(); node.setDirtyCanvas(true); }; seg.appendChild(e); return [v,e]; });
        const paint=()=>opts.forEach(([v,e])=>e.classList.toggle("db-seg-active",Boolean(w?.value)===v)); paint();
        row.append(txt,seg); if (addNow) add(`db_fx_${name}`,row); return { row, paint };
      };
      const combo = (name, tag, addNow = true) => { const w=controls[name]; const p=makeFlyoutBtn(node,tag,{getLabel:()=>w?.value,
        getValues:()=>w?.options?.values||[],getCurrent:()=>w?.value,onPick:(v)=>{if(w)w.value=v;}}); if (addNow) add(`db_fx_${name}`,p.row); return p; };
      const text = (name, placeholder, addNow = true) => { const w=controls[name], box=document.createElement("textarea");
        box.className="comfy-multiline-input"; box.placeholder=placeholder; box.value=w?.value||"";
        box.style.cssText="width:100%;height:72px;resize:none;background:#191919;color:#ddd;border:1px solid #343434;border-radius:6px;padding:8px;";
        box.oninput=()=>{if(w)w.value=box.value;}; if (addNow) add(`db_fx_${name}`,box,82); return box; };
      title("db_fx_sampling_h", "The Face Pass");
      const samplerCtl = combo("sampler","SAMPLER",false);
      const schedulerCtl = combo("scheduler","SCHEDULER",false);
      const stepsCtl = slider("steps","Steps",1,100,1,0,false);
      const cfgCtl = slider("cfg_scale","CFG",0,30,.5,1,false);
      const denoiseCtl = slider("denoise_strength","Denoise",0,1,.01,2,false);
      denoiseCtl.row.style.cssText += "border-left:2px solid #5aadff;padding-left:5px;";
      const passCols = document.createElement("div"); passCols.className = "db-talent-columns";
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

      title("db_fx_prompt_h", "Face Prompt");
      const promptPanel=document.createElement("div");
      promptPanel.style.cssText="display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;overflow:hidden;";
      const promptTabs=document.createElement("div"); promptTabs.className="db-seg"; promptTabs.style.height="22px";
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

      title("db_fx_preview_h", "Before / After");
      const compare=document.createElement("div"); compare.title="Click to compare"; compare.style.cssText="position:relative;height:190px;background:#0b0b0b;border:1px solid #303030;border-radius:6px;overflow:hidden;cursor:pointer;user-select:none;";
      const resolution=document.createElement("div"); resolution.style.cssText="position:absolute;top:6px;right:8px;z-index:4;color:#aaa;font-size:9px;text-shadow:0 1px 2px #000;";
      const compareState=document.createElement("div"); compareState.style.cssText="position:absolute;left:8px;bottom:7px;z-index:4;padding:3px 7px;border:1px solid #5aadff;border-radius:10px;background:#10283bcc;color:#bfe4ff;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-shadow:0 1px 2px #000;pointer-events:none;";
      const beforeImg=document.createElement("img"), afterImg=document.createElement("img");
      [beforeImg,afterImg].forEach(img=>img.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;");
      let showAfter=true;
      const paintComparison=()=>{afterImg.style.display=showAfter?"block":"none";compareState.textContent=showAfter?"After":"Before";};
      compare.addEventListener("click",()=>{showAfter=!showAfter;paintComparison();});
      compare.append(beforeImg,afterImg,resolution,compareState); paintComparison(); add("db_fx_compare",compare,198);
      const previewWidgets=()=>node.widgets?.filter(w=>w.name==="db_fx_preview_h"||w.name==="db_fx_compare")||[];
      const showPreview=(shown)=>{
        previewWidgets().forEach(w=>{if(w.element)w.element.style.display=shown?"":"none";w.computedHeight=shown?undefined:0;});
        node.setSize(node.computeSize());
      };
      showPreview(false);
      const viewUrl=(item)=>item?`/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(item.subfolder||"")}&type=${encodeURIComponent(item.type||"temp")}`:"";
      node._dbFixerPreview=(before,after,res)=>{
        const ready=!!(before&&after);
        if(ready){beforeImg.src=viewUrl(before);afterImg.src=viewUrl(after);resolution.textContent=res?`Auto · ${res}px`:"";}
        showPreview(ready);
      };

      bindWidthSync(node, els, MIN_W);
    };
  },
});
