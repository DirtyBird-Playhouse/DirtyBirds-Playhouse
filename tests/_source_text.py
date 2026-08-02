"""Formatter-proof source matching for the contract tests.

The UI contract tests assert that specific snippets appear in real source
files. Written against raw text, every one of those assertions breaks the
moment an auto-formatter (prettier, black) re-wraps the file — different line
breaks, an added trailing comma, an uppercased hex literal — even though the
code does exactly the same thing. That happened once and silently disabled
seventeen guards at a stroke.

``read_source`` returns text that compares by code rather than by layout:
membership, counting, indexing and splitting all ignore whitespace, trailing
commas before a closing bracket, and hex-literal case. Everything a formatter
is allowed to change is normalized away; everything that changes behavior
still fails the assertion.
"""

import re
from pathlib import Path

_WHITESPACE = re.compile(r"\s+")
_TRAILING_COMMA = re.compile(r",(?=[)\]}])")
_HEX_LITERAL = re.compile(r"0[xX][0-9a-fA-F]+")


def canon(text):
    """Reduce source text to the form a formatter cannot alter."""
    text = _WHITESPACE.sub("", str(text))
    text = _TRAILING_COMMA.sub("", text)
    return _HEX_LITERAL.sub(lambda m: m.group(0).upper(), text)


class Source(str):
    """Source text whose comparisons ignore purely cosmetic formatting."""

    def __contains__(self, needle):
        return canon(needle) in canon(self)

    def count(self, needle, *args):
        return canon(self).count(canon(needle))

    def index(self, needle, *args):
        return canon(self).index(canon(needle))

    def split(self, sep=None, maxsplit=-1):
        if sep is None:
            return [Source(part) for part in str(self).split(None, maxsplit)]
        return [Source(part) for part in canon(self).split(canon(sep), maxsplit)]


def read_source(path):
    """Read a source file for contract assertions."""
    return Source(Path(path).read_text(encoding="utf-8"))
