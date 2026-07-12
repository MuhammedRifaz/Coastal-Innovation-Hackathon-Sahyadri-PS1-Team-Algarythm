// Full-viewport MapLibre dark basemap: live road network colored by
// flood status, incidents, vehicles, and animated mission routes.
// Snapshot updates call source.setData() only — sources/layers are
// created once on style load, never re-created.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "../store/useAppStore";
import { getRoadInspector, postFlood, postFloodClear, postIncident, postUserRoute, postWhatIf } from "../lib/api";
import { useRouteAnimation } from "./useRouteAnimation";
import { useSafeZoneLayer } from "./SafeZoneLayer";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const ROADS_SOURCE_ID = "roads";
const BASE_LAYER_ID = "roads-base";
const FLOOD_OVERLAY_LAYER_ID = "roads-flood-overlay";
const UNCERTAIN_FLOOD_LAYER_ID = "roads-uncertain-flood";
const AT_RISK_LAYER_ID = "roads-at-risk";

const MISSIONS_SOURCE_ID = "mission-routes";
const MISSIONS_LAYER_ID = "mission-routes-line";

const BACKUP_SOURCE_ID = "mission-backup-route";
const BACKUP_LAYER_ID = "mission-backup-route-line";

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

const POIS_SOURCE_ID = "pois";
const HOSPITALS_GLOW_LAYER_ID = "hospitals-glow";
const HOSPITALS_DOT_LAYER_ID = "hospitals-dot";

const USER_ROUTE_SOURCE_ID = "user-route";
const USER_ROUTE_LAYER_ID = "user-route-line";
const ROUTE_PINS_SOURCE_ID = "route-pins";
const ROUTE_PINS_LAYER_ID = "route-pins-dot";

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

const IS_UNCERTAIN_FLOOD_FILTER: maplibregl.ExpressionSpecification = [
  "all",
  [">", ["get", "flood_depth_cm"], 0],
  ["<", ["get", "confidence"], 100],
];

