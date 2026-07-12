"""Tests for the Critical Road Impact Analyzer (Prompt 7)."""

import pytest

from app.core.graph_service import CRITICAL_BRIDGE_EDGE_IDS, GraphService


@pytest.fixture
def service() -> GraphService:
    svc = GraphService()
    svc.load()
    return svc


def test_flooding_the_bridge_isolates_zones_and_drops_resilience(service: GraphService):
    # A single edge_id is enough now: apply_flood floods the whole linked
    # group (all 3 carriageway segments) atomically, so one click on the
    # bridge severs it — no need to flood each segment separately.
    snapshot = service.apply_flood(CRITICAL_BRIDGE_EDGE_IDS[0], 60.0)

    report = snapshot.latest_impact
    assert report is not None
    assert len(report.isolated_zones) >= 1
    assert report.affected_population > 0
    assert report.resilience_after < report.resilience_before
    assert report.recommendation != ""


def test_whatif_reports_impact_without_mutating_real_state(service: GraphService):
    target_edge_id = CRITICAL_BRIDGE_EDGE_IDS[1]

    # whatif on one segment of the bridge hypothetically severs the whole
    # linked group, same as a real apply_flood would.
    report = service.whatif(target_edge_id)
    assert len(report.isolated_zones) >= 1

    # ...but none of it may have touched the real graph — including every
    # edge in the group, not just the one passed in.
    for edge_id in CRITICAL_BRIDGE_EDGE_IDS:
        u, v, k = service._lookup_edge(edge_id)
        assert service.graph[u][v][k]["status"] == "safe"
        assert service.graph[u][v][k]["flood_depth_cm"] == 0.0
    assert service.latest_impact is None


def test_whatif_does_not_mutate_real_zone_reachable_hospitals(service: GraphService):
    before = [z.reachable_hospitals for z in service.zones]

    service.whatif(CRITICAL_BRIDGE_EDGE_IDS[0])

    after = [z.reachable_hospitals for z in service.zones]
    assert before == after


def test_no_impact_analysis_for_non_blocking_flood(service: GraphService):
    edge_id = CRITICAL_BRIDGE_EDGE_IDS[0]
    snapshot = service.apply_flood(edge_id, 15.0)  # risky, not blocked

    assert snapshot.latest_impact is None


def test_clearing_a_flood_clears_the_alert(service: GraphService):
    service.apply_flood(CRITICAL_BRIDGE_EDGE_IDS[0], 60.0)
    assert service.latest_impact is not None

    snapshot = service.clear_flood(CRITICAL_BRIDGE_EDGE_IDS[0])

    assert snapshot.latest_impact is None
