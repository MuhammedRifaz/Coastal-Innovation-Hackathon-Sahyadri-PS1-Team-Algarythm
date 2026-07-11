"""One-time OSM extract fetch (Prompt 2).

Downloads the drivable road network spanning the NH66 Nethravathi Bridge
crossing between Mangaluru (north bank) and Ullal (south bank) — the
"NH-66 River Crossing" referenced in the master plan's demo script —
simplifies it, adds free speed/travel-time attributes, and saves it to
data/demo_graph.graphml. Run once, offline from then on — never fetched at
demo time.

The box is taller than the original "~3x3 km" guideline (about 3.3km x
6.7km) because a tighter box around the bridge only clipped a 2-node stub
of the south bank — not enough for a real demo zone. This size verified
to produce a genuine chokepoint: removing the crossing's edges (see
CRITICAL_BRIDGE_EDGE_IDS in graph_service.py) splits the graph into a
931-node north component and a 649-node south component, with no other
route between them in this extract.

Usage: python scripts/fetch_graph.py
"""

from pathlib import Path

import osmnx as ox

# (west, south, east, north) in decimal degrees — osmnx's bbox order.
# Spans from central Mangaluru down to Ullal, straddling the Nethravathi
# river so both banks of the NH66 bridge crossing are present.
BBOX = (74.835, 12.805, 74.868, 12.865)

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "demo_graph.graphml"


def main() -> None:
    graph = ox.graph_from_bbox(bbox=BBOX, network_type="drive", simplify=True)
    graph = ox.add_edge_speeds(graph)
    graph = ox.add_edge_travel_times(graph)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(graph, filepath=OUTPUT_PATH)

    print(f"Saved {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
