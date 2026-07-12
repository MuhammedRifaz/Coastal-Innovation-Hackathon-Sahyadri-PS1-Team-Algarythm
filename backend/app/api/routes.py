"""REST command endpoints (commands only — state flows over the WebSocket).

Routes to add as later build prompts land:
POST /api/incidents/{id}/resolve
POST /api/scenario/start, /api/scenario/reset
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.graph_service import EdgeNotFoundError

router = APIRouter(prefix="/api")


class FloodRequest(BaseModel):
    edge_id: str
    depth_cm: float


class FloodClearRequest(BaseModel):
    edge_id: str


class IncidentRequest(BaseModel):
    lat: float
    lng: float
    severity: int = Field(ge=1, le=3)


class WhatIfRequest(BaseModel):
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


@router.post("/incidents")
async def post_incident(payload: IncidentRequest, request: Request) -> dict:
    graph_service = request.app.state.graph_service
    snapshot = graph_service.create_incident(payload.lat, payload.lng, payload.severity)
    incident = snapshot.incidents[-1]
    mission = next((m for m in snapshot.missions if m.incident_id == incident.id), None)
    return {
        "snapshot_seq": snapshot.seq,
        "incident_id": incident.id,
        "mission_id": mission.id if mission else None,
    }


@router.post("/whatif")
async def post_whatif(payload: WhatIfRequest, request: Request) -> dict:
    """Hypothetically close a road and report the impact — mutates nothing."""
    graph_service = request.app.state.graph_service
    try:
        report = graph_service.whatif(payload.edge_id)
    except EdgeNotFoundError:
        raise HTTPException(status_code=404, detail=f"edge_id '{payload.edge_id}' not found")
    return report.model_dump(mode="json")


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: str, request: Request) -> dict:
    graph_service = request.app.state.graph_service
    snapshot = graph_service.resolve_incident(incident_id)
    return {"snapshot_seq": snapshot.seq}


@router.post("/scenario/start")
async def start_scenario(request: Request) -> dict:
    scenario_runner = request.app.state.scenario_runner
    await scenario_runner.start()
    return {"status": "started"}


@router.post("/scenario/reset")
async def reset_scenario(request: Request) -> dict:
    scenario_runner = request.app.state.scenario_runner
    await scenario_runner.reset()
    return {"status": "reset"}

