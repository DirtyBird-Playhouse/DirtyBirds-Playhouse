"""Reusable blocking in-node image picker (websocket event + POST handshake).

Generalised from the DirtyBirds Sampler's picker so other nodes (e.g. the Fixer's
"All (Compare)" mode) get the same battle-tested flow: after producing a batch,
the node pushes it to the browser and BLOCKS until the user multi-selects inline
and confirms; only picked indices are returned. Each picker instance owns its own
websocket event + POST route, so multiple pickers don't cross-talk.

Register the route at import time from a module that ComfyUI loads at startup
(e.g. a node package's ``__init__.py``) — not from a lazily-imported module, or
the route is added after the server's routes are frozen.
"""

import logging
import threading
import time

from aiohttp import web
from server import PromptServer
from comfy.model_management import throw_exception_if_processing_interrupted

logger = logging.getLogger(__name__)


class ImagePicker:
    """A blocking, token-keyed image picker bound to one event/route pair."""

    _PENDING = object()

    def __init__(self, event, route, timeout=30, label="picker"):
        self.event = event
        self.route = route
        self.timeout = int(timeout)
        self.label = label
        self._requests = {}
        self._lock = threading.Lock()
        # Register the POST route the browser replies on (idempotent per process).
        PromptServer.instance.routes.post(route)(self._on_message)

    # -- shared state ------------------------------------------------------ #
    def _start(self, token):
        with self._lock:
            self._requests[str(token)] = self._PENDING

    def _waiting(self, token):
        with self._lock:
            return self._requests.get(str(token)) is self._PENDING

    def _deliver(self, token, selection):
        key = str(token)
        with self._lock:
            if self._requests.get(key) is not self._PENDING:
                return False
            clean = []
            for item in selection or []:
                try:
                    clean.append(int(item))
                except (TypeError, ValueError):
                    continue
            self._requests[key] = clean
            return True

    def _take(self, token):
        with self._lock:
            sel = self._requests.pop(str(token), self._PENDING)
        return None if sel is self._PENDING else sel

    async def _on_message(self, request):
        """Browser POSTs {token, selection:[indices]} when the user confirms."""
        try:
            data = await request.json()
        except Exception:
            data = {}
        matched = self._deliver(data.get("token"), data.get("selection"))
        if not matched:
            logger.info("[DirtyBirds] %s: ignoring stale/mismatched reply", self.label)
        return web.json_response({"ok": matched})

    # -- public API -------------------------------------------------------- #
    def wait_for_pick(self, token, payload, timeout=None):
        """Send ``payload`` (with token) to the browser and block until a reply
        or timeout. Returns list[int] of selected indices, or None on timeout."""
        timeout = self.timeout if timeout is None else int(timeout)
        self._start(token)
        payload = dict(payload)
        payload["token"] = token
        PromptServer.instance.send_sync(self.event, payload)

        end = time.monotonic() + max(1, timeout)
        while time.monotonic() < end and self._waiting(token):
            throw_exception_if_processing_interrupted()
            PromptServer.instance.send_sync(
                self.event, {"token": token, "tick": int(end - time.monotonic())}
            )
            time.sleep(0.5)

        sel = self._take(token)
        if sel is None:
            PromptServer.instance.send_sync(
                self.event, {"token": token, "timeout": True}
            )
        return sel
