"""Fleet assignment engine (Prompt 8).

assign(incident) -> Mission: best + backup vehicle by true route cost, with
structured rejection reasons for closer-by-distance vehicles that lose out.

reassess_all(): reroute or reassign active missions after any graph change.

No logic implemented yet.
"""
