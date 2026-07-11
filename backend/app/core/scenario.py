"""Scripted demo scenario runner (Prompt 10).

Executes the timed step list in data/scenario_monsoon.json via asyncio:
incidents, floods, and clears fired at fixed offsets. Cancelable and
idempotent; scenario/reset restores the pristine graph and clears
incidents/missions/decisions.

No logic implemented yet.
"""
