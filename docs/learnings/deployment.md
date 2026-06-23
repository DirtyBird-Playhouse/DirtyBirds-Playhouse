# Deployment / Distribution

This is a ComfyUI custom-node pack, not a hosted app. "Deployment" means
installing into ComfyUI and distributing the pack, not CI/CD to a server.

## Install layout

- ComfyUI loads custom nodes from `custom_nodes/`. The live install is at
  `ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\...`; the dev folder reaches it
  via a junction. Always confirm and edit the live copy. See
  `.claude/COMMON_MISTAKES.md` #1.
- `__init__.py` exports `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`, and
  `WEB_DIRECTORY = "./web"`; ComfyUI auto-discovers these on start.

## Dependencies

- Python deps live in `requirements.txt`. Keep it accurate so a fresh ComfyUI
  install can load the pack.
- SAM3 model is external: `My_AI_Tools\models\sam3\sam3.pt` (not bundled).
- Local LLM is LM Studio's OpenAI-compatible endpoint (external service).

## Release checklist

- Bump/record changes (CHANGELOG if maintained).
- Verify the pack loads cleanly in a restarted ComfyUI with no import errors.
- Confirm `web/` assets are served and each node's UI renders.
- Do not ship `master.yaml` or `user_files/` (gitignored, banned).

## No server CI/CD

There is no hosting pipeline. Distribution is the git repo / ComfyUI manager,
not a deploy target.
