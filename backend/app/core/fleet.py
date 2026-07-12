"""Fleet Assignment Engine — Prompt 8.

assign(incident, graph, vehicles, node_coords) -> Mission | None
    Rank every available vehicle by true A* route cost (ETA). Pick the
    best as the primary assignment, the second-best as the backup route.
    Build a plain-language reasons[] that calls out any vehicle that was
    closer by straight-line distance but rejected (blocked path, higher
    ETA, or unreachable).

reassess_all(graph, vehicles, missions, incidents, node_coords)
    -> list[ReassessDecision]
    On every graph change, recompute routes for active/rerouted missions.
    Two triggers for reassignment (freeing the old unit and picking a new
    best):
      1. The current vehicle's route becomes unreachable.
      2. An available (not en_route) vehicle now beats the mission's ETA
         by more than REASSIGN_THRESHOLD (25%).

seed_vehicles() is deliberately positioned so that flooding the main
NH66 bridge makes the straight-line-nearest unit (Unit 1, north bank) the
wrong choice for a south-side incident — Unit 3 (south bank) wins on
true route cost, flipping the assignment.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import networkx as nx

from app.core.routing import compute_route
from app.models import Incident, Mission, RouteResult, Vehicle, Zone

EARTH_RADIUS_M = 6371000.0

# If an available (not en_route) vehicle now beats the active mission's
# ETA by more than this fraction the mission is reassigned.
REASSIGN_THRESHOLD = 0.25

# Seed plan: (zone_id, callsign, kind)
# Positions chosen so that:
#   • Unit 1 (north bank) is straight-line closest to a south-side incident
#     but its only route crosses the bridge — blocked when flooded.
#   • Unit 3 (south bank) is farther in a straight line but wins on
#     true route cost after the bridge floods.
SEED_PLAN: tuple[tuple[str, str, str], ...] = (
    ("zone-north-1", "Unit 1", "ambulance"),
    ("zone-central", "Unit 2", "ambulance"),
    ("zone-south-1", "Unit 3", "rescue_truck"),
    ("zone-south-2", "Unit 4", "rescue_truck"),
)


# ── helpers ───────────────────────────────────────────────────────────────────


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _node_coords_of(vehicle: Vehicle, node_coords: dict[Any, tuple[float, float]]) -> tuple[float, float] | None:
    """(lon, lat) for the graph node this vehicle is parked at."""
    return node_coords.get(int(vehicle.node_id))


# ── seeding ───────────────────────────────────────────────────────────────────


def seed_vehicles(zones: list[Zone], node_coords: dict[Any, tuple[float, float]]) -> list[Vehicle]:
    """Place one vehicle per SEED_PLAN entry, snapped to the zone's
    centroid_node_id. Silently skips entries whose zone_id isn't found."""
    zones_by_id = {z.id: z for z in zones}
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


# ── candidate ranking ─────────────────────────────────────────────────────────


@dataclass
class _Candidate:
    vehicle: Vehicle
    route: RouteResult
    straight_line_m: float
    eta_s: float  # math.inf if unreachable


def _rank_candidates(
    vehicles: list[Vehicle],
    incident_node: int,
    incident_coords: tuple[float, float],  # (lon, lat)
    graph: nx.MultiDiGraph,
    node_coords: dict[Any, tuple[float, float]],
) -> list[_Candidate]:
    """Route every available vehicle to the incident and return candidates
    sorted by ETA (unreachable vehicles at the end)."""
    candidates: list[_Candidate] = []
    for vehicle in vehicles:
        if vehicle.status != "available":
            continue
        coords = _node_coords_of(vehicle, node_coords)
        if coords is None:
            continue
        v_lon, v_lat = coords
        inc_lon, inc_lat = incident_coords
        sl_dist = _haversine_m(v_lon, v_lat, inc_lon, inc_lat)
        route = compute_route(graph, int(vehicle.node_id), incident_node)
        eta = route.eta_s if route.reachable else math.inf
        candidates.append(_Candidate(vehicle=vehicle, route=route, straight_line_m=sl_dist, eta_s=eta))

    candidates.sort(key=lambda c: c.eta_s)
    return candidates


