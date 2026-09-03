"""JSON-backed local stores used by the loader library backend."""

import json
import os


class JsonStore:
    """Best-effort JSON persistence with caller-owned warning text."""

    def __init__(self, path, logger, save_error_label):
        self.path = path
        self.logger = logger
        self.save_error_label = save_error_label

    def load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as handle:
                    return json.load(handle)
            except Exception:
                pass
        return {}

    def save(self, value):
        try:
            with open(self.path, "w", encoding="utf-8") as handle:
                json.dump(value, handle, indent=2)
        except Exception as error:
            self.logger.warning(f"[DirtyBirds] {self.save_error_label}: {error}")
