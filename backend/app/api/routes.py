"""REST command endpoints (commands only — state flows over the WebSocket).

Routes to add as build prompts land:
GET  /api/graph
POST /api/floods, /api/floods/clear
POST /api/incidents, /api/incidents/{id}/resolve
POST /api/whatif
POST /api/scenario/start, /api/scenario/reset

No routes implemented yet.
"""
