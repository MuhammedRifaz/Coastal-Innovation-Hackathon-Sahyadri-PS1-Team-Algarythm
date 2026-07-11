// Full-viewport MapLibre dark basemap with the live road network, colored
// by flood status. Snapshot updates call source.setData() only — the
// source/layers are created once on map load, never re-created.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "../store/useAppStore";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const ROADS_SOURCE_ID = "roads";
const BASE_LAYER_ID = "roads-base";
const FLOOD_OVERLAY_LAYER_ID = "roads-flood-overlay";

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

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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

    // "style.load" fires once the style/sources/sprite/glyphs are parsed
    // and ready — it does not wait for basemap raster/vector tiles to
    // finish fetching, so our GeoJSON overlay renders even if the CARTO
    // tile CDN is slow or briefly unreachable (map.on("load") would block
    // on that and can hang indefinitely).
    const addRoadsLayers = () => {
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

      let step = -1;
      const animate = (timestamp: number) => {
        const newStep = Math.floor((timestamp / 50) % DASH_SEQUENCE.length);
        if (newStep !== step) {
          if (map.getLayer(FLOOD_OVERLAY_LAYER_ID)) {
            map.setPaintProperty(FLOOD_OVERLAY_LAYER_ID, "line-dasharray", DASH_SEQUENCE[newStep]);
          }
          step = newStep;
        }
        animationFrameId = requestAnimationFrame(animate);
      };
      animationFrameId = requestAnimationFrame(animate);
    };

    if (map.isStyleLoaded()) {
      addRoadsLayers();
    } else {
      map.once("style.load", addRoadsLayers);
    }

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    return useAppStore.subscribe((state, prevState) => {
      if (state.roads === prevState.roads || !state.roads) return;
      const map = mapRef.current;
      if (!map) return;
      const source = map.getSource(ROADS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(state.roads);
    });
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
