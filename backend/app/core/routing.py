"""Risk-aware composite-cost routing engine.

edge_cost(attrs): time x flood_multiplier(depth) x critical_penalty, infinite
above the impassable threshold (30 cm default) — see master-plan §11.

compute_route(graph, origin_node, dest_node) -> RouteResult: A* over
edge_cost with a straight-line/max-speed admissible heuristic.
"""

from __future__ import annotations

import math
import time
from typing import Any

import networkx as nx

from app.models import LineStringGeometry, RouteResult

IMPASSABLE_CM = 30.0
RISK_ALPHA = 2.0
CRITICAL_BETA = 1.3
# Confidence penalty: lower confidence increases cost to reflect uncertainty
CONFIDENCE_GAMMA = 0.5

# Upper bound on any edge's real speed in the demo graph (observed max is
# 60 kph); comfortably above that keeps the A* heuristic admissible (never
# overestimates true remaining time) since flood multipliers only ever
# increase cost above the unflooded floor.
MAX_SPEED_KPH = 120.0
MAX_SPEED_MPS = MAX_SPEED_KPH * 1000 / 3600
EARTH_RADIUS_M = 6371000.0


def edge_cost(attrs: dict[str, Any]) -> float:
    """Composite routing cost: time x flood multiplier x critical penalty x confidence penalty."""
    depth_cm = attrs.get("flood_depth_cm", 0.0)
    if depth_cm >= IMPASSABLE_CM:
        return math.inf
    multiplier = 1 + (depth_cm / IMPASSABLE_CM) * RISK_ALPHA
    if attrs.get("critical") and depth_cm > 0:
        multiplier *= CRITICAL_BETA
    # Confidence penalty: lower confidence (uncertain reports) increases cost
    # Confidence 100% = no penalty, 50% = 1.25x cost, 0% = 1.5x cost
    confidence = attrs.get("confidence", 100)
    if confidence < 100 and depth_cm > 0:
        confidence_penalty = 1 + (1 - confidence / 100) * CONFIDENCE_GAMMA
        multiplier *= confidence_penalty
    return attrs["base_time_s"] * multiplier


def _min_cost_parallel_edge(
    edge_data: dict[Any, dict[str, Any]],
) -> tuple[Any, dict[str, Any]] | None:
    """Cheapest parallel edge between two nodes in a MultiDiGraph; None if
    every parallel copy is impassable."""
    best_key, best_cost, best_attrs = None, math.inf, None
    for key, attrs in edge_data.items():
        cost = edge_cost(attrs)
        if cost < best_cost:
            best_key, best_cost, best_attrs = key, cost, attrs
    if best_attrs is None or not math.isfinite(best_cost):
        return None
    return best_key, best_attrs


def _weight(_u: Any, _v: Any, edge_data: dict[Any, dict[str, Any]]) -> float | None:
    """A* weight function: hides (returns None) a u->v connection when every
    parallel edge between them is impassable, so NetworkXNoPath propagates
    naturally instead of a path with infinite cost being returned."""
    selected = _min_cost_parallel_edge(edge_data)
    return None if selected is None else edge_cost(selected[1])


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _heuristic(graph: nx.MultiDiGraph):
    def h(u: Any, v: Any) -> float:
        u_data, v_data = graph.nodes[u], graph.nodes[v]
        dist_m = _haversine_m(u_data["x"], u_data["y"], v_data["x"], v_data["y"])
        return dist_m / MAX_SPEED_MPS

    return h


def _unreachable(computed_in_ms: float) -> RouteResult:
    return RouteResult(
        node_path=[],
        geometry=LineStringGeometry(coordinates=[]),
        distance_m=0.0,
        eta_s=0.0,
        risk_score=0.0,
        avoided_edges=[],
        computed_in_ms=computed_in_ms,
        reachable=False,
    )


def compute_route(graph: nx.MultiDiGraph, origin_node: Any, dest_node: Any) -> RouteResult:
    """A* shortest path under the composite risk-aware cost, from
    origin_node to dest_node (both must be node ids present in `graph`)."""
    start = time.perf_counter()

    try:
        path = nx.astar_path(
            graph, origin_node, dest_node, heuristic=_heuristic(graph), weight=_weight
        )
    except nx.NetworkXNoPath:
        return _unreachable((time.perf_counter() - start) * 1000)

    edges_used: list[tuple[Any, Any, dict[str, Any]]] = []
    for u, v in zip(path, path[1:]):
        selected = _min_cost_parallel_edge(graph[u][v])
        assert selected is not None, "weight() admitted an edge with no passable parallel copy"
        _key, attrs = selected
        edges_used.append((u, v, attrs))

    distance_m = sum(attrs["length_m"] for _u, _v, attrs in edges_used)
    eta_s = sum(edge_cost(attrs) for _u, _v, attrs in edges_used)

    # "Safety deficit" here is driven by flood depth (the live, per-route
    # risk signal) rather than the static safety_score field, since depth
    # is what actually varies as floods are applied.
    deficits = [
        min(100.0, (attrs.get("flood_depth_cm", 0.0) / IMPASSABLE_CM) * 100.0)
        for _u, _v, attrs in edges_used
    ]
    risk_score = sum(deficits) / len(deficits) if deficits else 0.0

    path_edge_ids = {attrs["edge_id"] for _u, _v, attrs in edges_used}
    avoided_edges: set[str] = set()
    for node in path:
        for _n, _nbr, attrs in graph.out_edges(node, data=True):
            if attrs["edge_id"] not in path_edge_ids and attrs.get("flood_depth_cm", 0.0) > 0:
                avoided_edges.add(attrs["edge_id"])
        for _nbr, _n, attrs in graph.in_edges(node, data=True):
            if attrs["edge_id"] not in path_edge_ids and attrs.get("flood_depth_cm", 0.0) > 0:
                avoided_edges.add(attrs["edge_id"])

    coordinates: list[tuple[float, float]] = []
    for u, v, attrs in edges_used:
        geometry = attrs.get("geometry")
        if geometry is not None and hasattr(geometry, "coords"):
            coords = [(float(x), float(y)) for x, y in geometry.coords]
            u_xy = (graph.nodes[u]["x"], graph.nodes[u]["y"])
            if coords and _haversine_m(*coords[0], *u_xy) > _haversine_m(*coords[-1], *u_xy):
                coords.reverse()
        else:
            coords = [
                (graph.nodes[u]["x"], graph.nodes[u]["y"]),
                (graph.nodes[v]["x"], graph.nodes[v]["y"]),
            ]
        if coordinates and coords and coordinates[-1] == coords[0]:
            coordinates.extend(coords[1:])
        else:
            coordinates.extend(coords)

    computed_in_ms = (time.perf_counter() - start) * 1000

    return RouteResult(
        node_path=[str(n) for n in path],
        geometry=LineStringGeometry(coordinates=coordinates),
        distance_m=distance_m,
        eta_s=eta_s,
        risk_score=risk_score,
        avoided_edges=sorted(avoided_edges),
        computed_in_ms=computed_in_ms,
        reachable=True,
    )
