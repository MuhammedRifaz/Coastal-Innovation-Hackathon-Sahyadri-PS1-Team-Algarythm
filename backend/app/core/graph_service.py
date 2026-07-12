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

from app.core import fleet, impact
from app.models import POI, Decision, ImpactReport, Incident, Mission, StateSnapshot, Vehicle, Zone

# Maximum number of Decision entries kept in the snapshot.
MAX_DECISIONS = 50

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

# Flooding/clearing one edge in a group applies to the whole group as one
# atomic action. Without this, a single click on the bridge would only
# flood one of its 3 parallel carriageway segments and visibly do
# nothing — the demo needs "click the bridge, it's out" to be one click.
_EDGE_GROUPS: dict[str, tuple[str, ...]] = {eid: CRITICAL_BRIDGE_EDGE_IDS for eid in CRITICAL_BRIDGE_EDGE_IDS}


def _edges_in_group(edge_id: str) -> tuple[str, ...]:
    return _EDGE_GROUPS.get(edge_id, (edge_id,))


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
                # The zone's own curated lat/lng (a population center), not
                # the snapped road node's coordinates — centroid_node_id is
                # only a routing anchor and may sit slightly off the true
                # zone location.
                lat=raw_zone["lat"],
                lng=raw_zone["lng"],
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
        self.latest_impact: ImpactReport | None = None
        self.decisions: list[Decision] = []
        self._edge_index: dict[str, tuple[Any, Any, Any]] = {}
        self._node_coords: dict[Any, tuple[float, float]] = {}
        self._components_cache: dict[Any, int] = {}
        self._seq = 0
        self._incident_seq = 0
        self._mission_seq = 0
        self._decision_seq = 0

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
        self._components_cache = impact.compute_components(self.graph)

    def to_geojson(self) -> dict[str, Any]:
        assert self.graph is not None, "GraphService.load() must run before use"
        return graph_to_geojson(self.graph)

    def _lookup_edge(self, edge_id: str) -> tuple[Any, Any, Any]:
        try:
            return self._edge_index[edge_id]
        except KeyError:
            raise EdgeNotFoundError(edge_id) from None

    def _add_decision(
        self,
        kind: str,
        headline: str,
        reasons: list[str],
        data: dict[str, Any] | None = None,
    ) -> None:
        """Append a Decision to the ring buffer (capped at MAX_DECISIONS)."""
        self._decision_seq += 1
        from app.models import DecisionKind  # local to avoid circular at module level
        self.decisions.append(
            Decision(
                id=f"decision-{self._decision_seq}",
                ts=datetime.now(timezone.utc),
                kind=kind,  # type: ignore[arg-type]
                headline=headline,
                reasons=reasons,
                data=data or {},
            )
        )
        if len(self.decisions) > MAX_DECISIONS:
            self.decisions = self.decisions[-MAX_DECISIONS:]

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
            latest_impact=self.latest_impact,
            safe_zone_map={},
            decisions=list(self.decisions),
        )

    def _apply_flood_and_analyze(self, edge_id: str, depth_cm: float, start: float) -> StateSnapshot:
        group = _edges_in_group(edge_id)
        group_locations = [self._lookup_edge(eid) for eid in group]
        old_statuses = [self.graph[u][v][k]["status"] for u, v, k in group_locations]

        for u, v, k in group_locations:
            _set_edge_flood(self.graph, u, v, k, depth_cm)
        new_statuses = [self.graph[u][v][k]["status"] for u, v, k in group_locations]

        mission_etas_before = {m.id: m.eta_s for m in self.missions}
        self._reassess_missions()

        # A group only actually changes the passable subgraph when it goes
        # from "not fully blocked" to "fully blocked" (or the reverse) —
        # for the bridge, that's the difference between one carriageway
        # still open and the whole crossing being severed.
        was_severed = all(status == "blocked" for status in old_statuses)
        is_severed = all(status == "blocked" for status in new_statuses)

        if is_severed and not was_severed:
            report = impact.analyze_impact(
                self.graph,
                edge_id,
                self.zones,
                self.pois,
                self.missions,
                self.vehicles,
                self._node_coords,
                self._components_cache,
                mission_etas_before,
            )
            self._components_cache = impact.compute_components(self.graph)
            self.latest_impact = report
        elif was_severed and not is_severed:
            self._components_cache = impact.compute_components(self.graph)
            self.latest_impact = None

        return self.build_snapshot(started_at=start)

    def apply_flood(self, edge_id: str, depth_cm: float) -> StateSnapshot:
        """Mutate the edge in place, reassess active missions and run
        impact analysis against the new graph, build one snapshot for the
        whole update cycle, and emit it on graph_changed so subscribers
        (the WS broadcaster) can push the exact same snapshot to clients."""
        start = time.perf_counter()
        snapshot = self._apply_flood_and_analyze(edge_id, depth_cm, start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def clear_flood(self, edge_id: str) -> StateSnapshot:
        start = time.perf_counter()
        snapshot = self._apply_flood_and_analyze(edge_id, 0.0, start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def whatif(self, edge_id: str) -> ImpactReport:
        """Hypothetically block edge_id's whole linked group (e.g. all 3
        bridge carriageway segments) on a throwaway copy of the graph and
        analyze impact — the real graph and all state are untouched."""
        graph_copy = self.graph.copy()
        for eid in _edges_in_group(edge_id):
            u, v, k = self._lookup_edge(eid)
            # graph.copy() shares edge attribute dicts with the original —
            # a plain `graph_copy[u][v][k] = ...` can't fix that (edges[]
            # is a read-only AtlasView), so give only the edges we're
            # mutating their own dict by removing and re-adding them,
            # which is what actually decouples them from the original.
            attrs = dict(graph_copy.edges[u, v, k])
            graph_copy.remove_edge(u, v, key=k)
            graph_copy.add_edge(u, v, key=k, **attrs)
            _set_edge_flood(graph_copy, u, v, k, IMPASSABLE_CM + 20.0)

        # analyze_impact() updates each zone's reachable_hospitals in place
        # (desired for the real apply_flood path) — pass copies here so a
        # hypothetical what-if can't leak into real zone state.
        zone_copies = [z.model_copy() for z in self.zones]
        mission_etas_before = {m.id: m.eta_s for m in self.missions}
        return impact.analyze_impact(
            graph_copy,
            edge_id,
            zone_copies,
            self.pois,
            self.missions,
            self.vehicles,
            self._node_coords,
            self._components_cache,
            mission_etas_before,
        )

    def snap_to_node(self, lat: float, lng: float) -> Any:
        node = ox.distance.nearest_nodes(self.graph, X=lng, Y=lat)
        return node

    def create_incident(self, lat: float, lng: float, severity: int) -> StateSnapshot:
        """Snap to nearest node, create the Incident, run true route-cost
        fleet assignment (Prompt 8), compute primary + backup routes, create
        the Mission, and broadcast — all in one update cycle."""
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

        self._mission_seq += 1
        mission, reasons = fleet.assign(
            incident,
            self.graph,
            self.vehicles,
            self._node_coords,
            self._mission_seq,
        )
        if mission is not None:
            self.missions.append(mission)
            assigned_vehicle = next(v for v in self.vehicles if v.id == mission.vehicle_id)
            assigned_vehicle.status = "en_route"
            assigned_vehicle.mission_id = mission.id
            incident.status = "assigned"
            self._add_decision(
                kind="assignment",
                headline=(
                    f"{assigned_vehicle.callsign} dispatched to {incident.id} "
                    f"— ETA {mission.eta_s:.0f}s"
                )[:90],
                reasons=reasons,
                data={"mission_id": mission.id, "vehicle_id": assigned_vehicle.id},
            )
        else:
            self._add_decision(
                kind="assignment",
                headline=f"No unit available for {incident.id} — all routes blocked or no vehicles free",
                reasons=reasons,
                data={"incident_id": incident.id},
            )

        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def _vehicle_by_id(self, vehicle_id: str) -> Vehicle | None:
        return next((v for v in self.vehicles if v.id == vehicle_id), None)

    def _incident_by_id(self, incident_id: str) -> Incident | None:
        return next((i for i in self.incidents if i.id == incident_id), None)

    def _reassess_missions(self) -> None:
        """Prompt-8 fleet reassessment: recompute routes, reassign when
        current route is unreachable or a better unit now beats ETA >25%,
        and log every material decision."""
        reassess_decisions = fleet.reassess_all(
            self.graph,
            self.vehicles,
            self.missions,
            self.incidents,
            self._node_coords,
        )
        for rd in reassess_decisions:
            if rd.action == "reassigned":
                headline = (
                    f"{rd.new_vehicle_callsign} reassigned to mission {rd.mission_id} "
                    f"(replacing {rd.old_vehicle_callsign})"
                )[:90]
            elif rd.action == "rerouted":
                headline = f"Mission {rd.mission_id} rerouted ({rd.old_vehicle_callsign})"
            else:
                headline = f"Mission {rd.mission_id} unreachable — no route available"
            kind = "reroute" if rd.action in ("rerouted", "unreachable") else "assignment"
            self._add_decision(
                kind=kind,
                headline=headline[:90],
                reasons=rd.reasons,
                data={"mission_id": rd.mission_id},
            )

    def resolve_incident(self, incident_id: str) -> StateSnapshot:
        """Resolve an incident, free its vehicle, mark mission complete, and broadcast."""
        start = time.perf_counter()
        incident = self._incident_by_id(incident_id)
        if not incident:
            return self.build_snapshot(started_at=start)

        incident.status = "resolved"
        # Find the active/rerouted mission for this incident
        mission = next(
            (m for m in self.missions if m.incident_id == incident_id and m.status in ("active", "rerouted", "reassigned")),
            None
        )
        if mission:
            mission.status = "complete"
            vehicle = self._vehicle_by_id(mission.vehicle_id)
            if vehicle:
                vehicle.status = "available"
                vehicle.mission_id = None
            self._add_decision(
                kind="assignment",
                headline=f"Incident {incident_id} resolved — mission complete",
                reasons=[f"Incident {incident_id} marked as resolved.", f"Vehicle {vehicle.callsign if vehicle else 'unknown'} returned to available status."],
                data={"incident_id": incident_id, "mission_id": mission.id},
            )
        else:
            self._add_decision(
                kind="assignment",
                headline=f"Incident {incident_id} resolved",
                reasons=[f"Incident {incident_id} marked as resolved."],
                data={"incident_id": incident_id},
            )

        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    async def reset_state(self) -> None:
        """Reset the system back to the pristine state by reloading GraphML and annotations."""
        self.graph = load_graph(GRAPH_PATH)
        self.zones, self.pois = load_annotations(self.graph, DEMO_AREA_PATH)
        self._edge_index = _index_edges(self.graph)
        self.vehicles = fleet.seed_vehicles(self.zones, self._node_coords)
        self.incidents = []
        self.missions = []
        self.decisions = []
        self.latest_impact = None
        self._components_cache = impact.compute_components(self.graph)
        self._seq = 0
        self._incident_seq = 0
        self._mission_seq = 0
        self._decision_seq = 0
        self._add_decision(
            kind="assignment",
            headline="System state reset to pristine configuration",
            reasons=["All flooded segments cleared.", "All active incidents and missions terminated."],
        )

