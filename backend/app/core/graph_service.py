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

import math

import networkx as nx
import osmnx as ox

from app.core import fleet, impact, safezones
from app.core.routing import compute_route
from app.core.scenario import ScenarioRunner
from app.models import POI, Decision, ImpactReport, Incident, Mission, StateSnapshot, Vehicle, Zone

MAX_DECISION_LOG = 50

# Nethravathi river center — elevation baseline for simulation.
RIVER_CENTER_LAT = 12.835
RIVER_CENTER_LNG = 74.852
EARTH_RADIUS_M = 6371000.0


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _simulated_elevation(lat: float, lng: float) -> float:
    """Simulate elevation (metres) for Mangaluru–Ullal area.
    Nethravathi river bed ≈ 3 m; rises ~8 m per km away from the river,
    capped at 40 m.  Coastal northern reach stays a little lower."""
    dist_m = _haversine_m(lat, lng, RIVER_CENTER_LAT, RIVER_CENTER_LNG)
    base = 3.0 + (dist_m / 1000.0) * 8.0
    if lat > 12.87:
        base *= 0.75
    return min(max(base, 2.0), 40.0)

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

    # Tag each node with a simulated elevation first so edges can inherit it.
    for node, data in graph.nodes(data=True):
        data["elevation_m"] = _simulated_elevation(float(data["y"]), float(data["x"]))

    for u, v, k, data in graph.edges(keys=True, data=True):
        length_m = float(data.get("length", 0.0))
        travel_time = data.get("travel_time")
        base_time_s = (
            float(travel_time)
            if travel_time is not None
            else length_m / (DEFAULT_SPEED_KPH * 1000 / 3600)
        )
        u_elev = graph.nodes[u].get("elevation_m", 10.0)
        v_elev = graph.nodes[v].get("elevation_m", 10.0)
        elevation_m = (u_elev + v_elev) / 2.0
        # Safety score: lower elevation roads are more flood-vulnerable.
        # 3 m → score 55; 20 m → score 90; 40 m → score 100.
        safety_score = min(100, max(20, int(50 + elevation_m * 2.5)))
        data["edge_id"] = f"{u}_{v}_{k}"
        data["length_m"] = length_m
        data["base_time_s"] = base_time_s
        data["highway_class"] = _highway_class(data.get("highway"))
        data["flood_depth_cm"] = 0.0
        data["status"] = _edge_status(0.0)
        data["safety_score"] = safety_score
        data["elevation_m"] = round(elevation_m, 1)
        data["critical"] = False
        data["updated_at"] = now
        data["rainfall_flooded"] = False
        # Confidence in flood report (0-100%): 100% = confirmed by sensors,
        # 50% = citizen report, 0% = no data. Default to 100% (no uncertainty).
        data["confidence"] = 100
        # at_risk: True if this edge is predicted to flood soon based on
        # proximity to currently flooded edges (contagion model heuristic).
        data["at_risk"] = False

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
                    "elevation_m": data.get("elevation_m", 10.0),
                    "critical": data["critical"],
                    "updated_at": data["updated_at"],
                    "confidence": data.get("confidence", 100),
                    "at_risk": data.get("at_risk", False),
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


class IncidentNotFoundError(KeyError):
    """Raised by resolve_incident when incident_id doesn't exist."""


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


def _set_edge_flood(graph: nx.MultiDiGraph, u: Any, v: Any, k: Any, depth_cm: float, confidence: int = 100) -> None:
    data = graph[u][v][k]
    data["flood_depth_cm"] = float(depth_cm)
    data["status"] = _edge_status(depth_cm)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    data["confidence"] = confidence


