/**
 * DirtyBirds Playhouse — Sampler node UI.
 *
 * Applies the shared DirtyBirds node theme.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR } from "./db_shared.js";

app.registerExtension({
  name: "DirtyBirds.Sampler",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsSampler") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.color = DB_COLOR;
      this.bgcolor = DB_BGCOLOR;
      this.size[0] = Math.max(this.size[0] || 0, 320);
    };
  },
});
