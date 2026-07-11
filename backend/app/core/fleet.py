"""Fleet assignment engine.

seed_vehicles(): 4 vehicles at fixed real nodes, seeded once at startup.

assign_nearest(): temporary nearest-by-straight-line-distance assignment,
per Prompt 6 — replaced by true route-cost assignment (with backup +
rejection reasons) in Prompt 8. Kept here, not in graph_service, so the
Prompt 8 rewrite only touches this module.
"""

from __future__ import annotations

import math
from typing import Any

from app.models import Vehicle, Zone

EARTH_RADIUS_M = 6371000.0

# (zone id to seed at, callsign, vehicle kind) — spread across both banks
# of the river so straight-line-nearest and route-cost-nearest can
# plausibly disagree once Prompt 8 lands.
SEED_PLAN: tuple[tuple[str, str, str], ...] = (
    ("zone-north-1", "Unit 1", "ambulance"),
    ("zone-central", "Unit 2", "ambulance"),
    ("zone-south-1", "Unit 3", "rescue_truck"),
    ("zone-south-2", "Unit 4", "rescue_truck"),
)


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def seed_vehicles(zones: list[Zone], node_coords: dict[Any, tuple[float, float]]) -> list[Vehicle]:
    zones_by_id = {zone.id: zone for zone in zones}
    vehicles: list[Vehicle] = []
    for i, (zone_id, callsign, kind) in enumerate(SEED_PLAN, start=1):
        zone = zones_by_id.get(zone_id)
        if zone is None:
            continue
        lng, lat = node_coords[int(zone.centroid_node_id)]
        vehicles.append(
            Vehicle(
                id=f"vehicle-{i}",
                callsign=callsign,
                kind=kind,  # type: ignore[arg-type]
                node_id=zone.centroid_node_id,
                lat=lat,
                lng=lng,
                status="available",
            )
        )
    return vehicles


def assign_nearest(
    vehicles: list[Vehicle], incident_node_coords: tuple[float, float], node_coords: dict[Any, tuple[float, float]]
) -> Vehicle | None:
    """Nearest available vehicle to the incident by straight-line distance.
    node_coords maps a graph node id (as used in Vehicle.node_id, cast to
    the same type as the graph's node keys) to (lon, lat)."""
    incident_lon, incident_lat = incident_node_coords
    best: Vehicle | None = None
    best_dist = math.inf
    for vehicle in vehicles:
        if vehicle.status != "available":
            continue
        coords = node_coords.get(int(vehicle.node_id))
        if coords is None:
            continue
        dist = _haversine_m(coords[0], coords[1], incident_lon, incident_lat)
        if dist < best_dist:
            best_dist = dist
            best = vehicle
    return best
