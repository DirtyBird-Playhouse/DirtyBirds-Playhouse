/**
 * DirtyBirds Playhouse — Pipe routing nodes UI ("Undress" / "Dress").
 *
 * These are simple passthrough/bundle nodes, so the UI is just suite theming:
 * the DirtyBirds color + bgcolor and a styled section title. The sockets
 * themselves are declared by the Python INPUT_TYPES / RETURN_TYPES.
 */

import { app } from "../../../scripts/app.js";
import {
  DB_COLOR,
  DB_BGCOLOR,
  ensureStylesheet,
  addTitle,
} from "./db_shared.js";

ensureStylesheet();

// In-node section label; the node title already reads "Undress — Pipe Out" /
// "Dress — Pipe In", so the label carries just the flavor line.
const PIPE_NODES = {
  DirtyBirdsPipeOut: "Tap the Pipe",
  DirtyBirdsPipeIn: "Build the Pipe",
};

app.registerExtension({
  name: "DirtyBirds.Pipe",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const title = PIPE_NODES[nodeData.name];
    if (!title) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      node.color = DB_COLOR;
      node.bgcolor = DB_BGCOLOR;
      addTitle(node, "db_pipe_title", title);
    };
  },
});
