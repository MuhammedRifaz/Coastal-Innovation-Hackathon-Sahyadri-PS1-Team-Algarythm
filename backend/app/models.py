"""Shared Pydantic types — single source of truth for the backend contract.

Mirrored by hand into frontend/src/lib/types.ts. Do not let the two drift:
any field added/renamed here must be reflected there in the same commit.

Types to define here (see resqos-master-plan.md §10): Edge attrs, POI, Zone,
Vehicle, Incident, Mission, RouteResult, ImpactReport, Decision, StateSnapshot.
Left empty until the relevant build prompt implements it.
"""
