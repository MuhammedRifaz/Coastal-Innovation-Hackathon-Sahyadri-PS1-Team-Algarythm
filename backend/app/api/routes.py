"""REST command endpoints (commands only — state flows over the WebSocket)."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.graph_service import EdgeNotFoundError, IncidentNotFoundError

router = APIRouter(prefix="/api")


class FloodRequest(BaseModel):
    edge_id: str
    depth_cm: float
    # Confidence in flood report (0-100%): 100% = confirmed by sensors,
    # 50% = citizen report, 0% = no data. Defaults to 100% (certain).
    confidence: int = 100


class FloodClearRequest(BaseModel):
    edge_id: str


class IncidentRequest(BaseModel):
    lat: float
    lng: float
    severity: int = Field(ge=1, le=3)


class WhatIfRequest(BaseModel):
    edge_id: str


class RainfallRequest(BaseModel):
    rainfall_mm: float = Field(ge=0, le=300)


class PropagationRequest(BaseModel):
    propagation_radius_m: float = Field(ge=10, le=500, default=50.0)


class UserRouteRequest(BaseModel):
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float


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
        snapshot = graph_service.apply_flood(payload.edge_id, payload.depth_cm, payload.confidence)
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


@router.post("/incidents/{incident_id}/resolve")
async def post_resolve_incident(incident_id: str, request: Request) -> dict:
    graph_service = request.app.state.graph_service
    try:
        snapshot = graph_service.resolve_incident(incident_id)
    except IncidentNotFoundError:
        raise HTTPException(status_code=404, detail=f"incident_id '{incident_id}' not found")
    return {"snapshot_seq": snapshot.seq}


@router.post("/whatif")
async def post_whatif(payload: WhatIfRequest, request: Request) -> dict:
    """Hypothetically close a road and report the impact — mutates nothing."""
    graph_service = request.app.state.graph_service
    try:
        report = graph_service.whatif(payload.edge_id)
    except EdgeNotFoundError:
        raise HTTPException(status_code=404, detail=f"edge_id '{payload.edge_id}' not found")
    return report.model_dump(mode="json")


@router.post("/rainfall")
async def post_rainfall(payload: RainfallRequest, request: Request) -> dict:
    """Apply elevation-aware flood depths across the whole network based on
    rainfall intensity. Call with rainfall_mm=0 to clear rainfall floods."""
    graph_service = request.app.state.graph_service
    snapshot = graph_service.apply_rainfall(payload.rainfall_mm)
    return {"snapshot_seq": snapshot.seq}


@router.post("/propagation")
async def post_propagation(payload: PropagationRequest, request: Request) -> dict:
    """Trigger flood propagation analysis: mark edges adjacent to flooded
    edges as at-risk based on the given propagation radius."""
    from app.core.graph_service import _update_flood_propagation
    
    graph_service = request.app.state.graph_service
    changed_edges = _update_flood_propagation(graph_service.graph, payload.propagation_radius_m)
    
    # Build and broadcast snapshot with updated at_risk flags
    snapshot = graph_service.build_snapshot()
    graph_service._emit_snapshot(snapshot)
    
    return {
        "snapshot_seq": snapshot.seq,
        "affected_edges": len(changed_edges),
    }


@router.post("/scenario/start")
async def post_scenario_start(request: Request) -> dict:
    graph_service = request.app.state.graph_service
    graph_service.start_scenario()
    return {"status": "started"}


@router.post("/scenario/reset")
async def post_scenario_reset(request: Request) -> dict:
    graph_service = request.app.state.graph_service
    snapshot = graph_service.reset()
    return {"snapshot_seq": snapshot.seq}


@router.get("/road/{edge_id:path}")
async def get_road_inspector(edge_id: str, request: Request) -> dict:
    """Full attributes for a single road edge, including nearby zones/POIs
    and a what-if analysis of closing it."""
    graph_service = request.app.state.graph_service
    try:
        return graph_service.get_road_inspector(edge_id)
    except Exception:
        raise HTTPException(status_code=404, detail=f"edge_id '{edge_id}' not found")


@router.post("/route")
async def post_user_route(payload: UserRouteRequest, request: Request) -> dict:
    """Compute the safest current route between two lat/lng points."""
    graph_service = request.app.state.graph_service
    return graph_service.compute_user_route(
        payload.origin_lat, payload.origin_lng,
        payload.dest_lat, payload.dest_lng,
    )
