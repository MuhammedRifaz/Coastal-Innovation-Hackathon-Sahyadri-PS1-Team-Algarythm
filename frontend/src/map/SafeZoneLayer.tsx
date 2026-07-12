// Safe Zone Layer — evacuation-facing visualization.
// Displays reachability halos around safe zones, evacuation routes from zones
// to their assigned safe zones, and greys out unreachable safe zones.
import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { useAppStore } from "../store/useAppStore";
import type { SafeZoneAssignment } from "../lib/types";

const SAFE_ZONES_SOURCE_ID = "safe-zones";
const SAFE_ZONES_HALO_LAYER_ID = "safe-zones-halo";
const SAFE_ZONES_DOT_LAYER_ID = "safe-zones-dot";

const EVAC_ROUTES_SOURCE_ID = "evac-routes";
const EVAC_ROUTES_LAYER_ID = "evac-routes-line";

const ZONE_CENTROIDS_SOURCE_ID = "zone-centroids";
const ZONE_CENTROIDS_LAYER_ID = "zone-centroids-dot";

export function useSafeZoneLayer(mapRef: React.RefObject<maplibregl.Map | null>) {
  const pois = useAppStore((s) => s.pois);
  const zones = useAppStore((s) => s.zones);
  const safeZoneMap = useAppStore((s) => s.safeZoneMap);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Create safe zone halo layer
    if (!map.getSource(SAFE_ZONES_SOURCE_ID)) {
      map.addSource(SAFE_ZONES_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: SAFE_ZONES_HALO_LAYER_ID,
        type: "circle",
        source: SAFE_ZONES_SOURCE_ID,
        paint: {
          "circle-radius": 8,
          "circle-color": [
            "case",
            ["boolean", ["feature-state", "unreachable"], false],
            "rgba(34, 197, 94, 0.2)", // Green for reachable
            "rgba(148, 163, 184, 0.1)", // Grey for unreachable
          ],
          "circle-blur": 1,
        },
      });

      map.addLayer({
        id: SAFE_ZONES_DOT_LAYER_ID,
        type: "circle",
        source: SAFE_ZONES_SOURCE_ID,
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "case",
            ["boolean", ["feature-state", "unreachable"], false],
            "#22C55E", // Green for reachable
            "#94A3B8", // Grey for unreachable
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    // Create evacuation routes layer
    if (!map.getSource(EVAC_ROUTES_SOURCE_ID)) {
      map.addSource(EVAC_ROUTES_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: EVAC_ROUTES_LAYER_ID,
        type: "line",
        source: EVAC_ROUTES_SOURCE_ID,
        paint: {
          "line-color": "#22C55E",
          "line-width": 2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.6,
        },
      });
    }

    // Create zone centroids layer
    if (!map.getSource(ZONE_CENTROIDS_SOURCE_ID)) {
      map.addSource(ZONE_CENTROIDS_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: ZONE_CENTROIDS_LAYER_ID,
        type: "circle",
        source: ZONE_CENTROIDS_SOURCE_ID,
        paint: {
          "circle-radius": 4,
          "circle-color": "#F59E0B",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Filter safe zones (shelters + stroke-ready hospitals)
    const safeZones = pois.filter(
      (p) => p.kind === "shelter" || (p.kind === "hospital" && p.stroke_ready)
    );

    // Build safe zone features
    const safeZoneFeatures = safeZones.map((sz) => ({
      type: "Feature" as const,
      properties: { id: sz.id, name: sz.name, kind: sz.kind },
      geometry: {
        type: "Point" as const,
        coordinates: [sz.lng, sz.lat],
      },
    }));

    // Determine which safe zones are reachable by checking assignments
    const reachableSafeZoneIds = new Set(
      Object.values(safeZoneMap)
        .filter((assignment: SafeZoneAssignment) => assignment.reachable && assignment.safe_zone_id)
        .map((assignment: SafeZoneAssignment) => assignment.safe_zone_id)
    );

    // Set feature state for unreachable safe zones
    safeZoneFeatures.forEach((feature) => {
      const isUnreachable = !reachableSafeZoneIds.has(feature.properties.id);
      if (map.getSource(SAFE_ZONES_SOURCE_ID)) {
        map.setFeatureState(
          { source: SAFE_ZONES_SOURCE_ID, id: feature.properties.id },
          { unreachable: isUnreachable }
        );
      }
    });

    const safeZonesGeoJSON: FeatureCollection = {
      type: "FeatureCollection",
      features: safeZoneFeatures,
    };

    const source = map.getSource(SAFE_ZONES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(safeZonesGeoJSON);
    }
  }, [mapRef, pois, safeZoneMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Build evacuation route features
    const evacRouteFeatures: FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    Object.entries(safeZoneMap).forEach(([zoneId, assignment]) => {
      const typedAssignment = assignment as SafeZoneAssignment;
      if (!typedAssignment.reachable || !typedAssignment.evac_route) return;

      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) return;

      const route = typedAssignment.evac_route;
      if (!route.reachable || !route.geometry) return;

      evacRouteFeatures.features.push({
        type: "Feature" as const,
        properties: {
          zoneId,
          safeZoneId: typedAssignment.safe_zone_id,
          eta_s: route.eta_s,
        },
        geometry: route.geometry,
      });
    });

    const source = map.getSource(EVAC_ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(evacRouteFeatures);
    }
  }, [mapRef, zones, safeZoneMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Build zone centroid features
    const zoneCentroidFeatures = zones.map((zone) => ({
      type: "Feature" as const,
      properties: { id: zone.id, name: zone.name, population: zone.population },
      geometry: {
        type: "Point" as const,
        coordinates: [zone.lng, zone.lat],
      },
    }));

    const zoneCentroidsGeoJSON: FeatureCollection = {
      type: "FeatureCollection",
      features: zoneCentroidFeatures,
    };

    const source = map.getSource(ZONE_CENTROIDS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(zoneCentroidsGeoJSON);
    }
  }, [mapRef, zones]);
}
