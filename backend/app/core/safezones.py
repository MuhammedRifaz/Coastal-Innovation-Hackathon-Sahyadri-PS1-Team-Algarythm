"""Dynamic Safe-Zone Mapping — evacuation-facing mirror of responder routing.

For each populated zone, find the nearest currently-reachable safe zone (shelter
or stroke-ready hospital) by true route cost on the passable subgraph, and
compute its evacuation route. When a safe zone becomes cut off, the affected
population is re-mapped to the next-best reachable safe zone. This serves
civilians, the elderly, disabled, and phone-less — the inclusivity WOW.

Reuses the passable-subgraph reachability cache from impact.py for efficiency.
"""

from __future__ import annotations

from typing import Any

import networkx as nx

from app.core import impact, routing
from app.models import POI, RouteResult, SafeZoneAssignment, Zone


def _get_safe_zones(pois: list[POI]) -> list[POI]:
    """Return all POIs that qualify as safe zones: shelters + stroke-ready hospitals."""
    return [p for p in pois if p.kind == "shelter" or (p.kind == "hospital" and p.stroke_ready)]


def map_safe_zones(
    graph: nx.MultiDiGraph,
    zones: list[Zone],
    pois: list[POI],
) -> dict[str, SafeZoneAssignment]:
    """For each zone, find the nearest reachable safe zone by true route cost.
    
    Returns a dict mapping zone_id -> SafeZoneAssignment with the best safe zone,
    its evacuation route, and whether it's reachable. If no safe zone is reachable,
    safe_zone_id is None and reachable is False.
    """
    safe_zones = _get_safe_zones(pois)
    if not safe_zones:
        return {z.id: SafeZoneAssignment(safe_zone_id=None, evac_route=None, reachable=False) for z in zones}
    
    # Get passable subgraph for reachability check
    passable = impact.passable_subgraph(graph)
    components = impact.compute_components(graph)
    
    assignments: dict[str, SafeZoneAssignment] = {}
    
    for zone in zones:
        zone_node = int(zone.centroid_node_id)
        zone_component = components.get(zone_node)
        
        # Filter safe zones in the same connected component (reachable)
        reachable_safe_zones = [
            sz for sz in safe_zones
            if components.get(int(sz.node_id)) == zone_component
        ]
        
        if not reachable_safe_zones:
            assignments[zone.id] = SafeZoneAssignment(
                safe_zone_id=None,
                evac_route=None,
                reachable=False
            )
            continue
        
        # Find the nearest safe zone by true route cost
        best_safe_zone = None
        best_route = None
        best_cost = float('inf')
        
        for safe_zone in reachable_safe_zones:
            safe_zone_node = int(safe_zone.node_id)
            route = routing.compute_route(graph, zone_node, safe_zone_node)
            
            if route.reachable and route.eta_s < best_cost:
                best_cost = route.eta_s
                best_safe_zone = safe_zone
                best_route = route
        
        if best_safe_zone and best_route:
            assignments[zone.id] = SafeZoneAssignment(
                safe_zone_id=best_safe_zone.id,
                evac_route=best_route,
                reachable=True
            )
        else:
            assignments[zone.id] = SafeZoneAssignment(
                safe_zone_id=None,
                evac_route=None,
                reachable=False
            )
    
    return assignments


def detect_safe_zone_changes(
    before_assignments: dict[str, SafeZoneAssignment],
    after_assignments: dict[str, SafeZoneAssignment],
    zones: list[Zone],
    pois: list[POI],
) -> list[str]:
    """Generate decision log reasons for zones that lost or changed safe zone access.
    
    Returns a list of plain-language reasons describing what changed.
    """
    reasons = []
    safe_zones = {sz.id: sz for sz in _get_safe_zones(pois)}
    zones_by_id = {z.id: z for z in zones}
    
    for zone_id, after in after_assignments.items():
        before = before_assignments.get(zone_id)
        zone = zones_by_id.get(zone_id)
        
        if not zone:
            continue
        
        if before is None:
            # Initial assignment - no change to log
            continue
        
        if before.reachable and not after.reachable:
            # Zone lost all safe zone access
            old_safe_zone = safe_zones.get(before.safe_zone_id) if before.safe_zone_id else None
            if old_safe_zone:
                reasons.append(
                    f"Zone {zone.name} lost access to {old_safe_zone.name} — "
                    f"no reachable safe zone remains ({zone.population} residents at risk)"
                )
            else:
                reasons.append(
                    f"Zone {zone.name} lost all safe zone access "
                    f"({zone.population} residents at risk)"
                )
        
        elif before.reachable and after.reachable:
            # Zone still has access, but safe zone changed
            if before.safe_zone_id != after.safe_zone_id:
                old_safe_zone = safe_zones.get(before.safe_zone_id) if before.safe_zone_id else None
                new_safe_zone = safe_zones.get(after.safe_zone_id) if after.safe_zone_id else None
                
                if old_safe_zone and new_safe_zone and after.evac_route:
                    eta_delta = after.evac_route.eta_s - (before.evac_route.eta_s if before.evac_route else 0)
                    delta_str = f"+{eta_delta:.0f}s" if eta_delta > 0 else f"{eta_delta:.0f}s"
                    reasons.append(
                        f"Zone {zone.name} re-mapped from {old_safe_zone.name} to {new_safe_zone.name} "
                        f"({delta_str}, {zone.population} residents)"
                    )
        
        elif not before.reachable and after.reachable:
            # Zone gained safe zone access (rare, but possible if a road clears)
            new_safe_zone = safe_zones.get(after.safe_zone_id) if after.safe_zone_id else None
            if new_safe_zone:
                reasons.append(
                    f"Zone {zone.name} gained access to {new_safe_zone.name} "
                    f"({zone.population} residents now protected)"
                )
    
    return reasons