def _update_flood_propagation(graph: nx.MultiDiGraph, propagation_radius_m: float = 50.0) -> set[str]:
    """Simple contagion model: mark edges adjacent to flooded edges as at_risk.
    Uses graph topology instead of distance for O(n) performance.
    Returns set of edge_ids that changed status."""
    # Get all currently flooded edge nodes
    flooded_nodes = set()
    for u, v, k, data in graph.edges(keys=True, data=True):
        if data.get("flood_depth_cm", 0) > 0:
            flooded_nodes.add(u)
            flooded_nodes.add(v)
    
    # Clear existing at_risk flags
    changed_edges = set()
    for u, v, k, data in graph.edges(keys=True, data=True):
        if data.get("at_risk", False):
            data["at_risk"] = False
            changed_edges.add(data["edge_id"])
    
    # Mark edges adjacent to flooded nodes as at_risk
    for node in flooded_nodes:
        # Check all edges connected to this node
        for u, v, k, data in graph.edges(node, keys=True, data=True):
            if data.get("flood_depth_cm", 0) > 0:
                continue  # Skip already flooded edges
            
            data["at_risk"] = True
            changed_edges.add(data["edge_id"])
    
    return changed_edges


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
        self._safe_zone_assignments: dict[str, safezones.SafeZoneAssignment] = {}
        self._seq = 0
        self._incident_seq = 0
        self._mission_seq = 0
        self._decision_seq = 0
        self.scenario = ScenarioRunner(self._apply_scenario_step)

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
        self._safe_zone_assignments = safezones.map_safe_zones(self.graph, self.zones, self.pois)

    def _apply_scenario_step(self, step: dict[str, Any]) -> None:
        action = step["action"]
        params = step.get("params", {})
        if action == "incident":
            self.create_incident(params["lat"], params["lng"], params["severity"])
        elif action == "flood":
            self.apply_flood(params["edge_id"], params["depth_cm"])
        elif action == "flood_clear":
            self.clear_flood(params["edge_id"])
        elif action == "rainfall":
            self.apply_rainfall(params["rainfall_mm"])

    def start_scenario(self) -> None:
        self.scenario.start()
        self._log_decision("assignment", "Monsoon Surge scenario started")
        snapshot = self.build_snapshot()
        self.event_bus.emit("graph_changed", snapshot)

    def reset(self, graph_path: Path = GRAPH_PATH, demo_area_path: Path = DEMO_AREA_PATH) -> StateSnapshot:
        """Stop any running scenario, reload the pristine graph (discarding
        all flood mutations), and clear incidents/missions/decisions."""
        self.scenario.stop()
        self.load(graph_path, demo_area_path)
        self.incidents = []
        self.missions = []
        self.decisions = []
        self.latest_impact = None
        self._seq = 0
        self._incident_seq = 0
        self._mission_seq = 0
        self._decision_seq = 0
        self._log_decision("assignment", "Scenario reset — pristine state restored")
        snapshot = self.build_snapshot()
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def _log_decision(
        self,
        kind: str,
        headline: str,
        reasons: list[str] | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        self._decision_seq += 1
        self.decisions.append(
            Decision(
                id=f"decision-{self._decision_seq}",
                ts=datetime.now(timezone.utc),
                kind=kind,  # type: ignore[arg-type]
                headline=headline[:90],
                reasons=reasons or [],
                data=data or {},
            )
        )
        if len(self.decisions) > MAX_DECISION_LOG:
            self.decisions = self.decisions[-MAX_DECISION_LOG:]

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
            latest_impact=self.latest_impact,
            safe_zone_map={k: v.model_dump() for k, v in self._safe_zone_assignments.items()},
            decisions=self.decisions[-MAX_DECISION_LOG:],
        )

    def _apply_flood_and_analyze(self, edge_id: str, depth_cm: float, confidence: int = 100, start: float | None = None) -> StateSnapshot:
        group = _edges_in_group(edge_id)
        group_locations = [self._lookup_edge(eid) for eid in group]
        old_statuses = [self.graph[u][v][k]["status"] for u, v, k in group_locations]
        old_depths = [self.graph[u][v][k]["flood_depth_cm"] for u, v, k in group_locations]

        for u, v, k in group_locations:
            _set_edge_flood(self.graph, u, v, k, depth_cm, confidence)
        new_statuses = [self.graph[u][v][k]["status"] for u, v, k in group_locations]
        new_depths = [self.graph[u][v][k]["flood_depth_cm"] for u, v, k in group_locations]

        # Note: Flood propagation prediction disabled in hot path for performance.
        # Can be triggered via separate API endpoint if needed.

        mission_etas_before = {m.id: m.eta_s for m in self.missions}
        reassessment_reasons = fleet.reassess_all(self.graph, self.missions, self.vehicles, self.incidents)
        for reason in reassessment_reasons:
            self._log_decision("reroute", reason, reasons=[reason])

        # Recompute safe zone assignments
        old_safe_assignments = self._safe_zone_assignments.copy()
        self._safe_zone_assignments = safezones.map_safe_zones(self.graph, self.zones, self.pois)
        safe_zone_reasons = safezones.detect_safe_zone_changes(
            old_safe_assignments, self._safe_zone_assignments, self.zones, self.pois
        )
        for reason in safe_zone_reasons:
            self._log_decision("safezone", "Safe zone mapping changed", reasons=[reason])

        # A group only actually changes the passable subgraph when it goes
        # from "not fully blocked" to "fully blocked" (or the reverse) —
        # for the bridge, that's the difference between one carriageway
        # still open and the whole crossing being severed.
        was_severed = all(status == "blocked" for status in old_statuses)
        is_severed = all(status == "blocked" for status in new_statuses)

        # Run impact analysis for any flood (not just when severed)
        # to provide warnings about potential infrastructure impact
        if any(depth > 0 for depth in new_depths):
            report = impact.analyze_impact(
                self.graph,
                edge_id,
                self.zones,
                self.pois,
                self.missions,
                self.vehicles,
                self._components_cache,
                mission_etas_before,
            )
            self._components_cache = impact.compute_components(self.graph)
            self.latest_impact = report
            if is_severed and not was_severed:
                # Critical alert: road fully blocked
                if report.isolated_zones:
                    headline = (
                        f"{edge_id} CLOSED — {len(report.isolated_zones)} zone(s), "
                        f"~{report.affected_population} residents affected"
                    )
                else:
                    headline = f"{edge_id} closed — no zone lost hospital access"
                self._log_decision("impact", headline, reasons=[report.recommendation], data={"closed_edge": edge_id})
            else:
                # Warning: road flooded but still passable
                headline = (
                    f"{edge_id} flooded ({max(new_depths):.0f}cm) — "
                    f"{'CRITICAL' if is_severed else 'WARNING'}: {report.recommendation[:100]}..."
                )
                self._log_decision("impact", headline, reasons=[report.recommendation], data={"closed_edge": edge_id})
        elif was_severed and not is_severed:
            self._components_cache = impact.compute_components(self.graph)
            self.latest_impact = None
            self._log_decision("impact", f"{edge_id} reopened — network reconnected")
        elif any(depth > 0 for depth in old_depths) and all(depth == 0 for depth in new_depths):
            # Flood cleared
            self._components_cache = impact.compute_components(self.graph)
            self.latest_impact = None

        return self.build_snapshot(started_at=start)

    def apply_flood(self, edge_id: str, depth_cm: float, confidence: int = 100) -> StateSnapshot:
        """Mutate the edge in place, reassess active missions and run
        impact analysis against the new graph, build one snapshot for the
        whole update cycle, and emit it on graph_changed so subscribers
        (the WS broadcaster) can push the exact same snapshot to clients."""
        start = time.perf_counter()
        snapshot = self._apply_flood_and_analyze(edge_id, depth_cm, confidence, start)
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
            self._components_cache,
            mission_etas_before,
        )

    def snap_to_node(self, lat: float, lng: float) -> Any:
        node = ox.distance.nearest_nodes(self.graph, X=lng, Y=lat)
        return node

    def create_incident(self, lat: float, lng: float, severity: int) -> StateSnapshot:
        """Snap to nearest node, create the Incident, assign the best
        available vehicle by true route cost (Prompt 8 — replaces the
        Prompt 6 straight-line-nearest logic), compute its route + a
        backup, and create the Mission — all in one update cycle."""
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

        vehicle, route, backup_vehicle, backup_route, reasons = fleet.assign(self.graph, node_id, self.vehicles)
        if vehicle is not None and route is not None:
            self._mission_seq += 1
            mission = Mission(
                id=f"mission-{self._mission_seq}",
                incident_id=incident.id,
                vehicle_id=vehicle.id,
                route=route,
                backup_route=backup_route,
                eta_s=route.eta_s,
                status="active",
                reasons=reasons,
            )
            self.missions.append(mission)
            vehicle.status = "en_route"
            vehicle.mission_id = mission.id
            incident.status = "assigned"
            headline = f"{vehicle.callsign} dispatched to incident {incident.id} — ETA {route.eta_s:.0f}s"
            if backup_vehicle is not None:
                headline += f" (backup: {backup_vehicle.callsign})"
            self._log_decision("assignment", headline, reasons=reasons)
        else:
            self._log_decision("assignment", f"Incident {incident.id} — no unit could be assigned", reasons=reasons)

        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def resolve_incident(self, incident_id: str) -> StateSnapshot:
        """Mark the incident resolved, free its vehicle, and complete its
        mission. Lets the operator clear a handled incident from the map
        instead of it sitting there forever."""
        start = time.perf_counter()
        incident = self._incident_by_id(incident_id)
        if incident is None:
            raise IncidentNotFoundError(incident_id)

        incident.status = "resolved"
        for mission in self.missions:
            if mission.incident_id != incident_id or mission.status == "complete":
                continue
            mission.status = "complete"
            vehicle = self._vehicle_by_id(mission.vehicle_id)
            if vehicle is not None:
                vehicle.status = "available"
                vehicle.mission_id = None

        self._log_decision("assignment", f"Incident {incident_id} resolved")
        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def apply_rainfall(self, rainfall_mm: float) -> StateSnapshot:
        """Flood edges proportional to rainfall intensity and local elevation.
        Low-lying roads (<10 m) flood first; at 200 mm almost everything
        below 25 m is under water. Clears previous rainfall-driven depths
        before re-applying so callers can drag a slider live."""
        assert self.graph is not None
        start = time.perf_counter()

        # Clear any previously rainfall-driven flood depths.
        for _u, _v, _k, data in self.graph.edges(keys=True, data=True):
            if data.get("rainfall_flooded"):
                data["flood_depth_cm"] = 0.0
                data["status"] = _edge_status(0.0)
                data["safety_score"] = min(100, max(20, int(50 + data.get("elevation_m", 10.0) * 2.5)))
                data["rainfall_flooded"] = False
                data["updated_at"] = datetime.now(timezone.utc).isoformat()

        flooded_count = 0
        if rainfall_mm > 10.0:
            for _u, _v, _k, data in self.graph.edges(keys=True, data=True):
                elev = data.get("elevation_m", 10.0)
                # vulnerability: 0.0 at ≥25 m, 1.0 at river level (2 m)
                vulnerability = max(0.0, (25.0 - elev) / 23.0)
                depth = min(60.0, (rainfall_mm - 10.0) * vulnerability * 0.35)
                if depth > 0.5:
                    data["flood_depth_cm"] = depth
                    data["status"] = _edge_status(depth)
                    # Safety score degrades under water
                    data["safety_score"] = max(5, min(100, int(50 + elev * 2.5) - int(depth * 1.2)))
                    data["rainfall_flooded"] = True
                    data["updated_at"] = datetime.now(timezone.utc).isoformat()
                    flooded_count += 1

        self._edge_index = _index_edges(self.graph)
        self._components_cache = impact.compute_components(self.graph)
        fleet.reassess_all(self.graph, self.missions, self.vehicles, self.incidents)
        self._log_decision(
            "impact",
            f"Rainfall {rainfall_mm:.0f} mm applied — {flooded_count} road segments flooded",
            reasons=[f"Low-elevation roads (< 25 m) affected; {flooded_count} edges now risky or blocked"],
        )
        snapshot = self.build_snapshot(started_at=start)
        self.event_bus.emit("graph_changed", snapshot)
        return snapshot

    def get_road_inspector(self, edge_id: str) -> dict[str, Any]:
        """Return full details for one edge: attributes, nearby zones/POIs,
        and a what-if preview of what closing it would cost."""
        assert self.graph is not None
        u, v, k = self._lookup_edge(edge_id)
        data = self.graph[u][v][k]

        u_node, v_node = self.graph.nodes[u], self.graph.nodes[v]
        edge_center_lat = (float(u_node["y"]) + float(v_node["y"])) / 2
        edge_center_lng = (float(u_node["x"]) + float(v_node["x"])) / 2

        nearby_zones = []
        for zone in self.zones:
            dist_m = _haversine_m(edge_center_lat, edge_center_lng, zone.lat, zone.lng)
            if dist_m < 2500:
                nearby_zones.append({
                    "id": zone.id, "name": zone.name,
                    "population": zone.population, "distance_m": round(dist_m),
                })
        nearby_zones.sort(key=lambda z: z["distance_m"])

        nearby_pois = []
        for poi in self.pois:
            dist_m = _haversine_m(edge_center_lat, edge_center_lng, poi.lat, poi.lng)
            if dist_m < 2500:
                nearby_pois.append({
                    "id": poi.id, "name": poi.name, "kind": poi.kind,
                    "distance_m": round(dist_m),
                })
        nearby_pois.sort(key=lambda p: p["distance_m"])

        # What-if: hypothetically close this edge and see the impact.
        try:
            whatif = self.whatif(edge_id)
            if_closed_zones = [z.name for z in whatif.isolated_zones]
            if_closed_pop = whatif.affected_population
            if_closed_recommendation = whatif.recommendation
        except Exception:
            if_closed_zones = []
            if_closed_pop = 0
            if_closed_recommendation = "Could not compute impact."

        return {
            "edge_id": edge_id,
            "highway_class": data["highway_class"],
            "length_m": round(data["length_m"], 1),
            "flood_depth_cm": round(data["flood_depth_cm"], 1),
            "status": data["status"],
            "safety_score": data["safety_score"],
            "elevation_m": round(data.get("elevation_m", 10.0), 1),
            "critical": data["critical"],
            "nearby_zones": nearby_zones[:5],
            "nearby_pois": nearby_pois[:5],
            "if_closed_zones": if_closed_zones,
            "if_closed_population": if_closed_pop,
            "if_closed_recommendation": if_closed_recommendation,
        }

    def compute_user_route(self, origin_lat: float, origin_lng: float,
                           dest_lat: float, dest_lng: float) -> dict[str, Any]:
        """Plan a safe route between two user-specified points."""
        assert self.graph is not None
        origin_node = self.snap_to_node(origin_lat, origin_lng)
        dest_node = self.snap_to_node(dest_lat, dest_lng)
        route = compute_route(self.graph, origin_node, dest_node)
        return route.model_dump(mode="json")

    def _vehicle_by_id(self, vehicle_id: str) -> Vehicle | None:
        return next((v for v in self.vehicles if v.id == vehicle_id), None)

    def _incident_by_id(self, incident_id: str) -> Incident | None:
        return next((i for i in self.incidents if i.id == incident_id), None)
