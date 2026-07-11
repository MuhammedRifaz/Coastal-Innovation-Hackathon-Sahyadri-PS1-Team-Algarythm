# ResQOS — Emergency Response Decision Engine
## Master Design Document, Final PRD & Claude Code Build Guide

**Hackathon:** Coastal Innovation Hackathon · Problem #1: Flood-Aware Evacuation Routing
**Build window:** 24 hours · **Build tool:** Claude Code · **Version:** Final (Frozen Scope)

---

# 1. Executive Summary

**The problem.** During extreme monsoon events, roads flood faster than any map updates. Standard navigation stacks (Google, OSRM, GraphHopper, ArcGIS Network Analyst) treat the road network as a *static* graph: flood conditions must be manually painted on, closures are binary (open/closed), updates require reprocessing, and no system explains *what a closure means operationally*. Emergency responders are routed onto submerged roads, and dispatch commanders are left guessing which vehicle to send and why.

**Why current solutions fail** (from the research report):
1. **Static graph assumption** — CH-preprocessed engines (OSRM/GraphHopper) can't absorb live closures without hours of recomputation; ArcGIS requires batch reruns.
2. **Binary road state** — real floods have depth gradients (5 cm ≠ 60 cm); vehicles have different tolerances.
3. **No infrastructure semantics** — no engine knows that "edge 4711 is the only bridge to Hospital H2 and 3 villages."
4. **No explainability** — outputs are polylines, not decisions.
5. **No fleet layer** — "nearest by straight line" dispatch ignores network reality under flooding.

**What we build.** ResQOS is *not* another navigation app. It is an **Emergency Response Decision Support Platform** with five capabilities layered on one in-memory dynamic road graph:

1. **Dynamic Road Intelligence** — every edge carries live flood depth, safety score, and status; updates apply in-place, no rebuild.
2. **Risk-Aware Routing** — optimizes *safest reachable path* (composite cost), not shortest path.
3. **Fleet Assignment** — recommends the best vehicle per incident by true route cost, with backup.
4. **Critical Road Impact Analyzer (WOW)** — when a road floods, the system instantly answers *"what did the city just lose?"*: isolated zones, unreachable hospitals, affected missions, added delay.
5. **Explainable Decision Engine** — every recommendation ships with a plain-language "why."

**Why it wins.** It hits the exact research gaps the literature confirms are unsolved (dynamic graph state, graded risk, infrastructure context, explainability, fleet optimization), it maps 1:1 onto every judging criterion, it is fully buildable in 24 h with Claude Code using only free/open components (FastAPI + NetworkX + OSM + React + MapLibre), and the demo tells a story judges remember: *"Other teams reroute. We tell commanders what the flood means, who should respond, and why."*

---

# 2. Research Analysis

## 2.1 Existing solutions and their limitations

| System | Approach | Limitation for our problem |
|---|---|---|
| ArcGIS Network Analyst | Static network dataset, batch closest-facility queries | Heavy preprocessing; flood inputs manual; full rerun per event; not sub-second |
| OpenRouteService (disaster branch) | CH graph + flood polygons as avoid-areas | Binary avoidance; re-runs full query per change; no incremental state; depends on OSM refresh cadence |
| OSRM / GraphHopper | Contraction Hierarchies for millisecond queries | CH cannot absorb arbitrary live closures; "time-dependent restrictions… not considered in any freely available software" (TARDUR) |
| Sahana Eden / Ushahidi / HOT | Data collection & visualization | No routing engine at all; provide map data, not decisions |
| Academic prototypes (D*/LPA*, contagion models, adaptive evacuation) | Incremental shortest paths, flood spread prediction | Never integrated into an operational system; too complex for 24 h at city scale |

## 2.2 Research gaps → opportunities (ranked)

Scoring: Innovation (I), Feasibility in 24 h (F), Implementation effort (E, lower = better), Demo impact (D), Judging impact (J). Each /5.

| # | Opportunity | I | F | E | D | J | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Impact Analysis Module** ("what does this closure mean?") | 5 | 4 | 3 | 5 | 5 | **BUILD — the WOW** |
| 2 | **Safety-weighted composite routing cost** | 4 | 5 | 1 | 4 | 5 | **BUILD — core** |
| 3 | **Event-driven in-place graph updates** | 4 | 5 | 2 | 4 | 5 | **BUILD — core** |
| 4 | **Explainability layer** | 4 | 5 | 2 | 5 | 5 | **BUILD — core** |
| 5 | **Fleet assignment by true route cost** | 4 | 4 | 3 | 4 | 5 | **BUILD — core** |
| 6 | Confidence-aware routing (uncertainty per report) | 4 | 3 | 3 | 2 | 3 | Cut — hard to demo convincingly |
| 7 | Flood propagation prediction (contagion) | 5 | 2 | 4 | 3 | 3 | Cut — defensibility risk without hydro data; mention as future work |
| 8 | Multi-vehicle coverage repositioning | 3 | 2 | 4 | 2 | 3 | Cut — OR complexity, invisible in a 3-min demo |
| 9 | Full knowledge-graph / digital-twin ontology | 5 | 1 | 5 | 2 | 3 | Cut — abstract; we keep a lightweight "context annotation" version instead |
| 10 | Incremental A*/D* Lite algorithms | 4 | 2 | 5 | 1 | 2 | Cut — full Dijkstra on a small graph is already <50 ms; incremental machinery is invisible and risky |

**Key pragmatic insight from the research:** on a demo-sized graph (a few km², ~2–10 k nodes), plain Dijkstra/A* recomputes in tens of milliseconds. The sub-second constraint is trivially met **if** we keep the graph in memory and update edge weights in place. So we spend zero time on exotic incremental algorithms and *all* saved time on the layers that actually differentiate: impact analysis, explainability, fleet logic, and a polished EOC-grade UI.

---

# 3. MVP Comparison

| Dimension | MVP v1 (FloodPath PRD) | MVP v2 (ResQOS vision) | Combined verdict |
|---|---|---|---|
| Framing | Routing engine with a fleet add-on | Decision-support platform | **Take v2 framing** — it is the winning narrative |
| Core routing | Dijkstra/A*, flood = edge weight | Composite safest-path cost | **Merge**: v1's concrete graph plan + v2's composite cost |
| Graph & data plan | Concrete (osmnx extract, in-memory NetworkX, WebSocket) | Vague on data | **Take v1** — it is the buildable skeleton |
| Fleet | FR-5: route-cost nearest vehicle | Best vehicle + ETA + backup route + reassignment | **Take v2's richer output**, v1's simple algorithm |
| WOW feature | None (latency stopwatch is table stakes) | Critical Road Impact Analyzer | **Take v2** |
| Explainability | Absent | Explicit engine | **Take v2** — research says this is where demos win |
| Latency instrumentation | On-screen stopwatch, minutes-saved comparison | Implicit | **Take v1** — judges love a live number |
| Scope discipline | Good non-goals list | "Build ONLY this" freeze | **Take both**: v1's non-goals + v2's freeze |
| Risks | Demo-network fallback, cached tiles, backup video | Not covered | **Take v1's risk plan** |
| Weaknesses | Sells itself as "a better router" — commodity narrative; no impact/explainability | No data plan, no schedule, no API design, hand-wavy on how | Fixed in the final design below |
| Unnecessary complexity | FR-7 text triage (cut) | Shelter activation recommendations (simplify to display-only shelters) | Both trimmed |

**Combined architecture (only score-increasing pieces kept):**

