"""Shared Pydantic types — single source of truth for the backend contract.

Mirrored by hand into frontend/src/lib/types.ts. Do not let the two drift:
any field added/renamed here must be reflected there in the same commit.

Schema per resqos-master-plan.md §10. Road-graph edge attributes live on
the NetworkX graph itself (plain dict attrs, not these models) — see
EdgeAttributes below for the documented shape of those dict attrs.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

EdgeStatus = Literal["safe", "risky", "blocked"]
POIKind = Literal["hospital", "shelter"]
VehicleKind = Literal["ambulance", "rescue_truck"]
VehicleStatus = Literal["available", "en_route"]
IncidentStatus = Literal["open", "assigned", "resolved"]
MissionStatus = Literal["active", "rerouted", "reassigned", "complete"]
DecisionKind = Literal["assignment", "reroute", "impact", "whatif"]


class EdgeAttributes(BaseModel):
    """Documents the attribute dict every graph edge carries (not stored as
    Pydantic instances on the graph itself — NetworkX edges hold plain
    dicts for performance; this model exists so the shape is contractual
    and reusable when serializing edges to GeoJSON properties)."""

    edge_id: str
    length_m: float
    base_time_s: float
    highway_class: str
    flood_depth_cm: float = 0.0
    status: EdgeStatus = "safe"
    safety_score: int = 100
    critical: bool = False
    updated_at: datetime


class LineStringGeometry(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[float, float]]


class POI(BaseModel):
    id: str
    kind: POIKind
    name: str
    node_id: str
    lat: float
    lng: float
    stroke_ready: bool = False


class Zone(BaseModel):
    id: str
    name: str
    centroid_node_id: str
    population: int
    reachable_hospitals: list[str] = []


class Vehicle(BaseModel):
    id: str
    callsign: str
    kind: VehicleKind
    node_id: str
    lat: float
    lng: float
    status: VehicleStatus = "available"
    mission_id: str | None = None


class Incident(BaseModel):
    id: str
    node_id: str
    lat: float
    lng: float
    severity: int = Field(ge=1, le=3)
    status: IncidentStatus = "open"
    created_at: datetime


class RouteResult(BaseModel):
    node_path: list[str]
    geometry: LineStringGeometry
    distance_m: float
    eta_s: float
    risk_score: float
    avoided_edges: list[str] = []
    computed_in_ms: float
    reachable: bool = True


class Mission(BaseModel):
    id: str
    incident_id: str
    vehicle_id: str
    route: RouteResult
    backup_route: RouteResult | None = None
    eta_s: float
    status: MissionStatus = "active"


class MissionDelta(BaseModel):
    mission_id: str
    delta_eta_s: float
    action: str


class ImpactReport(BaseModel):
    closed_edge: str
    isolated_zones: list[Zone]
    affected_population: int
    unreachable_pois: list[str]
    affected_missions: list[MissionDelta]
    resilience_before: float
    resilience_after: float
    recommendation: str


class Decision(BaseModel):
    id: str
    ts: datetime
    kind: DecisionKind
    headline: str
    reasons: list[str] = []
    data: dict[str, Any] = {}


class SafeZoneAssignment(BaseModel):
    safe_zone_id: str | None
    evac_route: RouteResult | None
    reachable: bool


class StateSnapshot(BaseModel):
    seq: int
    ts: datetime
    computed_in_ms: float
    edges_geojson: dict[str, Any]
    vehicles: list[Vehicle] = []
    incidents: list[Incident] = []
    missions: list[Mission] = []
    pois: list[POI] = []
    zones: list[Zone] = []
    latest_impact: ImpactReport | None = None
    safe_zone_map: dict[str, SafeZoneAssignment] = {}
    decisions: list[Decision] = []
