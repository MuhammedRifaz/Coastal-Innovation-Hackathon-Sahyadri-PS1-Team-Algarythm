// WebSocket client for the single /ws channel. Auto-reconnects with a
// fixed backoff; every message is a full StateSnapshot written straight
// into useAppStore.
import { useAppStore } from "../store/useAppStore";
import type { StateSnapshot } from "./types";

const RECONNECT_DELAY_MS = 1500;

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function connectWebSocket(): void {
  const socket = new WebSocket(wsUrl());

  socket.onopen = () => {
    useAppStore.getState().setWsConnected(true);
  };

  socket.onmessage = (event) => {
    const snapshot = JSON.parse(event.data) as StateSnapshot;
    useAppStore.getState().setFromSnapshot(snapshot);
  };

  socket.onclose = () => {
    useAppStore.getState().setWsConnected(false);
    setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
  };

  socket.onerror = () => {
    socket.close();
  };
}
