"""Road graph loading, annotation, and mutation.

Loads the cached OSM GraphML into an in-memory NetworkX MultiDiGraph at
FastAPI startup, enriches every edge with the routing/flood attributes the
rest of core/ depends on, snaps POIs/zones from data/demo_area.json to
their nearest graph nodes, and precomputes approximate betweenness
centrality to flag critical edges. apply_flood/clear_flood mutate edge
state in place and emit a graph_changed event; GraphService.build_snapshot
assembles the full StateSnapshot broadcast over the WebSocket.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import networkx as nx
import osmnx as ox

from app.core import fleet
from app.core.routing import compute_route
from app.models import POI, Incident, Mission, StateSnapshot, Vehicle, Zone

# ETA degradation beyond which a flood forces a mission reroute, even if
# the new route is still technically reachable.
REROUTE_ETA_WORSENING_THRESHOLD = 1.2

REPO_ROOT = Path(__file__).resolve().parents[3]
GRAPH_PATH = REPO_ROOT / "data" / "demo_graph.graphml"
DEMO_AREA_PATH = REPO_ROOT / "data" / "demo_area.json"

IMPASSABLE_CM = 30.0
BETWEENNESS_SAMPLE_K = 200
CRITICAL_FRACTION = 0.03
DEFAULT_SPEED_KPH = 30.0

# The real NH66 Nethravathi Bridge crossing in the fetch_graph.py extract is
# represented as 3 separate directed edges (opposite-carriageway OSM ways).
# Flooding all 3 together is what actually disconnects the north (Mangaluru)
# and south (Ullal) sides — flooding just one still leaves the others as a
# passable parallel connection. Documented here for the scenario/impact-
# analyzer prompts; not used by flood/routing logic itself, which floods
# whatever edge_id it's told to.
CRITICAL_BRIDGE_EDGE_IDS = (
    "3610166954_11266540718_0",
    "11266540706_11266540687_0",
    "11266540707_5596107411_0",
)


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


class EdgeNotFoundError(KeyError):
    """Raised by apply_flood/clear_flood when edge_id doesn't exist."""


