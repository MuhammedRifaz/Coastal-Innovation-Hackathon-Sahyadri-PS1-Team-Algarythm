
# CONTEXT.md

# ResQOS – Comprehensive Project Context

> This document is intended for autonomous coding agents (Antigravity, Claude Code, Cursor, etc.).
> Read this file before making changes. It represents the current state of the project, architectural decisions, completed work, known issues, constraints, and the intended roadmap.

---

# 1. Project Overview

**Project Name:** ResQOS

**Purpose**

ResQOS is an Emergency Response Decision Engine for flood disasters. Unlike a consumer navigation app, it is designed for emergency operations centers to support responders with dynamic routing, road impact analysis, evacuation planning, and decision explainability.

Core capabilities:
- Flood-aware routing
- Dynamic road state updates
- Safe evacuation routes
- Emergency fleet dispatch
- Critical road impact analysis
- Explainable routing decisions
- Live operational dashboard

The project was originally developed for the Coastal Innovation Hackathon (Problem Statement 1).

---

# 2. Technology Stack

## Backend

- Python 3.12
- FastAPI
- NetworkX
- OSMnx
- Pydantic
- pytest

## Frontend

- React 18
- TypeScript (strict)
- Vite
- Tailwind CSS
- Zustand
- MapLibre GL
- Motion

---

# 3. Architecture Principles

The backend is intentionally layered.

app/core
- Pure algorithms.
- No FastAPI imports.
- No HTTP.
- No WebSocket.
- No persistence.

app/api
- Thin REST adapters.
- Validation only.
- Calls into core.

app/ws
- Thin websocket broadcaster.
- Broadcasts state snapshots.

State is entirely in memory.

There is intentionally:
- No database
- No Redis
- No authentication
- No cloud dependency
- No paid APIs
- No ML inference

---

# 4. Communication Model

REST
- Used only for commands and queries.

WebSocket
- Single `/ws`
- Broadcasts complete state snapshots.
- UI derives everything from snapshots.

---

# 5. Current Data

Location:
- Mangaluru
- NH66 / Netravati bridge region

Road graph:
- ~446 nodes
- ~1072 edges

Data files:
- data/demo_graph.graphml
- data/demo_area.json

Every zone and POI is snapped to its nearest graph node during startup.

---

# 6. Edge Attributes

Every graph edge contains:
- edge_id
- length_m
- base_time_s
- flood_depth_cm
- status
- safety_score
- critical
- updated_at

Future attributes should extend rather than replace this schema.

---

# 7. Completed Milestones

## Prompt 1
- Monorepo scaffold
- Backend skeleton
- Frontend skeleton
- CLAUDE.md
- README
- Verified FastAPI startup
- Verified React startup

## Prompt 2
Implemented:
- OSM download script
- Graph loader
- Startup initialization
- Graph enrichment
- POI snapping
- Zone snapping
- Critical-edge detection
- GET /api/graph

Verified:
- Startup ≈2.5 seconds
- Tests passing

## Prompt 3
Implemented:
- Flood-aware edge cost
- A* routing
- ETA
- Route geometry
- Risk score
- Avoided-edge reporting
- Timing metrics

Verified:
- All routing tests pass
- <100ms routing

---

# 8. Routing Rules

Flood depth:
- <30cm = traversable
- >=30cm = impassable

Routing considers:
- Travel time
- Flood penalty
- Critical-road multiplier

Uses A* with admissible heuristic.

---

# 9. Known Issue

Flooding the real NH66 bridge does not currently force rerouting.

Likely causes:
- Zone placement
- Alternate crossing
- OSM extract topology

The routing algorithm itself is believed correct.

Investigate before implementing the Critical Road Impact Analyzer.

---

# 10. Testing Status

Passing:
- Graph loading
- Graph enrichment
- API
- Routing
- Startup
- Performance

---

# 11. Performance Goals

Startup <10 seconds

Routing <100ms

Everything remains in memory.

---

# 12. Development Constraints

Never introduce:
- Database
- Authentication
- Paid APIs
- ML models

Do not move business logic outside app/core.

Avoid unnecessary abstractions.

---

# 13. Remaining Roadmap

Prompt 4
- Flood update engine
- WebSocket broadcasting

Prompt 5
- Interactive MapLibre UI

Prompt 6
- Fleet assignment

Prompt 7
- Critical Road Impact Analyzer

Prompt 8+
- Scenario simulation
- Explainability engine
- Dashboard polish

---

# 14. Repository

GitHub:
https://github.com/MuhammedRifaz/Coastal-Innovation-Hackathon-Sahyadri-PS1-Team-Algarythm

Branch:
main

---

# 15. Guidance for Autonomous Agents

Before modifying code:
1. Read this file.
2. Preserve architecture.
3. Extend existing modules.
4. Keep algorithms deterministic.
5. Add tests with new functionality.
6. Do not rewrite working systems unless fixing a proven bug.
7. Prioritize correctness over cleverness.



