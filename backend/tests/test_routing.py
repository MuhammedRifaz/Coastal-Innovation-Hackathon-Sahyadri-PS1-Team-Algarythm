"""Tests for app.core.routing.

(a) and (d) run against the real fetched graph (GraphService) since
startup performance is the thing worth verifying there. (b) and (c)
build a small synthetic MultiDiGraph with a known-cheap direct path and a
known-expensive detour, so flood-driven rerouting is deterministic and
doesn't depend on which real-world alternates happen to exist near the
one river crossing in the demo extract.
"""

import math
from datetime import datetime, timezone

import networkx as nx
import pytest

from app.core.graph_service import GraphService
from app.core.routing import IMPASSABLE_CM, compute_route, edge_cost


@pytest.fixture(scope="module")
def real_graph_service() -> GraphService:
    service = GraphService()
    service.load()
    return service


def _edge_attrs(base_time_s: float, length_m: float, flood_depth_cm: float = 0.0) -> dict:
    return {
        "base_time_s": base_time_s,
        "length_m": length_m,
        "flood_depth_cm": flood_depth_cm,
        "highway_class": "residential",
        "status": "safe",
        "safety_score": 100,
        "critical": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _diamond_graph() -> nx.MultiDiGraph:
    """1 -> 2 -> 4 (cheap direct path, 60s/leg) and 1 -> 3 -> 4 (expensive
    detour, 180s/leg). All nodes share identical coordinates so the A*
    heuristic is always 0 (trivially admissible) and edge_cost/base_time_s
    alone determine which path wins."""
    g = nx.MultiDiGraph()
    for node in (1, 2, 3, 4):
        g.add_node(node, x=74.9, y=12.9)
    g.add_edge(1, 2, key=0, edge_id="e_1_2", **_edge_attrs(60.0, 500.0))
    g.add_edge(2, 4, key=0, edge_id="e_2_4", **_edge_attrs(60.0, 500.0))
    g.add_edge(1, 3, key=0, edge_id="e_1_3", **_edge_attrs(180.0, 1500.0))
    g.add_edge(3, 4, key=0, edge_id="e_3_4", **_edge_attrs(180.0, 1500.0))
    return g


def test_route_between_two_fixed_nodes_succeeds(real_graph_service: GraphService):
    zones_by_id = {z.id: z for z in real_graph_service.zones}
    origin = int(zones_by_id["zone-north-1"].centroid_node_id)
    dest = int(zones_by_id["zone-south-1"].centroid_node_id)

    result = compute_route(real_graph_service.graph, origin, dest)

    assert result.reachable
    assert len(result.node_path) >= 2
    assert result.distance_m > 0
    assert result.eta_s > 0


def test_flooding_best_path_edge_to_40cm_forces_a_different_path():
    graph = _diamond_graph()

    baseline = compute_route(graph, 1, 4)
    assert baseline.reachable
    assert baseline.node_path == ["1", "2", "4"]

    graph[2][4][0]["flood_depth_cm"] = 40.0  # >= IMPASSABLE_CM -> blocked

    rerouted = compute_route(graph, 1, 4)
    assert rerouted.reachable
    assert rerouted.node_path == ["1", "3", "4"]
    assert "2" not in rerouted.node_path


def test_25cm_penalizes_but_still_allows_the_edge():
    graph = _diamond_graph()

    baseline = compute_route(graph, 1, 4)
    assert baseline.eta_s == pytest.approx(120.0)

    graph[2][4][0]["flood_depth_cm"] = 25.0  # < IMPASSABLE_CM -> passable, penalized

    penalized = compute_route(graph, 1, 4)

    assert penalized.reachable
    # Still the cheapest path (220s) vs. the 360s detour, so the edge
    # remains part of the route despite the flood penalty.
    assert penalized.node_path == ["1", "2", "4"]
    assert penalized.eta_s == pytest.approx(220.0)
    assert penalized.eta_s > baseline.eta_s
    assert edge_cost(graph[2][4][0]) < math.inf


def test_edge_cost_thresholds():
    assert edge_cost(_edge_attrs(60.0, 500.0, flood_depth_cm=0.0)) == pytest.approx(60.0)
    assert edge_cost(_edge_attrs(60.0, 500.0, flood_depth_cm=29.99)) < float("inf")
    assert edge_cost(_edge_attrs(60.0, 500.0, flood_depth_cm=IMPASSABLE_CM)) == float("inf")


def test_compute_time_under_100ms(real_graph_service: GraphService):
    zones_by_id = {z.id: z for z in real_graph_service.zones}
    origin = int(zones_by_id["zone-north-1"].centroid_node_id)
    dest = int(zones_by_id["zone-south-2"].centroid_node_id)

    result = compute_route(real_graph_service.graph, origin, dest)

    assert result.computed_in_ms < 100
