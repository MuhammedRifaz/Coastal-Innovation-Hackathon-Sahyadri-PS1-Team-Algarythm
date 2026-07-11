"""WebSocket connection manager for the single /ws channel (Prompt 4).

Tracks connected clients, sends a full StateSnapshot on connect, and
broadcasts a fresh snapshot to all clients on every graph_changed event.

No logic implemented yet.
"""
