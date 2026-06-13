/**
 * DirtyBirds Playhouse — Booru Tag node UI.
 *
 * Applies the shared DirtyBirds node theme so it matches the rest of the suite.
 */

import { app } from "../../../scripts/app.js";
import { DB_COLOR, DB_BGCOLOR, ensureStylesheet } from "./db_shared.js";

ensureStylesheet();

app.registerExtension({
  name: "DirtyBirds.BooruTag",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DirtyBirdsBooruTag") return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.color = DB_COLOR;
      this.bgcolor = DB_BGCOLOR;
      this.size[0] = Math.max(this.size[0] || 0, 320);
    };
  },
});
