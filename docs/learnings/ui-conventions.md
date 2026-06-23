# UI Conventions

Suite-wide UI rules so nodes look and behave consistently. Enforced by the
`db-ui-reviewer` agent.

## Shared token palette

Colors, spacing, and DOM-widget helper classes are defined once in
`web/db_shared.js`. Use them; do not hardcode hex colors or re-declare widget
classes per node.

## DOM widgets

- Create via `node.addDOMWidget`.
- Width-sync: keep the widget element width in sync with the node body on
  resize/draw, or it clips or overflows.
- Clipping: respect the node's content rect; long content needs scroll or
  truncation, not overflow.

## No blocking dialogs

ComfyUI desktop blocks `window.prompt()`/`alert()`/`confirm()`. Use inline DOM
inputs and a status-text line for feedback.

## Status text

Surface success/error/progress in an in-node status line rather than console
only, so the user sees it in the UI.

## Verify visually

UI work is screenshot-driven: run the app, exercise the widget, confirm
appearance and behavior before reporting done.
