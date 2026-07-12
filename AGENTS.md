# ResQOS

Emergency Response Decision Engine for flood events.

Full spec, research, and the 15-prompt build book live in `resqos-master-plan (1).md`.

## Architecture rules
- `backend/app/core/` is pure logic — **no FastAPI imports, no I/O**. `backend/app/api/` and `backend/app/ws/` are thin adapters that call into `core/`, nothing more.
- All shared types live in exactly two places, kept in lockstep by hand: `backend/app/models.py` (Pydantic) and `frontend/src/lib/types.ts` (mirrored TS). Any field added/renamed in one must be reflected in the other in the same commit.
- REST is commands-only. One WebSocket, `/ws`, broadcasts full `StateSnapshot`s — it is the only channel that carries state.
- No database. All state lives in the in-memory NetworkX graph and process memory; nothing persists across a restart.
- No paid APIs. OSM (via osmnx) + MapLibre + free CARTO dark tiles only.

## Folder structure
```
resqos/
├── data/                      # demo_graph.graphml, demo_area.json, scenario_monsoon.json
├── scripts/fetch_graph.py     # one-time osmnx pull (run before hackathon day)
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app, lifespan graph load, WS manager
│   │   ├── models.py          # all Pydantic types (single source of truth)
│   │   ├── core/               # PURE LOGIC — no FastAPI imports
│   │   │   ├── graph_service.py   # load, annotate, mutate, snapshot
│   │   │   ├── routing.py         # composite-cost A*, RouteResult
│   │   │   ├── fleet.py           # assign, backup, reassess
│   │   │   ├── impact.py          # reachability diff, resilience, recommendation
│   │   │   ├── explain.py         # reasons builder
│   │   │   └── scenario.py        # timed script runner
│   │   ├── api/routes.py      # thin REST endpoints
│   │   └── ws/manager.py      # connections + broadcast
│   └── tests/                 # test_routing.py, test_impact.py, test_fleet.py
└── frontend/
    └── src/
        ├── store/useAppStore.ts        # Zustand mirror of snapshot
        ├── lib/{ws.ts, api.ts, types.ts}
        ├── map/{MapView.tsx, layers/*, useRouteAnimation.ts}
        └── components/{MissionPanel, ImpactAlert, DecisionLog,
                        LatencyBadge, ScenarioBar, WhatIfToggle, Header}.tsx
```

(Note: this structure lives at the repo root rather than under a nested `resqos/` directory — the repo itself is the `resqos` project.)

## Non-goals (frozen scope)
Auth, persistence/DB, real sensors, ML/prediction, citizen reporting, text triage, multi-city, mobile app, shelter capacity math, ambulance repositioning.

## Stack
Backend: Python 3.12, FastAPI, NetworkX + osmnx, pytest, in a `backend/venv` virtualenv (`pip install -r backend/requirements.txt`).
Frontend: Vite + React 18 + TypeScript strict + Tailwind v4 + Zustand + maplibre-gl + `motion` (import from `motion/react`).

## Running locally
```
# backend
cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --reload

# frontend
cd frontend && npm run dev
```

## Build order
Follow the 15-prompt build book in `resqos-master-plan (1).md` §15 (plus the §22 addendum, Prompt 7B for safe-zone mapping) in order. Each prompt assumes prior prompts are already implemented — don't regenerate earlier work. No business logic is implemented yet; only the scaffold from Prompt 1 exists so far.
