"""Tests for the temporary nearest-by-line fleet assignment (Prompt 6) and
mission reassessment on flood changes."""

import pytest

from app.core.graph_service import CRITICAL_BRIDGE_EDGE_IDS, GraphService


@pytest.fixture
def service() -> GraphService:
    svc = GraphService()
    svc.load()
    return svc


def test_four_vehicles_seeded_at_load(service: GraphService):
    assert len(service.vehicles) == 4
    assert {v.status for v in service.vehicles} == {"available"}
    node_ids = {v.node_id for v in service.vehicles}
    assert len(node_ids) == 4  # each at a distinct real node


def test_create_incident_assigns_vehicle_and_creates_mission(service: GraphService):
    snapshot = service.create_incident(lat=12.852, lng=74.841, severity=2)

    assert len(snapshot.incidents) == 1
    incident = snapshot.incidents[0]
    assert incident.status == "assigned"

    assert len(snapshot.missions) == 1
    mission = snapshot.missions[0]
    assert mission.incident_id == incident.id
    assert mission.route.reachable

    vehicle = next(v for v in service.vehicles if v.id == mission.vehicle_id)
    assert vehicle.status == "en_route"
    assert vehicle.mission_id == mission.id


def test_incident_with_no_available_vehicles_creates_no_mission(service: GraphService):
    for vehicle in service.vehicles:
        vehicle.status = "en_route"

    snapshot = service.create_incident(lat=12.852, lng=74.841, severity=1)

    assert len(snapshot.incidents) == 1
    assert snapshot.incidents[0].status == "open"
    assert len(snapshot.missions) == 0


def test_flooding_bridge_reroutes_mission_that_depends_on_it(service: GraphService):
    # Only the north-side vehicle is available, so a south-side incident
    # must be assigned across the river.
    for vehicle in service.vehicles:
        if vehicle.id != "vehicle-1":
            vehicle.status = "en_route"

    snapshot = service.create_incident(lat=12.815, lng=74.850, severity=3)
    mission = snapshot.missions[0]
    assert mission.status == "active"
    assert mission.route.reachable

    for edge_id in CRITICAL_BRIDGE_EDGE_IDS:
        service.apply_flood(edge_id, 60.0)

    updated = next(m for m in service.missions if m.id == mission.id)
    assert updated.status == "rerouted"
    assert not updated.route.reachable


def test_reassess_missions_marks_rerouted_on_20pct_eta_worsening():
    """Synthetic graph so the >20% ETA-worsening (but still reachable)
    branch is deterministic, independent of real-world alternates."""
    import networkx as nx
    from datetime import datetime, timezone

    from app.core.graph_service import GraphService
    from app.models import Incident, Mission, Vehicle
    from app.core.routing import compute_route

    def edge_attrs(base_time_s, length_m, flood_depth_cm=0.0):
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

    graph = nx.MultiDiGraph()
    for node in (1, 2):
        graph.add_node(node, x=74.9, y=12.9)
    graph.add_edge(1, 2, key=0, edge_id="e_1_2", **edge_attrs(100.0, 1000.0))

    service = GraphService()
    service.graph = graph
    service._edge_index = {"e_1_2": (1, 2, 0)}
    service.vehicles = [
        Vehicle(
            id="vehicle-1", callsign="Unit 1", kind="ambulance", node_id="1", lat=12.9, lng=74.9, status="en_route"
        )
    ]
    service.incidents = [
        Incident(
            id="incident-1",
            node_id="2",
            lat=12.9,
            lng=74.9,
            severity=1,
            status="assigned",
            created_at=datetime.now(timezone.utc),
        )
    ]
    baseline_route = compute_route(graph, 1, 2)
    service.missions = [
        Mission(
            id="mission-1",
            incident_id="incident-1",
            vehicle_id="vehicle-1",
            route=baseline_route,
            eta_s=baseline_route.eta_s,
            status="active",
        )
    ]

    # 25cm keeps the edge passable but multiplies cost well past the 20% threshold.
    service.apply_flood("e_1_2", 25.0)

    updated = service.missions[0]
    assert updated.status == "rerouted"
    assert updated.route.reachable
    assert updated.eta_s > baseline_route.eta_s * 1.2
