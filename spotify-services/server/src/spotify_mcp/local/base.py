"""Abstract LocalBackend interface."""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any


class LocalBackend(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def is_running(self) -> bool: ...

    @abstractmethod
    async def now_playing(self) -> dict[str, Any] | None: ...

    @abstractmethod
    async def play(self) -> None: ...

    @abstractmethod
    async def pause(self) -> None: ...

    @abstractmethod
    async def next(self) -> None: ...

    @abstractmethod
    async def previous(self) -> None: ...

    # Optional — not all backends support these
    async def seek_to(self, position_ms: int) -> None:
        from spotify_mcp.errors import StructuredError
        raise StructuredError("not_supported",
                              f"{self.name} backend does not support seek_to")

    async def set_volume(self, level: int) -> None:
        from spotify_mcp.errors import StructuredError
        raise StructuredError("not_supported",
                              f"{self.name} backend does not support set_volume")

    async def launch(self) -> None:
        from spotify_mcp.errors import StructuredError
        raise StructuredError("not_supported",
                              f"{self.name} backend does not support launch")

    async def quit(self) -> None:
        from spotify_mcp.errors import StructuredError
        raise StructuredError("not_supported",
                              f"{self.name} backend does not support quit")
