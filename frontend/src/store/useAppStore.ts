// Zustand store mirroring the latest snapshot — either from the initial
// GET /api/graph fetch or from a WebSocket StateSnapshot (which carries
// everything the REST fetch does, plus vehicles/incidents/missions/etc.
// added by later prompts).
import { create } from "zustand";
import type { FeatureCollection } from "geojson";
import type {
  GraphResponse,
  ImpactReport,
  Incident,
  Mission,
  POI,
  StateSnapshot,
  Vehicle,
  Zone,
} from "../lib/types";

interface AppState {
  roads: FeatureCollection | null;
  pois: POI[];
  zones: Zone[];
  vehicles: Vehicle[];
  incidents: Incident[];
  missions: Mission[];
  seq: number;
  computedInMs: number;
  wsConnected: boolean;
  latestImpact: ImpactReport | null;
  // What-If is entirely client-side: it never mutates real state, so its
  // result doesn't come from a snapshot — it's set directly from the
  // /api/whatif response and cleared on dismiss or toggle-off.
  whatIfMode: boolean;
  hypotheticalImpact: ImpactReport | null;
  // Mission Panel interaction state (drives map dimming + backup route rendering)
  hoveredMissionId: string | null;
  expandedMissionId: string | null;
  decisions: Decision[];
  setFromGraphResponse: (data: GraphResponse) => void;
  setFromSnapshot: (snapshot: StateSnapshot) => void;
  setWsConnected: (connected: boolean) => void;
  setWhatIfMode: (on: boolean) => void;
  setHypotheticalImpact: (report: ImpactReport | null) => void;
  setHoveredMissionId: (id: string | null) => void;
  setExpandedMissionId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  roads: null,
  pois: [],
  zones: [],
  vehicles: [],
  incidents: [],
  missions: [],
  seq: 0,
  computedInMs: 0,
  wsConnected: false,
  latestImpact: null,
  whatIfMode: false,
  hypotheticalImpact: null,
  hoveredMissionId: null,
  expandedMissionId: null,
  decisions: [],

  setFromGraphResponse: (data) =>
    set({ roads: data.roads, pois: data.pois, zones: data.zones }),

  setFromSnapshot: (snapshot) =>
    set({
      roads: snapshot.edges_geojson,
      pois: snapshot.pois,
      zones: snapshot.zones,
      vehicles: snapshot.vehicles,
      incidents: snapshot.incidents,
      missions: snapshot.missions,
      seq: snapshot.seq,
      computedInMs: snapshot.computed_in_ms,
      latestImpact: snapshot.latest_impact,
      decisions: snapshot.decisions ?? [],
    }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setWhatIfMode: (on) => set({ whatIfMode: on, hypotheticalImpact: null }),

  setHypotheticalImpact: (report) => set({ hypotheticalImpact: report }),

  setHoveredMissionId: (id) => set({ hoveredMissionId: id }),

  setExpandedMissionId: (id) =>
    set((state) => ({ expandedMissionId: state.expandedMissionId === id ? null : id })),
}));
