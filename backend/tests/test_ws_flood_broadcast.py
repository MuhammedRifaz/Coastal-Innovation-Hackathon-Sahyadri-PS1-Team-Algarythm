"""End-to-end test of the flood -> snapshot -> WS broadcast cycle.

Runs a real uvicorn server in a background thread (not the ASGI
TestClient) so the WebSocket connections and the HTTP POST are genuinely
concurrent over the loopback network, matching how the frontend actually
talks to this API.
"""

import asyncio
import json
import threading
import time

import httpx
import pytest
import uvicorn
import websockets

from app.core.graph_service import CRITICAL_BRIDGE_EDGE_IDS
from app.main import app

HOST = "127.0.0.1"
PORT = 8765


@pytest.fixture(scope="module")
def live_server():
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            httpx.get(f"http://{HOST}:{PORT}/health", timeout=0.2)
            break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        raise RuntimeError("server did not start in time")

    yield

    server.should_exit = True
    thread.join(timeout=5)


def test_both_ws_clients_receive_snapshot_after_flood_post(live_server):
    async def scenario():
        # max_size=None: the full-snapshot payload (every edge's GeoJSON
        # properties) currently exceeds the client's default 1MB cap.
        # Prompt 14 switches broadcasts to delta snapshots; until then,
        # the test client just needs to accept the larger frame.
        async with (
            websockets.connect(f"ws://{HOST}:{PORT}/ws", max_size=None) as ws1,
            websockets.connect(f"ws://{HOST}:{PORT}/ws", max_size=None) as ws2,
        ):
            # Each client gets a full snapshot immediately on connect; drain those first.
            await asyncio.wait_for(ws1.recv(), timeout=2)
            await asyncio.wait_for(ws2.recv(), timeout=2)

            edge_id = CRITICAL_BRIDGE_EDGE_IDS[0]
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"http://{HOST}:{PORT}/api/floods",
                    json={"edge_id": edge_id, "depth_cm": 45.0},
                )
            assert response.status_code == 200
            posted_seq = response.json()["snapshot_seq"]

            msg1 = json.loads(await asyncio.wait_for(ws1.recv(), timeout=2))
            msg2 = json.loads(await asyncio.wait_for(ws2.recv(), timeout=2))
            return posted_seq, msg1, msg2

    posted_seq, msg1, msg2 = asyncio.run(scenario())

    assert msg1["seq"] == posted_seq
    assert msg2["seq"] == posted_seq
    assert msg1["computed_in_ms"] < 200
    assert msg2["computed_in_ms"] < 200
