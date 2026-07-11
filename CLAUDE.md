# ResQOS — Emergency Response Decision Engine

Flood-aware routing + decision-support platform for the Coastal Innovation Hackathon (PS1). Full spec lives in `resqos-master-plan (1).md`.

## Architecture rules (do not violate)
- `backend/app/core/` is pure logic — no FastAPI imports, no I/O. Everything else (`api/`, `ws/`) is a thin adapter over it.
- Single source of truth for shared types: `backend/app/models.py` (Pydantic), mirrored by hand into `frontend/src/lib/types.ts`.
- REST = commands only (`POST /api/floods`, `/api/incidents`, `/api/whatif`, `/api/scenario/*`). WebSocket `/ws` = state only, pushing full `StateSnapshot`s.
- No database. No persistence. All state lives in the in-memory NetworkX graph + process memory.
- No paid map APIs, no ML/prediction. OSM (osmnx) + MapLibre + free CARTO dark tiles only.
- One road graph, five engines read/write it: routing, fleet, impact analysis, safe-zone mapping, explanation builder.

## Stack
- Backend: Python 3.12, FastAPI, NetworkX + osmnx, pytest.
- Frontend: Vite + React 18 + TypeScript (strict) + Tailwind + Zustand + maplibre-gl + framer-motion.

## Folder structure (target — not yet created)
```
resqos/
├── data/                      # demo_graph.graphml, demo_area.json, scenario_monsoon.json
├── scripts/fetch_graph.py
├── backend/app/{main.py, models.py, core/, api/, ws/}
└── frontend/src/{store/, lib/, map/, components/}
```

## Non-goals (frozen scope — do not implement)
Auth, persistence/DB, real sensors, ML/prediction, citizen reporting apps, text triage, multi-city, mobile app, shelter capacity math, ambulance repositioning.

## Build order
Follow the 15-prompt build book in `resqos-master-plan (1).md` §15 (plus the §22 addendum, Prompt 7B for safe-zone mapping) in order. Each prompt assumes prior prompts are already implemented — don't regenerate earlier work.
