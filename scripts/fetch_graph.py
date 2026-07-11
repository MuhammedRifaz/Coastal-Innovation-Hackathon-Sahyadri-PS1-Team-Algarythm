"""One-time OSM extract fetch (Prompt 2).

Downloads the drivable road network for a ~3x3 km bounding box around the
NH66 crossing of the Netravati river in Mangaluru (the "NH-66 River
Crossing" referenced in the master plan's demo script), simplifies it,
adds free speed/travel-time attributes, and saves it to
data/demo_graph.graphml. Run once, offline from then on — never fetched at
demo time.

Usage: python scripts/fetch_graph.py
"""

from pathlib import Path

import osmnx as ox

# (west, south, east, north) in decimal degrees — osmnx's bbox order.
# Centered on the NH66 / Netravati river crossing south of Mangaluru.
BBOX = (74.8342, 12.8285, 74.8618, 12.8555)

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
