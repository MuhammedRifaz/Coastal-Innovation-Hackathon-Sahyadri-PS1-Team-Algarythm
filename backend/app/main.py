"""FastAPI application entrypoint.

Owns the app lifespan (graph load at startup, wiring graph_changed ->
WebSocket broadcast), mounts REST routes from app.api and the WebSocket
endpoint. No business logic lives here — this is a thin adapter over
app.core.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.api.routes import router as api_router
from app.core.graph_service import GraphService
from app.models import StateSnapshot
from app.ws.manager import ConnectionManager

from app.core.scenario import ScenarioRunner

manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    graph_service = GraphService()
    graph_service.load()
    app.state.graph_service = graph_service

    async def ws_broadcast(snapshot) -> None:
        await manager.broadcast(snapshot.model_dump(mode="json"))

    scenario_runner = ScenarioRunner(graph_service, ws_broadcast)
    app.state.scenario_runner = scenario_runner

    def on_graph_changed(snapshot: StateSnapshot) -> None:
        asyncio.get_running_loop().create_task(
            manager.broadcast(snapshot.model_dump(mode="json"))
        )

    graph_service.event_bus.on("graph_changed", on_graph_changed)
    yield
    scenario_runner.cancel()


app = FastAPI(title="ResQOS", lifespan=lifespan)
app.include_router(api_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    graph_service: GraphService = websocket.app.state.graph_service
    await manager.connect(websocket)
    try:
        snapshot = graph_service.build_snapshot()
        await websocket.send_json(snapshot.model_dump(mode="json"))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
