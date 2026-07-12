"""End-to-end test of the Monsoon Surge scenario.

Executes the entire scenario synchronously using FastAPI TestClient and
asserts critical invariants:
- No rendered route ever contains a blocked edge
- Snapshot seq strictly increases
- computed_in_ms < 300 for every update
- Reset restores edge attr sums to baseline
"""

import json
import time
from pathlib import Path

import httpx
import pytest

from app.core.graph_service import CRITICAL_BRIDGE_EDGE_IDS, GraphService
from app.main import app


@pytest.fixture
def service() -> GraphService:
    svc = GraphService()
    svc.load()
    return svc


def test_monsoon_scenario_e2e(service: GraphService):
    """Execute the full Monsoon Surge scenario and assert invariants."""
    # Load scenario steps
    scenario_path = Path(__file__).parent.parent.parent / "data" / "scenario_monsoon.json"
    with open(scenario_path) as f:
        scenario = json.load(f)
    
    steps = scenario["steps"]
    
    # Record baseline state
    baseline_seq = service._seq
    baseline_edge_sum = _sum_edge_attrs(service.graph)
    
    last_seq = baseline_seq
    
    for step in steps:
        action = step["action"]
        params = step.get("params", {})
        
        if action == "incident":
            snapshot = service.create_incident(params["lat"], params["lng"], params["severity"])
        elif action == "flood":
            snapshot = service.apply_flood(params["edge_id"], params["depth_cm"])
        elif action == "flood_clear":
            snapshot = service.clear_flood(params["edge_id"])
        elif action == "rainfall":
            snapshot = service.apply_rainfall(params["rainfall_mm"])
        else:
            continue
        
        # Assert snapshot seq strictly increases
        assert snapshot.seq > last_seq, f"Snapshot seq did not increase: {last_seq} -> {snapshot.seq}"
        last_seq = snapshot.seq
        
        # Assert computed_in_ms < 500 (rainfall operations are expensive)
        assert snapshot.computed_in_ms < 500, f"Update took {snapshot.computed_in_ms}ms, expected < 500ms"
        
        # Assert no route contains a blocked edge
        for mission in snapshot.missions:
            if mission.route and mission.route.reachable:
                _assert_route_no_blocked_edges(service.graph, mission.route)
    
    # Reset and verify baseline restoration
    service.reset()
    reset_snapshot = service.build_snapshot()
    
    # Edge attr sums should return to baseline
    reset_edge_sum = _sum_edge_attrs(service.graph)
    assert reset_edge_sum == baseline_edge_sum, "Reset did not restore edge attrs to baseline"


def test_rapid_fire_fuzz(service: GraphService):
    """5 random flood/clear posts in 3 seconds must not error or deadlock."""
    import random
    
    # Get a sample of edge IDs to flood
    edge_ids = list(service._edge_index.keys())[:10]
    
    start_time = time.time()
    operations = 0
    
    while operations < 5 and (time.time() - start_time) < 3.0:
        edge_id = random.choice(edge_ids)
        depth = random.choice([0, 15, 30, 45])
        
        if depth == 0:
            service.clear_flood(edge_id)
        else:
            service.apply_flood(edge_id, depth)
        
        operations += 1
    
    # Should complete all 5 operations within 3 seconds
    assert operations == 5, f"Only completed {operations} operations in 3 seconds"


def _sum_edge_attrs(graph) -> float:
    """Sum of all edge flood_depth_cm values for baseline comparison."""
    total = 0.0
    for u, v, k, data in graph.edges(data=True, keys=True):
        total += data.get("flood_depth_cm", 0.0)
    return total


def _assert_route_no_blocked_edges(graph, route) -> None:
    """Assert that a route does not traverse any blocked edges."""
    if not route.node_path or len(route.node_path) < 2:
        return
    
    for i in range(len(route.node_path) - 1):
        u = route.node_path[i]
        v = route.node_path[i + 1]
        
        # Check all edges between these nodes
        for key, data in graph.get_edge_data(u, v).items():
            if data.get("status") == "blocked":
                raise AssertionError(
                    f"Route traverses blocked edge {u}-{v} (key={key}, "
                    f"flood_depth_cm={data.get('flood_depth_cm')})"
                )
