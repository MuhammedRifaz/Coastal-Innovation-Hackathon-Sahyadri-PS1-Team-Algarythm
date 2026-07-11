// Drives the mission-route "draw-on" animation. Whenever a mission's
// route reference changes (new assignment or a reroute), its line grows
// from 0% to 100% of its length over 600ms. Runs entirely on
// requestAnimationFrame outside React state — the caller pushes each
// frame's GeoJSON straight into a maplibre source via setData.
import { useEffect, useRef } from "react";
import type { FeatureCollection, Position } from "geojson";
import type { Mission } from "../lib/types";

const DRAW_ON_MS = 600;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sliceCoordinates(coords: Position[], t: number): Position[] {
  if (coords.length < 2 || t >= 1) return coords;

  const cumulative: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  const target = cumulative[cumulative.length - 1] * t;

  const sliced: Position[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (cumulative[i] < target) {
      sliced.push(coords[i]);
      continue;
    }
    const segStart = cumulative[i - 1];
    const segLen = cumulative[i] - segStart;
    const segT = segLen === 0 ? 0 : (target - segStart) / segLen;
    sliced.push([lerp(coords[i - 1][0], coords[i][0], segT), lerp(coords[i - 1][1], coords[i][1], segT)]);
    break;
  }
  return sliced;
}

export function useRouteAnimation(missions: Mission[], onUpdate: (fc: FeatureCollection) => void): void {
  const animState = useRef(new Map<string, { route: Mission["route"]; startedAt: number }>());
  const rafRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const state = animState.current;
    const now = performance.now();

    for (const mission of missions) {
      const existing = state.get(mission.id);
      if (!existing || existing.route !== mission.route) {
        state.set(mission.id, { route: mission.route, startedAt: now });
      }
    }
    for (const id of [...state.keys()]) {
      if (!missions.some((m) => m.id === id)) state.delete(id);
    }

    const frame = (t: number) => {
      const features: FeatureCollection["features"] = [];
      for (const mission of missions) {
        const entry = state.get(mission.id);
        if (!entry || !mission.route.reachable) continue;
        const progress = Math.min(1, (t - entry.startedAt) / DRAW_ON_MS);
        features.push({
          type: "Feature",
          properties: { mission_id: mission.id, status: mission.status },
          geometry: {
            type: "LineString",
            coordinates: sliceCoordinates(mission.route.geometry.coordinates, progress),
          },
        });
      }
      onUpdateRef.current({ type: "FeatureCollection", features });
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(rafRef.current);
  }, [missions]);
}
