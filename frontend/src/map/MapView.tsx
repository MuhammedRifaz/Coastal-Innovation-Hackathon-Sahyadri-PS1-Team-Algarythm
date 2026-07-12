// Full-viewport MapLibre dark basemap: live road network colored by
// flood status, incidents, vehicles, and animated mission routes.
// Snapshot updates call source.setData() only — sources/layers are
// created once on style load, never re-created.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "../store/useAppStore";
import { postFlood, postFloodClear, postIncident, postWhatIf } from "../lib/api";
import { useRouteAnimation } from "./useRouteAnimation";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const ROADS_SOURCE_ID = "roads";
const BASE_LAYER_ID = "roads-base";
const FLOOD_OVERLAY_LAYER_ID = "roads-flood-overlay";

const MISSIONS_SOURCE_ID = "mission-routes";
const MISSIONS_LAYER_ID = "mission-routes-line";

const BACKUP_ROUTES_SOURCE_ID = "backup-routes";
const BACKUP_ROUTES_LAYER_ID = "backup-routes-line";

const INCIDENTS_SOURCE_ID = "incidents";
const INCIDENTS_RING_LAYER_ID = "incidents-ring";
const INCIDENTS_DOT_LAYER_ID = "incidents-dot";

const VEHICLES_SOURCE_ID = "vehicles";
const VEHICLES_LAYER_ID = "vehicles-chevron";

const CHEVRON_AVAILABLE_IMAGE = "chevron-available";
const CHEVRON_ENROUTE_IMAGE = "chevron-enroute";

const ISOLATED_ZONES_SOURCE_ID = "isolated-zones";
const ISOLATED_ZONES_FILL_LAYER_ID = "isolated-zones-fill";
const ISOLATED_ZONES_OUTLINE_LAYER_ID = "isolated-zones-outline";
const RED_HATCH_IMAGE = "red-hatch";

// Default severity for click-to-report incidents until a severity picker
// UI exists (later polish prompt).
const DEFAULT_INCIDENT_SEVERITY = 2;

// Depth applied when a road is clicked to flood it — clearly above the
// 30cm impassable threshold so the demo effect is unambiguous.
const CLICK_FLOOD_DEPTH_CM = 45;

// Meters-ish radius (in degrees, roughly) for the isolated-zone halo —
// zones are point centroids in this dataset, not polygons, so this is an
// approximate affected-area marker, not a true administrative boundary.
const ZONE_HALO_DEGREES = 0.0035;

// Centered on the NH66 Nethravathi Bridge crossing (Mangaluru <-> Ullal).
const INITIAL_CENTER: [number, number] = [74.85, 12.835];
const INITIAL_ZOOM = 12.7;

const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

// "Water shimmer" marching-ants dash sequence for flooded (risky/blocked)
// edges — the standard MapLibre/Mapbox animated-line technique.
const DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

const IS_FLOODED_FILTER: maplibregl.ExpressionSpecification = [
  "any",
  ["==", ["get", "status"], "risky"],
  ["==", ["get", "status"], "blocked"],
];

// Pulsing red ring period, in ms, for incident markers.
const PULSE_PERIOD_MS = 1400;

function buildIncidentsFeatureCollection(): FeatureCollection {
  const { incidents } = useAppStore.getState();
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      properties: { id: incident.id, severity: incident.severity, status: incident.status },
      geometry: { type: "Point", coordinates: [incident.lng, incident.lat] },
    })),
  };
}

function buildVehiclesFeatureCollection(): FeatureCollection {
  const { vehicles } = useAppStore.getState();
  return {
    type: "FeatureCollection",
    features: vehicles.map((vehicle) => ({
      type: "Feature",
      properties: { id: vehicle.id, callsign: vehicle.callsign, kind: vehicle.kind, status: vehicle.status },
      geometry: { type: "Point", coordinates: [vehicle.lng, vehicle.lat] },
    })),
  };
}

