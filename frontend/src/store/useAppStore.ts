// Zustand store mirroring the latest snapshot — either from the initial
// GET /api/graph fetch or from a WebSocket StateSnapshot (which carries
// everything the REST fetch does, plus vehicles/incidents/missions/etc.
// added by later prompts).
import { create } from "zustand";
import type { FeatureCollection } from "geojson";
import type {
  Decision,
  GraphResponse,
  ImpactReport,
  Incident,
  Mission,
  POI,
  RoadInspectorData,
  RouteResult,
  SafeZoneAssignment,
  StateSnapshot,
  Vehicle,
  Zone,
} from "../lib/types";
import { postUserRoute, getRoadInspector } from "../lib/api";

interface AppState {
  roads: FeatureCollection | null;
  pois: POI[];
  zones: Zone[];
  vehicles: Vehicle[];
  incidents: Incident[];
  missions: Mission[];
  decisions: Decision[];
  seq: number;
  computedInMs: number;
  wsConnected: boolean;
  latestImpact: ImpactReport | null;
  safeZoneMap: Record<string, SafeZoneAssignment>;
  // What-If is entirely client-side: it never mutates real state, so its
  // result doesn't come from a snapshot — it's set directly from the
  // /api/whatif response and cleared on dismiss or toggle-off.
  whatIfMode: boolean;
  hypotheticalImpact: ImpactReport | null;
  // UI-only selection state, read by MapView to highlight/dim routes.
  hoveredMissionId: string | null;
  expandedMissionId: string | null;
  roadInspector: RoadInspectorData | null;
  // Route planner: null = inactive, "picking_origin" | "picking_dest" | "showing"
  routePlannerMode: "idle" | "picking_origin" | "picking_dest" | "showing";
  routePlannerOrigin: [number, number] | null;
  routePlannerDest: [number, number] | null;
  routePlannerResult: RouteResult | null;
  // One-shot camera request: MapView flies here then clears it.
  cameraTarget: { center: [number, number]; zoom: number } | null;
  setCameraTarget: (t: { center: [number, number]; zoom: number } | null) => void;
  setFromGraphResponse: (data: GraphResponse) => void;
  setFromSnapshot: (snapshot: StateSnapshot) => void;
  setWsConnected: (connected: boolean) => void;
  setWhatIfMode: (on: boolean) => void;
  setHypotheticalImpact: (report: ImpactReport | null) => void;
  setHoveredMissionId: (id: string | null) => void;
  setExpandedMissionId: (id: string | null) => void;
  setRoadInspector: (data: RoadInspectorData | null) => void;
  setRoutePlannerMode: (mode: "idle" | "picking_origin" | "picking_dest" | "showing") => void;
  setRoutePlannerOrigin: (pt: [number, number] | null) => void;
  setRoutePlannerDest: (pt: [number, number] | null) => void;
  setRoutePlannerResult: (r: RouteResult | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  roads: null,
  pois: [],
  zones: [],
  vehicles: [],
  incidents: [],
  missions: [],
  decisions: [],
  seq: 0,
  computedInMs: 0,
  wsConnected: false,
  latestImpact: null,
  safeZoneMap: {},
  whatIfMode: false,
  hypotheticalImpact: null,
  hoveredMissionId: null,
  expandedMissionId: null,
  roadInspector: null,
  routePlannerMode: "idle",
  routePlannerOrigin: null,
  routePlannerDest: null,
  routePlannerResult: null,
  cameraTarget: null,

  setCameraTarget: (t) => set({ cameraTarget: t }),

  setFromGraphResponse: (data) =>
    set({ roads: data.roads, pois: data.pois, zones: data.zones }),

  setFromSnapshot: (snapshot) => {
    const state = useAppStore.getState();
    const graphChanged = snapshot.seq !== state.seq;
    
    set({
      roads: snapshot.edges_geojson,
      pois: snapshot.pois,
      zones: snapshot.zones,
      vehicles: snapshot.vehicles,
      incidents: snapshot.incidents,
      missions: snapshot.missions,
      decisions: snapshot.decisions,
      seq: snapshot.seq,
      computedInMs: snapshot.computed_in_ms,
      latestImpact: snapshot.latest_impact,
      safeZoneMap: snapshot.safe_zone_map,
    });
    
    // Auto-recalculate user route if graph changed and route planner is active
    if (graphChanged && state.routePlannerOrigin && state.routePlannerDest) {
      postUserRoute(
        state.routePlannerOrigin[0], state.routePlannerOrigin[1],
        state.routePlannerDest[0], state.routePlannerDest[1]
      ).then((route) => {
        useAppStore.getState().setRoutePlannerResult(route);
      }).catch((err) => {
        console.error("Failed to recalculate user route:", err);
        useAppStore.getState().setRoutePlannerResult({
          node_path: [],
          geometry: { type: "LineString", coordinates: [] },
          distance_m: 0,
          eta_s: 0,
          risk_score: 100,
          avoided_edges: [],
          computed_in_ms: 0,
          reachable: false,
        });
      });
    }
    
    // Refresh RoadInspector data if graph changed and an edge is selected
    if (graphChanged && state.roadInspector) {
      const edgeId = state.roadInspector.edge_id;
      getRoadInspector(edgeId)
        .then((data) => {
          useAppStore.getState().setRoadInspector(data);
        })
        .catch((err) => console.error("Failed to refresh RoadInspector:", err));
    }
  },

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setWhatIfMode: (on) => set({ whatIfMode: on, hypotheticalImpact: null }),

  setHypotheticalImpact: (report) => set({ hypotheticalImpact: report }),

  setHoveredMissionId: (id) => set({ hoveredMissionId: id }),

  setExpandedMissionId: (id) => set({ expandedMissionId: id }),

  setRoadInspector: (data) => set({ roadInspector: data }),

  setRoutePlannerMode: (mode) => set({ routePlannerMode: mode }),
  setRoutePlannerOrigin: (pt) => set({ routePlannerOrigin: pt }),
  setRoutePlannerDest: (pt) => set({ routePlannerDest: pt }),
  setRoutePlannerResult: (r) => set({ routePlannerResult: r }),
}));
