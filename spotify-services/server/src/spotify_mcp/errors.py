"""Structured error shapes returned by tools.

Every tool error is a StructuredError that the tool dispatcher
serializes to a JSON object with at least {"error": "<code>"}."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class StructuredError(Exception):
    code: str
    message: str = ""
    payload: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        out = {"error": self.code}
        if self.message:
            out["message"] = self.message
        out.update(self.payload)
        return out
