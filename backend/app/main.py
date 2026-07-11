"""FastAPI application entrypoint.

Owns the app lifespan (graph load at startup), mounts REST routes from
app.api and the WebSocket endpoint from app.ws. No business logic lives
here — this is a thin adapter over app.core.
"""

from fastapi import FastAPI

app = FastAPI(title="ResQOS")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
