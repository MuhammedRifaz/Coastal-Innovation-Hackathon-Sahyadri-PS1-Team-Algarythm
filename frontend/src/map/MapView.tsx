// Full-viewport MapLibre dark basemap: live road network colored by
// flood status, incidents, vehicles, and animated mission routes.
// Snapshot updates call source.setData() only — sources/layers are
// created once on style load, never re-created.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "../store/useAppStore";
import { postIncident } from "../lib/api";
import { useRouteAnimation } from "./useRouteAnimation";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const ROADS_SOURCE_ID = "roads";
const BASE_LAYER_ID = "roads-base";
const FLOOD_OVERLAY_LAYER_ID = "roads-flood-overlay";

const MISSIONS_SOURCE_ID = "mission-routes";
const MISSIONS_LAYER_ID = "mission-routes-line";

const INCIDENTS_SOURCE_ID = "incidents";
const INCIDENTS_RING_LAYER_ID = "incidents-ring";
const INCIDENTS_DOT_LAYER_ID = "incidents-dot";

const VEHICLES_SOURCE_ID = "vehicles";
const VEHICLES_LAYER_ID = "vehicles-chevron";

const CHEVRON_AVAILABLE_IMAGE = "chevron-available";
const CHEVRON_ENROUTE_IMAGE = "chevron-enroute";

// Default severity for click-to-report incidents until a severity picker
// UI exists (later polish prompt).
const DEFAULT_INCIDENT_SEVERITY = 2;

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
