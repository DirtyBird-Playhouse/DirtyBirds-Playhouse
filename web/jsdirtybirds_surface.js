/** Shared control surface + common node width for every DirtyBirds node. */
import { app } from "../../../scripts/app.js";
import { DIRTYBIRDS_NODE_WIDTH, applyControlSurface } from "./db_shared.js";

// One common two-column canvas for every DirtyBirds node. Individual nodes may
// contain different amounts of content, but they no longer define competing
// width systems.
function minimumWidth(nodeData, node) {
  return Math.max(Number(node?.min_width) || 0, DIRTYBIRDS_NODE_WIDTH);
}

app.registerExtension({
  name: "DirtyBirds.ControlSurface",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!String(nodeData?.name || "").startsWith("DirtyBirds")) return;
    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      // Every DirtyBirds node starts at the common width. LiteGraph sizes a node
      // from its widgets, so the two nodes that own multiline text boxes (Prompt
      // Builder, Prompt Enhance) were born 400px wide while the rest were 360 —
      // one row of DirtyBirds nodes on a canvas did not line up. This only sets
      // the starting width: onConfigure restores a saved node's own size
      // afterwards, and the resize handle is untouched.
      this.size[0] = minimumWidth(nodeData, this);
      // Other node extensions add their DOM widgets during the same creation
      // chain. Mark the surface after those callbacks have finished, so every
      // widget element exists by then.
      requestAnimationFrame(() =>
        applyControlSurface(this, { minWidth: minimumWidth(nodeData, this) }),
      );
      return result;
    };
  },
});
