"""REST command endpoints (commands only — state flows over the WebSocket).

Routes to add as later build prompts land:
POST /api/floods, /api/floods/clear
POST /api/incidents, /api/incidents/{id}/resolve
POST /api/whatif
POST /api/scenario/start, /api/scenario/reset
"""

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api")


@router.get("/graph")
def get_graph(request: Request) -> dict:
    """Full roads GeoJSON + POIs + zones — the client's initial load."""
    graph_service = request.app.state.graph_service
    return {
        "roads": graph_service.to_geojson(),
        "pois": [poi.model_dump() for poi in graph_service.pois],
        "zones": [zone.model_dump() for zone in graph_service.zones],
    }