// Zones are point centroids, not polygons — approximate an "affected
// area" halo as a small circle around the centroid, radius scaled by
// population so a bigger zone reads as a bigger loss.
function circlePolygon(center: [number, number], degreesRadius: number): number[][][] {
  const points = 24;
  const ring: number[][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    ring.push([center[0] + degreesRadius * Math.cos(angle), center[1] + degreesRadius * Math.sin(angle)]);
  }
  return [ring];
}

function buildIsolatedZonesFeatureCollection(): FeatureCollection {
  const { latestImpact, hypotheticalImpact } = useAppStore.getState();
  const impact = hypotheticalImpact ?? latestImpact;
  const zones = impact?.isolated_zones ?? [];
  return {
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature",
      properties: { id: zone.id, name: zone.name, population: zone.population },
      geometry: {
        type: "Polygon",
        coordinates: circlePolygon([zone.lng, zone.lat], ZONE_HALO_DEGREES * Math.sqrt(zone.population / 1000)),
      },
    })),
  };
}

function makeHatchPatternImage(color: string): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, size + 2);
  ctx.lineTo(size + 2, -2);
  ctx.moveTo(-2, 4);
  ctx.lineTo(4, -2);
  ctx.moveTo(size - 4, size + 2);
  ctx.lineTo(size + 2, size - 4);
  ctx.stroke();
  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}

