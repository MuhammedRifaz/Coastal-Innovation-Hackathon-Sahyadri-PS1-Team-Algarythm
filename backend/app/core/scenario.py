"""Scenario runner for timed flood/incident sequences.

Reads data/scenario_monsoon.json ({"steps": [{t_s, action, params}]}),
executes each step at its absolute t_s offset from scenario start, and
delegates the actual mutation to the apply_step callback (graph_service).
Idempotent-cancelable: start() cancels any prior run first.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

SCENARIO_PATH = Path(__file__).resolve().parents[3] / "data" / "scenario_monsoon.json"


class ScenarioRunner:
    def __init__(self, apply_step: Callable[[dict], None]) -> None:
        self.apply_step = apply_step
        self._task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        """(Re)start the Monsoon Surge scenario from t=0."""
        self.stop()
        self._task = asyncio.create_task(self._run_scenario())

    def stop(self) -> None:
        """Cancel any running scenario."""
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def _run_scenario(self) -> None:
        try:
            with open(SCENARIO_PATH, encoding="utf-8") as f:
                steps = json.load(f)["steps"]
        except (FileNotFoundError, json.JSONDecodeError, KeyError) as exc:
            logger.error("scenario file unreadable: %s", exc)
            return

        # t_s values are absolute offsets from scenario start — sleep the
        # delta between consecutive steps, not the raw value.
        elapsed = 0.0
        for step in steps:
            delay = float(step.get("t_s", 0)) - elapsed
            if delay > 0:
                await asyncio.sleep(delay)
                elapsed += delay
            try:
                self.apply_step(step)
            except Exception:
                # One bad step must not kill the rest of the story.
                logger.exception("scenario step failed: %r", step)
