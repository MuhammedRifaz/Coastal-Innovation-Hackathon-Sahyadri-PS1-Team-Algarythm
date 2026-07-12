"""Critical Road Impact Analyzer — the WOW feature.

Maintains a lazily-recomputed reachability cache: node -> connected-
component index over the "passable" subgraph (every edge whose status
isn't "blocked"). analyze_impact() diffs a before/after pair of these
caches to answer "what did the city just lose?" when an edge transitions
to blocked — isolated zones, unreachable hospitals, affected missions,
and a population-weighted resilience score. Recomputing the cache is
graph_service's job (it only needs to happen on a blocked-status
transition); this module is pure — no I/O, no mutation of its own state.
"""

from __future__ import annotations

from typing import Any

import networkx as nx

from app.core import fleet
from app.models import ImpactReport, Mission, MissionDelta, POI, Vehicle, Zone


def passable_subgraph(graph: nx.MultiDiGraph) -> nx.Graph:
    """Undirected view containing only non-blocked edges."""
    passable = nx.Graph()
    passable.add_nodes_from(graph.nodes)
    for u, v, data in graph.edges(data=True):
        if data.get("status") != "blocked":
            passable.add_edge(u, v)
    return passable


def compute_components(graph: nx.MultiDiGraph) -> dict[Any, int]:
    """node -> connected-component index, over the passable subgraph."""
    passable = passable_subgraph(graph)
    components: dict[Any, int] = {}
    for idx, component in enumerate(nx.connected_components(passable)):
        for node in component:
            components[node] = idx
    return components


def _reachable_poi_ids(
    zone_node: int, components: dict[Any, int], pois: list[POI], kind: str | None = None
) -> set[str]:
    """Return reachable POI IDs for a zone, optionally filtered by kind."""
    zone_component = components.get(zone_node)
    if zone_component is None:
        return set()
    filtered_pois = pois if kind is None else [p for p in pois if p.kind == kind]
    return {p.id for p in filtered_pois if components.get(int(p.node_id)) == zone_component}


def resilience_score(zones: list[Zone], components: dict[Any, int], pois: list[POI]) -> float:
    """Population-weighted mean fraction of all critical POIs each zone can
    reach (hospitals, fire stations, police). A binary "reaches >=1 POI" threshold
    never moves in this demo area — every zone has a locally-reachable POI on its own
    riverbank by design (§18 inclusivity: redundant coverage), so losing
    the bridge never drops anyone to zero. The graduated coverage-fraction
    version below still rewards full redundancy at 1.0 and still
    correctly drops when a zone loses access to some (not all) of the
    city's critical infrastructure — which is the real, demo-relevant signal."""
    critical_pois = [p for p in pois if p.kind in ("hospital", "fire_station", "police")]
    total_population = sum(z.population for z in zones)
    if total_population == 0 or not critical_pois:
        return 1.0
    weighted_coverage = sum(
        z.population * (len(_reachable_poi_ids(int(z.centroid_node_id), components, critical_pois)) / len(critical_pois))
        for z in zones
    )
    return weighted_coverage / total_population


def _is_edge_critical(graph: nx.MultiDiGraph, edge_id: str) -> bool:
    for _u, _v, data in graph.edges(data=True):
        if data.get("edge_id") == edge_id:
            return bool(data.get("critical"))
    return False


