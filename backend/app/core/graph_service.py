"""Road graph loading, annotation, and mutation.

Responsibilities (implemented in Prompt 2 / Prompt 4):
- Load the cached OSM GraphML into an in-memory NetworkX MultiDiGraph at startup.
- Annotate edges with length_m, base_time_s, flood_depth_cm, status, safety_score,
  critical, updated_at.
- Snap POIs/zones from data/demo_area.json to nearest graph nodes.
- Precompute betweenness centrality to mark critical edges.
- apply_flood(edge_id, depth_cm) / clear_flood(edge_id): mutate edge attrs in place.
- build_snapshot(): produce the StateSnapshot broadcast over the WebSocket.

No logic implemented yet.
"""
