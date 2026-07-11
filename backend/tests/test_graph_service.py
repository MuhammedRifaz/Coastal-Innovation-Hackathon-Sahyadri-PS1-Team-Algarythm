from app.core.graph_service import REQUIRED_EDGE_ATTRS, GraphService


def test_load_graph_has_nodes_and_edges():
    service = GraphService()
    service.load()

    assert service.graph.number_of_nodes() > 0
    assert service.graph.number_of_edges() > 0


def test_all_edges_have_required_attributes():
    service = GraphService()
    service.load()

    for _u, _v, data in service.graph.edges(data=True):
        for attr in REQUIRED_EDGE_ATTRS:
            assert attr in data, f"edge missing '{attr}': {data.get('edge_id')}"


def test_zones_and_pois_snap_to_real_nodes():
    service = GraphService()
    service.load()

    node_ids = set(service.graph.nodes)
    assert len(service.zones) > 0
    assert len(service.pois) > 0
    for zone in service.zones:
        assert int(zone.centroid_node_id) in node_ids
    for poi in service.pois:
        assert int(poi.node_id) in node_ids


def test_some_edges_marked_critical():
    service = GraphService()
    service.load()

    critical_count = sum(1 for _u, _v, data in service.graph.edges(data=True) if data["critical"])
    assert 0 < critical_count < service.graph.number_of_edges()