def _build_recommendation(
    graph: nx.MultiDiGraph,
    closed_edge_id: str,
    isolated_zones: list[Zone],
    vehicles: list[Vehicle],
) -> str:
    if not isolated_zones:
        # A "0 zones affected" result is a real, verifiable finding, not a
        # gap — explain *why* instead of leaving a bare zero: most roads
        # have an alternate route, so closing them doesn't cut anyone off.
        # The betweenness-centrality flag (see graph_service._mark_critical_
        # edges) tells us whether this was even a candidate chokepoint.
        if _is_edge_critical(graph, closed_edge_id):
            return (
                "No zone lost hospital access — this road is flagged as high-traffic "
                "(top 3% by betweenness centrality), but an alternate route still exists. "
                "Resilience unchanged."
            )
        return (
            "No zone lost hospital access — this road isn't a load-bearing chokepoint "
            "for any zone's route to a hospital. Resilience unchanged. Try the NH66 "
            "bridge crossing the river for the network's real single point of failure."
        )
    worst = max(isolated_zones, key=lambda z: z.population)
    zone_node = int(worst.centroid_node_id)
    vehicle, route, _backup_v, _backup_r, _reasons = fleet.assign(graph, zone_node, vehicles)
    if vehicle is None or route is None:
        return f"No available unit can reach {worst.name} ({worst.population} residents) — all vehicles committed or blocked."
    return (
        f"RECOMMENDED: Dispatch {vehicle.callsign} to {worst.name} "
        f"({worst.population} residents) — ETA {route.eta_s:.0f}s via alternate route."
    )


def analyze_impact(
    graph: nx.MultiDiGraph,
    closed_edge_id: str,
    zones: list[Zone],
    pois: list[POI],
    missions: list[Mission],
    vehicles: list[Vehicle],
    before_components: dict[Any, int],
    mission_etas_before: dict[str, float],
) -> ImpactReport:
    """Diff reachability before/after `closed_edge_id` transitioned to
    blocked. `before_components` must be the cache from immediately before
    this change; `mission_etas_before` the mission etas from immediately
    before reassessment ran."""
    critical_pois = [p for p in pois if p.kind in ("hospital", "fire_station", "police")]
    after_components = compute_components(graph)

    # A zone counts as affected if it lost access to any critical POI it could
    # reach before — not only if it lost ALL POI access. In this demo
    # area each riverbank has its own hospital, so a zone never goes to
    # zero reachable POIs when the bridge floods; it still loses its
    # route to a specific one (e.g. the stroke-ready hospital across the
    # river), which is the real, demo-relevant impact.
    isolated_zones: list[Zone] = []
    unreachable_poi_ids: set[str] = set()
    for zone in zones:
        zone_node = int(zone.centroid_node_id)
        before_pois = _reachable_poi_ids(zone_node, before_components, critical_pois)
        after_pois = _reachable_poi_ids(zone_node, after_components, critical_pois)
        zone.reachable_hospitals = sorted([p for p in after_pois if any(poi.id == p for poi in pois if poi.kind == "hospital")])
        lost_pois = before_pois - after_pois
        if lost_pois:
            isolated_zones.append(zone)
            unreachable_poi_ids |= lost_pois

    affected_population = sum(z.population for z in isolated_zones)

    vehicles_by_id = {v.id: v for v in vehicles}
    affected_missions: list[MissionDelta] = []
    for mission in missions:
        if mission.id not in mission_etas_before:
            continue
        eta_before = mission_etas_before[mission.id]
        eta_after = mission.eta_s
        if not mission.route.reachable:
            affected_missions.append(
                MissionDelta(mission_id=mission.id, delta_eta_s=0.0, action="unreachable — no passable route")
            )
        elif eta_after > eta_before * 1.001:
            affected_missions.append(
                MissionDelta(
                    mission_id=mission.id,
                    delta_eta_s=eta_after - eta_before,
                    action="rerouted",
                )
            )

    resilience_before = resilience_score(zones, before_components, pois)
    resilience_after = resilience_score(zones, after_components, pois)
    recommendation = _build_recommendation(graph, closed_edge_id, isolated_zones, vehicles)

    return ImpactReport(
        closed_edge=closed_edge_id,
        isolated_zones=isolated_zones,
        affected_population=affected_population,
        unreachable_pois=sorted(unreachable_poi_ids),
        affected_missions=affected_missions,
        resilience_before=resilience_before,
        resilience_after=resilience_after,
        recommendation=recommendation,
    )
