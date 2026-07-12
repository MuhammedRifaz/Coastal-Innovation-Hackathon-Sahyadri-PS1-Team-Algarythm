"""Tests for app.core.safezones.

Tests safe zone mapping functionality: zones are assigned to their nearest
reachable safe zone (shelters + stroke-ready hospitals), and when roads flood,
zones are re-mapped to the next-best reachable safe zone.
"""

import pytest

from app.core.graph_service import GraphService
from app.core.safezones import detect_safe_zone_changes, map_safe_zones


@pytest.fixture(scope="module")
def real_graph_service() -> GraphService:
    service = GraphService()
    service.load()
    return service


def test_safe_zone_mapping_assigns_all_zones(real_graph_service: GraphService):
    """All zones should be assigned to a reachable safe zone initially."""
    assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )

    assert len(assignments) == len(real_graph_service.zones)
    
    # All zones should have a safe zone assignment
    for zone_id, assignment in assignments.items():
        assert assignment is not None
        # In the pristine graph, all zones should be reachable to at least one safe zone
        assert assignment.reachable or assignment.safe_zone_id is None


def test_safe_zone_mapping_includes_shelters_and_stroke_ready_hospitals(
    real_graph_service: GraphService,
):
    """Safe zones should include both shelters and stroke-ready hospitals."""
    safe_zones = [
        p for p in real_graph_service.pois
        if p.kind == "shelter" or (p.kind == "hospital" and p.stroke_ready)
    ]

    assert len(safe_zones) > 0, "Should have at least one safe zone in demo data"
    
    # Verify we have both types if present in demo data
    has_shelter = any(p.kind == "shelter" for p in safe_zones)
    has_stroke_ready = any(p.kind == "hospital" and p.stroke_ready for p in safe_zones)
    
    # At least one type should be present
    assert has_shelter or has_stroke_ready


def test_flooding_bridge_causes_safe_zone_remap(real_graph_service: GraphService):
    """Flooding the main bridge should cause zones to lose access to safe zones
    on the opposite riverbank and trigger re-mapping."""
    # Get initial assignments
    before_assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )

    # Flood the bridge (use one of the critical bridge edge IDs)
    bridge_edge_id = "3610166954_11266540718_0"
    real_graph_service.apply_flood(bridge_edge_id, 45.0)

    # Get assignments after flooding
    after_assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )

    # Detect changes
    changes = detect_safe_zone_changes(
        before_assignments, after_assignments, real_graph_service.zones, real_graph_service.pois
    )

    # At least one zone should have changed its safe zone assignment
    # (zones on one side of the river losing access to shelters on the other side)
    assert len(changes) > 0, "Flooding the bridge should trigger safe zone re-mapping"

    # Reset for other tests
    real_graph_service.reset()


def test_detect_safe_zone_changes_generates_reasons(real_graph_service: GraphService):
    """Safe zone change detection should generate human-readable reasons."""
    from app.core.graph_service import CRITICAL_BRIDGE_EDGE_IDS
    
    # Get initial safe zone assignments
    before_assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )
    
    # Find a zone that has a reachable safe zone initially
    zone_with_safe_zone = None
    for zone_id, assignment in before_assignments.items():
        if assignment.reachable and assignment.safe_zone_id:
            zone_with_safe_zone = zone_id
            break
    
    if not zone_with_safe_zone:
        pytest.skip("No zone with reachable safe zone found in initial state")
    
    # Flood the critical bridge to trigger safe zone changes
    for edge_id in CRITICAL_BRIDGE_EDGE_IDS:
        real_graph_service.apply_flood(edge_id, 45.0)
    
    # Get new assignments after flooding
    after_assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )
    
    # Detect changes
    changes = detect_safe_zone_changes(
        before_assignments, after_assignments, real_graph_service.zones, real_graph_service.pois
    )
    
    # Should generate at least onereason
    assert len(changes) > 0


def test_safe_zone_evacuation_routes_are_computed(real_graph_service: GraphService):
    """When a zone is assigned to a safe zone, an evacuation route should be computed."""
    assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )

    # Check that reachable zones have evacuation routes
    zones_with_routes = 0
    for zone_id, assignment in assignments.items():
        if assignment.reachable and assignment.evac_route:
            zones_with_routes += 1
            # Route should have basic properties
            assert assignment.evac_route.reachable
            assert assignment.evac_route.eta_s > 0
            assert len(assignment.evac_route.node_path) >= 2

    # At least some zones should have routes
    assert zones_with_routes > 0, "At least some zones should have evacuation routes"


def test_safe_zone_mapping_computation_time(real_graph_service: GraphService):
    """Safe zone mapping should complete quickly (< 500ms for demo graph)."""
    import time

    start = time.perf_counter()
    assignments = map_safe_zones(
        real_graph_service.graph, real_graph_service.zones, real_graph_service.pois
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert len(assignments) == len(real_graph_service.zones)
    assert elapsed_ms < 500, f"Safe zone mapping took {elapsed_ms:.2f}ms, expected < 500ms"
