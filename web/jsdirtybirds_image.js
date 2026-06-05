/**
 * DirtyBirds Playhouse — Load Image node UI.
 *
 * Applies the shared DirtyBirds node theme, and answers Prompt Studio's
 * "pull the current image" requests over the shared BroadcastChannel: when the
 * Studio asks, we report this node's current `image` / `image_url` widget values
 * so the Studio can fetch the pixels via /dirtybirds/fetch-image.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR } from "./db_shared.js";

// Most-recently-touched DirtyBirds Load Image node (for the Studio to read).
let lastNode = null;

function widgetVal(node, name) {
  const w = node?.widgets?.find((w) => w.name === name);
  return w ? w.value : "";
}

if (typeof BroadcastChannel !== "undefined") {
  const ch = new BroadcastChannel("dirtybirds-prompt");
  ch.onmessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type !== "request-load-image") return;
    if (!lastNode) {
      ch.postMessage({ type: "load-image-info", error: "no DirtyBirds Load Image node found" });
      return;
    }
    ch.postMessage({
      type: "load-image-info",
      image: widgetVal(lastNode, "image"),
      image_url: widgetVal(lastNode, "image_url"),
    });
  };
}

app.registerExtension({
  name: "DirtyBirds.LoadImage",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsLoadImage") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.color = DB_COLOR;
      this.bgcolor = DB_BGCOLOR;
      this.size[0] = Math.max(this.size[0] || 0, 320);
      lastNode = this;
      // Track interaction so the Studio reads the node you last touched.
      const orig = this.onMouseDown;
      this.onMouseDown = function () { lastNode = this; return orig?.apply(this, arguments); };
    };
  },
});
