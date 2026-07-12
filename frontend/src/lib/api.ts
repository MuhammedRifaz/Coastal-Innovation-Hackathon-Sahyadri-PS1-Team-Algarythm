// Typed fetch helpers for the REST command endpoints.
import type { GraphResponse, ImpactReport } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status} ${detail}`);
  }
  return response.json() as Promise<T>;
}

export function getGraph(): Promise<GraphResponse> {
  return request<GraphResponse>("/api/graph");
}

export function postFlood(edgeId: string, depthCm: number): Promise<{ snapshot_seq: number }> {
  return request("/api/floods", {
    method: "POST",
    body: JSON.stringify({ edge_id: edgeId, depth_cm: depthCm }),
  });
}

export function postFloodClear(edgeId: string): Promise<{ snapshot_seq: number }> {
  return request("/api/floods/clear", {
    method: "POST",
    body: JSON.stringify({ edge_id: edgeId }),
  });
}

export function postIncident(
  lat: number,
  lng: number,
  severity: number,
): Promise<{ snapshot_seq: number; incident_id: string; mission_id: string | null }> {
  return request("/api/incidents", {
    method: "POST",
    body: JSON.stringify({ lat, lng, severity }),
  });
}

export function postWhatIf(edgeId: string): Promise<ImpactReport> {
  return request<ImpactReport>("/api/whatif", {
    method: "POST",
    body: JSON.stringify({ edge_id: edgeId }),
  });
}

export function postResolveIncident(incidentId: string): Promise<{ snapshot_seq: number }> {
  return request(`/api/incidents/${incidentId}/resolve`, {
    method: "POST",
  });
}

export function postScenarioStart(): Promise<{ status: string }> {
  return request("/api/scenario/start", {
    method: "POST",
  });
}

export function postScenarioReset(): Promise<{ status: string }> {
  return request("/api/scenario/reset", {
    method: "POST",
  });
}