const IS_AT_RISK_FILTER: maplibregl.ExpressionSpecification = [
  "all",
  ["==", ["get", "at_risk"], true],
  ["==", ["get", "flood_depth_cm"], 0],
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

function buildBackupRouteFeatureCollection(): FeatureCollection {
  const { missions, expandedMissionId } = useAppStore.getState();
  const mission = missions.find((m) => m.id === expandedMissionId);
  if (!mission?.backup_route) return EMPTY_FEATURE_COLLECTION;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { mission_id: mission.id },
        geometry: { type: "LineString", coordinates: mission.backup_route.geometry.coordinates },
      },
    ],
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

  // Initialize safe zone layer
  useSafeZoneLayer(mapRef);

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
      const { whatIfMode, setHypotheticalImpact, setRoadInspector,
              routePlannerMode, setRoutePlannerMode, setRoutePlannerOrigin,
              setRoutePlannerDest, setRoutePlannerResult } = useAppStore.getState();

      // Route planner: capture origin then destination clicks.
      if (routePlannerMode === "picking_origin") {
        setRoutePlannerOrigin([e.lngLat.lat, e.lngLat.lng]);
        setRoutePlannerMode("picking_dest");
        return;
      }
      if (routePlannerMode === "picking_dest") {
        const { routePlannerOrigin: origin } = useAppStore.getState();
        if (!origin) return;
        setRoutePlannerDest([e.lngLat.lat, e.lngLat.lng]);
        setRoutePlannerMode("showing");
        postUserRoute(origin[0], origin[1], e.lngLat.lat, e.lngLat.lng)
          .then((route) => {
            setRoutePlannerResult(route);
            const source = map.getSource(USER_ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
            const pins = map.getSource(ROUTE_PINS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
            if (route.reachable && route.geometry.coordinates.length > 0) {
              // Color route based on risk level
              const routeColor = route.risk_score <= 20 ? "#22C55E" : route.risk_score <= 50 ? "#F59E0B" : "#EF4444";
              if (map.getLayer(USER_ROUTE_LAYER_ID)) {
                map.setPaintProperty(USER_ROUTE_LAYER_ID, "line-color", routeColor);
                map.setPaintProperty("user-route-glow", "line-color", routeColor);
              }
              source?.setData({ type: "FeatureCollection", features: [
                { type: "Feature", properties: { risk_score: route.risk_score }, geometry: { type: "LineString", coordinates: route.geometry.coordinates } },
              ]});
            }
            const dest = useAppStore.getState().routePlannerDest;
            pins?.setData({ type: "FeatureCollection", features: [
              { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [origin[1], origin[0]] } },
              ...(dest ? [{ type: "Feature" as const, properties: { kind: "dest" }, geometry: { type: "Point" as const, coordinates: [dest[1], dest[0]] } }] : []),
            ]});
          })
          .catch((err) => console.error("user route failed", err));
        return;
      }

      // A small bounding box, not a single point, so a thin road line is
      // easy to hit — MapLibre's point query has almost no tolerance.
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4],
      ];
      const roadFeatures = map.queryRenderedFeatures(box, { layers: [BASE_LAYER_ID] });
      const edgeId = roadFeatures[0]?.properties?.edge_id as string | undefined;

      if (edgeId) {
        if (whatIfMode) {
          postWhatIf(edgeId)
            .then((report) => setHypotheticalImpact(report))
            .catch((err) => console.error("what-if failed", err));
          return;
        }
        // Show road inspector + toggle flood on second click.
        getRoadInspector(edgeId)
          .then((data) => setRoadInspector(data))
          .catch((err) => console.error("road inspector failed", err));
        const status = roadFeatures[0]?.properties?.status as string | undefined;
        const action =
          status === "blocked" || status === "risky"
            ? postFloodClear(edgeId)
            : postFlood(edgeId, CLICK_FLOOD_DEPTH_CM);
        action.catch((err) => console.error("failed to toggle flood", err));
        return;
      }

      // Close road inspector when clicking empty map.
      setRoadInspector(null);

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

      // Uncertain flood reports - dashed orange lines for low-confidence reports
      map.addLayer({
        id: UNCERTAIN_FLOOD_LAYER_ID,
        type: "line",
        source: ROADS_SOURCE_ID,
        filter: IS_UNCERTAIN_FLOOD_FILTER,
        paint: {
          "line-color": "#F97316",
          "line-opacity": 0.6,
          "line-width": ["case", ["get", "critical"], 3.5, 2],
          "line-dasharray": [4, 4],
        },
      });

      // At-risk edges - yellow dotted lines for predicted flood spread
      map.addLayer({
        id: AT_RISK_LAYER_ID,
        type: "line",
        source: ROADS_SOURCE_ID,
        filter: IS_AT_RISK_FILTER,
        paint: {
          "line-color": "#FBBF24",
          "line-opacity": 0.5,
          "line-width": 2,
          "line-dasharray": [2, 4],
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

      map.addSource(BACKUP_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      map.addLayer({
        id: BACKUP_LAYER_ID,
        type: "line",
        source: BACKUP_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#38BDF8",
          "line-width": 2.5,
          "line-opacity": 0.5,
          "line-dasharray": [2, 2],
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

      // POI layer: hospital glows + shelter markers.
      const poisFC: FeatureCollection = {
        type: "FeatureCollection",
        features: useAppStore.getState().pois.map((poi) => ({
          type: "Feature",
          properties: { id: poi.id, kind: poi.kind, name: poi.name, stroke_ready: poi.stroke_ready },
          geometry: { type: "Point", coordinates: [poi.lng, poi.lat] },
        })),
      };
      map.addSource(POIS_SOURCE_ID, { type: "geojson", data: poisFC });
      // Outer glow ring around hospitals — pulsed larger for stroke-ready ones.
      map.addLayer({
        id: HOSPITALS_GLOW_LAYER_ID,
        type: "circle",
        source: POIS_SOURCE_ID,
        filter: ["==", ["get", "kind"], "hospital"],
        paint: {
          "circle-radius": ["case", ["get", "stroke_ready"], 28, 22],
          "circle-color": "#F472B6",
          "circle-opacity": 0.25,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#F472B6",
          "circle-stroke-opacity": 0.6,
        },
      });
      // Inner glow ring for hospitals
      map.addLayer({
        id: "hospitals-inner-glow",
        type: "circle",
        source: POIS_SOURCE_ID,
        filter: ["==", ["get", "kind"], "hospital"],
        paint: {
          "circle-radius": ["case", ["get", "stroke_ready"], 20, 16],
          "circle-color": "#F472B6",
          "circle-opacity": 0.35,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#F472B6",
          "circle-stroke-opacity": 0.7,
        },
      });
      // Main dot for POIs
      map.addLayer({
        id: HOSPITALS_DOT_LAYER_ID,
        type: "circle",
        source: POIS_SOURCE_ID,
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "hospital"], 8, 5],
          "circle-color": ["case", ["==", ["get", "kind"], "hospital"], "#F472B6", "#818CF8"],
          "circle-stroke-color": "#0B0F14",
          "circle-stroke-width": 2.5,
        },
      });
      // Stroke-ready indicator ring for hospitals
      map.addLayer({
        id: "hospitals-stroke-ready",
        type: "circle",
        source: POIS_SOURCE_ID,
        filter: ["all", ["==", ["get", "kind"], "hospital"], ["==", ["get", "stroke_ready"], true]],
        paint: {
          "circle-radius": 10,
          "circle-color": "#22C55E",
          "circle-opacity": 0.8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0B0F14",
        },
      });

      // User route planner layers.
      map.addSource(USER_ROUTE_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      // Route glow effect
      map.addLayer({
        id: "user-route-glow",
        type: "line",
        source: USER_ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#A78BFA", "line-width": 8, "line-opacity": 0.3 },
      });
      // Main route line
      map.addLayer({
        id: USER_ROUTE_LAYER_ID,
        type: "line",
        source: USER_ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#A78BFA", "line-width": 4, "line-opacity": 0.95 },
      });
      map.addSource(ROUTE_PINS_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
      // Route pin glow
      map.addLayer({
        id: "route-pins-glow",
        type: "circle",
        source: ROUTE_PINS_SOURCE_ID,
        paint: {
          "circle-radius": 12,
          "circle-color": ["case", ["==", ["get", "kind"], "origin"], "#A78BFA", "#34D399"],
          "circle-opacity": 0.4,
        },
      });
      // Route pin main dot
      map.addLayer({
        id: ROUTE_PINS_LAYER_ID,
        type: "circle",
        source: ROUTE_PINS_SOURCE_ID,
        paint: {
          "circle-radius": 8,
          "circle-color": ["case", ["==", ["get", "kind"], "origin"], "#A78BFA", "#34D399"],
          "circle-stroke-color": "#0B0F14",
          "circle-stroke-width": 2.5,
        },
      });
      // Route pin inner dot
      map.addLayer({
        id: "route-pins-inner",
        type: "circle",
        source: ROUTE_PINS_SOURCE_ID,
        paint: {
          "circle-radius": 4,
          "circle-color": "#0B0F14",
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

      if (state.hoveredMissionId !== prevState.hoveredMissionId) {
        if (map.getLayer(MISSIONS_LAYER_ID)) {
          const opacity = state.hoveredMissionId
            ? (["case", ["==", ["get", "mission_id"], state.hoveredMissionId], 1, 0.3] as maplibregl.ExpressionSpecification)
            : 0.95;
          map.setPaintProperty(MISSIONS_LAYER_ID, "line-opacity", opacity);
        }
      }

      if (state.expandedMissionId !== prevState.expandedMissionId || state.missions !== prevState.missions) {
        const source = map.getSource(BACKUP_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(buildBackupRouteFeatureCollection());
      }

      // Update user route when it's recalculated (e.g., after road flooding)
      if (state.routePlannerResult !== prevState.routePlannerResult && state.routePlannerResult) {
        const source = map.getSource(USER_ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        const route = state.routePlannerResult;
        
        if (route.reachable && route.geometry.coordinates.length > 0) {
          // Color route based on risk level
          const routeColor = route.risk_score <= 20 ? "#22C55E" : route.risk_score <= 50 ? "#F59E0B" : "#EF4444";
          if (map.getLayer(USER_ROUTE_LAYER_ID)) {
            map.setPaintProperty(USER_ROUTE_LAYER_ID, "line-color", routeColor);
            map.setPaintProperty("user-route-glow", "line-color", routeColor);
          }
          source?.setData({ type: "FeatureCollection", features: [
            { type: "Feature", properties: { risk_score: route.risk_score }, geometry: { type: "LineString", coordinates: route.geometry.coordinates } },
          ]});
        }
      }

      // Clear user route when planner resets.
      if (state.routePlannerMode !== prevState.routePlannerMode && state.routePlannerMode === "idle") {
        (map.getSource(USER_ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FEATURE_COLLECTION);
        (map.getSource(ROUTE_PINS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FEATURE_COLLECTION);
      }

      // One-shot camera request (e.g. scenario start frames the bridge).
      if (state.cameraTarget && state.cameraTarget !== prevState.cameraTarget) {
        map.flyTo({ center: state.cameraTarget.center, zoom: state.cameraTarget.zoom, duration: 1800 });
        useAppStore.getState().setCameraTarget(null);
      }
    });
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
