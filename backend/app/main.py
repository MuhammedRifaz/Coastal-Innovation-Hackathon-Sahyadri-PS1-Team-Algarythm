"""FastAPI application entrypoint.

Owns the app lifespan (graph load at startup), mounts REST routes from
app.api and the WebSocket endpoint from app.ws. No business logic lives
here — this is a thin adapter over app.core.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.api.routes import router as api_router
from app.core.graph_service import GraphService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    graph_service = GraphService()
    graph_service.load()
    app.state.graph_service = graph_service
    yield


app = FastAPI(title="ResQOS", lifespan=lifespan)
app.include_router(api_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
