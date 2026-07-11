// Zustand store mirroring the latest snapshot — either from the initial
// GET /api/graph fetch or from a WebSocket StateSnapshot (which carries
// everything the REST fetch does, plus vehicles/incidents/missions/etc.
// added by later prompts).
import { create } from "zustand";
import type { FeatureCollection } from "geojson";
import type { GraphResponse, POI, StateSnapshot, Zone } from "../lib/types";

interface AppState {
  roads: FeatureCollection | null;
  pois: POI[];
  zones: Zone[];
  seq: number;
  computedInMs: number;
  wsConnected: boolean;
  setFromGraphResponse: (data: GraphResponse) => void;
  setFromSnapshot: (snapshot: StateSnapshot) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  roads: null,
  pois: [],
  zones: [],
  seq: 0,
  computedInMs: 0,
  wsConnected: false,

  setFromGraphResponse: (data) =>
    set({ roads: data.roads, pois: data.pois, zones: data.zones }),

  setFromSnapshot: (snapshot) =>
    set({
      roads: snapshot.edges_geojson,
      pois: snapshot.pois,
      zones: snapshot.zones,
      seq: snapshot.seq,
      computedInMs: snapshot.computed_in_ms,
    }),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
