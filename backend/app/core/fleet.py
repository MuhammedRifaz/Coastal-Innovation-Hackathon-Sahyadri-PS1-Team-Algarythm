"""Fleet assignment engine.

seed_vehicles(): 4 vehicles at fixed real nodes, seeded once at startup.

assign(): true route-cost assignment (Prompt 8) — evaluates every
available vehicle's actual routing.compute_route() cost, not straight-
line distance. Returns the best vehicle + route, a backup (second-best),
and reasons[] explaining every rejected vehicle, including why (blocked
approach road, or simply slower).

reassess_all(): run after every graph change. Reroutes missions in place
when the change is minor; reassigns to a different available vehicle
(freeing the old one) when the current vehicle's route becomes
unreachable or another available vehicle now beats it by a wide margin.
"""

from __future__ import annotations

import math
from typing import Any

import networkx as nx

from app.core.routing import compute_route
from app.models import Incident, Mission, RouteResult, Vehicle, Zone

EARTH_RADIUS_M = 6371000.0

# A candidate vehicle must beat the currently-assigned one's ETA by more
# than this factor to justify reassigning (freeing the old vehicle and
# re-dispatching) rather than just leaving it en route.
REASSIGN_ETA_IMPROVEMENT_THRESHOLD = 1.25

# (zone id to seed at, callsign, vehicle kind) — spread across both banks
# of the river. With this layout, an incident near the north bridge foot
# (see tests/test_fleet.py) has Unit 3 as straight-line-nearest but Unit 3
# needs the bridge to reach it — exactly the "naive nearest goes wrong"
# case the master plan asks for.
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


def nearest_by_straight_line(
    vehicles: list[Vehicle], point: tuple[float, float], node_coords: dict[Any, tuple[float, float]]
) -> Vehicle | None:
    """Nearest available vehicle by straight-line distance. Used only for
    comparison/explanation purposes now (e.g. "naive nearest would have
    picked X") — assign() itself always uses true route cost."""
    lon, lat = point
    best: Vehicle | None = None
    best_dist = math.inf
    for vehicle in vehicles:
        if vehicle.status != "available":
            continue
        coords = node_coords.get(int(vehicle.node_id))
        if coords is None:
            continue
        dist = _haversine_m(coords[0], coords[1], lon, lat)
        if dist < best_dist:
            best_dist = dist
            best = vehicle
    return best


def _road_label(data: dict[str, Any]) -> str:
    name = data.get("name")
    if isinstance(name, list):
        name = name[0] if name else None
    if name:
        return str(name)
    highway = data.get("highway_class") or "road"
    return f"a {highway} segment"


def _identify_blocking_road(graph: nx.MultiDiGraph, origin: int, dest: int) -> str | None:
    """Best-effort explanation for why a vehicle can't reach the incident:
    the shortest path ignoring flood cost (plain travel time), then the
    first blocked edge encountered along it."""
    try:
        path = nx.astar_path(graph, origin, dest, weight="base_time_s")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None
    for u, v in zip(path, path[1:]):
        edge_data = min(graph[u][v].values(), key=lambda a: a.get("base_time_s", math.inf))
        if edge_data.get("status") == "blocked":
            return _road_label(edge_data)
    return None


class Candidate:
    __slots__ = ("vehicle", "route")

    def __init__(self, vehicle: Vehicle, route: RouteResult) -> None:
        self.vehicle = vehicle
        self.route = route


def _rank(candidates: list[Candidate]) -> list[Candidate]:
    return sorted(candidates, key=lambda c: (0 if c.route.reachable else 1, c.route.eta_s if c.route.reachable else math.inf))


