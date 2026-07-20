/** Shared content-driven sizing for every DirtyBirds node. */
import { app } from "../../../scripts/app.js";
import { DIRTYBIRDS_NODE_WIDTH, installContentSizeGuard } from "./db_shared.js";

// One common two-column canvas for every DirtyBirds node. Individual nodes may
// contain different amounts of content, but they no longer define competing
// width systems.
function minimumWidth(nodeData, node) {
  return Math.max(Number(node?.min_width) || 0, DIRTYBIRDS_NODE_WIDTH);
}

app.registerExtension({
  name: "DirtyBirds.ContentSizeGuard",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!String(nodeData?.name || "").startsWith("DirtyBirds")) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      // Other node extensions add their DOM widgets during the same creation
      // chain. Install after those callbacks have finished.
      requestAnimationFrame(() => installContentSizeGuard(this, {
        minWidth: minimumWidth(nodeData, this),
      }));
      return result;
    };
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      requestAnimationFrame(() => this._dbFitContent?.());
      return result;
    };
  },
});
