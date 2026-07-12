"""Scripted demo scenario runner — Prompt 9."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
SCENARIO_PATH = REPO_ROOT / "data" / "scenario_monsoon.json"


class ScenarioRunner:
    def __init__(self, graph_service, ws_broadcast) -> None:
        self._gs = graph_service
        self._broadcast = ws_broadcast
        self._task: asyncio.Task | None = None
        self._scenario: dict = {}

    def _load(self) -> dict:
        if not self._scenario:
            with open(SCENARIO_PATH, encoding="utf-8") as f:
                self._scenario = json.load(f)
        return self._scenario

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.running:
            return
        scenario = self._load()
        self._task = asyncio.create_task(self._run(scenario["steps"]))

    def cancel(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def reset(self) -> None:
        self.cancel()
        await self._gs.reset_state()
        snapshot = self._gs.build_snapshot()
        await self._broadcast(snapshot)

    async def _run(self, steps: list[dict]) -> None:
        log.info("Scenario started — %d steps", len(steps))
        loop = asyncio.get_event_loop()
        t0 = loop.time()
        try:
            for step in steps:
                delay = (t0 + float(step["t_s"])) - loop.time()
                if delay > 0:
                    await asyncio.sleep(delay)
                log.info("Scenario [%ss] %s", step["t_s"], step.get("narrate", ""))
                snap = await self._dispatch(step["action"], step.get("params", {}))
                if snap:
                    await self._broadcast(snap)
        except asyncio.CancelledError:
            log.info("Scenario cancelled")
            raise
        except Exception:
            log.exception("Scenario step failed")
        log.info("Scenario finished")

    async def _dispatch(self, action: str, params: dict):
        gs = self._gs
        try:
            if action == "incident":
                return gs.create_incident(params["lat"], params["lng"], params["severity"])
            if action == "flood":
                eid = params["edge_id"]
                if eid.startswith("auto:"):
                    eid = self._pick_any_safe_edge()
                    if not eid:
                        return None
                return gs.apply_flood(eid, params.get("depth_cm", 45))
            if action == "flood_bridge":
                depth = params.get("depth_cm", 55)
                from app.core.graph_service import CRITICAL_BRIDGE_EDGE_IDS  # noqa: PLC0415
                snap = None
                for eid in CRITICAL_BRIDGE_EDGE_IDS:
                    try:
                        snap = gs.apply_flood(eid, depth)
                    except Exception:
                        pass
                return snap
            if action == "clear":
                return gs.clear_flood(params["edge_id"])
        except Exception as exc:
            log.warning("Scenario dispatch '%s' skipped: %s", action, exc)
        return None

    def _pick_any_safe_edge(self) -> str | None:
        for _u, _v, data in self._gs.graph.edges(data=True):
            eid = data.get("edge_id", "")
            if eid and data.get("status", "safe") == "safe" and not data.get("critical", False):
                return eid
        return None