function makeChevronImage(color: string): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(11,15,20,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 4, size - 6);
  ctx.lineTo(size / 2, size - 14);
  ctx.lineTo(4, size - 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const missions = useAppStore((s) => s.missions);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
    });
    mapRef.current = map;
    map.on("error", (e) => console.error("maplibre error", e.error));

    // Guards against a CSS-load race: if the container's real size isn't
    // known yet when maplibre measures it on construction, the canvas can
    // lock in at 0x0. Also keeps the map correctly sized on real resizes.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    let animationFrameId = 0;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Ignore clicks inside the 320px right sidebar column (those are for UI buttons).
      const sidebarWidth = 320;
      if (e.point.x > map.getCanvas().width - sidebarWidth) return;

      // A small bounding box, not a single point, so a thin road line is
      // easy to hit — MapLibre's point query has almost no tolerance.
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4],
      ];
      const roadFeatures = map.queryRenderedFeatures(box, { layers: [BASE_LAYER_ID] });
      const edgeId = roadFeatures[0]?.properties?.edge_id as string | undefined;
      const { whatIfMode, setHypotheticalImpact } = useAppStore.getState();

      if (edgeId) {
        if (whatIfMode) {
          postWhatIf(edgeId)
            .then((report) => setHypotheticalImpact(report))
            .catch((err) => console.error("what-if failed", err));
          return;
        }
        const status = roadFeatures[0]?.properties?.status as string | undefined;
        const action =
          status === "blocked" || status === "risky"
            ? postFloodClear(edgeId)
            : postFlood(edgeId, CLICK_FLOOD_DEPTH_CM);
        action.catch((err) => console.error("failed to toggle flood", err));
        return;
      }

      // No road under the click: report an incident there instead. Skip
      // this while What-If is on — that mode only probes road closures.
      if (whatIfMode) return;
      postIncident(e.lngLat.lat, e.lngLat.lng, DEFAULT_INCIDENT_SEVERITY).catch((err) =>
        console.error("failed to report incident", err),
      );
    };

    // "style.load" fires once the style/sources/sprite/glyphs are parsed
    // and ready — it does not wait for basemap raster/vector tiles to
    // finish fetching, so our GeoJSON overlay renders even if the CARTO
    // tile CDN is slow or briefly unreachable (map.on("load") would block
    // on that and can hang indefinitely).
    const setupLayers = () => {
      map.addSource(ROADS_SOURCE_ID, {
        type: "geojson",
        data: useAppStore.getState().roads ?? EMPTY_FEATURE_COLLECTION,
      });

      map.addLayer({
        id: BASE_LAYER_ID,
        type: "line",
        source: ROADS_SOURCE_ID,
        paint: {
          "line-color": [
            "match",
            ["get", "status"],
            "safe",
            "#22C55E",
            "risky",
            "#F59E0B",
            "blocked",
            "#EF4444",
            "#22C55E",
          ],
          "line-opacity": ["match", ["get", "status"], "safe", 0.3, 1],
          "line-width": ["case", ["get", "critical"], 3.5, 2],
        },
      });

      map.addLayer({
        id: FLOOD_OVERLAY_LAYER_ID,
        type: "line",
        source: ROADS_SOURCE_ID,
        filter: IS_FLOODED_FILTER,
        paint: {
          "line-color": "#38BDF8",
          "line-opacity": 0.8,
          "line-width": ["case", ["get", "critical"], 3.5, 2],
          "line-dasharray": DASH_SEQUENCE[0],
        },
      });

      map.addImage(RED_HATCH_IMAGE, makeHatchPatternImage("#F87171"));
      map.addSource(ISOLATED_ZONES_SOURCE_ID, {
        type: "geojson",
        data: buildIsolatedZonesFeatureCollection(),
      });
      map.addLayer({
        id: ISOLATED_ZONES_FILL_LAYER_ID,
        type: "fill",
        source: ISOLATED_ZONES_SOURCE_ID,
        paint: { "fill-pattern": RED_HATCH_IMAGE, "fill-opacity": 0.55 },
      });
      map.addLayer({
        id: ISOLATED_ZONES_OUTLINE_LAYER_ID,
        type: "line",
        source: ISOLATED_ZONES_SOURCE_ID,
        paint: { "line-color": "#F87171", "line-width": 1.5, "line-opacity": 0.9 },
      });

      map.addSource(MISSIONS_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: MISSIONS_LAYER_ID,
        type: "line",
        source: MISSIONS_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#38BDF8",
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });

      // Backup route: dashed, 50% opacity — visible only when a card is expanded
      map.addSource(BACKUP_ROUTES_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: BACKUP_ROUTES_LAYER_ID,
        type: "line",
        source: BACKUP_ROUTES_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#38BDF8",
          "line-width": 2.5,
          "line-opacity": 0.5,
          "line-dasharray": [4, 3],
        },
      });

      map.addSource(INCIDENTS_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: INCIDENTS_RING_LAYER_ID,
        type: "circle",
        source: INCIDENTS_SOURCE_ID,
        paint: {
          "circle-radius": 10,
          "circle-color": "#F87171",
          "circle-opacity": 0.35,
          "circle-stroke-width": 0,
        },
      });
      map.addLayer({
        id: INCIDENTS_DOT_LAYER_ID,
        type: "circle",
        source: INCIDENTS_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": "#F87171",
          "circle-stroke-color": "#0B0F14",
          "circle-stroke-width": 1.5,
        },
      });

      map.addImage(CHEVRON_AVAILABLE_IMAGE, makeChevronImage("#22C55E"));
      map.addImage(CHEVRON_ENROUTE_IMAGE, makeChevronImage("#38BDF8"));
      map.addSource(VEHICLES_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: VEHICLES_LAYER_ID,
        type: "symbol",
        source: VEHICLES_SOURCE_ID,
        layout: {
          "icon-image": ["case", ["==", ["get", "status"], "available"], CHEVRON_AVAILABLE_IMAGE, CHEVRON_ENROUTE_IMAGE],
          "icon-size": 0.75,
          "icon-allow-overlap": true,
        },
      });

      let step = -1;
      let pulseStart = performance.now();
      const animate = (timestamp: number) => {
        const newStep = Math.floor((timestamp / 50) % DASH_SEQUENCE.length);
        if (newStep !== step) {
          if (map.getLayer(FLOOD_OVERLAY_LAYER_ID)) {
            map.setPaintProperty(FLOOD_OVERLAY_LAYER_ID, "line-dasharray", DASH_SEQUENCE[newStep]);
          }
          step = newStep;
        }
        const pulseT = ((timestamp - pulseStart) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
        if (map.getLayer(INCIDENTS_RING_LAYER_ID)) {
          map.setPaintProperty(INCIDENTS_RING_LAYER_ID, "circle-radius", 8 + pulseT * 10);
          map.setPaintProperty(INCIDENTS_RING_LAYER_ID, "circle-opacity", 0.45 * (1 - pulseT));
        }
        animationFrameId = requestAnimationFrame(animate);
      };
      animationFrameId = requestAnimationFrame(animate);

      map.on("click", handleClick);
    };

    if (map.isStyleLoaded()) {
      setupLayers();
    } else {
      map.once("style.load", setupLayers);
    }

    return () => {
      map.off("click", handleClick);
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    return useAppStore.subscribe((state, prevState) => {
      const map = mapRef.current;
      if (!map) return;

      if (state.roads !== prevState.roads && state.roads) {
        const source = map.getSource(ROADS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(state.roads);
      }

      if (state.incidents !== prevState.incidents) {
        const source = map.getSource(INCIDENTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(buildIncidentsFeatureCollection());
      }

      if (state.vehicles !== prevState.vehicles) {
        const source = map.getSource(VEHICLES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(buildVehiclesFeatureCollection());
      }

      if (state.latestImpact !== prevState.latestImpact || state.hypotheticalImpact !== prevState.hypotheticalImpact) {
        const source = map.getSource(ISOLATED_ZONES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(buildIsolatedZonesFeatureCollection());
      }
    });
  }, []);

  // Hover: dim non-hovered mission routes to 30%
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      const map = mapRef.current;
      if (!map || !map.getLayer(MISSIONS_LAYER_ID)) return;
      if (state.hoveredMissionId === prevState.hoveredMissionId) return;

      if (state.hoveredMissionId === null) {
        // Nothing hovered — restore all to 95%
        map.setPaintProperty(MISSIONS_LAYER_ID, "line-opacity", 0.95);
      } else {
        // Hovered mission: full opacity for hovered, 30% for others
        // We store mission-id in GeoJSON properties.mission_id
        map.setPaintProperty(MISSIONS_LAYER_ID, "line-opacity", [
          "case",
          ["==", ["get", "mission_id"], state.hoveredMissionId],
          0.95,
          0.3,
        ]);
      }
    });
    return unsubscribe;
  }, []);

  // Expand: show backup route as dashed line when card is expanded
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      const map = mapRef.current;
      if (!map || !map.getSource(BACKUP_ROUTES_SOURCE_ID)) return;
      if (state.expandedMissionId === prevState.expandedMissionId &&
          state.missions === prevState.missions) return;

      const source = map.getSource(BACKUP_ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      if (!state.expandedMissionId) {
        source.setData(EMPTY_FEATURE_COLLECTION);
        return;
      }

      const mission = state.missions.find((m) => m.id === state.expandedMissionId);
      if (!mission?.backup_route?.reachable || !mission.backup_route.geometry.coordinates.length) {
        source.setData(EMPTY_FEATURE_COLLECTION);
        return;
      }

      source.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { mission_id: mission.id },
          geometry: {
            type: "LineString",
            coordinates: mission.backup_route.geometry.coordinates,
          },
        }],
      });
    });
    return unsubscribe;
  }, []);

  useRouteAnimation(missions, (fc) => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource(MISSIONS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(fc);
  });

  // Inline style, not Tailwind's `absolute inset-0` classes: maplibre-gl
  // adds its own "maplibregl-map" class to this exact element, and
  // maplibre-gl.css sets `.maplibregl-map { position: relative }` on it —
  // same specificity as Tailwind's `.absolute` utility, so whichever
  // stylesheet loads later in the cascade wins. When maplibre's CSS won,
  // `position` silently flipped to relative, `inset-0` became a no-op,
  // and the container (whose only child is an absolutely-positioned
  // canvas that doesn't contribute to parent height) collapsed to 0px
  // tall — the map was rendering into a real, correctly-loaded style,
  // just inside an invisible zero-height box. Inline styles always win
  // regardless of import order, so this can't happen again.
  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
  );
}
