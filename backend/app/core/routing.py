"""Risk-aware composite-cost routing engine (Prompt 3).

edge_cost(attrs): time x flood_multiplier(depth) x critical_penalty, infinite
above the impassable threshold (30 cm default).

compute_route(graph, origin_node, dest_node) -> RouteResult: A* over edge_cost
with a straight-line/max-speed admissible heuristic.

No logic implemented yet.
"""
