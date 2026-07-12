import pytest
from app.core.graph_service import GraphService
from app.core.scenario import ScenarioRunner

@pytest.mark.anyio
async def test_resolve_incident():
    gs = GraphService()
    gs.load()
    
    # Create incident
    lat, lng = 12.863, 74.841
    snapshot = gs.create_incident(lat, lng, 2)
    assert len(snapshot.incidents) == 1
    assert len(snapshot.missions) == 1
    incident_id = snapshot.incidents[0].id
    
    # Resolve incident
    snapshot = gs.resolve_incident(incident_id)
    assert snapshot.incidents[0].status == "resolved"
    assert snapshot.missions[0].status == "complete"
    assert snapshot.vehicles[0].status == "available"
    assert snapshot.vehicles[0].mission_id is None

@pytest.mark.anyio
async def test_scenario_runner_reset():
    gs = GraphService()
    gs.load()
    
    async def mock_broadcast(snapshot):
        pass
        
    runner = ScenarioRunner(gs, mock_broadcast)
    
    # Create some incidents/floods to corrupt state
    gs.create_incident(12.863, 74.841, 2)
    gs.apply_flood(list(gs._edge_index.keys())[0], 45)
    
    # Verify non-pristine
    assert len(gs.incidents) > 0
    
    # Reset
    await runner.reset()
    
    # Verify pristine
    assert len(gs.incidents) == 0
    assert len(gs.missions) == 0
    assert len(gs.decisions) == 1
    assert gs.decisions[0].headline == "System state reset to pristine configuration"
