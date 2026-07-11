"""Road graph loading, annotation, and mutation.

Loads the cached OSM GraphML into an in-memory NetworkX MultiDiGraph at
FastAPI startup, enriches every edge with the routing/flood attributes the
rest of core/ depends on, snaps POIs/zones from data/demo_area.json to
their nearest graph nodes, and precomputes approximate betweenness
centrality to flag critical edges.

apply_flood/clear_flood and build_snapshot (full WebSocket contract) land
in Prompt 4 — this module only covers load-time setup and the read-only
GeoJSON view needed for GET /api/graph.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import networkx as nx
import osmnx as ox

from app.models import POI, Zone

REPO_ROOT = Path(__file__).resolve().parents[3]
GRAPH_PATH = REPO_ROOT / "data" / "demo_graph.graphml"
DEMO_AREA_PATH = REPO_ROOT / "data" / "demo_area.json"

IMPASSABLE_CM = 30.0
BETWEENNESS_SAMPLE_K = 200
CRITICAL_FRACTION = 0.03
DEFAULT_SPEED_KPH = 30.0


def _highway_class(value: Any) -> str:
    if isinstance(value, list):
        return str(value[0]) if value else "unclassified"
    return str(value) if value is not None else "unclassified"


def _edge_status(depth_cm: float) -> str:
    if depth_cm <= 0:
        return "safe"
    if depth_cm < IMPASSABLE_CM:
        return "risky"
    return "blocked"


def _mark_critical_edges(
    graph: nx.MultiDiGraph,
    k: int = BETWEENNESS_SAMPLE_K,
    fraction: float = CRITICAL_FRACTION,
) -> None:
    """Approximate betweenness on a collapsed simple graph, top `fraction`
    of (u, v) pairs by centrality get critical=True on every parallel edge
    between them in the original MultiDiGraph."""
    undirected = nx.Graph(graph)
    if undirected.number_of_edges() == 0:
        return
    sample_k = min(k, undirected.number_of_nodes())
    centrality = nx.edge_betweenness_centrality(
        undirected, k=sample_k, weight="length_m", seed=42
    )
    if not centrality:
        return
    ranked = sorted(centrality.items(), key=lambda item: item[1], reverse=True)
    top_n = max(1, round(len(ranked) * fraction))
    critical_pairs = {frozenset((u, v)) for (u, v), _ in ranked[:top_n]}
    for u, v, data in graph.edges(data=True):
        if frozenset((u, v)) in critical_pairs:
            data["critical"] = True


def load_graph(graph_path: Path = GRAPH_PATH) -> nx.MultiDiGraph:
    """Load the cached GraphML and enrich every edge with the routing/flood
    attribute set every other engine relies on."""
    graph = ox.load_graphml(graph_path)
    now = datetime.now(timezone.utc).isoformat()

    for u, v, k, data in graph.edges(keys=True, data=True):
        length_m = float(data.get("length", 0.0))
        travel_time = data.get("travel_time")
        base_time_s = (
            float(travel_time)
            if travel_time is not None
            else length_m / (DEFAULT_SPEED_KPH * 1000 / 3600)
        )
        data["edge_id"] = f"{u}_{v}_{k}"
        data["length_m"] = length_m
        data["base_time_s"] = base_time_s
        data["highway_class"] = _highway_class(data.get("highway"))
        data["flood_depth_cm"] = 0.0
        data["status"] = _edge_status(0.0)
        data["safety_score"] = 100
        data["critical"] = False
        data["updated_at"] = now

    _mark_critical_edges(graph)
    return graph


def load_annotations(
    graph: nx.MultiDiGraph, demo_area_path: Path = DEMO_AREA_PATH
) -> tuple[list[Zone], list[POI]]:
    """Load data/demo_area.json and snap each zone/POI to its nearest graph node."""
    with demo_area_path.open(encoding="utf-8") as f:
        raw = json.load(f)

    raw_zones = raw.get("zones", [])
    raw_pois = raw.get("pois", [])

    lngs = [z["lng"] for z in raw_zones] + [p["lng"] for p in raw_pois]
    lats = [z["lat"] for z in raw_zones] + [p["lat"] for p in raw_pois]

    if not lngs:
        return [], []

    nearest = ox.distance.nearest_nodes(graph, X=lngs, Y=lats)
    nearest = nearest.tolist() if hasattr(nearest, "tolist") else [nearest]

    zones: list[Zone] = []
    for raw_zone, node_id in zip(raw_zones, nearest[: len(raw_zones)]):
        zones.append(
            Zone(
                id=raw_zone["id"],
                name=raw_zone["name"],
                centroid_node_id=str(node_id),
                population=raw_zone["population"],
            )
        )

    pois: list[POI] = []
    for raw_poi, node_id in zip(raw_pois, nearest[len(raw_zones) :]):
        pois.append(
            POI(
                id=raw_poi["id"],
                kind=raw_poi["kind"],
                name=raw_poi["name"],
                node_id=str(node_id),
                lat=raw_poi["lat"],
                lng=raw_poi["lng"],
                stroke_ready=raw_poi.get("stroke_ready", False),
            )
        )

    return zones, pois


def graph_to_geojson(graph: nx.MultiDiGraph) -> dict[str, Any]:
    """Roads as a GeoJSON FeatureCollection, edge attrs carried as properties."""
    features = []
    for u, v, _k, data in graph.edges(keys=True, data=True):
        geometry = data.get("geometry")
        if geometry is not None and hasattr(geometry, "coords"):
            coordinates = [[float(x), float(y)] for x, y in geometry.coords]
        else:
            u_node, v_node = graph.nodes[u], graph.nodes[v]
            coordinates = [
                [float(u_node["x"]), float(u_node["y"])],
                [float(v_node["x"]), float(v_node["y"])],
            ]

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "properties": {
                    "edge_id": data["edge_id"],
                    "length_m": data["length_m"],
                    "base_time_s": data["base_time_s"],
                    "highway_class": data["highway_class"],
                    "flood_depth_cm": data["flood_depth_cm"],
                    "status": data["status"],
                    "safety_score": data["safety_score"],
                    "critical": data["critical"],
                    "updated_at": data["updated_at"],
                },
            }
        )

    return {"type": "FeatureCollection", "features": features}


REQUIRED_EDGE_ATTRS = (
    "edge_id",
    "length_m",
    "base_time_s",
    "highway_class",
    "flood_depth_cm",
    "status",
    "safety_score",
    "critical",
    "updated_at",
)


class GraphService:
    """Holds the process-lifetime graph + POIs/zones. One instance lives on
    app.state, constructed and loaded during the FastAPI lifespan."""

    def __init__(self) -> None:
        self.graph: nx.MultiDiGraph | None = None
        self.zones: list[Zone] = []
        self.pois: list[POI] = []

    def load(
        self,
        graph_path: Path = GRAPH_PATH,
        demo_area_path: Path = DEMO_AREA_PATH,
    ) -> None:
        self.graph = load_graph(graph_path)
        self.zones, self.pois = load_annotations(self.graph, demo_area_path)

    def to_geojson(self) -> dict[str, Any]:
        assert self.graph is not None, "GraphService.load() must run before use"
        return graph_to_geojson(self.graph)