```
osmnx OSM extract (one-time, cached)         static context annotations
            │                                 (hospitals, shelters, zones)
            ▼                                          │
   In-memory Dynamic Road Graph  ◄─── flood updates (UI clicks / scenario script)
            │
   ┌────────┼──────────────┬───────────────────┐
   ▼        ▼              ▼                   ▼
Risk-Aware  Fleet      Impact Analyzer    Explanation
Routing     Assignment (WOW)              Builder
   └────────┴──────────────┴───────────────────┘
            │  single WebSocket state push
            ▼
   React + MapLibre EOC Dashboard
```

---

# 4. Final MVP (Frozen Scope)

Build **exactly** these six modules. Anything else is cut.

1. **Dynamic Road Graph Engine** — OSM extract of a bounded coastal-city area loaded once into NetworkX; every edge carries `{length_m, base_time_s, flood_depth_cm, safety_score, status, updated_at}`. Flood updates mutate edges in place and emit an event. No restarts, no rebuilds.
2. **Risk-Aware Routing Engine** — A* over composite cost `time × flood_multiplier(depth) × critical_penalty`; edges above the impassable threshold (30 cm default) get infinite cost. Returns route, ETA, risk score, and the list of avoided flooded edges (feeds explanations).
3. **Fleet Assignment Engine** — for each open incident, evaluates every available vehicle by *true route cost*, recommends best + backup, auto-reassigns when a flood invalidates an active mission. Must include one scripted scenario where route-aware choice ≠ straight-line-nearest choice (a judged success metric).
4. **Critical Road Impact Analyzer (WOW)** — see §5–6.
5. **Explainable Decision Engine** — every routing/assignment/impact output is paired with structured reasons rendered as plain language ("Ambulance A rejected — its only approach crosses Bridge R17, now at 45 cm. Ambulance B selected — ETA 6 min better, risk −42%.").
6. **Dynamic Safe-Zone Mapping** *(explicitly required by the problem statement's expected outcome)* — safe zones (shelters, high-ground assembly points, stroke-ready hospitals) are live nodes. As roads flood, the system continuously recomputes, for every populated zone, its **nearest currently-reachable safe zone** and the safe evacuation route to it. When a safe zone becomes cut off, it greys out and the affected population is re-mapped to the next-best reachable one — the evacuation-facing mirror of the responder-facing routing. This is what makes ResQOS serve civilians and vulnerable groups, not just dispatchers.
7. **Emergency Operations Dashboard** — dark, map-first EOC screen: live road status overlay, vehicles, incidents, safe-zone reachability halos, mission panel, decision-log feed, resilience gauge, latency badge, and one big "Simulate Monsoon Surge" scenario button for the demo.

**Explicit non-goals (frozen):** auth, persistence/DB, real sensors, ML/prediction, citizen reporting, text triage, multi-city, mobile app, shelter *capacity* math, ambulance repositioning. Each is one line in the pitch's "future work," zero lines of code. (Note: safe-zone *reachability* is IN scope; safe-zone *capacity/occupancy* is out.)

---

# 5. WOW Feature Analysis

Ten candidates evaluated against the constraints (no ML training, no paid APIs, ≤30 s to demo, instantly understandable, buildable in Claude Code):

| # | Candidate | Buildable in ~2–3 h? | Demo ≤30 s? | Instantly clear? | Differentiating? | Score /20 |
|---|---|---|---|---|---|---|
| 1 | **Critical Road Impact Analyzer** | Yes (BFS reachability diff) | Yes | Yes — "4 villages isolated" | Very — graph theory judges respect, hard to bolt on last-minute | **19** |
| 2 | Ghost-route comparison (naive GPS route drawn dying into the flood next to ours) | Yes | Yes | Yes | Medium — visual trick, not new capability | 15 |
| 3 | Live flood-spread simulation (contagion animation) | Risky | Yes | Yes | High novelty but scientifically challengeable | 13 |
| 4 | Confidence-weighted routing | Yes | No — invisible | No | Weak on screen | 9 |
| 5 | Vehicle-type depth tolerance (truck passes, ambulance doesn't) | Yes | Yes | Yes | Medium | 14 |
| 6 | Auto mission reassignment mid-route | Yes | Yes | Yes | Medium — feels expected | 14 |
| 7 | Isochrone "reachability halo" around hospitals shrinking live | Medium | Yes | Yes | High but compute-heavy per frame | 13 |
| 8 | Commander "what-if" mode (hypothetically close a road before it floods) | Yes (reuses #1) | Yes | Yes | High | 16 |
| 9 | Plain-language incident radio log (auto-generated SITREP) | Yes | Yes | Yes | Medium — cosmetic without #1 | 12 |
| 10 | Betweenness-centrality "critical roads" pre-highlighting | Yes (precomputed) | Yes | Medium | Medium alone; strong as garnish | 12 |

# 6. Final WOW Feature: Critical Road Impact Analyzer

**What happens:** a judge clicks any road → sets it flooded → within one second a Critical Infrastructure Alert slides in:

```
⚠ CRITICAL INFRASTRUCTURE ALERT — NH-66 River Crossing
• 2 zones (est. 3,400 residents) now unreachable
• Hospital City General: cut off from the northern sector
• 2 active missions rerouted (+7 min), 1 mission reassigned to Unit 3
• Network resilience: 91% → 74%
RECOMMENDED: Dispatch Unit 3 via Alternate Route C
```

**How it works (all cheap graph theory):**
- On startup: precompute betweenness centrality (roads on many shortest paths get `critical=true`, drawn thicker on the map — free foreshadowing for the demo).
- On closure: BFS/connected-components from each POI (hospitals, shelters, zone centroids) on the passable subgraph; diff against the pre-closure snapshot → isolated zones, unreachable POIs.
- Re-evaluate active missions against the new graph → delay deltas and reassignments.
- Resilience score = fraction of zone→nearest-hospital pairs still connected, weighted by population.
- Bonus (reuses the same code path): **What-If mode** — commander hypothetically closes a road, sees the impact, nothing is committed.

**Why it beats the other nine:** #2, #6, #9, #10 are garnishes we get almost for free *because* of #1 (the ghost route, the reassignment, the log entries, the pre-highlighted critical roads all fall out of the same event). #3 and #4 are scientifically attackable in Q&A. #5 and #7 are nice but don't change the narrative. #1 is the only feature that upgrades the product category itself — from "router" to "decision support" — which is precisely the top-ranked research gap ("no system semantically interprets flood + graph + resources") and precisely the sentence we want judges repeating.

---

# 7. Complete PRD

## 7.1 Vision
Give flood-emergency commanders a single screen that understands the city: what just flooded, what that means, who should respond, and why.

## 7.2 Problem Statement
Monsoon flash-flooding invalidates road networks in minutes. Existing navigation tools use static graphs, binary closures, and opaque outputs, so responders get routed into water and commanders dispatch blind. The problem statement demands: real-time flood-aware routing, <1 s recalculation, in-memory processing, rescue fleet optimization, and no paid map APIs.

## 7.3 Goals
- G1: Visible reroute around a newly flooded segment in <1 s, with the latency shown on screen.
- G2: Fleet recommendation by true route cost that demonstrably differs from straight-line-nearest in ≥1 scenario.
- G3: Impact analysis (isolated zones, unreachable hospitals, mission deltas) within 1 s of any closure.
- G4: Every decision explained in plain language in the decision log.
- G5: 100% open/free stack; routing works with zero internet (tiles cached).

## 7.4 Non-Goals
Auth · persistence · real sensors · ML/prediction · citizen apps · triage ethics · multi-city · mobile native · shelter capacity math · vehicle repositioning.

## 7.5 Personas
- **Commander (primary):** owns the dashboard; needs situational awareness + recommendations + reasons.
- **Dispatcher:** confirms assignments; needs ETA/backup route clarity.
- **Judge (demo persona):** needs to interact (click a road) and see cause→effect in seconds.

## 7.6 User Stories (all demo-critical)
- US-1: As a commander, when a road floods, I see the map recolor and every affected mission reroute in under a second.
- US-2: As a commander, when I add an incident, the system recommends the best unit, ETA, route, and backup — with reasons.
- US-3: As a commander, when a bridge floods, I immediately see which zones/hospitals are cut off and what to do about it.
- US-4: As a commander, I can ask "what if this road goes?" without committing the closure.
- US-5: As a judge, I can click "Simulate Monsoon Surge" and watch the whole system react step by step.

## 7.7 Functional Requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-1 | Load bounded OSM extract into in-memory graph at startup | ≤10 s startup from cached GraphML; zero network calls during routing |
| FR-2 | Edge flood state mutable at runtime (depth cm, 0–100) | PATCH applies in <10 ms; event emitted; no restart |
| FR-3 | Risk-aware A* with composite cost + impassable threshold | Route never crosses depth ≥ threshold; returns ETA, risk, avoided edges |
| FR-4 | Recompute all affected active routes on any edge change | Server compute + WS push + client render < 1000 ms, timed and displayed |
| FR-5 | Fleet assignment: best unit + backup per incident, by route cost | Scenario exists where choice ≠ straight-line nearest; reassignment on invalidation |
| FR-6 | Impact analysis on closure: isolated zones, unreachable POIs, mission deltas, resilience score | Alert rendered < 1 s after closure |
| FR-7 | Explanations: structured reasons on every route/assignment/impact | Decision log entry for 100% of decisions |
| FR-8 | Incident CRUD (click-to-place), vehicle status display | Session-scoped, no persistence |
| FR-9 | Scenario engine: one scripted "Monsoon Surge" (timed sequence of floods/incidents) | One click runs the full 3-min demo storyline |
| FR-10 | What-If mode (dry-run closure) | Impact shown, graph untouched, one-click revert |
| FR-11 | **Dynamic safe-zone mapping**: per-zone nearest reachable safe zone + evacuation route, recomputed on every change | Safe zone cut off → affected population re-mapped to next-best reachable safe zone < 1 s; unreachable safe zones greyed out |

## 7.8 Non-Functional Requirements
- Latency: edge update → client render < 1 s (target < 300 ms); route compute < 100 ms on demo graph.
- Reliability: routing fully offline; tiles cached; scripted scenario deterministic; backup video recorded.
- Data: OSM via osmnx, cached as GraphML in repo; CARTO dark tiles (free) with local fallback.
- Type safety: Pydantic models end-to-end on backend; TypeScript strict on frontend; shared JSON contracts.
- Graph scale: 2–10 k nodes. Architecture note for judges: swap NetworkX for igraph/graph-tool + partition workers to scale city-wide; design unchanged.

## 7.9 Success Metrics (demo-verifiable)
1. On-screen latency badge < 1000 ms on every reroute (target: double-digit ms).
2. 0% of any rendered route crosses an impassable edge.
3. Minutes-saved readout vs naive shortest path (e.g. "avoided 2 flooded segments, +2 min vs +∞/rescue failure").
4. ≥1 assignment where route-aware ≠ nearest-by-distance, called out in the log.
5. Impact alert with concrete numbers (zones, people, hospitals) < 1 s after closure.

## 7.10 Risks
| Risk | Mitigation |
|---|---|
| Venue WiFi dies | All routing offline; cached tiles; recorded backup video at hour 22 |
| OSM extract too big/slow | Pre-fetch once, commit GraphML to repo; never fetch at demo |
| Live-click demo fumbles | Scenario engine replays a deterministic script; manual clicking is the encore |
| Fleet/impact overruns schedule | Build order is routing → impact → fleet; fleet degrades gracefully to "nearest by route cost" without backup logic |
| WebSocket flakiness | Client auto-reconnect + full-state snapshot on connect (idempotent render) |

## 7.11 Demo Script (3 minutes)
1. (0:00) Dark EOC screen, city graph, critical roads pre-highlighted thicker. "This is Mangaluru's road network as a living graph."
2. (0:20) Click "Simulate Monsoon Surge." Incident appears → system assigns Unit 2, route draws, log explains why.
3. (0:50) Scenario floods the river bridge. **Boom:** route bends in <1 s (latency badge flashes 43 ms), impact alert slides in — "2 zones isolated, City General cut off, Unit 2's mission reassigned to Unit 3." Log narrates every decision.
4. (1:40) Invite the judge: "Flood any road you like." They click; impact analysis answers instantly. Show What-If on a second road.
5. (2:30) Closing line: *"Most teams built a flood navigation app. ResQOS understands what a road closure means, recommends the rescue strategy, and explains every decision — in real time, on open data, with no paid APIs."*

## 7.12 Future Scope (pitch only)
Real gauge/satellite feeds (Copernicus EMS) · flood-propagation forecasting · confidence-weighted reports · vehicle-type depth tolerances · multi-city sharding · dispatch-system integration.

---

# 8. Technology Stack

| Layer | Choice | Why | Alternatives / tradeoffs | Difficulty | Claude Code fit | Est. time |
|---|---|---|---|---|---|---|
| Backend | **Python 3.12 + FastAPI** | Async WebSockets native; Pydantic type safety; the whole graph ecosystem is Python | Node/Express: fine, but you'd hand-roll graph code osmnx gives free | Low | Excellent — Claude Code is strongest in FastAPI patterns | 0.5 h scaffold |
| Graph | **NetworkX + osmnx** | One line to pull real OSM roads into a mutable in-memory graph; Dijkstra/A*/betweenness built-in | igraph (faster, worse ergonomics), custom adjacency (needless) | Low | Excellent | 1 h |
| Realtime | **Native FastAPI WebSocket, single `/ws` channel, full-state snapshots** | Snapshot-on-every-event = idempotent client, no diff bugs, trivially debuggable | Socket.IO (extra dep), SSE (one-way, fine but WS reads better in pitch) | Low | Excellent | 1 h |
| Frontend | **React 18 + TypeScript + Vite** | Fast HMR; TS catches contract drift against Pydantic models | Svelte (fewer Claude Code reference patterns) | Low | Excellent | 0.5 h scaffold |
| Map | **MapLibre GL JS + CARTO dark-matter tiles (free)** + GeoJSON layers | GPU vector rendering = smooth route animations; dark basemap gives the EOC look for free | Leaflet: simpler but raster-clunky animations. Fallback: if MapLibre fights us by hour 12, Leaflet + dark tiles drops in — GeoJSON contracts identical | Medium | Good (well-documented API) | 2 h |
| State | **Zustand** | One store mirroring the WS snapshot; zero boilerplate | Redux (overkill), Context (re-render pain) | Low | Excellent | 0.5 h |
| Styling | **Tailwind CSS** | Rapid dark-theme design system; consistent tokens | CSS modules (slower) | Low | Excellent | — |
| Anim | **Framer Motion** (panels) + MapLibre line animation (routes) | Micro-interactions judges notice | CSS-only (flatter) | Low | Good | 1 h |
| Testing | **pytest** (engines) + manual E2E script | Test the algorithms, not the pixels | Playwright (not worth 24 h budget) | Low | Excellent | 1 h |

**Deliberately excluded:** databases (in-memory only, per problem statement), Docker (nothing to orchestrate), auth, Redis, Celery, any ML library, any paid API.

---

# 9. System Architecture

```
                        backend/ (FastAPI, single process)
┌─────────────────────────────────────────────────────────────────┐
│  startup: load GraphML ─► GraphService (NetworkX MultiDiGraph)  │
│           annotate POIs/zones ─► precompute betweenness         │
│                                                                 │
│  REST (commands)                 core/ (pure, no I/O)           │
│   POST /api/floods  ──────►  flood_service.apply()              │
│   POST /api/incidents          │  mutates edge attrs            │
│   POST /api/whatif             ▼                                │
│   POST /api/scenario/start   EventBus.emit("graph_changed")     │
│                                │                                │
│              ┌─────────────────┼──────────────────┐             │
│              ▼                 ▼                  ▼             │
│        routing.py         impact.py          fleet.py          │
│        (A* composite)     (reachability      (assign/          │
│              │             diff, resilience)  reassign)        │
│              └────────┬────────┴───────┬──────────┘            │
│                       ▼                ▼                        │
│                 explain.py ──► StateSnapshot (Pydantic)         │
│                                        │                        │
│                            WS /ws  ◄───┘  broadcast snapshot    │
└─────────────────────────────────────────────────────────────────┘
                                         │ JSON snapshot (~50 KB)
                        frontend/        ▼
┌─────────────────────────────────────────────────────────────────┐
│  ws client ─► Zustand store ─► MapLibre layers (roads, routes,  │
│               │                 vehicles, incidents, POIs)      │
│               └─► panels: MissionPanel, ImpactAlert,            │
│                   DecisionLog, LatencyBadge, ScenarioBar        │
└─────────────────────────────────────────────────────────────────┘
```

**Real-time flow (the money path):** UI click → `POST /api/floods {edge_id, depth_cm}` → edge mutated in place → event bus → affected routes recomputed + impact diff + fleet re-eval + explanations → one snapshot broadcast → client re-renders declaratively. Server stamps `computed_in_ms` into the snapshot; the latency badge displays it.

**Design rules:** `core/` is pure functions on the graph (unit-testable, no FastAPI imports); `api/` is thin adapters; snapshot is the single contract; client never computes routing logic. That's Clean Architecture + SOLID in exactly as much ceremony as 24 h deserves.

---

# 10. Database Design (In-Memory State Model)

No database — deliberately (problem statement: in-memory, zero pipelines). These are the Pydantic/TS shared types:

```python
Edge attrs (on graph):  edge_id, length_m, base_time_s, highway_class,
                        flood_depth_cm: float = 0, status: Safe|Risky|Blocked,
                        safety_score: int (0-100), critical: bool, updated_at

POI:        id, kind: hospital|shelter, name, node_id, lat, lng
Zone:       id, name, centroid_node_id, population: int, reachable_hospitals: list[str]
Vehicle:    id, callsign, kind: ambulance|rescue_truck, node_id, status: available|en_route,
            mission_id: str | None
Incident:   id, node_id, severity: 1-3, status: open|assigned|resolved, created_at
Mission:    id, incident_id, vehicle_id, route: RouteResult, backup_route: RouteResult | None,
            eta_s, status: active|rerouted|reassigned|complete
RouteResult: node_path, geometry: LineString, distance_m, eta_s, risk_score,
             avoided_edges: list[str], computed_in_ms
ImpactReport: closed_edge, isolated_zones: list[Zone], affected_population,
              unreachable_pois, affected_missions: list[{mission_id, delta_eta_s, action}],
              resilience_before, resilience_after, recommendation: str
Decision:   id, ts, kind: assignment|reroute|impact|whatif, headline, reasons: list[str], data
StateSnapshot: seq, ts, computed_in_ms, edges_geojson_delta | full, vehicles, incidents,
               missions, pois, zones, latest_impact, decisions[-50:]
```

Zones and POIs ship as a hand-curated `demo_area.json` (6–8 zones with plausible populations, 2 hospitals, 2 shelters) — 30 minutes of curation that powers the entire WOW feature.

---

# 11. API Design

REST = commands, WebSocket = state. Nothing else.

```
GET  /api/graph            → full roads GeoJSON + POIs + zones (initial load)
POST /api/floods           {edge_id, depth_cm}            → 200 {snapshot_seq}
POST /api/floods/clear     {edge_id}                      → clears flooding
POST /api/incidents        {lat, lng, severity}           → creates + triggers assignment
POST /api/incidents/{id}/resolve
POST /api/whatif           {edge_id}                      → ImpactReport (graph untouched)
POST /api/scenario/start   {name: "monsoon_surge"}        → runs timed script server-side
POST /api/scenario/reset   → restore pristine state
WS   /ws                   → StateSnapshot on connect + on every change
```

Composite cost function (the heart, ~15 lines):

```python
def edge_cost(e):
    if e.flood_depth_cm >= IMPASSABLE_CM: return math.inf          # 30 cm default
    mult = 1 + (e.flood_depth_cm / IMPASSABLE_CM) * RISK_ALPHA     # graded, not binary
    if e.critical and e.flood_depth_cm > 0: mult *= CRITICAL_BETA  # avoid fragile lifelines
    return e.base_time_s * mult
```

---

# 12. Folder Structure

```
resqos/
├── data/                      # committed: demo_graph.graphml, demo_area.json, scenario_monsoon.json
├── scripts/fetch_graph.py     # one-time osmnx pull (run before hackathon day)
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app, lifespan graph load, WS manager
│   │   ├── models.py          # all Pydantic types (single source of truth)
│   │   ├── core/              # PURE LOGIC — no FastAPI imports
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

---

# 13. UI/UX Specification

**Concept:** a real Emergency Operations Center console — calm, dark, authoritative. Map is 100% of the viewport; everything else floats.

- **Theme tokens:** bg `#0B0F14`; panel `rgba(17,24,32,0.88)` with backdrop-blur; text `#E6EDF3`; accents — safe `#22C55E`, risky `#F59E0B`, blocked `#EF4444`, route `#38BDF8`, backup route dashed `#38BDF8/50`, alert `#F87171`. Font: Inter; mono (JetBrains Mono) for numbers/callsigns.
- **Layout:** full-bleed MapLibre dark basemap. Top-left: compact header (RESQOS wordmark, clock, network resilience gauge). Right: 360 px stack — ImpactAlert (slides in, auto-prioritized), MissionPanel (cards: unit, incident, ETA, risk, "why" expander). Bottom: DecisionLog ticker (newest left, mono timestamps). Bottom-center: ScenarioBar (▶ Simulate Monsoon Surge · Reset · What-If toggle). Top-right: LatencyBadge ("routing 43 ms" — pulses green on each recompute).
- **Map layers:** roads colored by status, critical roads +1.5 px width; flooded edges get an animated dash ("water shimmer"); route polylines animate with a line-gradient draw-on (600 ms); vehicles as directional chevrons that glide (lerp) between route points; incidents as pulsing red rings; hospitals/shelters as glyph badges; isolated zones fill with red hatch when the analyzer fires.
- **Interactions:** click road → mini popover (depth slider 0–60 cm, Flood/Clear, What-If); click map → new incident; hover mission card → its route highlights, others dim to 30%; everything else read-only.
- **Micro-interactions:** ImpactAlert slides + subtle red edge-glow; numbers count up; log entries fade-slide in; reroute = old route dissolves while new one draws. Nothing bounces. Nothing is cute. EOC, not dashboard-template.
- **Readability rules:** max 3 font sizes, max 2 accents visible per panel, no chart junk, no fake KPIs.

---

# 14. Implementation Roadmap

| Module | Hrs | Purpose | Key files | Done when | Depends on |
|---|---|---|---|---|---|
| M0 Pre-hackathon prep | (before) | Fetch + commit GraphML, curate demo_area.json, scaffold repos | scripts/, data/ | Graph loads locally in <10 s | — |
| M1 Backend skeleton + graph | 0–2 | FastAPI app, lifespan load, models.py, GET /api/graph | main.py, graph_service.py, models.py | GeoJSON of real roads returned | M0 |
| M2 Routing engine | 2–4 | Composite-cost A*, RouteResult, unit tests | routing.py, test_routing.py | Route avoids a flooded edge in tests; <100 ms | M1 |
| M3 Flood updates + WS | 4–6 | POST /floods, event bus, snapshot broadcast, latency stamping | api/routes.py, ws/manager.py, flood parts of graph_service | Two browser tabs both see a flood applied by curl | M2 |
| M4 Frontend shell + map | 6–9 | Vite+TS+Tailwind, Zustand, MapLibre dark map, road layer colored by status | store/, MapView, layers | Live map recolors when curl floods an edge | M3 |
| M5 Incidents, vehicles, routes on map | 9–11 | Click-to-incident, vehicle markers, animated route polylines, LatencyBadge | components/, layers/ | Full loop: click incident → route draws; flood it → reroute <1 s visibly | M4 |
| M6 Impact Analyzer (WOW) | 11–14 | Reachability diff, resilience score, recommendation, ImpactAlert UI, What-If | impact.py, ImpactAlert.tsx, test_impact.py | Flooding the bridge isolates zones + fires the alert <1 s | M5 |
| M7 Fleet engine | 14–16 | Best+backup assignment, reassignment on invalidation, the "differs from naive" scenario | fleet.py, MissionPanel, test_fleet.py | Scripted case picks the non-obvious unit and says why | M6 |
| M8 Explanations + DecisionLog | 16–17.5 | Reasons on every decision, log ticker | explain.py, DecisionLog.tsx | 100% of decisions logged in plain language | M7 |
| M9 Scenario engine | 17.5–19 | monsoon_surge script + ScenarioBar + reset | scenario.py, ScenarioBar.tsx | One click replays the full 3-min story deterministically | M8 |
| M10 Polish + animations | 19–21 | Route draw-on, vehicle glide, shimmer, panel motion, empty states | useRouteAnimation, CSS | Demo looks EOC-grade at a glance | M9 |
| M11 Test + harden | 21–22.5 | pytest green, rapid-click fuzzing, WS reconnect, reset soak test | tests/ | 10 consecutive clean scenario runs | M10 |
| M12 Demo prep | 22.5–24 | Record backup video, rehearse script, README, pitch numbers | — | Backup video exists; pitch rehearsed twice | M11 |

**Degradation ladder if behind:** cut backup-routes (M7) → cut What-If (M6) → cut vehicle glide (M10). Never cut: reroute <1 s, impact alert, explanations, scenario button.

---

# 15. Claude Code Prompt Book — "ResQOS Build Guide"

Rules for using this book: run prompts **in order**; commit after each one passes its check; every prompt starts by telling Claude Code what already exists so it never regenerates prior work. Keep a `CLAUDE.md` in the repo root (Prompt 1 creates it) — it is the persistent contract.

---

**Prompt 1 — Initialize project & CLAUDE.md**
> Create a monorepo `resqos/` with `backend/` (Python 3.12, FastAPI, uv or pip, pytest) and `frontend/` (Vite + React 18 + TypeScript strict + Tailwind + Zustand + maplibre-gl + framer-motion). Also create `CLAUDE.md` at the root containing: project one-liner ("Emergency Response Decision Engine for flood events"), the architecture rules — backend `app/core/` is pure logic with no FastAPI imports; `app/api/` and `app/ws/` are thin adapters; all shared types live in `backend/app/models.py` (Pydantic) and `frontend/src/lib/types.ts` (mirrored TS); REST is commands-only, one WebSocket `/ws` broadcasts full `StateSnapshot`s; no database, all state in memory; no paid APIs. Add the folder structure exactly as follows: [paste §12]. Create empty placeholder modules with docstrings, a root README, and verify both apps start (`uvicorn`, `npm run dev`). Do not implement logic yet.

**Prompt 2 — Data prep + backend graph service**
> Backend only. Implement `scripts/fetch_graph.py`: use osmnx to download the drivable road network for bounding box [INSERT ~3×3 km coastal-city bbox], simplify it, save to `data/demo_graph.graphml`. Then implement `app/core/graph_service.py`: load the GraphML at FastAPI lifespan startup into a NetworkX MultiDiGraph; ensure every edge has `edge_id` (stable string), `length_m`, `base_time_s` (from length + highway-class speed), `flood_depth_cm=0.0`, `status="safe"`, `safety_score=100`, `critical=False`, `updated_at`. Load `data/demo_area.json` (I will provide; schema: zones with centroid coords + population, POIs with kind/name/coords) and snap each to nearest node. Precompute approximate edge betweenness (sample k=200 nodes) and mark the top 3% edges `critical=True`. Expose `GET /api/graph` returning roads as GeoJSON FeatureCollection (with all edge attrs) plus POIs and zones. Add `models.py` Pydantic types from this spec: [paste §10]. Startup must complete in under 10 seconds. Write a pytest that loads the graph and asserts node/edge counts > 0 and all edges have the attributes.

**Prompt 3 — Risk-aware routing engine**
> Backend only; do not modify graph_service loading. Implement `app/core/routing.py`: `edge_cost(attrs)` exactly per this spec [paste cost function §11 with IMPASSABLE_CM=30, RISK_ALPHA=2.0, CRITICAL_BETA=1.3]; `compute_route(graph, origin_node, dest_node) -> RouteResult` using NetworkX `astar_path` with a straight-line/max-speed admissible heuristic; populate geometry (LineString of node coords), distance_m, eta_s, risk_score (mean edge safety deficit along path), avoided_edges (flooded edges adjacent to the path corridor that the route skirted), computed_in_ms via perf_counter. Handle NetworkXNoPath by returning an `unreachable` RouteResult. Write pytests: (a) route between two fixed nodes succeeds; (b) flooding the best-path edge to 40 cm produces a different path that excludes it; (c) 25 cm produces a penalized-but-allowed edge behavior; (d) compute time < 100 ms.

**Prompt 4 — Flood update engine + WebSocket state**
> Backend only; routing.py and graph_service.py exist — extend, don't rewrite. Implement: `apply_flood(edge_id, depth_cm)` and `clear_flood(edge_id)` in graph_service (mutate attrs in place, set status safe/risky/blocked at 0/1–29/≥30 cm, stamp updated_at); a tiny synchronous EventBus (`emit("graph_changed", payload)`); `app/ws/manager.py` with connect/disconnect/broadcast; `build_snapshot()` producing `StateSnapshot` per models.py including `computed_in_ms` for the whole update cycle and a monotonically increasing `seq`; REST endpoints `POST /api/floods`, `POST /api/floods/clear`. On any graph change: rebuild snapshot, broadcast to all WS clients. WS sends full snapshot on connect. Test with two `websockets` clients in pytest: both receive the snapshot after a flood POST, and `computed_in_ms < 200`.

**Prompt 5 — Frontend shell, store, live map**
> Frontend only; backend contract is `GET /api/graph` + WS `/ws` full snapshots per `types.ts` — mirror models.py exactly into `src/lib/types.ts` first. Implement: `lib/ws.ts` (auto-reconnect, on message → `useAppStore.setState`), `lib/api.ts` (typed fetch helpers), `store/useAppStore.ts` (holds snapshot slices), `map/MapView.tsx` using maplibre-gl with the CARTO dark-matter style, full-viewport. Add a `roads` GeoJSON source + line layer colored by status (safe #22C55E at 30% opacity, risky #F59E0B, blocked #EF4444), width +1.5 px when `critical`. Flooded (risky/blocked) edges additionally render an animated dashed overlay line. On snapshot updates, `setData` the source — no layer re-creation. Dark theme tokens in Tailwind config per this spec: [paste theme tokens §13]. Done when: I run the backend, POST a flood via curl, and the road recolors live without reload.

**Prompt 6 — Incidents, vehicles, missions on the map**
> Both ends; keep all existing contracts. Backend: `POST /api/incidents {lat,lng,severity}` snaps to nearest node, creates Incident, and (temporary until Prompt 8) assigns the nearest available vehicle by straight line, computes its route via routing.py, creates a Mission, broadcasts. Seed 4 vehicles at fixed nodes on startup. On any flood change, recompute routes for active missions; if a mission's route becomes unreachable or its ETA worsens >20%, mark it `rerouted` with the new route. Frontend: click on map → POST incident; render incidents (pulsing red ring), vehicles (chevron icons, color by status), mission routes (animated draw-on polyline #38BDF8, 600 ms, using a line-progress animation hook `useRouteAnimation`), and a `LatencyBadge` top-right showing snapshot `computed_in_ms`, pulsing green on change. Done when: click → route draws; flood an edge on that route → route visibly redraws in under a second with the badge updating.

**Prompt 7 — WOW feature: Critical Road Impact Analyzer + What-If**
> Backend `app/core/impact.py` + frontend `ImpactAlert.tsx`. Backend: maintain a baseline reachability table (for each zone centroid and each POI node: connected-component membership on the passable subgraph, i.e., edges with depth < 30 cm; recompute lazily per graph change using `nx.node_connected_component` on an undirected passable view — cache and only recompute when a blocked-status transition occurs). `analyze_impact(closed_edge_id) -> ImpactReport`: diff reachability before/after → isolated zones (+ summed population), POIs newly unreachable from each zone, affected active missions (delta ETA or reassignment action), resilience score = population-weighted fraction of zones that can reach ≥1 hospital, and a one-line recommendation (best available unit + route for the worst-affected zone/incident). Wire it so any transition to `blocked` triggers analysis and attaches `latest_impact` to the snapshot. Add `POST /api/whatif {edge_id}`: run the same analysis on a copied graph view, return the report, mutate nothing. Frontend: `ImpactAlert` panel slides in from the right (framer-motion) with red edge glow: closed road name, isolated zones + population (count-up animation), unreachable hospitals, mission actions, resilience before→after, recommendation. Isolated zones get a red hatched fill layer on the map. What-If toggle: when on, clicking a road calls /whatif and shows the alert with a "HYPOTHETICAL" tag and a dismiss that changes nothing. Pytest: blocking the known bridge edge in demo data isolates ≥1 zone and drops resilience.

**Prompt 8 — Fleet Assignment Engine**
> Backend `app/core/fleet.py`, replacing the temporary nearest-by-line logic from Prompt 6 — keep endpoint contracts identical. `assign(incident) -> Mission`: compute true route cost from every available vehicle; pick best; also compute backup = second-best vehicle's route (store as `backup_route`); build `reasons[]` including any rejected closer-by-distance vehicle and why (e.g., "Unit 1 rejected: only approach crosses [road], blocked"). `reassess_all()` on every graph change: reroute missions; if a mission becomes unreachable or another available unit now beats it by >25% ETA, reassign (free the old unit, log the decision). Seed vehicle positions in demo data such that flooding the main bridge makes the straight-line-nearest unit the wrong choice — verify with a pytest that asserts assignment flips after the flood. Frontend `MissionPanel.tsx`: right-side stack of mission cards (unit callsign, incident, ETA mono, risk chip, status) with an expandable "Why" section listing reasons; hovering a card highlights its route and dims others to 30%; backup route renders as a dashed 50%-opacity line when expanded.

**Prompt 9 — Explainable Decision Engine + Decision Log**
> Backend `app/core/explain.py`: a `Decision` builder used by routing/fleet/impact — every assignment, reroute, reassignment, impact, and what-if produces `{ts, kind, headline, reasons[]}` in plain operational English (headline ≤ 90 chars, e.g., "Unit 3 dispatched to Incident 12 — Unit 1 rejected (bridge R17 blocked)"). Keep the last 50 in the snapshot. Frontend `DecisionLog.tsx`: bottom ticker bar, mono timestamps, newest entries slide in from the left, kind-colored dot (assignment blue, reroute amber, impact red, whatif violet); clicking an entry expands reasons. Ensure 100% of decision paths emit an entry — add a pytest that floods a mission's route and asserts a reroute decision appears in the snapshot.

**Prompt 10 — Scenario Engine ("Simulate Monsoon Surge")**
> Backend `app/core/scenario.py` + `data/scenario_monsoon.json` + frontend `ScenarioBar.tsx`. Scenario file: a timed list of steps `[{t_s, action, params}]` implementing this storyline: t=0 incident in zone North-3 → t=4 flood two minor roads (15 cm, 25 cm) → t=8 flood the main river bridge (45 cm) → t=12 second incident near the hospital → t=16 clear one minor road. Runner executes steps with asyncio on `POST /api/scenario/start`, is idempotent-cancelable, and `POST /api/scenario/reset` restores the pristine graph (reload attrs from startup copy) and clears incidents/missions/decisions. Frontend ScenarioBar (bottom-center, glassy pill): ▶ Simulate Monsoon Surge (shows progress), Reset, What-If toggle. Done when one click reproducibly plays the full story and Reset returns to a clean map within 1 s.

**Prompt 11 — Header, resilience gauge, polish pass 1**
> Frontend only, no contract changes. Add `Header.tsx`: RESQOS wordmark (Inter, tracking-wide), live UTC+5:30 clock, and a network-resilience radial gauge (from snapshot resilience score) that animates on change and shifts green→amber→red. Empty states for MissionPanel and DecisionLog ("No active missions — click the map to report an incident"). Vehicle chevrons glide between route coordinates (requestAnimationFrame lerp, ~30 s traversal illusion). Consistency pass: max 3 font sizes, spacing scale, panel blur/opacity identical everywhere, all counts use tabular-nums. Verify nothing overlaps at 1366×768 and 1920×1080.

**Prompt 12 — Testing & hardening**
> Run and fix the full pytest suite. Add: `test_e2e_flow.py` using FastAPI TestClient + a WS client that executes the entire monsoon scenario synchronously and asserts — no rendered route ever contains a blocked edge, snapshot seq strictly increases, `computed_in_ms < 300` for every update, reset restores edge attr sums to baseline. Add rapid-fire fuzz: 30 random flood/clear posts in 3 s must not error or deadlock. Frontend: WS reconnect within 2 s of a killed backend restart, and the client fully re-renders from the fresh snapshot (no stale routes).

**Prompt 13 — Bug-fix sweep**
> Here is my list of observed issues from manual testing: [PASTE LIST]. Fix them one at a time, smallest diff possible, no refactors, run the test suite after each fix. If a fix requires touching a core/ contract, stop and explain before changing it.

**Prompt 14 — Performance & robustness optimization**
> Profile the update cycle (flood POST → snapshot broadcast). Optimize only measured hot spots, in this priority: (1) send `edges_geojson_delta` (changed features only) instead of the full road GeoJSON per snapshot, with a `full=true` snapshot on WS connect; (2) cache the passable-subgraph components and invalidate only on blocked-status transitions; (3) debounce impact analysis to once per burst (50 ms window). Do not change public contracts. Target: p95 update cycle < 150 ms on the demo graph; measure before/after and print the numbers.

**Prompt 15 — Final polish & demo assets**
> Final pass, no new features: (1) route draw-on and dissolve transitions smooth at 60 fps; (2) ImpactAlert typography/emphasis review — population and hospital lines must be readable from 3 m away; (3) favicon + title "ResQOS — Emergency Response Decision Engine"; (4) README.md: 3-line pitch, screenshot, quickstart (two commands), architecture diagram from §9, "why it's not a navigation app" paragraph; (5) a `DEMO.md` with the exact 3-minute click script from the PRD and the fallback plan; (6) console must be free of errors/warnings during a full scenario run.

---

## Final Quality Gate (before submitting)
- [ ] 10 consecutive clean "Monsoon Surge" runs, latency badge always < 1000 ms (expect < 150 ms)
- [ ] No rendered route ever crosses a blocked edge (asserted by tests, verified by eye)
- [ ] Impact alert numbers are concrete (zones, people, hospital names) — never generic
- [ ] Every decision in the log has a "why"
- [ ] The nearest-unit-is-wrong scenario fires and is narrated
- [ ] Backup video recorded; routing works with WiFi off
- [ ] Closing pitch line rehearsed: *"Other systems tell you where to drive. ResQOS tells commanders what the flood means, who should respond, and why."*

---
---

# PART II — PROBLEM-STATEMENT ALIGNMENT & PITCH PACK

*(Added after receiving the official Problem Statement, constraints, expected outcome, and the real judging criteria. This part reframes everything for judges who are buyers/stakeholders and supplies the market evidence to brag about.)*

## 16. Alignment to the Official Problem Statement

| PS element | ResQOS delivers | Where |
|---|---|---|
| "route emergency responders… not into submerged paths" | Risk-aware routing treats flood depth as live edge cost; routes never cross impassable edges | §4.2, FR-3 |
| "minimizes emergency response times" | Fleet assignment by true route cost + minutes-saved readout vs naive routing | §4.3, FR-5, metric #3 |
| "optimizes rescue fleet deployment" | Best + backup unit per incident, auto-reassignment on invalidation | §4.3, FR-5/FR-8 |
| **"safe-zone mapping under shifting conditions"** | **Dynamic Safe-Zone Mapping — nearest reachable safe zone + evac route per populated zone, live** | **§4.6, FR-11** |
| "Zero-Pipeline Processing… in-memory on the fly" | In-memory NetworkX graph, edge weights mutated in place, no batch jobs, no DB | §9, §10 |
| "Latency Boundary: under a second" | On-screen latency badge; p95 target < 150 ms on demo graph | FR-4, metric #1 |
| "No Commercial Map APIs" | OSM via osmnx + MapLibre + free CARTO tiles; routing works fully offline | §8 |
| Expected outcome: "continuous path recalculation and safe-zone mapping" | Both are core, demoed live in the Monsoon Surge scenario | §7.11 |

**One sentence for a non-technical judge:** *"When roads flood, ResQOS instantly re-routes rescue vehicles the safe way, tells commanders which neighbourhoods just got cut off and where to send them, and points every trapped area to the nearest shelter they can still reach — in under a second, on free maps."*

## 17. Judging-Criteria Playbook (the REAL five)

Every criterion below is something we can *show*, not just claim.

### 17.1 Innovation & Originality
- We don't ship "a better GPS." We ship a **decision engine**: the Critical Road Impact Analyzer answers *"what did the city just lose?"* — the exact gap the research confirms no existing system fills ("no system semantically interprets flood + graph + resources").
- Graded flood cost (depth-weighted), not binary open/closed. Betweenness-based critical-road pre-highlighting. What-If commander mode. These are genuinely uncommon in disaster demos.
- **Judge soundbite:** *"Other teams reroute. We tell commanders what the flood means, who should respond, and where survivors can still go."*

### 17.2 Technical Feasibility
- Fully buildable in 24 h with a boring, proven, free stack (FastAPI + NetworkX + OSM + React + MapLibre). No ML, no paid APIs, no exotic algorithms — plain A* on a small in-memory graph is already sub-100 ms, so the <1 s bound is met with huge margin.
- Live, working prototype with tests and an on-screen latency number that proves the constraint is satisfied.
- **Judge soundbite:** *"It runs offline, on open data, and the latency counter never leaves double digits."*

### 17.3 Impact & Inclusivity (this criterion is new — we lean in hard) — see §18
- Serves not just dispatchers but **civilians, the elderly, disabled, and phone-less** via commander-driven safe-zone mapping.
- Accessibility built in: colour-blind-safe status palette with shape/label redundancy, high-contrast EOC theme, multilingual-ready labels (English / Hindi / Kannada).
- **Judge soundbite:** *"A grandmother with no smartphone still gets rescued, because the commander's screen knows her street is cut off and which shelter she can still reach."*

### 17.4 Clarity of Submission (PPT) — see §20 for the full storyboard
- 12-slide deck with one idea per slide, a live-demo centrepiece, and a single memorable line.
- Problem → gap → what we built → live demo → impact numbers → market → ask.

### 17.5 Bonus: Business / Monetization — see §19
- Clear B2G/B2B SaaS model, real TAM/SAM/SOM from cited market reports, and a credible path to sustainability.

## 18. Impact & Inclusivity (dedicated section)

**Why the problem is worth solving (evidence, cited):**
- India's average annual flood loss is estimated by the World Bank at about <cite index="9-1">US$7.4 billion</cite>, and separately India bears <cite index="6-1">annual flood-related economic losses exceeding $3 billion, roughly 10% of the global total</cite>.
- The 2024 monsoon alone <cite index="5-1">killed 3,238 people across India and caused losses exceeding ₹40,000 crore</cite>.
- Flooding <cite index="14-1">damages roads and bridges and cuts rural communities off from the outside world, making it difficult to access resources</cite> — the exact isolation problem our Impact Analyzer surfaces.
- Response time is life-or-death: in India the <cite index="15-1">average ambulance response time is 25–35 minutes versus 8–10 minutes in developed countries</cite>, and <cite index="22-1">each one-minute increase in response time is associated with about a 6% reduction in survival to hospital discharge</cite>. A meta-analysis found <cite index="19-1">EMS response times over 8 minutes were associated with a 1.9× increase in odds of death for life-threatening calls</cite>.
- It's local, too: a <cite index="16-1">2021 CAG report on Karnataka found nearly 90,000 crash victims did not receive timely care due to ambulance unavailability and delays</cite>.
- The approach is proven to help: <cite index="16-1">in Chennai and Kolkata, GPS-enabled fleets reduced response times by 12–15%</cite>.

**Inclusivity, built into the product (not bolted on):**
1. **Reaches people who can't reach an app.** The value flows through the commander's screen, so rescue and evacuation guidance work for the elderly, disabled, children, tourists, and anyone without a charged smartphone or signal — precisely the people who die in floods.
2. **Accessible by design.** Status is never colour-only: safe/risky/blocked also carry distinct line styles and text labels (colour-blind safe); high-contrast dark theme; large tabular numerals; keyboard-navigable panels; ARIA labels on interactive layers.
3. **Language-ready.** All UI strings externalised for English / Hindi / Kannada — one JSON file, no code changes — matching the coastal-Karnataka deployment context.
4. **Equity in routing.** Safe-zone mapping is population-weighted, so the resilience score and recommendations prioritise the largest cut-off populations rather than the loudest caller.
5. **Works in the worst conditions.** Offline-capable, low-bandwidth (delta snapshots ~a few KB), runs on a single laptop in a flooded EOC with no cloud — inclusive of under-resourced municipalities.

## 19. Business / Monetization Strategy

**Positioning:** ResQOS is a **decision-support SaaS for emergency operations centres** — sold to the people who own the flood problem: city corporations, state disaster management authorities (SDMAs/NDMA), and large hospital networks.

**Market opportunity (cited, real):**
- The **emergency response software** market was <cite index="28-1">valued at $4.8 billion in 2025 and is projected to reach $11.2 billion by 2034 (9.8% CAGR), with Asia-Pacific the fastest-growing region at a 12.7% CAGR, driven partly by India's NDMA digital modernization program</cite>.
- The narrower **emergency management software** segment is <cite index="27-1">projected to grow from $0.42 billion in 2025 to $1.21 billion by 2035 at an 11.3% CAGR, with India holding an 11% share</cite>.
- The broader **incident & emergency management** market is <cite index="29-1">valued at about $157 billion in 2025, growing to $217 billion by 2030, with Asia the fastest-expanding region</cite>.

**TAM / SAM / SOM (framed conservatively):**
- **TAM** — global emergency response software, ~$4.8 B (2025) → $11.2 B (2034).
- **SAM** — India + coastal/flood-prone Asia-Pacific emergency-management software, on the order of a few hundred $M and growing double-digit.
- **SOM (5-yr, realistic)** — flood-exposed Indian ULBs (urban local bodies) + SDMAs. India has 4,000+ urban local bodies; capturing even 150 flood-prone cities at ₹8–15 lakh/yr each is a **₹12–22 crore ARR** wedge before hospital and enterprise expansion.

**Revenue model (simple, three lines a judge remembers):**
1. **Per-city SaaS licence (B2G):** annual subscription per municipality/SDMA, tiered by population and vehicle count. Anchor customer type.
2. **EOC deployment + integration:** one-time setup (map ingestion, safe-zone/asset onboarding, dispatch-system integration) — services revenue that also raises switching costs.
3. **Resilience-analytics add-on (B2B):** off-season, sell the same graph engine as pre-monsoon planning — "which roads, if they flood, isolate a hospital?" — to hospital networks, logistics/insurers, and utilities.

**Why it sustains and scales:**
- Costs are near-zero marginal (open data, no paid APIs, in-memory) → high gross margin SaaS economics.
- Climate tailwind: disaster budgets and mandates (NDMA modernization, Sendai Framework) are rising, not shrinking.
- Same engine, new cities = data + config, not new code → clean multi-city scaling story.
- **Grant/pilot on-ramp:** start as a funded municipal pilot (World Bank/GFDRR, state disaster funds), convert to paid licence after one monsoon season proving minutes-saved.

**Business one-liner for judges:** *"Free to run, sold per city, expands into year-round resilience analytics — a high-margin SaaS riding a climate-driven, government-funded market growing double digits in India."*

## 20. Marketing Research Stats — Pre & Post (the brag sheet)

### 20.1 PRE (why this must exist — the problem is huge and underserved)
- **₹40,000 crore+** in losses and **3,238 deaths** from India's 2024 monsoon alone.
- **$7.4 B** average annual flood loss in India (World Bank); India = **~10%** of all global flood economic losses.
- **25–35 min** Indian ambulance response vs **8–10 min** in developed countries; **~6%** survival lost *per minute* of delay; **1.9×** death odds when EMS takes >8 min.
- **~90,000** Karnataka crash victims denied timely care (2021 CAG) — the problem is on our doorstep.
- **Gap:** no mainstream routing system (Google, OSRM, ArcGIS, ORS) does live in-memory flood-graph updates, graded depth cost, infrastructure-impact reasoning, or safe-zone reachability — confirmed by the literature review.

### 20.2 POST (projected impact we can credibly claim, framed as projection not measured result)
- Deployed GPS-optimized fleets already cut response times **12–15%** in Chennai and Kolkata; ResQOS adds flood-awareness on top, so a conservative **10–15% reduction in flood-condition response time** is a defensible projection.
- Translating that: at ~6% survival gain per minute saved, shaving even **3–5 minutes** off a monsoon rescue is a **~18–30% relative improvement in survival odds** for time-critical cases — the headline impact slide.
- **Coverage projection:** in a demo city, safe-zone mapping keeps **X% of population matched to a reachable shelter** even after the main bridge floods, versus a static map that would strand them (we show the exact before/after number live).
- **Adoption projection:** targeting **150 flood-prone Indian cities in 5 years** → double-digit-crore ARR, inside a market growing **9.8–12.7% CAGR** in Asia-Pacific.

> Presenter's honesty note: label 20.2 as *projections/targets* on the slide. Judges trust teams who distinguish "measured" from "projected." The measured numbers (12–15% from real GPS deployments) do the persuading; our projection just rides them.

## 21. PPT Storyboard (12 slides — Clarity criterion)

One idea per slide. Big type. The demo is the star; slides frame it.

1. **Title** — "ResQOS — Emergency Response Decision Engine." Tagline: *"When roads flood, we tell commanders what it means, who responds, and where survivors can go."* Team name.
2. **The 15-second problem** — one photo of a flooded street + three numbers: 3,238 deaths (2024), 25–35 min response, 6% survival lost per minute.
3. **Why today's tools fail** — Google/OSRM/ArcGIS icons crossed out: static graphs, binary closures, no impact reasoning, route you into the water.
4. **Our insight** — "Answer *what is the city's state?* before *what is the path?*" The category shift: navigation → decision support.
5. **What we built (one diagram)** — the 5 engines on one road graph (from §9), plainly labelled.
6. **LIVE DEMO** — full screen, no bullets. Run Monsoon Surge: reroute in <1 s, impact alert, reassignment, safe-zone remap. This slide is 90 seconds of screen.
7. **The WOW** — Critical Road Impact Analyzer close-up: "2 zones isolated · City General cut off · resilience 91%→74%." "Everyone says *road blocked*. We say *here's what that costs.*"
8. **Safe-zone mapping** — before/after: population matched to reachable shelters as the bridge floods. Ties directly to the PS expected outcome.
9. **Impact & inclusivity** — reaches phone-less/elderly/disabled; colour-blind-safe; English/Hindi/Kannada; offline. Photo of an EOC.
10. **Proof it's real** — latency badge screenshot (43 ms), "no route ever crosses a blocked edge," offline + open-data + no paid API tick-marks.
11. **Business** — market chart ($4.8B→$11.2B, APAC 12.7% CAGR), 3-line revenue model, "150 cities → double-digit-crore ARR."
12. **Ask + one line** — pilot ask; close on *"Other systems tell you where to drive. ResQOS tells commanders what the flood means, who should respond, and why."*

**Deck rules:** dark theme matching the product; max ~15 words per slide; every stat carries its source in small footnote text; rehearse to land slide 6 (demo) by the 60-second mark.

## 22. Build-Guide Addendum — Safe-Zone Mapping Prompt

Insert **between Prompt 7 (Impact Analyzer) and Prompt 8 (Fleet)** in §15 — it reuses the same reachability machinery, so it's cheap:

**Prompt 7B — Dynamic Safe-Zone Mapping**
> Backend `app/core/safezones.py` + frontend `SafeZoneLayer.tsx`. Reuse the passable-subgraph reachability cache from impact.py. Safe zones are the POIs of kind `shelter` plus any `hospital` flagged `stroke_ready` (from demo_area.json). Implement `map_safe_zones() -> dict[zone_id, {safe_zone_id, evac_route: RouteResult, reachable: bool}]`: for each populated zone centroid, find the nearest safe zone by true route cost on the passable subgraph and compute its evacuation route; if none reachable, mark `reachable=False`. Recompute on every graph change and attach `safe_zone_map` to the snapshot. Frontend: draw a soft reachability halo around each safe zone, a thin evac-route line from each zone centroid to its assigned safe zone (colour-coded, dashed), and grey out safe zones that are cut off; when a zone loses its safe zone, flash its centroid and add a DecisionLog entry ("Zone North-3 lost access to Shelter S1 — re-mapped to Shelter S2, +4 min"). Pytest: flooding the bridge makes ≥1 zone's nearest safe zone change, and the map reflects it. Keep this recompute inside the same <1 s cycle.

Also extend **Prompt 10 (Scenario)** so the Monsoon Surge script includes a beat where the bridge flood forces a safe-zone re-map (demo slide 8), and **Prompt 15 (README/DEMO)** to mention safe-zone mapping in the pitch and the offline/open-data/inclusivity claims.
