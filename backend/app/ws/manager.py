"""WebSocket connection manager for the single /ws channel.

Tracks connected clients and broadcasts a fresh StateSnapshot to all of
them on every graph_changed event. The WS endpoint itself (app.main)
sends a full snapshot on connect; this manager only handles fan-out.
"""

from __future__ import annotations

from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._connections:
            self._connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for connection in list(self._connections):
            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(connection)
