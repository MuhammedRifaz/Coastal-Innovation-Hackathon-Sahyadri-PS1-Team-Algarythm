// Shared TS types mirroring backend/app/models.py by hand.
// Keep in lockstep: any field added/renamed in models.py must be reflected
// here in the same commit.

import type { FeatureCollection } from "geojson";

export type EdgeStatus = "safe" | "risky" | "blocked";
export type POIKind = "hospital" | "shelter" | "fire_station" | "police" | "utility";
export type VehicleKind = "ambulance" | "rescue_truck";
export type VehicleStatus = "available" | "en_route";
export type IncidentStatus = "open" | "assigned" | "resolved";
export type MissionStatus = "active" | "rerouted" | "reassigned" | "complete";
export type DecisionKind = "assignment" | "reroute" | "impact" | "whatif" | "safezone";

export interface EdgeAttributes {
  edge_id: string;
  length_m: number;
  base_time_s: number;
  highway_class: string;
  flood_depth_cm: number;
  status: EdgeStatus;
  safety_score: number;
  elevation_m: number;
  critical: boolean;
  updated_at: string;
  // Confidence in flood report (0-100%): 100% = confirmed by sensors,
  // 50% = citizen report, 0% = no data. Used for uncertainty-aware routing.
  confidence: number;
  // at_risk: True if this edge is predicted to flood soon based on
  // proximity to currently flooded edges (contagion model heuristic).
  at_risk: boolean;
}

export interface RoadInspectorData {
  edge_id: string;
  highway_class: string;
  length_m: number;
  flood_depth_cm: number;
  status: EdgeStatus;
  safety_score: number;
  elevation_m: number;
  critical: boolean;
  nearby_zones: { id: string; name: string; population: number; distance_m: number }[];
  nearby_pois: { id: string; name: string; kind: POIKind; distance_m: number }[];
  if_closed_zones: string[];
  if_closed_population: number;
  if_closed_recommendation: string;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface POI {
  id: string;
  kind: POIKind;
  name: string;
  node_id: string;
  lat: number;
  lng: number;
  stroke_ready: boolean;
}

export interface Zone {
  id: string;
  name: string;
  centroid_node_id: string;
  lat: number;
  lng: number;
  population: number;
  reachable_hospitals: string[];
}

export interface Vehicle {
  id: string;
  callsign: string;
  kind: VehicleKind;
  node_id: string;
  lat: number;
  lng: number;
  status: VehicleStatus;
  mission_id: string | null;
}

export interface Incident {
  id: string;
  node_id: string;
  lat: number;
  lng: number;
  severity: number;
  status: IncidentStatus;
  created_at: string;
}

export interface RouteResult {
  node_path: string[];
  geometry: LineStringGeometry;
  distance_m: number;
  eta_s: number;
  risk_score: number;
  avoided_edges: string[];
  computed_in_ms: number;
  reachable: boolean;
}

export interface Mission {
  id: string;
  incident_id: string;
  vehicle_id: string;
  route: RouteResult;
  backup_route: RouteResult | null;
  eta_s: number;
  status: MissionStatus;
  reasons: string[];
}

export interface MissionDelta {
  mission_id: string;
  delta_eta_s: number;
  action: string;
}

export interface ImpactReport {
  closed_edge: string;
  isolated_zones: Zone[];
  affected_population: number;
  unreachable_pois: string[];
  affected_missions: MissionDelta[];
  resilience_before: number;
  resilience_after: number;
  recommendation: string;
}

export interface Decision {
  id: string;
  ts: string;
  kind: DecisionKind;
  headline: string;
  reasons: string[];
  data: Record<string, unknown>;
}

export interface SafeZoneAssignment {
  safe_zone_id: string | null;
  evac_route: RouteResult | null;
  reachable: boolean;
}

export interface StateSnapshot {
  seq: number;
  ts: string;
  computed_in_ms: number;
  edges_geojson: FeatureCollection;
  vehicles: Vehicle[];
  incidents: Incident[];
  missions: Mission[];
  pois: POI[];
  zones: Zone[];
  latest_impact: ImpactReport | null;
  safe_zone_map: Record<string, SafeZoneAssignment>;
  decisions: Decision[];
}

// GET /api/graph response shape (initial load, before the WS connects).
export interface GraphResponse {
  roads: FeatureCollection;
  pois: POI[];
  zones: Zone[];
}
