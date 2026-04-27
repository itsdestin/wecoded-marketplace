"""Entrypoint: `python -m spotify_mcp` → stdio MCP server."""
from __future__ import annotations
import asyncio
import sys

from spotify_mcp.server import run_stdio


def main() -> int:
    try:
        asyncio.run(run_stdio())
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as e:
        print(f"spotify-mcp fatal: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