def _build_reasons(
    candidates: list[_Candidate],
    winner: _Candidate,
) -> list[str]:
    """Plain-language reasons for the assignment decision.

    Every rejected vehicle that was *closer by straight-line distance*
    than the winner gets an explicit rejection entry; farther-but-worse
    vehicles get a brief comparative note.
    """
    reasons: list[str] = [
        f"{winner.vehicle.callsign} selected — ETA {winner.eta_s:.0f}s "
        f"({winner.straight_line_m / 1000:.1f} km straight-line)"
    ]

    for c in candidates:
        if c.vehicle.id == winner.vehicle.id:
            continue

        closer = c.straight_line_m < winner.straight_line_m
        if not c.route.reachable:
            tag = "closer by distance but" if closer else ""
            reasons.append(
                f"{c.vehicle.callsign} rejected: {tag} route unreachable "
                f"(all approaches blocked)".replace(": route", ": route")
                .replace(" but route", ": closer by distance but route")
            )
        elif c.eta_s > winner.eta_s:
            if closer:
                reasons.append(
                    f"{c.vehicle.callsign} rejected: closer by distance "
                    f"({c.straight_line_m / 1000:.1f} km) but ETA {c.eta_s:.0f}s "
                    f"vs {winner.eta_s:.0f}s — longer route-cost path"
                )
            else:
                reasons.append(
                    f"{c.vehicle.callsign} available: ETA {c.eta_s:.0f}s — slower than {winner.vehicle.callsign}"
                )

    if winner.route.avoided_edges:
        n = len(winner.route.avoided_edges)
        reasons.append(
            f"Route avoids {n} flooded segment{'s' if n != 1 else ''} "
            f"(risk score {winner.route.risk_score:.0f}%)"
        )

    return reasons


# ── public: assign ────────────────────────────────────────────────────────────


def assign(
    incident: Incident,
    graph: nx.MultiDiGraph,
    vehicles: list[Vehicle],
    node_coords: dict[Any, tuple[float, float]],
    mission_id_seq: int,
) -> tuple[Mission, list[str]] | tuple[None, list[str]]:
    """True route-cost assignment.

    Returns (Mission, reasons) where reasons is a human-readable list
    explaining the decision (for the Decision log). Returns (None, reasons)
    when no vehicle is available or all routes are unreachable.
    """
    incident_node = int(incident.node_id)
    incident_coords = (incident.lng, incident.lat)

    candidates = _rank_candidates(vehicles, incident_node, incident_coords, graph, node_coords)

    reachable = [c for c in candidates if c.route.reachable]
    if not reachable:
        reasons = ["No available vehicle can reach this incident — all routes blocked or no units free"]
        return None, reasons

    winner = reachable[0]
    backup_candidate = reachable[1] if len(reachable) > 1 else None
    reasons = _build_reasons(candidates, winner)

    mission = Mission(
        id=f"mission-{mission_id_seq}",
        incident_id=incident.id,
        vehicle_id=winner.vehicle.id,
        route=winner.route,
        backup_route=backup_candidate.route if backup_candidate else None,
        eta_s=winner.route.eta_s,
        status="active",
        reasons=reasons,
    )
    return mission, reasons


# ── public: reassess_all ──────────────────────────────────────────────────────


@dataclass
class ReassessDecision:
    mission_id: str
    action: str  # "rerouted" | "reassigned" | "unreachable" | "unchanged"
    old_vehicle_callsign: str
    new_vehicle_callsign: str | None
    reasons: list[str] = field(default_factory=list)


