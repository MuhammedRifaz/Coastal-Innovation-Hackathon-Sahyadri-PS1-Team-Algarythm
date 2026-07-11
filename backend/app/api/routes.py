"""REST command endpoints (commands only — state flows over the WebSocket).

Routes to add as later build prompts land:
POST /api/incidents, /api/incidents/{id}/resolve
POST /api/whatif
POST /api/scenario/start, /api/scenario/reset
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.graph_service import EdgeNotFoundError

router = APIRouter(prefix="/api")


class FloodRequest(BaseModel):
    edge_id: str
    depth_cm: float


class FloodClearRequest(BaseModel):
    edge_id: str


@router.get("/graph")
async def get_graph(request: Request) -> dict:
    """Full roads GeoJSON + POIs + zones — the client's initial load."""
    graph_service = request.app.state.graph_service
    return {
        "roads": graph_service.to_geojson(),
        "pois": [poi.model_dump() for poi in graph_service.pois],
        "zones": [zone.model_dump() for zone in graph_service.zones],
    }


@router.post("/floods")
async def post_flood(payload: FloodRequest, request: Request) -> dict:
    graph_service = request.app.state.graph_service
    try:
        snapshot = graph_service.apply_flood(payload.edge_id, payload.depth_cm)
    except EdgeNotFoundError:
        raise HTTPException(status_code=404, detail=f"edge_id '{payload.edge_id}' not found")
    return {"snapshot_seq": snapshot.seq}


@router.post("/floods/clear")
async def post_flood_clear(payload: FloodClearRequest, request: Request) -> dict:
    graph_service = request.app.state.graph_service
    try:
        snapshot = graph_service.clear_flood(payload.edge_id)
    except EdgeNotFoundError:
        raise HTTPException(status_code=404, detail=f"edge_id '{payload.edge_id}' not found")
    return {"snapshot_seq": snapshot.seq}