def assign(
    graph: nx.MultiDiGraph,
    incident_node: int,
    vehicles: list[Vehicle],
) -> tuple[Vehicle | None, RouteResult | None, Vehicle | None, RouteResult | None, list[str]]:
    """Best available vehicle by true route cost, a backup (second-best),
    and reasons[] for every rejected vehicle. Returns
    (best_vehicle, best_route, backup_vehicle, backup_route, reasons)."""
    available = [v for v in vehicles if v.status == "available"]
    if not available:
        return None, None, None, None, ["No available units — every vehicle is already committed."]

    candidates = [Candidate(v, compute_route(graph, int(v.node_id), incident_node)) for v in available]
    ranked = _rank(candidates)
    best = ranked[0]

    if not best.route.reachable:
        reasons = ["No available unit can reach the incident — every route is currently blocked."]
        for c in ranked:
            blocking = _identify_blocking_road(graph, int(c.vehicle.node_id), incident_node)
            reasons.append(
                f"{c.vehicle.callsign} rejected — "
                + (f"only approach crosses {blocking}, blocked." if blocking else "no passable route.")
            )
        return None, None, None, None, reasons

    reasons = [f"{best.vehicle.callsign} selected — ETA {best.route.eta_s:.0f}s, risk {best.route.risk_score:.0f}."]
    for c in ranked[1:]:
        if not c.route.reachable:
            blocking = _identify_blocking_road(graph, int(c.vehicle.node_id), incident_node)
            reasons.append(
                f"{c.vehicle.callsign} rejected — "
                + (f"only approach crosses {blocking}, blocked." if blocking else "no passable route.")
            )
        else:
            delta = c.route.eta_s - best.route.eta_s
            reasons.append(
                f"{c.vehicle.callsign} rejected — ETA {c.route.eta_s:.0f}s, {delta:.0f}s slower than {best.vehicle.callsign}."
            )

    backup = ranked[1] if len(ranked) > 1 and ranked[1].route.reachable else None
    return best.vehicle, best.route, (backup.vehicle if backup else None), (backup.route if backup else None), reasons


def reassess_all(
    graph: nx.MultiDiGraph,
    missions: list[Mission],
    vehicles: list[Vehicle],
    incidents: list[Incident],
) -> list[str]:
    """Reroute or reassign every active/rerouted/reassigned mission
    against the current graph. Returns one human-readable line per
    mission that actually changed, for the decision log."""
    vehicles_by_id = {v.id: v for v in vehicles}
    incidents_by_id = {i.id: i for i in incidents}
    decisions: list[str] = []

    for mission in missions:
        if mission.status not in ("active", "rerouted", "reassigned"):
            continue
        vehicle = vehicles_by_id.get(mission.vehicle_id)
        incident = incidents_by_id.get(mission.incident_id)
        if vehicle is None or incident is None:
            continue
        incident_node = int(incident.node_id)

        current_route = compute_route(graph, int(vehicle.node_id), incident_node)

        best_alt: Candidate | None = None
        for candidate_vehicle in vehicles:
            if candidate_vehicle.status != "available" or candidate_vehicle.id == vehicle.id:
                continue
            route = compute_route(graph, int(candidate_vehicle.node_id), incident_node)
            if route.reachable and (best_alt is None or route.eta_s < best_alt.route.eta_s):
                best_alt = Candidate(candidate_vehicle, route)

        needs_new_vehicle = not current_route.reachable
        beaten_badly = (
            current_route.reachable
            and best_alt is not None
            and current_route.eta_s > best_alt.route.eta_s * REASSIGN_ETA_IMPROVEMENT_THRESHOLD
        )

        if (needs_new_vehicle or beaten_badly) and best_alt is not None:
            old_callsign = vehicle.callsign
            vehicle.status = "available"
            vehicle.mission_id = None
            best_alt.vehicle.status = "en_route"
            best_alt.vehicle.mission_id = mission.id
            mission.vehicle_id = best_alt.vehicle.id
            mission.route = best_alt.route
            mission.backup_route = None
            mission.eta_s = best_alt.route.eta_s
            mission.status = "reassigned"
            if needs_new_vehicle:
                reason = (
                    f"{old_callsign}'s route is now blocked — reassigned to "
                    f"{best_alt.vehicle.callsign} (ETA {best_alt.route.eta_s:.0f}s)."
                )
            else:
                reason = (
                    f"{best_alt.vehicle.callsign} is "
                    f"{(current_route.eta_s - best_alt.route.eta_s):.0f}s faster than {old_callsign} — reassigned."
                )
            mission.reasons = [reason]
            decisions.append(reason)
        elif needs_new_vehicle:
            mission.route = current_route
            mission.eta_s = 0.0
            mission.status = "rerouted"
            reason = f"{vehicle.callsign}'s route is blocked and no other unit is available to reassign."
            mission.reasons = [reason]
            decisions.append(reason)
        elif current_route.eta_s > mission.eta_s * 1.2 and mission.eta_s > 0:
            mission.route = current_route
            mission.eta_s = current_route.eta_s
            mission.status = "rerouted"
            reason = f"{vehicle.callsign} rerouted — ETA now {current_route.eta_s:.0f}s due to flooding."
            mission.reasons = [reason]
            decisions.append(reason)

    return decisions