def reassess_all(
    graph: nx.MultiDiGraph,
    vehicles: list[Vehicle],
    missions: list[Mission],
    incidents: list[Incident],
    node_coords: dict[Any, tuple[float, float]],
) -> list[ReassessDecision]:
    """Recompute routes for every active/rerouted mission. Returns a list
    of ReassessDecision objects describing what changed.

    Reassignment triggers:
      1. Current vehicle's route is unreachable.
      2. An available (not en_route) vehicle now beats the mission ETA
         by more than REASSIGN_THRESHOLD (25%).
    """
    vehicles_by_id = {v.id: v for v in vehicles}
    incidents_by_id = {i.id: i for i in incidents}
    decisions: list[ReassessDecision] = []

    for mission in missions:
        if mission.status not in ("active", "rerouted"):
            continue

        vehicle = vehicles_by_id.get(mission.vehicle_id)
        incident = incidents_by_id.get(mission.incident_id)
        if vehicle is None or incident is None:
            continue

        old_callsign = vehicle.callsign
        incident_node = int(incident.node_id)
        incident_coords = (incident.lng, incident.lat)

        # Recompute route for the current assigned vehicle
        new_route = compute_route(graph, int(vehicle.node_id), incident_node)
        old_eta = mission.eta_s

        if not new_route.reachable:
            # Try to reassign to the best available (not en_route) vehicle
            available = [v for v in vehicles if v.status == "available" and v.id != vehicle.id]
            alt_candidates = _rank_candidates(available, incident_node, incident_coords, graph, node_coords)
            reachable_alts = [c for c in alt_candidates if c.route.reachable]

            if reachable_alts:
                best_alt = reachable_alts[0]
                backup_alt = reachable_alts[1] if len(reachable_alts) > 1 else None
                reasons = _build_reasons(alt_candidates, best_alt)
                reasons.insert(0, f"{old_callsign} reassigned: route became unreachable after road closure")

                # Free old vehicle
                vehicle.status = "available"
                vehicle.mission_id = None

                # Assign new vehicle
                best_alt.vehicle.status = "en_route"
                best_alt.vehicle.mission_id = mission.id

                # Update mission
                mission.vehicle_id = best_alt.vehicle.id
                mission.route = best_alt.route
                mission.backup_route = backup_alt.route if backup_alt else None
                mission.eta_s = best_alt.route.eta_s
                mission.status = "reassigned"
                mission.reasons = reasons

                decisions.append(ReassessDecision(
                    mission_id=mission.id,
                    action="reassigned",
                    old_vehicle_callsign=old_callsign,
                    new_vehicle_callsign=best_alt.vehicle.callsign,
                    reasons=reasons,
                ))
            else:
                # No alternative — mark unreachable but keep assignment
                mission.route = new_route
                mission.eta_s = 0.0
                mission.status = "rerouted"
                reasons = [
                    f"{old_callsign}: route became unreachable; no alternative unit available"
                ]
                mission.reasons = reasons
                decisions.append(ReassessDecision(
                    mission_id=mission.id,
                    action="unreachable",
                    old_vehicle_callsign=old_callsign,
                    new_vehicle_callsign=None,
                    reasons=reasons,
                ))

        else:
            # Route still reachable — check if an available unit beats ETA by >25%
            available = [v for v in vehicles if v.status == "available" and v.id != vehicle.id]
            alt_candidates = _rank_candidates(available, incident_node, incident_coords, graph, node_coords)
            reachable_alts = [c for c in alt_candidates if c.route.reachable]

            eta_beat = None
            if reachable_alts:
                best_alt = reachable_alts[0]
                if best_alt.eta_s < new_route.eta_s * (1 - REASSIGN_THRESHOLD):
                    eta_beat = best_alt

            if eta_beat is not None:
                backup_alt = reachable_alts[1] if len(reachable_alts) > 1 else None
                improvement_pct = (new_route.eta_s - eta_beat.eta_s) / new_route.eta_s * 100
                reasons = _build_reasons(alt_candidates, eta_beat)
                reasons.insert(
                    0,
                    f"{eta_beat.vehicle.callsign} now beats {old_callsign} by "
                    f"{improvement_pct:.0f}% ETA ({new_route.eta_s:.0f}s → {eta_beat.eta_s:.0f}s) "
                    f"— reassigning"
                )

                # Free old vehicle
                vehicle.status = "available"
                vehicle.mission_id = None

                # Assign new
                eta_beat.vehicle.status = "en_route"
                eta_beat.vehicle.mission_id = mission.id

                mission.vehicle_id = eta_beat.vehicle.id
                mission.route = eta_beat.route
                mission.backup_route = backup_alt.route if backup_alt else None
                mission.eta_s = eta_beat.route.eta_s
                mission.status = "reassigned"
                mission.reasons = reasons

                decisions.append(ReassessDecision(
                    mission_id=mission.id,
                    action="reassigned",
                    old_vehicle_callsign=old_callsign,
                    new_vehicle_callsign=eta_beat.vehicle.callsign,
                    reasons=reasons,
                ))
            else:
                # Simply update the route (may have changed penalty-wise)
                eta_worsened = old_eta > 0 and new_route.eta_s > old_eta * 1.20
                mission.route = new_route
                mission.eta_s = new_route.eta_s
                if eta_worsened and mission.status != "rerouted":
                    mission.status = "rerouted"
                    reasons = [
                        f"{old_callsign}: ETA worsened from {old_eta:.0f}s to {new_route.eta_s:.0f}s "
                        f"due to road changes — rerouted"
                    ]
                    mission.reasons = reasons
                    decisions.append(ReassessDecision(
                        mission_id=mission.id,
                        action="rerouted",
                        old_vehicle_callsign=old_callsign,
                        new_vehicle_callsign=old_callsign,
                        reasons=reasons,
                    ))

    return decisions


# ── legacy shim (used only in impact.py _build_recommendation) ────────────────


def assign_nearest(
    vehicles: list[Vehicle], incident_node_coords: tuple[float, float], node_coords: dict[Any, tuple[float, float]]
) -> Vehicle | None:
    """Straight-line nearest — kept only for impact.py's quick recommendation
    heuristic which doesn't have graph access. Do not use for real dispatch."""
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