class EventBus:
    """Tiny synchronous pub/sub. emit() calls every subscriber immediately,
    in-process — no async, no queue, no external broker. Subscribers that
    need to do async work (like broadcasting over a WebSocket) are
    responsible for scheduling that themselves (e.g. asyncio.create_task)."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable[[Any], None]]] = {}

    def on(self, event: str, handler: Callable[[Any], None]) -> None:
        self._subscribers.setdefault(event, []).append(handler)

    def emit(self, event: str, payload: Any = None) -> None:
        for handler in self._subscribers.get(event, []):
            handler(payload)


def _index_edges(graph: nx.MultiDiGraph) -> dict[str, tuple[Any, Any, Any]]:
    return {data["edge_id"]: (u, v, k) for u, v, k, data in graph.edges(keys=True, data=True)}


def _set_edge_flood(graph: nx.MultiDiGraph, u: Any, v: Any, k: Any, depth_cm: float) -> None:
    data = graph[u][v][k]
    data["flood_depth_cm"] = float(depth_cm)
    data["status"] = _edge_status(depth_cm)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()


class GraphService:
    """Holds the process-lifetime graph + POIs/zones. One instance lives on
    app.state, constructed and loaded during the FastAPI lifespan."""

    def __init__(self) -> None:
        self.graph: nx.MultiDiGraph | None = None
        self.zones: list[Zone] = []
        self.pois: list[POI] = []
        self.vehicles: list[Vehicle] = []
        self.incidents: list[Incident] = []
        self.missions: list[Mission] = []
        self.event_bus = EventBus()
        self._edge_index: dict[str, tuple[Any, Any, Any]] = {}
        self._node_coords: dict[Any, tuple[float, float]] = {}
        self._seq = 0
        self._incident_seq = 0
        self._mission_seq = 0

    def load(
        self,
        graph_path: Path = GRAPH_PATH,
        demo_area_path: Path = DEMO_AREA_PATH,
    ) -> None:
        self.graph = load_graph(graph_path)
        self.zones, self.pois = load_annotations(self.graph, demo_area_path)
        self._edge_index = _index_edges(self.graph)
        self._node_coords = {
            node: (data["x"], data["y"]) for node, data in self.graph.nodes(data=True)
        }
        self.vehicles = fleet.seed_vehicles(self.zones, self._node_coords)

    def to_geojson(self) -> dict[str, Any]:
        assert self.graph is not None, "GraphService.load() must run before use"
        return graph_to_geojson(self.graph)

    def _lookup_edge(self, edge_id: str) -> tuple[Any, Any, Any]:
        try:
            return self._edge_index[edge_id]
        except KeyError:
            raise EdgeNotFoundError(edge_id) from None

    def build_snapshot(self, started_at: float | None = None) -> StateSnapshot:
        """Assemble the full StateSnapshot. `started_at` lets a caller that
        already mutated the graph (apply_flood/clear_flood) time the whole
        update cycle rather than just the snapshot assembly."""
        assert self.graph is not None, "GraphService.load() must run before use"
        start = started_at if started_at is not None else time.perf_counter()
        self._seq += 1
        edges_geojson = self.to_geojson()
        computed_in_ms = (time.perf_counter() - start) * 1000
        return StateSnapshot(
            seq=self._seq,
            ts=datetime.now(timezone.utc),
            computed_in_ms=computed_in_ms,
            edges_geojson=edges_geojson,
            vehicles=self.vehicles,
            incidents=self.incidents,
            missions=self.missions,
            pois=self.pois,
            zones=self.zones,
            latest_impact=None,
            safe_zone_map={},
            decisions=[],
        )

    def apply_flood(self, edge_id: str, depth_cm: float) -> StateSnapshot:
        """Mutate the edge in place, reassess active missions against the
        new graph, build one snapshot for the whole update cycle, and emit
        it on graph_changed so subscribers (the WS broadcaster) can push
        the exact same snapshot to clients."""
        start = time.perf_counter()
        u, v, k = self._lookup_edge(edge_id)
        _set_edge_flood(self.graph, u, v, k, depth_cm)
        self._reassess_missions()
        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def clear_flood(self, edge_id: str) -> StateSnapshot:
        start = time.perf_counter()
        u, v, k = self._lookup_edge(edge_id)
        _set_edge_flood(self.graph, u, v, k, 0.0)
        self._reassess_missions()
        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def snap_to_node(self, lat: float, lng: float) -> Any:
        node = ox.distance.nearest_nodes(self.graph, X=lng, Y=lat)
        return node

    def create_incident(self, lat: float, lng: float, severity: int) -> StateSnapshot:
        """Snap to nearest node, create the Incident, assign the nearest
        available vehicle by straight-line distance (temporary until
        Prompt 8's true route-cost assignment), compute its route, and
        create the Mission — all in one update cycle."""
        start = time.perf_counter()

        node_id = self.snap_to_node(lat, lng)
        # Use the snapped node's own coordinates (not the raw click point)
        # so the marker lines up exactly with the mission route's endpoint.
        node_lng, node_lat = self._node_coords[node_id]
        self._incident_seq += 1
        incident = Incident(
            id=f"incident-{self._incident_seq}",
            node_id=str(node_id),
            lat=node_lat,
            lng=node_lng,
            severity=severity,
            status="open",
            created_at=datetime.now(timezone.utc),
        )
        self.incidents.append(incident)

        vehicle = fleet.assign_nearest(self.vehicles, (lng, lat), self._node_coords)
        if vehicle is not None:
            route = compute_route(self.graph, int(vehicle.node_id), node_id)
            self._mission_seq += 1
            mission = Mission(
                id=f"mission-{self._mission_seq}",
                incident_id=incident.id,
                vehicle_id=vehicle.id,
                route=route,
                eta_s=route.eta_s,
                status="active",
            )
            self.missions.append(mission)
            vehicle.status = "en_route"
            vehicle.mission_id = mission.id
            incident.status = "assigned"

        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def _vehicle_by_id(self, vehicle_id: str) -> Vehicle | None:
        return next((v for v in self.vehicles if v.id == vehicle_id), None)

    def _incident_by_id(self, incident_id: str) -> Incident | None:
        return next((i for i in self.incidents if i.id == incident_id), None)

    def _reassess_missions(self) -> None:
        """Recompute the route for every active/rerouted mission. If it
        becomes unreachable or its ETA worsens by more than the threshold,
        update the mission's route and mark it rerouted."""
        for mission in self.missions:
            if mission.status not in ("active", "rerouted"):
                continue
            vehicle = self._vehicle_by_id(mission.vehicle_id)
            incident = self._incident_by_id(mission.incident_id)
            if vehicle is None or incident is None:
                continue

            new_route = compute_route(self.graph, int(vehicle.node_id), int(incident.node_id))
            old_eta = mission.eta_s
            worsened = not new_route.reachable or (
                old_eta > 0 and new_route.eta_s > old_eta * REROUTE_ETA_WORSENING_THRESHOLD
            )
            if worsened:
                mission.route = new_route
                mission.eta_s = new_route.eta_s
                mission.status = "rerouted"
