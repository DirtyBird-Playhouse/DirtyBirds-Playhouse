"""Thread-safe token state for the Sampler's browser picker handshake."""

import threading


class PickState:
    """Token-keyed pick requests, safe when more than one prompt is active."""

    _PENDING = object()
    _requests = {}
    _lock = threading.Lock()

    @classmethod
    def start(cls, token):
        with cls._lock:
            cls._requests[str(token)] = cls._PENDING

    @classmethod
    def waiting(cls, token):
        with cls._lock:
            return cls._requests.get(str(token)) is cls._PENDING

    @classmethod
    def deliver(cls, token, selection):
        key = str(token)
        with cls._lock:
            if cls._requests.get(key) is not cls._PENDING:
                return False
            clean = []
            for item in selection or []:
                try:
                    clean.append(int(item))
                except (TypeError, ValueError):
                    continue
            cls._requests[key] = clean
            return True

    @classmethod
    def take(cls, token):
        with cls._lock:
            selection = cls._requests.pop(str(token), cls._PENDING)
        return None if selection is cls._PENDING else selection
