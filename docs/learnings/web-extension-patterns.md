# Web Extension Patterns (web/*.js)

JS runs inside ComfyUI's litegraph browser context, not a standalone app. Plain
ES modules served from `web/` (WEB_DIRECTORY in `__init__.py`); no bundler.

## Registration

```js
import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "DirtyBirds.SomeNode",
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "DB_SomeNode") return;
    // patch prototype: onNodeCreated, onDrawForeground, etc.
  },
});
```

## Conventions

- Shared helpers and the token palette live in `web/db_shared.js` - reuse, don't
  re-implement.
- Main/shared entry: `web/jsdirtybirds.js`. Per-node UI:
  `web/jsdirtybirds_<module>.js`.
- Custom DOM widgets: use `node.addDOMWidget`; watch width-sync and clipping
  gotchas (see `ui-conventions.md`).

## Hard constraints

- ComfyUI desktop blocks `window.prompt()`, `alert()`, `confirm()`. Use inline
  DOM widgets plus status text instead.
- After any JS change: reload ComfyUI, refresh the browser, verify live. Do not
  report done from static inspection.

## Review

Run the `db-ui-reviewer` agent after editing any node's web extension to check
adherence to suite UI conventions.
